// 面板二：逐站核实（独立边界）。只核本站重量与作业凭证；S1/S2 先完成，S3 保留未知并派补证。
import React, { useState } from 'react';
import { fmtMin } from '../../types';
import { issueStationVerification, openDifferenceInvestigation } from '../../lib/reconActions';
import { currentStationTicket } from '../../lib/reconActions';
import { toInterval } from '../../lib/recon';
import { StationVerifyBadge } from '../Shared';
import { canReview, Msg, type ReconProps } from './common';

export function StationVerifyPanel({ snap, account }: ReconProps) {
  const [msg, setMsg] = useState('');
  const [bad, setBad] = useState(false);
  const flash = (m: string, isBad = false) => { setMsg(m); setBad(isBad); };

  const ordered = snap.stationVerifications
    .filter((v) => v.tripId === 'TRIP-1')
    .sort((a, b) => a.seq - b.seq);

  const onIssue = async (stationId: string) => {
    const r = await issueStationVerification(snap, { stationId, actor: account.name });
    flash(r.message, !r.ok);
  };

  const onInvestigate = async (stationId: string) => {
    const r = await openDifferenceInvestigation(snap, { stationId, actor: account.name });
    flash(r.message, false);
  };

  return (
    <div className="panel">
      <h3>② 逐站核实（正式边界 · 独立签发，不等跨站材料）</h3>
      <p className="muted small">
        逐站只核<b>本站重量及作业凭证</b>：S1/S2 凭本站有效秤票先完成；S3 无有效原件，结论<b>保留未知并派补证</b>，
        不等待跨站材料，也<b>不给量化范围</b>。估重仅作对照，永不填作实收；与推导不一致只触发差异调查，不重派清运。
      </p>
      <Msg text={msg} bad={bad} />

      <table className="tbl">
        <thead>
          <tr><th>序</th><th>站点</th><th>估重(吨)</th><th>本站有效票</th><th>实测区间</th><th>核实结论</th><th>签认</th><th>操作</th></tr>
        </thead>
        <tbody>
          {ordered.map((v) => {
            const ticket = currentStationTicket(snap, v.stationId);
            const iv = ticket ? toInterval(ticket.measure) : null;
            const estOutside = iv ? (v.estTon < iv.lo - 1e-9 || v.estTon > iv.hi + 1e-9) : false;
            return (
              <tr key={v.id}>
                <td className="mono">{v.seq}</td>
                <td><b>{v.stationId}</b></td>
                <td className="mono">{v.estTon.toFixed(1)}{estOutside && <span className="badge orange" title="估重落在实测区间外">估重偏差</span>}</td>
                <td className="small">{ticket ? <span className="mono">{ticket.ticketNo}<br />{ticket.measure.value.toFixed(2)}±{ticket.measure.tol.toFixed(2)}</span> : <span className="bad">无有效原件</span>}</td>
                <td className="mono small">{iv ? `[${iv.lo.toFixed(2)}, ${iv.hi.toFixed(2)}]` : '—'}</td>
                <td><StationVerifyBadge status={v.status} /><div className="tiny muted">{v.note}</div></td>
                <td className="small">{v.signedBy ? <>{v.signedBy}<div className="mono tiny">{v.signedAtMin != null ? fmtMin(v.signedAtMin) : ''}</div></> : '—'}</td>
                <td className="actions">
                  {canReview(account.role) && v.status !== 'verified' && (
                    <button className="btn small primary" onClick={() => onIssue(v.stationId)}>
                      {ticket ? '逐站签发核实' : '核为未知并派补证'}
                    </button>
                  )}
                  {canReview(account.role) && (
                    <button className="btn small ghost" onClick={() => onInvestigate(v.stationId)}>差异调查</button>
                  )}
                  {v.status === 'verified' && <span className="ok small">✓ 独立实测已入账</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="muted tiny" style={{ marginTop: 8 }}>
        说明：S2 估重 1.2t 与有效票 1.00±0.10t（区间 [0.90,1.10]）不相容，仅记录估重偏差；以有效票据为准，不回改估重、不据此重派。
      </div>
    </div>
  );
}
