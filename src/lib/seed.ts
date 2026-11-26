// 随题固定的虚构演示数据：路网、车辆、桶站、卸载点、居民预约通知
// 全部 deterministic，可通过“重置并重放”随时恢复到 09:20 封路通知到达的现场。
import type {
  Account, Closure, DumpSite, EventLog, EvidenceRequest, JointReview, NodeDef,
  NotificationDoc, Road, RouteVersion, SealRecord, Station, StationVerification,
  Vehicle, WeightTicket,
} from '../types';

export const START_MIN = 560; // 09:20，封路通知到达
export const BRIDGE_CLOSE_FROM = 560; // 09:20
export const BRIDGE_CLOSE_TO = 615;   // 10:15

export const ACCOUNTS: Account[] = [
  { id: 'U-DISP', username: 'dispatcher', password: 'disp123', name: '张调度', role: 'dispatcher' },
  { id: 'D01', username: 'driver1', password: 'drv123', name: '老王', role: 'driver', vehicleId: 'T1' },
  { id: 'D02', username: 'driver2', password: 'drv123', name: '小李', role: 'driver', vehicleId: 'T2' },
  { id: 'U-CS', username: 'service', password: 'svc123', name: '陈客服', role: 'cs' },
  // —— 重量差异补证复核线 ——
  { id: 'U-REV', username: 'reviewer', password: 'rev123', name: '周复核', role: 'reviewer' },
  { id: 'U-ADMIN', username: 'stationadmin', password: 'adm123', name: '吴站长', role: 'station-admin' },
  { id: 'U-CREW', username: 'crew', password: 'crew123', name: '郑班组', role: 'crew' },
];

export const NODES: NodeDef[] = [
  { id: 'DEPOT', name: '车队车场', x: 90, y: 430, kind: 'depot' },
  { id: 'P1', name: '滨河路口（T1 当前位置）', x: 150, y: 330, kind: 'point' },
  { id: 'S1', name: '梧桐里站', x: 250, y: 250, kind: 'station' },
  { id: 'S2', name: '桥东市场站', x: 430, y: 140, kind: 'station' },
  { id: 'P2', name: '文体中心（T2 当前位置）', x: 500, y: 400, kind: 'point' },
  { id: 'S3', name: '朝阳小区站', x: 580, y: 300, kind: 'station' },
  { id: 'S4', name: '河湾花园站', x: 710, y: 370, kind: 'station' },
  { id: 'D1', name: '城东卸载点', x: 740, y: 90, kind: 'dump' },
];

export const ROADS: Road[] = [
  // T1 侧
  { id: 'R-P1-S1', group: 'G-P1S1', from: 'P1', to: 'S1', minutes: 6 },
  { id: 'R-S1-P1', group: 'G-P1S1', from: 'S1', to: 'P1', minutes: 6 },
  { id: 'R-S1-S2', group: 'G-BRIDGE', name: '清河桥', from: 'S1', to: 'S2', minutes: 10 },
  { id: 'R-S2-S1', group: 'G-BRIDGE', name: '清河桥', from: 'S2', to: 'S1', minutes: 10 },
  { id: 'R-P1-DEP', group: 'G-P1DEP', from: 'P1', to: 'DEPOT', minutes: 15 },
  { id: 'R-DEP-P1', group: 'G-P1DEP', from: 'DEPOT', to: 'P1', minutes: 15 },
  { id: 'R-DEP-S2', group: 'G-DEPS2', from: 'DEPOT', to: 'S2', minutes: 30, widthLimitM: 2.5 },
  { id: 'R-S2-DEP', group: 'G-DEPS2', from: 'S2', to: 'DEPOT', minutes: 30, widthLimitM: 2.5 },
  // T2 侧（注意 S2→S3 与 S3→S2 为单向不同时）
  { id: 'R-P2-S2', group: 'G-P2S2', from: 'P2', to: 'S2', minutes: 8 },
  { id: 'R-S2-P2', group: 'G-P2S2', from: 'S2', to: 'P2', minutes: 8 },
  { id: 'R-S2-S3', group: 'G-S2S3', from: 'S2', to: 'S3', minutes: 7 },
  { id: 'R-S3-S2', group: 'G-S3S2', from: 'S3', to: 'S2', minutes: 3 },
  { id: 'R-S3-S4', group: 'G-S3S4', name: '朝阳路（单行）', from: 'S3', to: 'S4', minutes: 10 },
  { id: 'R-P2-S3', group: 'G-P2S3', from: 'P2', to: 'S3', minutes: 5 },
  { id: 'R-S3-P2', group: 'G-P2S3', from: 'S3', to: 'P2', minutes: 5 },
  { id: 'R-S2-S4', group: 'G-S2S4', name: '市场高架', from: 'S2', to: 'S4', minutes: 6, heightLimitM: 2.6 },
  { id: 'R-S4-S2', group: 'G-S2S4', name: '市场高架', from: 'S4', to: 'S2', minutes: 6, heightLimitM: 2.6 },
  // 跨区（S3→S4 为单行；T1 到 S2 只能走清河桥或绕行车场，保证封路前提成立）
  { id: 'R-S1-S4', group: 'G-S1S4', from: 'S1', to: 'S4', minutes: 20 },
  { id: 'R-S4-S1', group: 'G-S1S4', from: 'S4', to: 'S1', minutes: 20 },
  // 卸载点进出
  { id: 'R-S4-D1', group: 'G-S4D1', from: 'S4', to: 'D1', minutes: 12 },
  { id: 'R-D1-S4', group: 'G-S4D1', from: 'D1', to: 'S4', minutes: 12 },
  { id: 'R-S2-D1', group: 'G-S2D1', from: 'S2', to: 'D1', minutes: 15 },
  { id: 'R-D1-S2', group: 'G-S2D1', from: 'D1', to: 'S2', minutes: 15 },
  { id: 'R-S3-D1', group: 'G-S3D1', from: 'S3', to: 'D1', minutes: 9 },
  { id: 'R-D1-S3', group: 'G-S3D1', from: 'D1', to: 'S3', minutes: 9 },
  { id: 'R-S1-D1', group: 'G-S1D1', from: 'S1', to: 'D1', minutes: 30 },
  { id: 'R-D1-S1', group: 'G-S1D1', from: 'D1', to: 'S1', minutes: 30 },
  { id: 'R-P1-D1', group: 'G-P1D1', from: 'P1', to: 'D1', minutes: 30 },
  { id: 'R-D1-P1', group: 'G-P1D1', from: 'D1', to: 'P1', minutes: 30 },
  { id: 'R-P2-D1', group: 'G-P2D1', from: 'P2', to: 'D1', minutes: 14 },
  { id: 'R-D1-P2', group: 'G-P2D1', from: 'D1', to: 'P2', minutes: 14 },
  { id: 'R-DEP-D1', group: 'G-DEPD1', from: 'DEPOT', to: 'D1', minutes: 18 },
  { id: 'R-D1-DEP', group: 'G-DEPD1', from: 'D1', to: 'DEPOT', minutes: 18 },
];

export const CLOSURES: Closure[] = [
  {
    id: 'CL-BRIDGE-1',
    roadGroup: 'G-BRIDGE',
    label: '清河桥',
    fromMin: BRIDGE_CLOSE_FROM,
    toMin: BRIDGE_CLOSE_TO,
    reason: '桥梁临时封闭检修（09:20–10:15）',
  },
];

export const VEHICLES: Vehicle[] = [
  {
    id: 'T1', name: 'T1 压缩车', plate: '环A·1017',
    capacityTon: 5.0, loadTon: 3.0, heightM: 3.1, widthM: 2.4,
    posNodeId: 'P1', driverId: 'D01', driverName: '老王',
  },
  {
    id: 'T2', name: 'T2 压缩车', plate: '环A·2088',
    capacityTon: 4.0, loadTon: 0.8, heightM: 2.4, widthM: 2.0,
    posNodeId: 'P2', driverId: 'D02', driverName: '小李',
  },
];

export const STATIONS: Station[] = [
  {
    id: 'S1', name: '梧桐里站', nodeId: 'S1', estTon: 0.7, deadlineMin: 630, serviceMin: 2,
    status: 'pending', assignedVehicleId: 'T1',
  },
  {
    id: 'S2', name: '桥东市场站', nodeId: 'S2', estTon: 1.2, deadlineMin: 600, serviceMin: 2,
    status: 'pending', assignedVehicleId: 'T1',
  },
  {
    id: 'S3', name: '朝阳小区站', nodeId: 'S3', estTon: 0.8, deadlineMin: 630, serviceMin: 2,
    status: 'pending', assignedVehicleId: 'T2',
  },
  {
    id: 'S4', name: '河湾花园站', nodeId: 'S4', estTon: 0.7, deadlineMin: 660, serviceMin: 2,
    status: 'pending', assignedVehicleId: 'T2',
  },
];

export const DUMPS: DumpSite[] = [
  { id: 'D1', name: '城东卸载点', nodeId: 'D1', windows: [{ startMin: 480, endMin: 720 }], unloadMin: 5 },
];

export const ROUTE_VERSIONS: RouteVersion[] = [
  {
    id: 'RV-T1-1', vehicleId: 'T1', versionNo: 1, stopIds: ['S1', 'S2'],
    strategy: 'initial', reason: '早班初始排线', createdAtMin: 540,
  },
  {
    id: 'RV-T2-1', vehicleId: 'T2', versionNo: 1, stopIds: ['S3', 'S4'],
    strategy: 'initial', reason: '早班初始排线', createdAtMin: 540,
  },
];

// 居民已获知的预计到达（通知时刻 = 计划到达 + 10 分钟告知缓冲）
export const NOTIFICATIONS: NotificationDoc[] = [
  {
    id: 'N1', stationId: 'S1', resident: '张女士', slotText: '09:20–09:40',
    notifiedVehicleId: 'T1', notifiedEtaMin: 566, notifiedSeq: 1, notifiedRouteVersionId: 'RV-T1-1',
    status: 'valid', resendReasons: [],
  },
  {
    id: 'N2', stationId: 'S2', resident: '李先生', slotText: '09:30–09:50',
    notifiedVehicleId: 'T1', notifiedEtaMin: 576, notifiedSeq: 2, notifiedRouteVersionId: 'RV-T1-1',
    status: 'valid', resendReasons: [],
  },
  {
    id: 'N3', stationId: 'S3', resident: '王阿姨', slotText: '09:30–09:50',
    notifiedVehicleId: 'T2', notifiedEtaMin: 575, notifiedSeq: 1, notifiedRouteVersionId: 'RV-T2-1',
    status: 'valid', resendReasons: [],
  },
  {
    id: 'N4', stationId: 'S4', resident: '赵先生', slotText: '09:40–10:00',
    notifiedVehicleId: 'T2', notifiedEtaMin: 585, notifiedSeq: 2, notifiedRouteVersionId: 'RV-T2-1',
    status: 'valid', resendReasons: [],
  },
];

export const SEED_EVENTS: EventLog[] = [
  { tsMin: 540, actor: '系统', type: 'init', message: '早班排线完成：T1=[S1,S2]，T2=[S3,S4]（版本 RV-T1-1 / RV-T2-1）' },
  { tsMin: 560, actor: '路政', type: 'closure', message: '09:20 清河桥封闭至 10:15，T1 无法按原顺序前往 S2（S2 截止 10:00）' },
];

export function credentialOf(stationId: string): string {
  return `QR-${stationId}-20261126`;
}

// ===================== 重量差异补证复核（TRIP-1） =====================
// 线路依次 S1、S2、S3；估重 0.7 / 1.2 / 0.8 吨。
// 出车空载毛重 4.00±0.05；完成三站后终磅 7.60±0.10（后可更正为 7.80±0.10）。
// S1、S2 有效秤票 0.70±0.05 与 1.00±0.10；S3 无票。三段封闭签认均有效，样例证明无其他加料/卸料/换车。
export const TRIP_ID = 'TRIP-1';
export const TRIP_STATION_IDS = ['S1', 'S2', 'S3'];
export const TRIP_EST: Record<string, number> = { S1: 0.7, S2: 1.2, S3: 0.8 };

export const WEIGHT_TICKETS: WeightTicket[] = [
  {
    id: 'WT-TARE-1', ticketNo: 'WB-TARE-001', tripId: TRIP_ID, kind: 'tare',
    measure: { value: 4.0, tol: 0.05 }, calibrationValid: true, lifecycle: 'current',
    submittedBy: 'D01', submittedByName: '老王', submittedAtMin: 480, deviceTimeMin: 480, offline: false,
    note: '出车空载毛重（地磅）',
  },
  {
    id: 'WT-FINAL-1', ticketNo: 'WB-FINAL-001', tripId: TRIP_ID, kind: 'final',
    measure: { value: 7.6, tol: 0.1 }, calibrationValid: true, lifecycle: 'current',
    submittedBy: 'D01', submittedByName: '老王', submittedAtMin: 630, deviceTimeMin: 630, offline: false,
    note: '完成三站后终磅（地磅）',
  },
  {
    id: 'WT-S1-1', ticketNo: 'WB-S1-001', tripId: TRIP_ID, kind: 'station', stationId: 'S1',
    measure: { value: 0.7, tol: 0.05 }, calibrationValid: true, lifecycle: 'current',
    submittedBy: 'D01', submittedByName: '老王', submittedAtMin: 520, deviceTimeMin: 520, offline: false,
    note: '梧桐里站站点秤票',
  },
  {
    id: 'WT-S2-1', ticketNo: 'WB-S2-001', tripId: TRIP_ID, kind: 'station', stationId: 'S2',
    measure: { value: 1.0, tol: 0.1 }, calibrationValid: true, lifecycle: 'current',
    submittedBy: 'D01', submittedByName: '老王', submittedAtMin: 550, deviceTimeMin: 550, offline: false,
    note: '桥东市场站站点秤票',
  },
  // S3  deliberately 无票：缺站点秤票，只能待查派补证。
];

export const SEAL_RECORDS: SealRecord[] = [
  {
    id: 'SEAL-1', tripId: TRIP_ID, stage: 'depot-s1', label: '出车→S1',
    signedBy: '郑班组', signedAtMin: 485, noAddNoUnload: true, valid: true, offline: false,
    note: '载荷变动日志：本阶段无加料、无卸料、未换车',
  },
  {
    id: 'SEAL-2', tripId: TRIP_ID, stage: 's1-s2', label: 'S1→S2',
    signedBy: '郑班组', signedAtMin: 525, noAddNoUnload: true, valid: true, offline: false,
    note: '载荷变动日志：本阶段无加料、无卸料、未换车',
  },
  {
    id: 'SEAL-3', tripId: TRIP_ID, stage: 's2-final', label: 'S2→终磅',
    signedBy: '郑班组', signedAtMin: 555, noAddNoUnload: true, valid: true, offline: false,
    note: '载荷变动日志：本阶段无加料、无卸料、未换车',
  },
];

export const STATION_VERIFICATIONS: StationVerification[] = [
  { id: 'SV-S1', tripId: TRIP_ID, stationId: 'S1', seq: 1, estTon: 0.7, status: 'pending' },
  { id: 'SV-S2', tripId: TRIP_ID, stationId: 'S2', seq: 2, estTon: 1.2, status: 'pending' },
  { id: 'SV-S3', tripId: TRIP_ID, stationId: 'S3', seq: 3, estTon: 0.8, status: 'unknown-evidence',
    note: '无站点秤票，事实待查：已派补证，不得用估重或整车差额填作实收' },
];

export const JOINT_REVIEWS: JointReview[] = [
  {
    id: 'JR-1', tripId: TRIP_ID, status: 'draft',
    checks: { tareTicket: false, finalTicket: false, sealDepotS1: false, sealS1S2: false, sealS2Final: false },
    basedOnFinalTicketId: 'WT-FINAL-1', basedOnTareTicketId: 'WT-TARE-1',
    history: [
      { atMin: 635, actor: '系统', message: '联合复核单建立：须逐项审核 2 张地磅票与 3 段封闭签认（共 5 项依赖）后方可签发' },
    ],
  },
];

export const EVIDENCE_REQUESTS: EvidenceRequest[] = [
  {
    id: 'ER-S3', tripId: TRIP_ID, stationId: 'S3', status: 'open',
    reason: '朝阳小区站缺站点秤票原件，无法独立核实本站实收重量',
    openedAtMin: 640, openedBy: '周复核',
    note: '逐站边界：S3 保留未知并派补证，不等待跨站材料；补证到位前不给量化范围',
  },
];

export const MID_UNLOADS: import('../types').MidUnload[] = [];

export const RECON_SEED_EVENTS: EventLog[] = [
  { tsMin: 480, actor: '老王', type: 'recon-ticket', message: 'TRIP-1 出车空载地磅票 4.00±0.05 提交（WB-TARE-001，校准有效）' },
  { tsMin: 520, actor: '老王', type: 'recon-ticket', message: 'TRIP-1 S1 站点秤票 0.70±0.05 提交（WB-S1-001，校准有效）' },
  { tsMin: 550, actor: '老王', type: 'recon-ticket', message: 'TRIP-1 S2 站点秤票 1.00±0.10 提交（WB-S2-001，校准有效）' },
  { tsMin: 630, actor: '老王', type: 'recon-ticket', message: 'TRIP-1 终磅地磅票 7.60±0.10 提交（WB-FINAL-001，校准有效）；S3 无站点秤票' },
  { tsMin: 640, actor: '周复核', type: 'recon-case', message: 'TRIP-1 重量差异补证案件建立：S1/S2 可逐站核实，S3 缺票派补证' },
];
