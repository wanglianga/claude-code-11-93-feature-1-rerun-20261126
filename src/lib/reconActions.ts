// 重量差异复核动作层：所有复核状态变更经此落库 + 事件日志 + 广播。
// 关键纪律：估重/整车差额/回站补称永不写成站点实收；推导值与实测严格分账；重复上传不增量。
import type {
  BoundedMeasure, EvidenceRequest, Interval, JointDependencyCheck, JointReview,
  MidUnload, SealRecord, StationVerification, TicketKind, WeightTicket,
} from '../types';
import { fmtMin, round2 } from '../types';
import { getDb, type Snapshot } from './db';
import { bus } from './actions';
import {
  addIntervals, allDepsChecked, computeCandidate, computeTotalGain, countChecked,
  deriveChecks, emptyChecks, estimateConsistent, sameTicketNoDifferentContent,
  sumStationTickets, toInterval,
} from './recon';
import { TRIP_ID } from './seed';

function emitChange() {
  bus.dispatchEvent(new Event('change'));
}

async function log(db: any, tsMin: number, actor: string, type: string, message: string) {
  await db.add('events', { tsMin, actor, type, message });
}

let seq = 0;
// 加载期随机标签 + 单调序号：生成 ID 带 GEN- 前缀，绝不与种子固定 ID 撞键，跨会话也不重复
const LOAD_TAG = Math.random().toString(36).slice(2, 8);
function nextId(prefix: string): string {
  seq += 1;
  return `GEN-${prefix}-${LOAD_TAG}-${seq}`;
}

let ticketSeq = 0;
function nextTicketNo(kind: string): string {
  ticketSeq += 1;
  return `WB-${kind}-${LOAD_TAG}-${String(ticketSeq).padStart(3, '0')}`;
}

export interface ActionResult {
  ok: boolean;
  verdict?: 'accepted' | 'duplicate' | 'conflict' | 'rejected';
  message: string;
}

// ---------- 派生：当前联合候选（总增重 − 已知站量） ----------

export interface JointCandidateView {
  tare?: WeightTicket;
  final?: WeightTicket;
  totalGain: Interval | null;
  knownInterval: Interval;
  candidate: Interval | null;
  objectiveChecks: JointDependencyCheck;
  checkedCount: number;
}

export function currentTicket(snap: Snapshot, kind: TicketKind): WeightTicket | undefined {
  return snap.weightTickets.find((t) => t.tripId === TRIP_ID && t.kind === kind && t.lifecycle === 'current');
}

export function currentStationTicket(snap: Snapshot, stationId: string): WeightTicket | undefined {
  return snap.weightTickets.find(
    (t) => t.tripId === TRIP_ID && t.kind === 'station' && t.stationId === stationId && t.lifecycle === 'current',
  );
}

export function jointCandidate(snap: Snapshot): JointCandidateView {
  const tare = currentTicket(snap, 'tare');
  const final = currentTicket(snap, 'final');
  const stationTickets = snap.weightTickets.filter((t) => t.tripId === TRIP_ID && t.kind === 'station');
  const knownInterval = sumStationTickets(stationTickets);
  const totalGain = tare && final ? computeTotalGain(tare.measure, final.measure) : null;
  const candidate = totalGain ? computeCandidate(totalGain, knownInterval) : null;
  const objectiveChecks = deriveChecks(snap.weightTickets, snap.seals);
  return {
    tare, final, totalGain, knownInterval, candidate, objectiveChecks,
    checkedCount: countChecked(objectiveChecks),
  };
}

// ---------- 票据：司机提交原票（幂等 / 同号异容冲突） ----------

export async function submitTicket(
  snap: Snapshot,
  input: {
    ticketNo: string; kind: TicketKind; stationId?: string;
    measure: BoundedMeasure; calibrationValid: boolean;
    submittedBy: string; submittedByName: string; offline: boolean; note?: string;
  },
): Promise<ActionResult> {
  const db = await getDb();
  const t = snap.nowMin;
  const sameNo = snap.weightTickets.filter((x) => x.ticketNo === input.ticketNo);

  // 同票号同内容：重复上传，只计一次，不产生任何新增重量
  const identical = sameNo.find(
    (x) => x.measure.value === input.measure.value && x.measure.tol === input.measure.tol
      && x.calibrationValid === input.calibrationValid,
  );
  if (identical) {
    await log(db, t, input.submittedByName, 'recon-duplicate',
      `票据 ${input.ticketNo} 重复上传：内容一致，按幂等只计一次，不增加清运量`);
    emitChange();
    return { ok: true, verdict: 'duplicate', message: '同一票据重复上传，已按幂等忽略，不增加清运量' };
  }
  // 同票号不同内容：冲突，单独留痕为 rejected，绝不静默覆盖
  const conflicting = sameNo.find((x) => sameTicketNoDifferentContent(x, input));
  if (conflicting) {
    const bad: WeightTicket = {
      id: nextId('WT-CONF'), ticketNo: input.ticketNo, tripId: TRIP_ID, kind: input.kind,
      stationId: input.stationId, measure: input.measure, calibrationValid: input.calibrationValid,
      lifecycle: 'rejected', submittedBy: input.submittedBy, submittedByName: input.submittedByName,
      submittedAtMin: t, deviceTimeMin: t, offline: input.offline,
      conflictNote: `票号 ${input.ticketNo} 已存在但内容不同（原值 ${conflicting.measure.value}±${conflicting.measure.tol}），冲突拒纳`,
      note: input.note,
    };
    await db.put('weightTickets', bad);
    await log(db, t, input.submittedByName, 'recon-conflict',
      `票据 ${input.ticketNo} 同号不同内容冲突：新报 ${input.measure.value}±${input.measure.tol} vs 原 ${conflicting.measure.value}±${conflicting.measure.tol}，已拒纳留痕`);
    emitChange();
    return { ok: false, verdict: 'conflict', message: '票号相同但内容不同，判冲突并留痕，未覆盖原票' };
  }

  const ticket: WeightTicket = {
    id: nextId('WT'), ticketNo: input.ticketNo, tripId: TRIP_ID, kind: input.kind,
    stationId: input.stationId, measure: input.measure, calibrationValid: input.calibrationValid,
    lifecycle: 'current', submittedBy: input.submittedBy, submittedByName: input.submittedByName,
    submittedAtMin: t, deviceTimeMin: t, offline: input.offline, note: input.note,
  };
  await db.put('weightTickets', ticket);
  await log(db, t, input.submittedByName, 'recon-ticket',
    `票据 ${input.ticketNo}（${input.kind}${input.stationId ? ' ' + input.stationId : ''}）受理：${input.measure.value}±${input.measure.tol} 吨，校准${input.calibrationValid ? '有效' : '失效'}`);
  emitChange();
  return { ok: true, verdict: 'accepted', message: '票据已受理' };
}

// ---------- 终磅更正：旧票留痕、重开联合、逐站结论不撤回 ----------

export async function reviseFinalTicket(
  snap: Snapshot,
  input: { measure: BoundedMeasure; calibrationValid: boolean; actor: string; note?: string },
): Promise<ActionResult> {
  const db = await getDb();
  const t = snap.nowMin;
  const old = currentTicket(snap, 'final');
  if (!old) return { ok: false, message: '无现行终磅票可更正' };

  old.lifecycle = 'superseded';
  const corrected: WeightTicket = {
    id: nextId('WT-FINAL'), ticketNo: nextTicketNo('FINAL-REV'), tripId: TRIP_ID,
    kind: 'final', measure: input.measure, calibrationValid: input.calibrationValid,
    lifecycle: 'current', submittedBy: 'REV', submittedByName: input.actor,
    submittedAtMin: t, deviceTimeMin: t, offline: false, revisionOf: old.id,
    note: input.note ?? `终磅更正（替代 ${old.ticketNo}）`,
  };
  await db.put('weightTickets', old);
  await db.put('weightTickets', corrected);
  await log(db, t, input.actor, 'recon-revise',
    `终磅更正：${old.ticketNo}（${old.measure.value}±${old.measure.tol}）作废留痕，现行 ${corrected.ticketNo} = ${input.measure.value}±${input.measure.tol} 吨`);

  // 联合候选依赖终磅 → 已签发联合复核必须重开，候选区间随之重算
  const jr = snap.jointReviews.find((j) => j.tripId === TRIP_ID);
  if (jr && jr.status === 'issued') {
    await reopenJoint(db, snap, jr, `终磅由 ${old.measure.value}±${old.measure.tol} 更正为 ${input.measure.value}±${input.measure.tol}，联合候选依据变更`, t, input.actor);
  } else if (jr) {
    jr.basedOnFinalTicketId = corrected.id;
    jr.checks = emptyChecks();
    jr.history.push({ atMin: t, actor: input.actor, message: `终磅更正为 ${input.measure.value}±${input.measure.tol}，联合复核依赖重置待审` });
    await db.put('jointReviews', jr);
  }
  // 纪律：逐站方式的 S1/S2 票据结论不因此撤回（此处不动 stationVerifications）
  emitChange();
  // 直接按更正后的终磅与现行空载、已知站量计算候选（新票尚未进入传入快照）
  const tare = currentTicket(snap, 'tare');
  let candText = '—';
  if (tare) {
    const totalGain = computeTotalGain(tare.measure, input.measure);
    const known = sumStationTickets(snap.weightTickets.filter((x) => x.tripId === TRIP_ID && x.kind === 'station'));
    const cand = computeCandidate(totalGain, known);
    candText = `[${cand.lo.toFixed(2)}, ${cand.hi.toFixed(2)}]`;
  }
  return {
    ok: true, verdict: 'accepted',
    message: `终磅已更正，联合复核已重开/重置；新候选区间 ${candText}；S1/S2 逐站结论不撤回`,
  };
}

async function reopenJoint(db: any, snap: Snapshot, jr: JointReview, reason: string, t: number, actor: string) {
  jr.status = 'reopened';
  jr.reopenedReason = reason;
  jr.candidateInterval = undefined;
  jr.checks = emptyChecks();
  jr.history.push({ atMin: t, actor, message: `联合复核重开：${reason}` });
  await db.put('jointReviews', jr);
  await log(db, t, actor, 'recon-joint-reopen', `联合复核单 ${jr.id} 重开：${reason}`);
}

// ---------- 封闭签认：班组补封闭记录 / 离线晚到失效 ----------

export async function submitSeal(
  snap: Snapshot,
  input: { stage: SealRecord['stage']; label: string; signedBy: string; offline: boolean; note?: string },
): Promise<ActionResult> {
  const db = await getDb();
  const t = snap.nowMin;
  const existing = snap.seals.find((s) => s.tripId === TRIP_ID && s.stage === input.stage);
  // 离线签认晚到：无法在相关时点独立验证 → 依赖失效
  if (input.offline) {
    if (existing) {
      existing.valid = false;
      existing.invalidateReason = '离线签认晚到，未能在作业时点完成验证，封闭依赖失效';
      existing.offline = true;
      await db.put('seals', existing);
    } else {
      const seal: SealRecord = {
        id: nextId('SEAL'), tripId: TRIP_ID, stage: input.stage, label: input.label,
        signedBy: input.signedBy, signedAtMin: t, noAddNoUnload: true, valid: false, offline: true,
        invalidateReason: '离线签认晚到，验证依赖失效', note: input.note,
      };
      await db.put('seals', seal);
    }
    await log(db, t, input.signedBy, 'recon-seal-invalid',
      `${input.label} 离线签认晚到 → 验证依赖失效，联合复核该阶段封闭性不成立`);
    const jr = snap.jointReviews.find((j) => j.tripId === TRIP_ID);
    if (jr && jr.status === 'issued') {
      await reopenJoint(db, snap, jr, `${input.label} 离线签认晚到失效，整趟封闭性不再成立`, t, input.signedBy);
    }
    emitChange();
    return { ok: false, verdict: 'rejected', message: '离线签认晚到，验证依赖失效，不能作为联合复核封闭依据' };
  }
  // 正常在线补封闭记录
  if (existing) {
    existing.valid = true;
    existing.invalidateReason = undefined;
    existing.signedBy = input.signedBy;
    existing.note = input.note ?? existing.note;
    await db.put('seals', existing);
  } else {
    const seal: SealRecord = {
      id: nextId('SEAL'), tripId: TRIP_ID, stage: input.stage, label: input.label,
      signedBy: input.signedBy, signedAtMin: t, noAddNoUnload: true, valid: true, offline: false, note: input.note,
    };
    await db.put('seals', seal);
  }
  await log(db, t, input.signedBy, 'recon-seal', `${input.label} 封闭签认有效：无加料、无卸料、未换车`);
  emitChange();
  return { ok: true, verdict: 'accepted', message: '封闭签认已记录并有效' };
}

// ---------- 中途卸料被补发现：破坏封闭性 ----------

export async function reportMidUnload(
  snap: Snapshot,
  input: { stage: SealRecord['stage']; detail: string; actor: string },
): Promise<ActionResult> {
  const db = await getDb();
  const t = snap.nowMin;
  const stageLabel: Record<SealRecord['stage'], string> = {
    'depot-s1': '出车→S1', 's1-s2': 'S1→S2', 's2-final': 'S2→终磅',
  };
  const unload: MidUnload = {
    id: nextId('MU'), tripId: TRIP_ID, stage: input.stage,
    foundAtMin: t, foundBy: input.actor, detail: input.detail,
  };
  await db.put('midUnloads', unload);
  const seal = snap.seals.find((s) => s.tripId === TRIP_ID && s.stage === input.stage);
  if (seal) {
    seal.valid = false;
    seal.invalidateReason = `中途卸料被补发现：${input.detail}`;
    await db.put('seals', seal);
  }
  await log(db, t, input.actor, 'recon-midunload',
    `${stageLabel[input.stage]} 中途卸料被补发现（${input.detail}），该阶段封闭签认失效，整车闭合推导前提破坏`);
  const jr = snap.jointReviews.find((j) => j.tripId === TRIP_ID);
  if (jr && jr.status === 'issued') {
    await reopenJoint(db, snap, jr, `${stageLabel[input.stage]} 中途卸料被补发现，整趟封闭性破坏，候选区间不可采用`, t, input.actor);
  }
  emitChange();
  return { ok: true, message: '已登记中途卸料并失效对应封闭签认；若联合复核已签发则自动重开' };
}

// ---------- 逐站核实（独立边界，不等跨站材料） ----------

export async function issueStationVerification(
  snap: Snapshot,
  input: { stationId: string; actor: string; note?: string },
): Promise<ActionResult> {
  const db = await getDb();
  const t = snap.nowMin;
  const sv = snap.stationVerifications.find((x) => x.tripId === TRIP_ID && x.stationId === input.stationId);
  if (!sv) return { ok: false, message: '无该站点核实单' };
  const ticket = currentStationTicket(snap, input.stationId);
  if (!ticket || !ticket.calibrationValid || ticket.lifecycle !== 'current') {
    sv.status = 'unknown-evidence';
    sv.note = '无有效站点秤票原件，事实待查：保留未知并派补证，不给量化范围，不以估重/整车差额顶替';
    await db.put('stationVerifications', sv);
    await ensureEvidenceRequest(db, snap, input.stationId, t, input.actor);
    await log(db, t, input.actor, 'recon-station-unknown',
      `${input.stationId} 逐站核实：无有效原件，结论保留未知并派补证（不等待跨站材料）`);
    emitChange();
    return { ok: false, verdict: 'rejected', message: '无有效原件，该站保留未知并派补证，不出具量化结论' };
  }
  sv.status = 'verified';
  sv.ticketId = ticket.id;
  sv.measuredInterval = toInterval(ticket.measure);
  sv.signedBy = input.actor;
  sv.signedAtMin = t;
  sv.note = input.note ?? `凭本站有效秤票 ${ticket.ticketNo} 独立核实，仅覆盖本站重量与作业凭证`;
  await db.put('stationVerifications', sv);
  await log(db, t, input.actor, 'recon-station-verified',
    `${input.stationId} 逐站核实签发：实测区间 [${sv.measuredInterval.lo.toFixed(2)}, ${sv.measuredInterval.hi.toFixed(2)}] 吨（票据 ${ticket.ticketNo}）`);
  emitChange();
  return { ok: true, verdict: 'accepted', message: `${input.stationId} 已凭本站有效原件独立核实` };
}

async function ensureEvidenceRequest(db: any, snap: Snapshot, stationId: string, t: number, actor: string) {
  const exists = snap.evidenceRequests.find((e) => e.tripId === TRIP_ID && e.stationId === stationId);
  if (exists) return;
  const er: EvidenceRequest = {
    id: nextId('ER'), tripId: TRIP_ID, stationId, status: 'open',
    reason: `${stationId} 缺站点秤票原件，无法独立核实本站实收`,
    openedAtMin: t, openedBy: actor,
  };
  await db.put('evidenceRequests', er);
}

// ---------- 联合复核：5 项依赖逐项审核 + 签发 ----------

export async function toggleDependency(
  snap: Snapshot,
  input: { key: keyof JointDependencyCheck; actor: string },
): Promise<ActionResult> {
  const db = await getDb();
  const jr = snap.jointReviews.find((j) => j.tripId === TRIP_ID);
  if (!jr) return { ok: false, message: '无联合复核单' };
  if (jr.status === 'issued') return { ok: false, message: '联合复核已签发；依赖变更须先重开' };
  const objective = deriveChecks(snap.weightTickets, snap.seals);
  if (!jr.checks[input.key] && !objective[input.key]) {
    return { ok: false, verdict: 'rejected', message: '客观材料不支持该项（票据须现行且校准有效，签认须未失效），不能勾选' };
  }
  jr.checks[input.key] = !jr.checks[input.key];
  await db.put('jointReviews', jr);
  emitChange();
  return { ok: true, message: `依赖项已${jr.checks[input.key] ? '审核通过' : '取消'}（${countChecked(jr.checks)}/5）` };
}

export async function issueJointReview(snap: Snapshot, input: { actor: string }): Promise<ActionResult> {
  const db = await getDb();
  const t = snap.nowMin;
  const jr = snap.jointReviews.find((j) => j.tripId === TRIP_ID);
  if (!jr) return { ok: false, message: '无联合复核单' };
  if (jr.status === 'issued') return { ok: false, message: '联合复核已签发' };
  const objective = deriveChecks(snap.weightTickets, snap.seals);
  if (!allDepsChecked(jr.checks) || !allDepsChecked(objective)) {
    return { ok: false, verdict: 'rejected', message: `须先审核全部 5 项依赖（当前人工 ${countChecked(jr.checks)}/5，客观 ${countChecked(objective)}/5）` };
  }
  const view = jointCandidate(snap);
  if (!view.candidate || !view.tare || !view.final) return { ok: false, message: '地磅票不完整，无法推导候选' };
  jr.status = 'issued';
  jr.candidateInterval = view.candidate;
  jr.basedOnTareTicketId = view.tare.id;
  jr.basedOnFinalTicketId = view.final.id;
  jr.issuedAtMin = t;
  jr.issuedBy = input.actor;
  jr.reopenedReason = undefined;
  jr.history.push({
    atMin: t, actor: input.actor,
    message: `联合复核签发：总增重 [${view.totalGain!.lo.toFixed(2)}, ${view.totalGain!.hi.toFixed(2)}] − 已知站量 [${view.knownInterval.lo.toFixed(2)}, ${view.knownInterval.hi.toFixed(2)}] → S3 候选 [${view.candidate.lo.toFixed(2)}, ${view.candidate.hi.toFixed(2)}]（闭合推导，非独立实测）`,
  });
  await db.put('jointReviews', jr);
  await log(db, t, input.actor, 'recon-joint-issue',
    `联合复核签发，S3 候选区间 [${view.candidate.lo.toFixed(2)}, ${view.candidate.hi.toFixed(2)}] 吨（推导值，不得记作站点实收）`);
  emitChange();
  return { ok: true, verdict: 'accepted', message: '联合复核已签发，候选为推导口径（非实测）' };
}

// ---------- 补证责任：司机提交 / 复核员采用或退回 / 站长查明缺失 ----------

export async function submitEvidence(
  snap: Snapshot,
  input: { requestId: string; text: string; actor: string; measure?: BoundedMeasure; calibrationValid?: boolean },
): Promise<ActionResult> {
  const db = await getDb();
  const t = snap.nowMin;
  const er = snap.evidenceRequests.find((e) => e.id === input.requestId);
  if (!er) return { ok: false, message: '无补证责任单' };
  er.driverSubmission = input.measure
    ? `${input.text}（随附原票 ${input.measure.value}±${input.measure.tol} 吨，校准${input.calibrationValid ? '有效' : '失效'}）`
    : input.text;
  er.status = 'submitted';
  er.submittedAtMin = t;
  // 随附有效原票则入票据池（仍须复核员采用后才核实）
  if (input.measure) {
    const ticketNo = nextTicketNo(`${er.stationId}-SUP`);
    const ticket: WeightTicket = {
      id: nextId('WT-SUP'), ticketNo, tripId: TRIP_ID, kind: 'station', stationId: er.stationId,
      measure: input.measure, calibrationValid: !!input.calibrationValid, lifecycle: 'current',
      submittedBy: 'D01', submittedByName: input.actor, submittedAtMin: t, deviceTimeMin: t, offline: false,
      note: '补证随附原件，待复核员采用',
    };
    await db.put('weightTickets', ticket);
  }
  await db.put('evidenceRequests', er);
  await log(db, t, input.actor, 'recon-evidence-submit', `${er.stationId} 补证材料已提交，等待复核员采用/退回`);
  emitChange();
  return { ok: true, verdict: 'accepted', message: '补证材料已提交，等待复核员采用或退回' };
}

export async function adoptEvidence(snap: Snapshot, input: { requestId: string; actor: string }): Promise<ActionResult> {
  const db = await getDb();
  const t = snap.nowMin;
  const er = snap.evidenceRequests.find((e) => e.id === input.requestId);
  if (!er || er.status !== 'submitted') return { ok: false, message: '补证单未处于待采用状态' };
  const ticket = currentStationTicket(snap, er.stationId);
  if (!ticket || !ticket.calibrationValid) {
    er.status = 'returned';
    er.note = '补交材料无有效原件（缺有效校准秤票），不能采用为实测';
    er.resolvedAtMin = t; er.resolvedBy = input.actor;
    await db.put('evidenceRequests', er);
    await log(db, t, input.actor, 'recon-evidence-return', `${er.stationId} 补证无有效原件，退回，站点继续待核`);
    emitChange();
    return { ok: false, verdict: 'rejected', message: '无有效原件，退回补证；站点继续待核，不得填作实收' };
  }
  // 采用 → 该站获得独立实测
  const sv = snap.stationVerifications.find((x) => x.tripId === TRIP_ID && x.stationId === er.stationId)!;
  sv.status = 'verified';
  sv.ticketId = ticket.id;
  sv.measuredInterval = toInterval(ticket.measure);
  sv.signedBy = input.actor;
  sv.signedAtMin = t;
  sv.note = `补证原件 ${ticket.ticketNo} 经复核员采用，转为独立实测`;
  er.status = 'adopted';
  er.resolvedAtMin = t; er.resolvedBy = input.actor;
  await db.put('stationVerifications', sv);
  await db.put('evidenceRequests', er);
  await log(db, t, input.actor, 'recon-evidence-adopt',
    `${er.stationId} 补证采用：实测 [${sv.measuredInterval!.lo.toFixed(2)}, ${sv.measuredInterval!.hi.toFixed(2)}] 吨，正式计入实测口径`);
  emitChange();
  return { ok: true, verdict: 'accepted', message: '补证已采用为独立实测并计入正式累计' };
}

export async function returnEvidence(snap: Snapshot, input: { requestId: string; reason: string; actor: string }): Promise<ActionResult> {
  const db = await getDb();
  const t = snap.nowMin;
  const er = snap.evidenceRequests.find((e) => e.id === input.requestId);
  if (!er) return { ok: false, message: '无补证责任单' };
  er.status = 'returned';
  er.note = `复核员退回：${input.reason}`;
  er.resolvedAtMin = t; er.resolvedBy = input.actor;
  await db.put('evidenceRequests', er);
  await log(db, t, input.actor, 'recon-evidence-return', `${er.stationId} 补证退回：${input.reason}`);
  emitChange();
  return { ok: true, message: '补证已退回，可重新提交' };
}

export async function adminResolveMissingOriginal(
  snap: Snapshot,
  input: { requestId: string; finding: string; actor: string },
): Promise<ActionResult> {
  const db = await getDb();
  const t = snap.nowMin;
  const er = snap.evidenceRequests.find((e) => e.id === input.requestId);
  if (!er) return { ok: false, message: '无补证责任单' };
  const ticket = currentStationTicket(snap, er.stationId);
  if (ticket && ticket.calibrationValid) {
    return { ok: false, message: '已存在有效原件，应走复核员采用流程，而非按缺失原件结案' };
  }
  er.status = 'closed-no-original';
  er.adminFinding = input.finding;
  er.resolvedAtMin = t; er.resolvedBy = input.actor;
  const sv = snap.stationVerifications.find((x) => x.tripId === TRIP_ID && x.stationId === er.stationId);
  if (sv) {
    sv.status = 'unknown-evidence';
    sv.note = `站点管理员查明：${input.finding}；无有效原件，继续待核，不产生实测重量`;
    await db.put('stationVerifications', sv);
  }
  await db.put('evidenceRequests', er);
  await log(db, t, input.actor, 'recon-evidence-closed',
    `${er.stationId} 缺失原件结案：${input.finding}；该站继续待核，正式累计不计其重量`);
  emitChange();
  return { ok: true, message: '已按缺失原件结案，站点继续待核且不计入实收' };
}

// ---------- 回站补称：混载后不能重建历史站量 ----------

export async function attemptBackstationReweigh(snap: Snapshot, input: { stationId: string; actor: string }): Promise<ActionResult> {
  const db = await getDb();
  const t = snap.nowMin;
  await log(db, t, input.actor, 'recon-backstation-reject',
    `${input.stationId} 尝试以回站后重新称重重建历史站量被拒：混载后无法还原该站装载时点重量，不能作为本站实收`);
  emitChange();
  return {
    ok: false, verdict: 'rejected',
    message: '混载后回站补称不能重建历史站量，拒绝作为实收证据；无有效原件的站点继续待核',
  };
}

// ---------- 估重与推导不一致：只触发差异调查，不重派清运 ----------

export async function openDifferenceInvestigation(snap: Snapshot, input: { stationId: string; actor: string }): Promise<ActionResult> {
  const db = await getDb();
  const t = snap.nowMin;
  const sv = snap.stationVerifications.find((x) => x.tripId === TRIP_ID && x.stationId === input.stationId);
  const view = jointCandidate(snap);
  const est = sv?.estTon;
  let consistent = true;
  if (view.candidate && est != null) consistent = estimateConsistent(view.candidate, est);
  const er = snap.evidenceRequests.find((e) => e.tripId === TRIP_ID && e.stationId === input.stationId);
  if (er && !consistent) {
    er.status = 'investigating';
    er.note = `估重 ${est}t 落在推导候选 [${view.candidate!.lo.toFixed(2)}, ${view.candidate!.hi.toFixed(2)}] 之外，启动差异调查；仅核查计量与凭证，不据此再派一次清运`;
    await db.put('evidenceRequests', er);
  }
  await log(db, t, input.actor, 'recon-diff-investigate',
    `${input.stationId} 估重${est}t 与候选区间${consistent ? '相容，无需调查' : '不一致，启动差异调查（不重派清运、不改写实收）'}`);
  emitChange();
  return {
    ok: true,
    message: consistent
      ? '估重与当前区间相容，无需调查'
      : '已启动差异调查：只核查计量与凭证，不直接再派一次清运，也不改写实收',
  };
}

// ---------- 正式累计：只读取已批准实测 ----------

export function selectAccumulated(snap: Snapshot) {
  const verified = new Set(
    snap.stationVerifications.filter((v) => v.status === 'verified').map((v) => v.stationId),
  );
  const stationTickets = snap.weightTickets.filter((t) => t.tripId === TRIP_ID && t.kind === 'station');
  const measuredTon = stationTickets
    .filter((t) => t.lifecycle === 'current' && t.calibrationValid && t.stationId && verified.has(t.stationId))
    .reduce((sum, t) => round2(sum + t.measure.value), 0);
  const jr = snap.jointReviews.find((j) => j.tripId === TRIP_ID);
  const derived = jr?.status === 'issued' && jr.candidateInterval
    ? { stationId: 'S3', interval: jr.candidateInterval }
    : undefined;
  return {
    measuredTon: round2(measuredTon),
    verifiedStationIds: Array.from(verified),
    pendingStationIds: snap.stationVerifications.filter((v) => v.status !== 'verified').map((v) => v.stationId),
    derived,
  };
}

// 供 UI 显示 S1/S2 已知合计区间
export function knownStationInterval(snap: Snapshot): Interval {
  return snap.weightTickets
    .filter((t) => t.tripId === TRIP_ID && t.kind === 'station')
    .reduce<Interval>((acc, t) => (t.lifecycle === 'current' && t.calibrationValid ? addIntervals(acc, toInterval(t.measure)) : acc), { lo: 0, hi: 0 });
}
