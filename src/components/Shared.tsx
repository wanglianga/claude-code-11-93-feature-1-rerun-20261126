// 共享 UI 小组件：状态徽章、事件日志、版本追溯
import React from 'react';
import type { EventLog, NotificationStatus, RouteVersion, StationStatus } from '../types';
import { fmtMin } from '../types';

export const VEHICLE_COLORS: Record<string, string> = {
  T1: '#2563eb',
  T2: '#059669',
};

export function StationBadge({ status, overflow }: { status: StationStatus; overflow?: boolean }) {
  const map: Record<StationStatus, [string, string]> = {
    pending: ['待服务', 'badge gray'],
    arrived: ['已到站', 'badge blue'],
    scanned: ['已扫码', 'badge indigo'],
    completed: ['已完成', 'badge green'],
    rejected: ['已拒收', 'badge red'],
  };
  const [text, cls] = map[status];
  return (
    <span>
      <span className={cls}>{text}</span>
      {overflow && <span className="badge orange">满溢</span>}
    </span>
  );
}

export function NotifBadge({ status }: { status: NotificationStatus }) {
  const map: Record<NotificationStatus, [string, string]> = {
    valid: ['有效', 'badge green'],
    'needs-resend': ['需重发', 'badge orange'],
    fulfilled: ['已履约', 'badge blue'],
    invalid: ['已失效', 'badge gray'],
  };
  const [text, cls] = map[status];
  return <span className={cls}>{text}</span>;
}

// ---------- 重量差异复核徽章 ----------

export function TicketLifecycleBadge({ lifecycle }: { lifecycle: 'current' | 'superseded' | 'rejected' }) {
  const map = {
    current: ['现行有效', 'badge green'],
    superseded: ['已修订作废', 'badge gray'],
    rejected: ['冲突拒纳', 'badge red'],
  } as const;
  const [text, cls] = map[lifecycle];
  return <span className={cls}>{text}</span>;
}

export function StationVerifyBadge({ status }: { status: 'pending' | 'verified' | 'unknown-evidence' }) {
  const map = {
    pending: ['待核', 'badge gray'],
    verified: ['已实测核实', 'badge green'],
    'unknown-evidence': ['未知·待补证', 'badge orange'],
  } as const;
  const [text, cls] = map[status];
  return <span className={cls}>{text}</span>;
}

export function JointStatusBadge({ status }: { status: 'draft' | 'issued' | 'reopened' }) {
  const map = {
    draft: ['草稿·待审依赖', 'badge gray'],
    issued: ['已签发', 'badge green'],
    reopened: ['已重开', 'badge red'],
  } as const;
  const [text, cls] = map[status];
  return <span className={cls}>{text}</span>;
}

export function EvidenceStatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    open: ['待补证', 'badge orange'],
    submitted: ['已提交待采用', 'badge blue'],
    adopted: ['已采用为实测', 'badge green'],
    returned: ['已退回', 'badge red'],
    investigating: ['差异调查中', 'badge indigo'],
    'closed-no-original': ['无原件·继续待核', 'badge gray'],
  };
  const [text, cls] = map[status] ?? [status, 'badge gray'];
  return <span className={cls}>{text}</span>;
}

export function EventLogPanel({ events }: { events: EventLog[] }) {
  const sorted = events.slice().sort((a, b) => (b.id ?? 0) - (a.id ?? 0)).slice(0, 80);
  return (
    <div className="panel">
      <h3>事件日志（可追溯）</h3>
      <table className="tbl">
        <thead>
          <tr><th>时刻</th><th>操作者</th><th>类型</th><th>内容</th></tr>
        </thead>
        <tbody>
          {sorted.map((e) => (
            <tr key={e.id}>
              <td className="mono">{fmtMin(e.tsMin)}</td>
              <td>{e.actor}</td>
              <td><span className="tag">{e.type}</span></td>
              <td>{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STRATEGY_NAME: Record<string, string> = {
  initial: '初始排线',
  insert: '最小变更（移交受阻站点）',
  global: '全局重排',
  manual: '人工调整',
};

export function VersionTracePanel({ versions }: { versions: RouteVersion[] }) {
  const sorted = versions.slice().sort((a, b) => a.vehicleId.localeCompare(b.vehicleId) || a.versionNo - b.versionNo);
  return (
    <div className="panel">
      <h3>线路版本追溯</h3>
      <table className="tbl">
        <thead>
          <tr><th>版本</th><th>车辆</th><th>站点顺序</th><th>策略</th><th>生成时刻</th><th>依据版本</th><th>原因</th></tr>
        </thead>
        <tbody>
          {sorted.map((rv) => (
            <tr key={rv.id}>
              <td className="mono">{rv.id}</td>
              <td><span className="veh-dot" style={{ background: VEHICLE_COLORS[rv.vehicleId] ?? '#666' }} />{rv.vehicleId}</td>
              <td className="mono">{rv.stopIds.join(' → ')}</td>
              <td>{STRATEGY_NAME[rv.strategy] ?? rv.strategy}</td>
              <td className="mono">{fmtMin(rv.createdAtMin)}</td>
              <td className="mono">{rv.basedOnVersionId ?? '—'}</td>
              <td>{rv.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
