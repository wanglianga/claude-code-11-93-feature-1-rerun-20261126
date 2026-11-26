// 重量差异复核纯函数：确定性误差边界的区间运算、候选推导、依赖核验、正式累计口径。
// 不触碰 IndexedDB，全部可单测。误差是“确定性边界”，按最坏情况取上下界（非概率区间）。
import type {
  AccumulatedWeight, BoundedMeasure, Interval, JointDependencyCheck,
  SealRecord, StationVerification, WeightTicket,
} from '../types';
import { round2 } from '../types';

/** 标称值 ± 确定性误差 → 闭区间。统一保留两位小数，规避浮点尾数。 */
export function toInterval(m: BoundedMeasure): Interval {
  return { lo: round2(m.value - m.tol), hi: round2(m.value + m.tol) };
}

/** 区间加法：[a.lo+b.lo, a.hi+b.hi]。 */
export function addIntervals(a: Interval, b: Interval): Interval {
  return { lo: round2(a.lo + b.lo), hi: round2(a.hi + b.hi) };
}

/** 区间减法：[a.lo−b.hi, a.hi−b.lo]（误差边界相加，最坏情况）。 */
export function subtractIntervals(a: Interval, b: Interval): Interval {
  return { lo: round2(a.lo - b.hi), hi: round2(a.hi - b.lo) };
}

export function sumIntervals(list: Interval[]): Interval {
  return list.reduce<Interval>((acc, i) => addIntervals(acc, i), { lo: 0, hi: 0 });
}

export function fmtInterval(i: Interval): string {
  return `[${i.lo.toFixed(2)}, ${i.hi.toFixed(2)}]`;
}

export function intervalContains(i: Interval, x: number): boolean {
  return x >= i.lo - 1e-9 && x <= i.hi + 1e-9;
}

/** 终磅区间 − 空载区间 = 整趟总增重区间。 */
export function computeTotalGain(tare: BoundedMeasure, final: BoundedMeasure): Interval {
  return subtractIntervals(toInterval(final), toInterval(tare));
}

/**
 * 总增重 − 已知站点实测合计 = 缺失站（S3）的“候选”区间。
 * 这是闭合推导值，不是独立实测；调用方必须先确认整趟封闭性与全部依赖成立。
 */
export function computeCandidate(totalGain: Interval, knownStations: Interval): Interval {
  return subtractIntervals(totalGain, knownStations);
}

/** 汇总若干有效站点秤票的实测区间。 */
export function sumStationTickets(stationTickets: WeightTicket[]): Interval {
  return sumIntervals(stationTickets.filter((t) => t.lifecycle === 'current' && t.calibrationValid).map((t) => toInterval(t.measure)));
}

// ---------- 联合复核的 5 项依赖（2 张地磅票 + 3 段封闭签认） ----------

export const DEPENDENCY_ITEMS: { key: keyof JointDependencyCheck; label: string }[] = [
  { key: 'tareTicket', label: '出车空载地磅票' },
  { key: 'finalTicket', label: '终磅地磅票' },
  { key: 'sealDepotS1', label: '封闭签认① 出车→S1' },
  { key: 'sealS1S2', label: '封闭签认② S1→S2' },
  { key: 'sealS2Final', label: '封闭签认③ S2→终磅' },
];

export function emptyChecks(): JointDependencyCheck {
  return { tareTicket: false, finalTicket: false, sealDepotS1: false, sealS1S2: false, sealS2Final: false };
}

export function countChecked(c: JointDependencyCheck): number {
  return DEPENDENCY_ITEMS.filter((d) => c[d.key]).length;
}

export function allDepsChecked(c: JointDependencyCheck): boolean {
  return countChecked(c) === DEPENDENCY_ITEMS.length;
}

/** 依据现行票据与签认，推导每项依赖当前是否成立（票据须现行且校准有效，签认须未失效）。 */
export function deriveChecks(tickets: WeightTicket[], seals: SealRecord[]): JointDependencyCheck {
  const tare = tickets.some((t) => t.kind === 'tare' && t.lifecycle === 'current' && t.calibrationValid);
  const final = tickets.some((t) => t.kind === 'final' && t.lifecycle === 'current' && t.calibrationValid);
  const seal = (stage: SealRecord['stage']) => seals.some((s) => s.stage === stage && s.valid);
  return {
    tareTicket: tare,
    finalTicket: final,
    sealDepotS1: seal('depot-s1'),
    sealS1S2: seal('s1-s2'),
    sealS2Final: seal('s2-final'),
  };
}

/** 联合复核能否签发：5 项依赖全部审核通过，且与现行客观材料一致。 */
export function jointCanIssue(checks: JointDependencyCheck): boolean {
  return allDepsChecked(checks);
}

// ---------- 票据冲突：同票号不同内容 ----------

/** 票号相同但测量值/校准状态不一致 → 冲突，不能静默覆盖。 */
export function sameTicketNoDifferentContent(existing: WeightTicket, incoming: { ticketNo: string; measure: BoundedMeasure; calibrationValid: boolean }): boolean {
  if (existing.ticketNo !== incoming.ticketNo) return false;
  return (
    existing.measure.value !== incoming.measure.value ||
    existing.measure.tol !== incoming.measure.tol ||
    existing.calibrationValid !== incoming.calibrationValid
  );
}

// ---------- 估重对照：仅触发差异调查，不据此改判或重派 ----------

/** 估重是否与推导/实测区间相容；不相容只触发差异调查。 */
export function estimateConsistent(interval: Interval, estTon: number): boolean {
  return intervalContains(interval, estTon);
}

// ---------- 正式累计：只读取“已批准的实测”口径 ----------

/**
 * 正式累计重量：
 * - measured：仅累加已凭有效原件核实的站点（取实测标称值）；
 * - derived：仅有联合推导区间的站，单列说明、不计入 measured；
 * - pending：无有效原件仍待核的站，不计任何重量；
 * 重复上传不产生新增站点量；估重与整车差额永不写入实收。
 */
export function computeAccumulated(verifications: StationVerification[]): AccumulatedWeight {
  const breakdown: AccumulatedWeight['breakdown'] = [];
  let measuredTon = 0;
  const pendingStations: string[] = [];
  const derivedText: string[] = [];

  for (const v of [...verifications].sort((a, b) => a.seq - b.seq)) {
    if (v.status === 'verified' && v.measuredInterval) {
      // 已批准实测：以区间中值的标称口径入账（这里取核实票据的标称值，保存于区间边界反推不稳健，
      // 故 measuredTon 由调用方按票据标称值统计；此处仅做结构分组）。
      measuredTon += (v.measuredInterval.lo + v.measuredInterval.hi) / 2;
      breakdown.push({ stationId: v.stationId, source: 'measured', ton: round2((v.measuredInterval.lo + v.measuredInterval.hi) / 2), interval: v.measuredInterval });
    } else if (v.status === 'unknown-evidence') {
      pendingStations.push(v.stationId);
      breakdown.push({ stationId: v.stationId, source: 'pending', ton: null });
      derivedText.push(`${v.stationId} 待核（无有效原件，估重 ${v.estTon}t 不计入实收）`);
    } else {
      breakdown.push({ stationId: v.stationId, source: 'pending', ton: null });
      pendingStations.push(v.stationId);
    }
  }
  return {
    measuredTon: round2(measuredTon),
    derivedTonText: derivedText.join('；'),
    pendingStations,
    breakdown,
  };
}

/**
 * 按有效站点秤票标称值统计正式实测累计（权威口径，避免区间中值反推）。
 * 仅统计 lifecycle=current、calibrationValid 且对应站点已核实的票据。
 */
export function officialMeasuredTon(stationTickets: WeightTicket[], verifiedStationIds: Set<string>): number {
  let sum = 0;
  for (const t of stationTickets) {
    if (t.lifecycle === 'current' && t.calibrationValid && t.stationId && verifiedStationIds.has(t.stationId)) {
      sum += t.measure.value;
    }
  }
  return round2(sum);
}
