// ===================== 领域类型定义 =====================
// 时间统一使用“自当日 00:00 起的分钟数”（如 09:20 = 560）

export type ID = string;
// dispatcher 调度员 / driver 司机 / cs 客服（封路重排线）
// reviewer 复核员 / station-admin 站点管理员 / crew 班组（重量差异补证复核线）
export type Role = 'dispatcher' | 'driver' | 'cs' | 'reviewer' | 'station-admin' | 'crew';

export interface Account {
  id: ID;
  username: string;
  password: string;
  name: string;
  role: Role;
  vehicleId?: ID; // 司机账号绑定车辆
}

export interface Vehicle {
  id: ID;
  name: string;
  plate: string;
  capacityTon: number;
  loadTon: number;
  heightM: number;
  widthM: number;
  posNodeId: string;
  driverId: string;
  driverName: string;
}

export type StationStatus = 'pending' | 'arrived' | 'scanned' | 'completed' | 'rejected';

export interface Station {
  id: ID;
  name: string;
  nodeId: string;
  estTon: number;          // 估重（吨）——不是实称
  actualTon?: number;      // 实称（吨），称重后才有
  deadlineMin: number;     // 服务截止时刻
  serviceMin: number;      // 到站作业时长（分钟）
  status: StationStatus;
  assignedVehicleId: ID;
  completedBy?: string;
  completedAtMin?: number;
  overflowReported?: boolean;
  rejectReason?: string;
}

export interface Road {
  id: ID;
  group: string;           // 同一物理道路（双向）归为一组，封闭按组生效
  name?: string;
  from: string;
  to: string;
  minutes: number;
  heightLimitM?: number;   // 限高（米）
  widthLimitM?: number;    // 限宽（米）
}

export interface Closure {
  id: ID;
  roadGroup: string;
  label: string;
  fromMin: number;
  toMin: number;
  reason: string;
}

export interface DumpSite {
  id: ID;
  name: string;
  nodeId: string;
  windows: { startMin: number; endMin: number }[]; // 开放时段
  unloadMin: number;                                // 卸载作业时长
}

export interface NodeDef {
  id: string;
  name: string;
  x: number;
  y: number;
  kind: 'depot' | 'station' | 'dump' | 'point';
}

export type NotificationStatus = 'valid' | 'needs-resend' | 'fulfilled' | 'invalid';

export interface NotificationDoc {
  id: ID;
  stationId: ID;
  resident: string;
  slotText: string;             // 居民预约时段文案
  notifiedVehicleId: ID;        // 通知时依据的车辆
  notifiedEtaMin: number;       // 通知时告知的预计到达
  notifiedSeq: number;          // 通知时在该车线路中的序号
  notifiedRouteVersionId: ID;   // 通知依据的线路版本
  status: NotificationStatus;
  resendReasons: string[];      // 需重发的原因
}

export type RouteStrategy = 'initial' | 'insert' | 'global' | 'manual';

export interface RouteVersion {
  id: ID;
  vehicleId: ID;
  versionNo: number;
  stopIds: ID[];                // 该版本下完整的站点顺序（含已完成）
  strategy: RouteStrategy;
  reason: string;
  createdAtMin: number;
  basedOnVersionId?: ID;
}

export type ReceiptAction = 'arrive' | 'scan' | 'weigh' | 'overflow' | 'closure';
export type ReceiptStatus = 'accepted' | 'duplicate' | 'conflict';

export interface Receipt {
  id: ID;                       // 回执凭证号（客户端生成，幂等键）
  credentialId: string;         // 扫码凭证内容（同一二维码重传只计一次）
  stationId?: ID;
  vehicleId: ID;
  routeVersionId: ID;           // 执行人操作时依据的线路版本
  executorId: string;
  executorName: string;
  action: ReceiptAction;
  payload?: string;             // 如称重吨数、说明
  deviceTimeMin: number;        // 设备端发生时间（离线时早于上传时间）
  uploadedAtMin: number;
  status: ReceiptStatus;
  note?: string;
}

export interface EventLog {
  id?: number;
  tsMin: number;
  actor: string;
  type: string;
  message: string;
}

// ===================== 重量差异补证复核领域 =====================
// 一趟清运（TRIP）的重量差异追查：地磅票、封闭签认、逐站核实、联合候选、补证责任。
// 所有测量的误差都是“确定性边界”（非概率置信区间），区间运算按最坏情况取上下界。

/** 带确定性误差边界的测量值：真实值落在 [value-tol, value+tol]。 */
export interface BoundedMeasure {
  value: number;   // 标称值（吨）
  tol: number;     // 确定性误差边界（吨，恒正）
}

/** 闭区间 [lo, hi]，单位吨。 */
export interface Interval {
  lo: number;
  hi: number;
}

/** 地磅票种类：tare 出车空载毛重 / final 终磅 / station 站点秤票。 */
export type TicketKind = 'tare' | 'final' | 'station';

/** 地磅票生命周期：current 现行有效 / superseded 被修订替代 / rejected 冲突退回。 */
export type TicketLifecycle = 'current' | 'superseded' | 'rejected';

export interface WeightTicket {
  id: ID;
  ticketNo: string;            // 票号（业务幂等键；同号不同内容判冲突）
  tripId: ID;
  kind: TicketKind;
  stationId?: ID;              // 站点票才有
  measure: BoundedMeasure;
  calibrationValid: boolean;   // 票据校准是否有效
  lifecycle: TicketLifecycle;
  submittedBy: string;
  submittedByName: string;
  submittedAtMin: number;
  deviceTimeMin: number;       // 离线补录时的设备发生时间
  offline: boolean;
  supersededBy?: ID;
  revisionOf?: ID;             // 本票修订自哪一张（终磅更正）
  conflictNote?: string;       // 同号异容等冲突说明
  note?: string;
}

/** 封闭签认（载荷变动日志 + 班组签认），按三个阶段各一条。 */
export interface SealRecord {
  id: ID;
  tripId: ID;
  stage: 'depot-s1' | 's1-s2' | 's2-final';
  label: string;               // 出车→S1 / S1→S2 / S2→终磅
  signedBy: string;            // 班组签认人
  signedAtMin: number;
  noAddNoUnload: boolean;      // 班组确认本阶段无加料、无卸料、未换车
  valid: boolean;              // 是否仍可作为联合复核依赖（晚到/被卸料证伪后置 false）
  invalidateReason?: string;
  offline: boolean;            // 离线签认晚到
  note?: string;
}

/** 逐站核实结论。 */
export type StationVerificationStatus =
  | 'pending'        // 待核
  | 'verified'       // 已凭本站有效原件核实
  | 'unknown-evidence'; // 无有效原件，事实待查、派补证

export interface StationVerification {
  id: ID;
  tripId: ID;
  stationId: ID;
  seq: number;                       // 线路次序
  estTon: number;                    // 估重（仅供对照，永不作为实收）
  status: StationVerificationStatus;
  ticketId?: ID;                     // 核实所依据的站点秤票
  measuredInterval?: Interval;       // 采用的实测区间（来自有效票）
  signedAtMin?: number;
  signedBy?: string;
  note?: string;
}

/** 联合复核单生命周期。 */
export type JointStatus =
  | 'draft'           // 草稿（依赖未审完/未签发）
  | 'issued'          // 已签发（候选区间正式采用为推导口径）
  | 'reopened';       // 依赖变更后重新打开（如终磅更正、签认失效）

/** 联合复核必须逐项审核的 5 项依赖（2 张地磅票 + 3 段封闭签认）。 */
export interface JointDependencyCheck {
  tareTicket: boolean;
  finalTicket: boolean;
  sealDepotS1: boolean;
  sealS1S2: boolean;
  sealS2Final: boolean;
}

export interface JointReview {
  id: ID;
  tripId: ID;
  status: JointStatus;
  checks: JointDependencyCheck;
  /** 签发时所依据的终磅票 id；终磅更正后与现行票不一致即触发重开。 */
  basedOnFinalTicketId?: ID;
  basedOnTareTicketId?: ID;
  candidateInterval?: Interval;     // 总增重 − 已知站量 的 S3 候选（推导，非独立实测）
  issuedAtMin?: number;
  issuedBy?: string;
  reopenedReason?: string;
  history: JointHistoryEntry[];     // 未结事项与历史解释（不可改写，只追加）
}

export interface JointHistoryEntry {
  atMin: number;
  actor: string;
  message: string;
}

/** 补证责任单。 */
export type EvidenceRequestStatus = 'open' | 'submitted' | 'adopted' | 'returned' | 'investigating' | 'closed-no-original';

export interface EvidenceRequest {
  id: ID;
  tripId: ID;
  stationId: ID;
  reason: string;                    // 缺站点秤票等
  status: EvidenceRequestStatus;
  openedAtMin: number;
  openedBy: string;
  /** 司机补交的原件说明（无有效原件时可为空）。 */
  driverSubmission?: string;
  submittedAtMin?: number;
  /** 站点管理员查明的缺失原件情况。 */
  adminFinding?: string;
  resolvedAtMin?: number;
  resolvedBy?: string;
  note?: string;
}

/** 中途卸料（被补发现即破坏封闭性）。 */
export interface MidUnload {
  id: ID;
  tripId: ID;
  stage: SealRecord['stage'];
  foundAtMin: number;
  foundBy: string;
  detail: string;
}

/** 正式累计口径：只读取“已批准的实测”，估重/推导/重复上传一律不计。 */
export interface AccumulatedWeight {
  measuredTon: number;       // 已批准实测合计（取有效票标称值）
  derivedTonText: string;    // 仅有推导区间的站（不计入 measuredTon）
  pendingStations: ID[];     // 仍待核、无实测的站
  breakdown: { stationId: ID; source: 'measured' | 'derived' | 'pending'; ton: number | null; interval?: Interval }[];
}

// ===================== 时间工具 =====================

export function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parseMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
