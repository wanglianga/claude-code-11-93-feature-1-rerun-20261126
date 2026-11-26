// 重量差异补证复核工作台：四个持久化面板（票据修订 / 站点核实 / 联合候选 / 补证责任）。
// 标签页只是同一案件不同视角，不是两套可切换流程；正式边界为逐站独立核实，联合为对照。
import React, { useState } from 'react';
import type { Snapshot } from '../lib/db';
import type { Account } from '../types';
import { resetDemo } from '../lib/actions';
import { jointCandidate, selectAccumulated } from '../lib/reconActions';
import { fmtInterval } from '../lib/recon';
import { TicketsPanel } from './recon/TicketsPanel';
import { StationVerifyPanel } from './recon/StationVerifyPanel';
import { JointReviewPanel } from './recon/JointReviewPanel';
import { EvidencePanel } from './recon/EvidencePanel';
import { EventLogPanel } from './Shared';
import { ROLE_LABEL } from './recon/common';

type Tab = 'tickets' | 'station' | 'joint' | 'evidence';

const TABS: { key: Tab; label: string }[] = [
  { key: 'tickets', label: '① 票据修订' },
  { key: 'station', label: '② 站点核实' },
  { key: 'joint', label: '③ 联合候选' },
  { key: 'evidence', label: '④ 补证责任' },
];

export function ReconView({ snap, account }: { snap: Snapshot; account: Account }) {
  const [tab, setTab] = useState<Tab>('station');
  const view = jointCandidate(snap);
  const acc = selectAccumulated(snap);
  const jr = snap.jointReviews.find((j) => j.tripId === 'TRIP-1');

  return (
    <div className="layout single">
      <div className="panel">
        <div className="veh-head">
          <h3 style={{ margin: 0 }}>TRIP-1 重量差异补证案件</h3>
          <span className="tag">{ROLE_LABEL[account.role]} · {account.name}</span>
          <span className="muted small">线路 S1→S2→S3；估重 0.7 / 1.2 / 0.8 吨（估重非实收）</span>
          <button className="btn tiny ghost" style={{ marginLeft: 'auto' }}
            onClick={async () => { await resetDemo(); setTab('station'); }}>
            重置并重放
          </button>
        </div>
        <div className="summary-grid">
          <div className="sum-item"><span className="muted small">空载/终磅</span>
            <b className="mono">{view.tare ? `${view.tare.measure.value.toFixed(2)}±${view.tare.measure.tol.toFixed(2)}` : '—'} / {view.final ? `${view.final.measure.value.toFixed(2)}±${view.final.measure.tol.toFixed(2)}` : '—'}</b></div>
          <div className="sum-item"><span className="muted small">总增重</span><b className="mono">{view.totalGain ? fmtInterval(view.totalGain) : '—'}</b></div>
          <div className="sum-item"><span className="muted small">已知 S1+S2</span><b className="mono">{fmtInterval(view.knownInterval)}</b></div>
          <div className="sum-item"><span className="muted small">S3 候选(推导)</span><b className="mono derived-text">{view.candidate ? fmtInterval(view.candidate) : '—'}</b></div>
          <div className="sum-item"><span className="muted small">正式实测累计</span><b className="mono">{acc.measuredTon.toFixed(2)} 吨</b></div>
          <div className="sum-item"><span className="muted small">联合单</span><b>{jr?.status === 'issued' ? '已签发' : jr?.status === 'reopened' ? '已重开' : '草稿'}</b></div>
        </div>
        <div className="boundary-box">
          <b>正式复核边界：逐站独立核实。</b>
          <span className="muted small"> S1/S2 凭本站有效原件独立出结论；S3 无有效原件，保留未知并派补证、不给量化范围。
          联合候选（总增重−已知站量）仅作对照，采用前须核全部 5 项依赖，且为推导值、非独立实测。</span>
        </div>
      </div>

      <div className="tabbar">
        {TABS.map((t) => (
          <button key={t.key} className={`tab-btn ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'tickets' && <TicketsPanel snap={snap} account={account} />}
      {tab === 'station' && <StationVerifyPanel snap={snap} account={account} />}
      {tab === 'joint' && <JointReviewPanel snap={snap} account={account} />}
      {tab === 'evidence' && <EvidencePanel snap={snap} account={account} />}

      <EventLogPanel events={snap.events.filter((e) => e.type.startsWith('recon'))} />
    </div>
  );
}
