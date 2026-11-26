// 复核端到端集成测试（fake-indexeddb）：逐站/联合两边界、终磅更正重开、封闭破坏、补证、正式累计
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadSnapshot, type Snapshot } from '../lib/db';
import { resetDemo } from '../lib/actions';
import {
  adoptEvidence, adminResolveMissingOriginal, attemptBackstationReweigh,
  issueJointReview, issueStationVerification, jointCandidate,
  openDifferenceInvestigation, reportMidUnload, returnEvidence, selectAccumulated,
  submitEvidence, submitSeal, submitTicket, toggleDependency, reviseFinalTicket,
} from '../lib/reconActions';
import type { JointDependencyCheck } from '../types';

async function snap(): Promise<Snapshot> {
  return loadSnapshot();
}

const REVIEWER = '周复核';
const DRIVER = '老王';
const CREW = '郑班组';
const ADMIN = '吴站长';
const ALL_KEYS: (keyof JointDependencyCheck)[] = [
  'tareTicket', 'finalTicket', 'sealDepotS1', 'sealS1S2', 'sealS2Final',
];

async function issueJoint(s: Snapshot) {
  for (const key of ALL_KEYS) {
    const r = await toggleDependency(s, { key, actor: REVIEWER });
    expect(r.ok).toBe(true);
    s = await snap();
  }
  const r = await issueJointReview(s, { actor: REVIEWER });
  expect(r.ok).toBe(true);
}

describe('TRIP-1 重量差异补证复核（集成）', () => {
  beforeEach(async () => {
    await resetDemo();
  });

  it('种子现场：总增重[3.45,3.75]、已知[1.55,1.85]、S3候选[1.60,2.20]，S3 无票已派补证', async () => {
    const s = await snap();
    const view = jointCandidate(s);
    expect(view.totalGain).toEqual({ lo: 3.45, hi: 3.75 });
    expect(view.knownInterval).toEqual({ lo: 1.55, hi: 1.85 });
    expect(view.candidate).toEqual({ lo: 1.6, hi: 2.2 });
    expect(view.checkedCount).toBe(5); // 客观材料 initially 全成立
    const sv3 = s.stationVerifications.find((v) => v.stationId === 'S3')!;
    expect(sv3.status).toBe('unknown-evidence');
    expect(s.evidenceRequests.find((e) => e.stationId === 'S3')!.status).toBe('open');
  });

  it('逐站边界：S1/S2 凭本站有效票独立核实；S3 无票保留未知、不给量化范围', async () => {
    let s = await snap();
    const r1 = await issueStationVerification(s, { stationId: 'S1', actor: REVIEWER });
    expect(r1.verdict).toBe('accepted');
    s = await snap();
    const r2 = await issueStationVerification(s, { stationId: 'S2', actor: REVIEWER });
    expect(r2.verdict).toBe('accepted');
    s = await snap();
    const sv1 = s.stationVerifications.find((v) => v.stationId === 'S1')!;
    const sv2 = s.stationVerifications.find((v) => v.stationId === 'S2')!;
    expect(sv1.status).toBe('verified');
    expect(sv1.measuredInterval).toEqual({ lo: 0.65, hi: 0.75 });
    expect(sv2.measuredInterval).toEqual({ lo: 0.9, hi: 1.1 });

    // S3 无有效原件 → 保留未知，不出量化结论
    const r3 = await issueStationVerification(s, { stationId: 'S3', actor: REVIEWER });
    expect(r3.ok).toBe(false);
    s = await snap();
    const sv3 = s.stationVerifications.find((v) => v.stationId === 'S3')!;
    expect(sv3.status).toBe('unknown-evidence');
    expect(sv3.measuredInterval).toBeUndefined();

    // 正式累计只读实测：1.70 吨，S3 待核不计
    const acc = selectAccumulated(s);
    expect(acc.measuredTon).toBeCloseTo(1.7);
    expect(acc.pendingStationIds).toContain('S3');
  });

  it('联合边界：5 项依赖逐项审核后签发，候选标注为推导值；未审齐不能签发', async () => {
    let s = await snap();
    const before = await issueJointReview(s, { actor: REVIEWER });
    expect(before.ok).toBe(false); // 一项未审，不能签发
    await issueJoint(s);
    s = await snap();
    const jr = s.jointReviews.find((j) => j.id === 'JR-1')!;
    expect(jr.status).toBe('issued');
    expect(jr.candidateInterval).toEqual({ lo: 1.6, hi: 2.2 });
    // 候选是推导：S3 逐站结论仍为未知，未写成实测
    const sv3 = s.stationVerifications.find((v) => v.stationId === 'S3')!;
    expect(sv3.status).toBe('unknown-evidence');
    const acc = selectAccumulated(s);
    expect(acc.measuredTon).toBeCloseTo(0); // 无站点被实测核实，推导不计入正式实测
    expect(acc.derived?.interval).toEqual({ lo: 1.6, hi: 2.2 });
  });

  it('终磅更正为 7.80±0.10：候选变 [1.80,2.40]，已签发联合自动重开；S1/S2 逐站结论不撤回', async () => {
    let s = await snap();
    // 先逐站核实 S1/S2，再签发联合
    await issueStationVerification(s, { stationId: 'S1', actor: REVIEWER });
    s = await snap();
    await issueStationVerification(s, { stationId: 'S2', actor: REVIEWER });
    s = await snap();
    await issueJoint(s);
    s = await snap();
    expect(s.jointReviews.find((j) => j.id === 'JR-1')!.status).toBe('issued');

    const r = await reviseFinalTicket(s, { measure: { value: 7.8, tol: 0.1 }, calibrationValid: true, actor: REVIEWER });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('[1.80, 2.40]');
    s = await snap();
    const view = jointCandidate(s);
    expect(view.totalGain).toEqual({ lo: 3.65, hi: 3.95 });
    expect(view.candidate).toEqual({ lo: 1.8, hi: 2.4 });
    const jr = s.jointReviews.find((j) => j.id === 'JR-1')!;
    expect(jr.status).toBe('reopened');
    expect(jr.candidateInterval).toBeUndefined();
    // 逐站结论不撤回
    expect(s.stationVerifications.find((v) => v.stationId === 'S1')!.status).toBe('verified');
    expect(s.stationVerifications.find((v) => v.stationId === 'S2')!.status).toBe('verified');
    // 旧终磅票留痕
    const oldFinal = s.weightTickets.find((t) => t.ticketNo === 'WB-FINAL-001')!;
    expect(oldFinal.lifecycle).toBe('superseded');
  });

  it('票据幂等：同票号同内容重传不增量；同票号异内容判冲突且不覆盖原票', async () => {
    let s = await snap();
    const beforeCount = s.weightTickets.filter((t) => t.stationId === 'S1' && t.lifecycle === 'current').length;
    const dup = await submitTicket(s, {
      ticketNo: 'WB-S1-001', kind: 'station', stationId: 'S1',
      measure: { value: 0.7, tol: 0.05 }, calibrationValid: true,
      submittedBy: 'D01', submittedByName: DRIVER, offline: false,
    });
    expect(dup.verdict).toBe('duplicate');
    s = await snap();
    expect(s.weightTickets.filter((t) => t.stationId === 'S1' && t.lifecycle === 'current')).toHaveLength(beforeCount);

    const conflict = await submitTicket(s, {
      ticketNo: 'WB-S1-001', kind: 'station', stationId: 'S1',
      measure: { value: 0.95, tol: 0.05 }, calibrationValid: true,
      submittedBy: 'D01', submittedByName: DRIVER, offline: false,
    });
    expect(conflict.verdict).toBe('conflict');
    s = await snap();
    const original = s.weightTickets.find((t) => t.ticketNo === 'WB-S1-001' && t.lifecycle === 'current')!;
    expect(original.measure.value).toBeCloseTo(0.7); // 原票未被覆盖
    expect(s.weightTickets.some((t) => t.lifecycle === 'rejected' && t.ticketNo === 'WB-S1-001')).toBe(true);
  });

  it('离线签认晚到：验证依赖失效，已签发联合复核重开', async () => {
    let s = await snap();
    await issueJoint(s);
    s = await snap();
    const r = await submitSeal(s, { stage: 's1-s2', label: 'S1→S2', signedBy: CREW, offline: true });
    expect(r.ok).toBe(false);
    s = await snap();
    expect(s.seals.find((x) => x.stage === 's1-s2')!.valid).toBe(false);
    expect(s.jointReviews.find((j) => j.id === 'JR-1')!.status).toBe('reopened');
  });

  it('中途卸料被补发现：对应签认失效并破坏封闭性，已签发联合重开', async () => {
    let s = await snap();
    await issueJoint(s);
    s = await snap();
    const r = await reportMidUnload(s, { stage: 's2-final', detail: '途中私自倾倒', actor: CREW });
    expect(r.ok).toBe(true);
    s = await snap();
    expect(s.seals.find((x) => x.stage === 's2-final')!.valid).toBe(false);
    expect(s.midUnloads).toHaveLength(1);
    expect(s.jointReviews.find((j) => j.id === 'JR-1')!.status).toBe('reopened');
  });

  it('回站补称不能重建混载后的历史站量：拒绝且 S3 继续待核', async () => {
    const s = await snap();
    const r = await attemptBackstationReweigh(s, { stationId: 'S3', actor: DRIVER });
    expect(r.ok).toBe(false);
    expect(r.verdict).toBe('rejected');
    const s2 = await snap();
    expect(s2.stationVerifications.find((v) => v.stationId === 'S3')!.status).toBe('unknown-evidence');
  });

  it('估重 0.8 与候选 [1.60,2.20] 不一致：只启动差异调查，不改写实收、不重派', async () => {
    const s = await snap();
    const r = await openDifferenceInvestigation(s, { stationId: 'S3', actor: REVIEWER });
    expect(r.message).toContain('差异调查');
    const s2 = await snap();
    expect(s2.evidenceRequests.find((e) => e.stationId === 'S3')!.status).toBe('investigating');
    // 站点仍待核，没有任何实测写入
    expect(s2.stationVerifications.find((v) => v.stationId === 'S3')!.measuredInterval).toBeUndefined();
  });

  it('补证流程：司机随附有效原件→复核员采用→S3 转为独立实测并计入正式累计', async () => {
    let s = await snap();
    const erId = s.evidenceRequests.find((e) => e.stationId === 'S3')!.id;
    await submitEvidence(s, {
      requestId: erId, text: '补到 S3 原件', actor: DRIVER,
      measure: { value: 1.9, tol: 0.1 }, calibrationValid: true,
    });
    s = await snap();
    expect(s.evidenceRequests.find((e) => e.id === erId)!.status).toBe('submitted');
    const adopt = await adoptEvidence(s, { requestId: erId, actor: REVIEWER });
    expect(adopt.ok).toBe(true);
    s = await snap();
    expect(s.stationVerifications.find((v) => v.stationId === 'S3')!.status).toBe('verified');
    expect(s.stationVerifications.find((v) => v.stationId === 'S3')!.measuredInterval).toEqual({ lo: 1.8, hi: 2.0 });
    const acc = selectAccumulated(s);
    expect(acc.measuredTon).toBeCloseTo(1.9); // 仅 S3 一张有效票 1.9（S1/S2 未在本测试逐站核实）
    expect(acc.pendingStationIds).not.toContain('S3');
  });

  it('补证无有效原件：复核员退回；站长可按缺失原件结案，站点继续待核且不计重量', async () => {
    let s = await snap();
    const erId = s.evidenceRequests.find((e) => e.stationId === 'S3')!.id;
    // 司机仅提交说明、不随附有效原件
    await submitEvidence(s, { requestId: erId, text: '暂时找不到票', actor: DRIVER });
    s = await snap();
    const adopt = await adoptEvidence(s, { requestId: erId, actor: REVIEWER });
    expect(adopt.ok).toBe(false); // 无有效原件，采用被拒并退回
    s = await snap();
    expect(s.evidenceRequests.find((e) => e.id === erId)!.status).toBe('returned');

    // 站长查明缺失原件并结案
    const close = await adminResolveMissingOriginal(s, { requestId: erId, finding: '当日地磅未出票', actor: ADMIN });
    expect(close.ok).toBe(true);
    s = await snap();
    expect(s.evidenceRequests.find((e) => e.id === erId)!.status).toBe('closed-no-original');
    expect(s.stationVerifications.find((v) => v.stationId === 'S3')!.status).toBe('unknown-evidence');
    expect(selectAccumulated(s).measuredTon).toBeCloseTo(0);
  });

  it('复核员可主动退回补证并附原因', async () => {
    const s = await snap();
    const erId = s.evidenceRequests.find((e) => e.stationId === 'S3')!.id;
    const r = await returnEvidence(s, { requestId: erId, reason: '凭证不清晰', actor: REVIEWER });
    expect(r.ok).toBe(true);
    const s2 = await snap();
    expect(s2.evidenceRequests.find((e) => e.id === erId)!.status).toBe('returned');
    expect(s2.evidenceRequests.find((e) => e.id === erId)!.note).toContain('凭证不清晰');
  });
});
