// 复核纯函数验证：确定性误差边界的区间运算、候选推导、票据冲突、依赖核验、正式累计口径
import { describe, expect, it } from 'vitest';
import type { StationVerification, WeightTicket } from '../types';
import {
  addIntervals, computeAccumulated, computeCandidate, computeTotalGain, deriveChecks,
  emptyChecks, estimateConsistent, officialMeasuredTon, sameTicketNoDifferentContent,
  subtractIntervals, sumIntervals, sumStationTickets, toInterval,
} from '../lib/recon';

const TARE = { value: 4.0, tol: 0.05 };
const FINAL = { value: 7.6, tol: 0.1 };
const FINAL_REV = { value: 7.8, tol: 0.1 };
const S1_TICKET_MEASURE = { value: 0.7, tol: 0.05 };
const S2_TICKET_MEASURE = { value: 1.0, tol: 0.1 };

function stationTicket(id: string, stationId: string, measure: { value: number; tol: number }, lifecycle: WeightTicket['lifecycle'] = 'current'): WeightTicket {
  return {
    id, ticketNo: id, tripId: 'TRIP-1', kind: 'station', stationId, measure,
    calibrationValid: true, lifecycle, submittedBy: 'D01', submittedByName: '老王',
    submittedAtMin: 1, deviceTimeMin: 1, offline: false,
  };
}

describe('区间运算（确定性误差边界，最坏情况取界）', () => {
  it('标称值 ± 误差 → 闭区间', () => {
    expect(toInterval(TARE)).toEqual({ lo: 3.95, hi: 4.05 });
    expect(toInterval(FINAL)).toEqual({ lo: 7.5, hi: 7.7 });
  });

  it('区间加法：误差边界相加', () => {
    expect(addIntervals({ lo: 1, hi: 2 }, { lo: 3, hi: 4 })).toEqual({ lo: 4, hi: 6 });
    // S1 [0.65,0.75] + S2 [0.90,1.10] = [1.55,1.85]
    expect(addIntervals(toInterval(S1_TICKET_MEASURE), toInterval(S2_TICKET_MEASURE)))
      .toEqual({ lo: 1.55, hi: 1.85 });
  });

  it('区间减法：[a.lo−b.hi, a.hi−b.lo]', () => {
    expect(subtractIntervals({ lo: 10, hi: 12 }, { lo: 3, hi: 4 })).toEqual({ lo: 6, hi: 9 });
    expect(sumIntervals([])).toEqual({ lo: 0, hi: 0 });
  });

  it('总增重 = 终磅区间 − 空载区间 = [3.45, 3.75]', () => {
    expect(computeTotalGain(TARE, FINAL)).toEqual({ lo: 3.45, hi: 3.75 });
  });

  it('已知 S1+S2 合计 = [1.55, 1.85]', () => {
    const tickets = [stationTicket('WT-S1', 'S1', S1_TICKET_MEASURE), stationTicket('WT-S2', 'S2', S2_TICKET_MEASURE)];
    expect(sumStationTickets(tickets)).toEqual({ lo: 1.55, hi: 1.85 });
  });

  it('S3 候选 = 总增重 − 已知站量 = [1.60, 2.20]，且为推导值', () => {
    const total = computeTotalGain(TARE, FINAL);
    const known = addIntervals(toInterval(S1_TICKET_MEASURE), toInterval(S2_TICKET_MEASURE));
    expect(computeCandidate(total, known)).toEqual({ lo: 1.6, hi: 2.2 });
  });

  it('终磅更正为 7.80±0.10 后：总增重 [3.65,3.95]，S3 候选 [1.80, 2.40]', () => {
    const total = computeTotalGain(TARE, FINAL_REV);
    expect(total).toEqual({ lo: 3.65, hi: 3.95 });
    const known = addIntervals(toInterval(S1_TICKET_MEASURE), toInterval(S2_TICKET_MEASURE));
    expect(computeCandidate(total, known)).toEqual({ lo: 1.8, hi: 2.4 });
  });

  it('作废/校准失效的站点票不计入已知合计', () => {
    const tickets = [
      stationTicket('WT-S1', 'S1', S1_TICKET_MEASURE),
      stationTicket('WT-S2', 'S2', S2_TICKET_MEASURE, 'superseded'),
    ];
    expect(sumStationTickets(tickets)).toEqual(toInterval(S1_TICKET_MEASURE));
  });
});

describe('票据同号冲突与估重对照', () => {
  const base = stationTicket('WB-X', 'S3', { value: 1.0, tol: 0.1 });
  it('同票号同内容 → 不算冲突（幂等）', () => {
    expect(sameTicketNoDifferentContent(base, { ticketNo: 'WB-X', measure: { value: 1.0, tol: 0.1 }, calibrationValid: true })).toBe(false);
  });
  it('同票号不同标称值 → 冲突', () => {
    expect(sameTicketNoDifferentContent(base, { ticketNo: 'WB-X', measure: { value: 1.2, tol: 0.1 }, calibrationValid: true })).toBe(true);
  });
  it('同票号不同校准状态 → 冲突', () => {
    expect(sameTicketNoDifferentContent(base, { ticketNo: 'WB-X', measure: { value: 1.0, tol: 0.1 }, calibrationValid: false })).toBe(true);
  });
  it('不同票号 → 不冲突', () => {
    expect(sameTicketNoDifferentContent(base, { ticketNo: 'WB-Y', measure: { value: 1.2, tol: 0.1 }, calibrationValid: true })).toBe(false);
  });
  it('估重 0.8 落在候选 [1.60,2.20] 之外 → 不相容（只触发差异调查）', () => {
    expect(estimateConsistent({ lo: 1.6, hi: 2.2 }, 0.8)).toBe(false);
  });
  it('估重落在区间内 → 相容', () => {
    expect(estimateConsistent({ lo: 0.65, hi: 0.75 }, 0.7)).toBe(true);
  });
});

describe('联合复核 5 项依赖与正式累计', () => {
  it('初始全部未审', () => {
    expect(Object.values(emptyChecks()).every((v) => v === false)).toBe(true);
  });

  it('2 张现行有效地磅票 + 3 段有效签认 → 客观 5 项全成立', () => {
    const tickets: WeightTicket[] = [
      { id: 'TARE', ticketNo: 'TARE', tripId: 'TRIP-1', kind: 'tare', measure: TARE, calibrationValid: true, lifecycle: 'current', submittedBy: 'x', submittedByName: 'x', submittedAtMin: 1, deviceTimeMin: 1, offline: false },
      { id: 'FINAL', ticketNo: 'FINAL', tripId: 'TRIP-1', kind: 'final', measure: FINAL, calibrationValid: true, lifecycle: 'current', submittedBy: 'x', submittedByName: 'x', submittedAtMin: 1, deviceTimeMin: 1, offline: false },
    ];
    const seals = [
      { id: 'A', tripId: 'TRIP-1', stage: 'depot-s1' as const, label: 'a', signedBy: 'c', signedAtMin: 1, noAddNoUnload: true, valid: true, offline: false },
      { id: 'B', tripId: 'TRIP-1', stage: 's1-s2' as const, label: 'b', signedBy: 'c', signedAtMin: 1, noAddNoUnload: true, valid: true, offline: false },
      { id: 'C', tripId: 'TRIP-1', stage: 's2-final' as const, label: 'c', signedBy: 'c', signedAtMin: 1, noAddNoUnload: true, valid: true, offline: false },
    ];
    const checks = deriveChecks(tickets, seals);
    expect(Object.values(checks).every(Boolean)).toBe(true);
  });

  it('签认失效 → 对应封闭依赖不成立', () => {
    const seals = [
      { id: 'B', tripId: 'TRIP-1', stage: 's1-s2' as const, label: 'b', signedBy: 'c', signedAtMin: 1, noAddNoUnload: true, valid: false, offline: true },
    ];
    const checks = deriveChecks([], seals);
    expect(checks.sealS1S2).toBe(false);
  });

  it('正式累计只读取已批准实测：S1+S2 = 1.70 吨，未核实站不计', () => {
    const tickets = [stationTicket('WT-S1', 'S1', S1_TICKET_MEASURE), stationTicket('WT-S2', 'S2', S2_TICKET_MEASURE)];
    const verified = new Set(['S1', 'S2']);
    expect(officialMeasuredTon(tickets, verified)).toBeCloseTo(1.7);
    // S3 未核实，即便混入其票据也不计
    const withS3 = [...tickets, stationTicket('WT-S3', 'S3', { value: 1.9, tol: 0.1 })];
    expect(officialMeasuredTon(withS3, verified)).toBeCloseTo(1.7);
  });

  it('未核实站在累计结构中归为 pending，已核实站归为 measured', () => {
    const vers: StationVerification[] = [
      { id: 'SV-S1', tripId: 'TRIP-1', stationId: 'S1', seq: 1, estTon: 0.7, status: 'verified', measuredInterval: { lo: 0.65, hi: 0.75 } },
      { id: 'SV-S3', tripId: 'TRIP-1', stationId: 'S3', seq: 3, estTon: 0.8, status: 'unknown-evidence' },
    ];
    const acc = computeAccumulated(vers);
    expect(acc.pendingStations).toContain('S3');
    expect(acc.breakdown.find((b) => b.stationId === 'S1')!.source).toBe('measured');
    expect(acc.breakdown.find((b) => b.stationId === 'S3')!.source).toBe('pending');
  });
});
