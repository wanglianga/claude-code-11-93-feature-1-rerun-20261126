// 面板四：补证责任（司机提交、复核员采用/退回、站点管理员查明缺失原件）+ 正式累计（只读批准实测）。
import React, { useState } from 'react';
import type { BoundedMeasure } from '../../types';
import { fmtMin } from '../../types';
import {
  adoptEvidence, adminResolveMissingOriginal, returnEvidence, selectAccumulated, submitEvidence,
} from '../../lib/reconActions';
import { fmtInterval } from '../../lib/recon';
import { EvidenceStatusBadge } from '../Shared';
import { canAdmin, canDrive, canReview, Msg, type ReconProps } from './common';

export function EvidencePanel({ snap, account }: ReconProps) {
  const [msg, setMsg] = useState('');
  const [bad, setBad] = useState(false);
  const [text, setText] = useState('S3 站点秤票原件正在向站点调取');
  const [withTicket, setWithTicket] = useState(true);
  const [supValue, setSupValue] = useState('1.9');
  const [supTol, setSupTol] = useState('0.1');
  const [returnReason, setReturnReason] = useState('凭证不清晰');
  const [finding, setFinding] = useState('调取监控与台账后确认：S3 当日地磅未出票，无有效原件可补');
  const flash = (m: string, isBad = false) => { setMsg(m); setBad(isBad); };

  const requests = snap.evidenceRequests.filter((e) => e.tripId === 'TRIP-1');
  const acc = selectAccumulated(snap);
  const jr = snap.jointReviews.find((j) => j.tripId === 'TRIP-1');

  const onSubmit = async (id: string) => {
    let measure: BoundedMeasure | undefined;
    let calib: boolean | undefined;
    if (withTicket) {
      const v = parseFloat(supValue);
      const e = parseFloat(supTol);
      if (isNaN(v) || isNaN(e)) { flash('请输入有效的补证票据数值', true); return; }
      measure = { value: v, tol: e };
      calib = true;
    }
    const r = await submitEvidence(snap, { requestId: id, text, actor: account.name, measure, calibrationValid: calib });
    flash(r.message, !r.ok);
  };
  const onAdopt = async (id: string) => { const r = await adoptEvidence(snap, { requestId: id, actor: account.name }); flash(r.message, !r.ok); };
  const onReturn = async (id: string) => { const r = await returnEvidence(snap, { requestId: id, reason: returnReason, actor: account.name }); flash(r.message, !r.ok); };
  const onAdminClose = async (id: string) => { const r = await adminResolveMissingOriginal(snap, { requestId: id, finding, actor: account.name }); flash(r.message, !r.ok); };

  return (
    <div className="panel">
      <h3>④ 补证责任与正式累计</h3>
      <Msg text={msg} bad={bad} />

      <table className="tbl">
        <thead>
          <tr><th>补证单</th><th>站点/原因</th><th>状态</th><th>司机提交</th><th>站长查明</th><th>责任操作</th></tr>
        </thead>
        <tbody>
          {requests.map((er) => (
            <tr key={er.id}>
              <td className="mono small">{er.id}<div className="tiny muted">开单 {fmtMin(er.openedAtMin)} {er.openedBy}</div></td>
              <td className="small"><b>{er.stationId}</b><div className="muted tiny">{er.reason}</div></td>
              <td><EvidenceStatusBadge status={er.status} /><div className="tiny muted">{er.note}</div></td>
              <td className="small">{er.driverSubmission ?? '—'}{er.submittedAtMin != null && <div className="mono tiny">{fmtMin(er.submittedAtMin)}</div>}</td>
              <td className="small">{er.adminFinding ?? '—'}{er.resolvedAtMin != null && <div className="mono tiny">{fmtMin(er.resolvedAtMin)} {er.resolvedBy}</div>}</td>
              <td className="actions">
                {(er.status === 'open' || er.status === 'returned') && canDrive(account.role) && (
                  <button className="btn small primary" onClick={() => onSubmit(er.id)}>司机提交补证</button>
                )}
                {er.status === 'submitted' && canReview(account.role) && (
                  <>
                    <button className="btn small primary" onClick={() => onAdopt(er.id)}>采用为实测</button>
                    <button className="btn small ghost" onClick={() => onReturn(er.id)}>退回</button>
                  </>
                )}
                {er.status !== 'closed-no-original' && canAdmin(account.role) && (
                  <button className="btn small" onClick={() => onAdminClose(er.id)}>站长查明缺失原件并结案</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {canDrive(account.role) && (
        <div className="form-card" style={{ marginTop: 10 }}>
          <h4>司机补证材料</h4>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} />
          <label className="switch"><input type="checkbox" checked={withTicket} onChange={(e) => setWithTicket(e.target.checked)} /> 随附有效原件（站点秤票）</label>
          {withTicket && (
            <div className="form-row">
              <input className="input" type="number" step="0.01" value={supValue} onChange={(e) => setSupValue(e.target.value)} placeholder="标称值" />
              <input className="input" type="number" step="0.01" value={supTol} onChange={(e) => setSupTol(e.target.value)} placeholder="误差" />
            </div>
          )}
          {!withTicket && <div className="muted tiny">不随附有效原件时，复核员无法采用为实测，站点将继续待核。</div>}
        </div>
      )}
      {canReview(account.role) && (
        <div className="form-card" style={{ marginTop: 10 }}>
          <h4>复核员退回原因</h4>
          <input className="input" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} />
        </div>
      )}
      {canAdmin(account.role) && (
        <div className="form-card" style={{ marginTop: 10 }}>
          <h4>站点管理员查明结论</h4>
          <input className="input" value={finding} onChange={(e) => setFinding(e.target.value)} />
        </div>
      )}

      <div className="accum-box">
        <h4>正式累计口径（只读取已批准的实测）</h4>
        <div className="kpi-strip">
          <div className="kpi-card">
            <div className="kpi-label">已批准实测合计</div>
            <div className="kpi-num mono">{acc.measuredTon.toFixed(2)} 吨</div>
            <div className="tiny muted">站点 {acc.verifiedStationIds.join('、') || '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">仍待核（不计重量）</div>
            <div className="kpi-num mono">{acc.pendingStationIds.join('、') || '—'}</div>
            <div className="tiny muted">无有效原件，估重/差额不计入</div>
          </div>
          <div className="kpi-card kpi-derived">
            <div className="kpi-label">联合推导（仅供对照，不计入实测）</div>
            <div className="kpi-num mono">{acc.derived ? `${acc.derived.stationId} ${fmtInterval(acc.derived.interval)}` : '未签发'}</div>
            <div className="tiny muted">推导值永不写入站点实收</div>
          </div>
        </div>
        <ul className="muted tiny">
          <li>重复上传不产生新增站点量；估重、整车差额、回站补称均不进入正式累计。</li>
          <li>仅当补证随附的有效原件被复核员「采用」后，该站才由待核转为实测并计入合计。</li>
          <li>当前联合复核状态：{jr?.status === 'issued' ? '已签发（候选可对照但仍非实测）' : '未签发/已重开（候选不可采用）'}。</li>
        </ul>
      </div>
    </div>
  );
}
