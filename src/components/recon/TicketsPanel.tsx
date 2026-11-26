// 面板一：票据修订（地磅票/站点秤票的提交、幂等、同号冲突、终磅更正、回站补称拒绝）
import React, { useState } from 'react';
import type { BoundedMeasure, TicketKind } from '../../types';
import { fmtMin } from '../../types';
import {
  attemptBackstationReweigh, reviseFinalTicket, submitTicket,
} from '../../lib/reconActions';
import { toInterval } from '../../lib/recon';
import { TicketLifecycleBadge } from '../Shared';
import { canDrive, canReview, Msg, type ReconProps } from './common';

const KIND_LABEL: Record<TicketKind, string> = { tare: '空载地磅票', final: '终磅地磅票', station: '站点秤票' };

export function TicketsPanel({ snap, account }: ReconProps) {
  const [msg, setMsg] = useState('');
  const [bad, setBad] = useState(false);
  // 新票据表单
  const [kind, setKind] = useState<TicketKind>('station');
  const [stationId, setStationId] = useState('S3');
  const [ticketNo, setTicketNo] = useState('WB-S3-NEW');
  const [value, setValue] = useState('1.9');
  const [tol, setTol] = useState('0.1');
  const [calib, setCalib] = useState(true);
  // 终磅更正表单
  const [revValue, setRevValue] = useState('7.8');
  const [revTol, setRevTol] = useState('0.1');

  const tickets = snap.weightTickets.filter((t) => t.tripId === 'TRIP-1');

  const flash = (m: string, isBad = false) => { setMsg(m); setBad(isBad); };

  const onSubmit = async () => {
    const v = parseFloat(value);
    const e = parseFloat(tol);
    if (isNaN(v) || isNaN(e) || v <= 0 || e < 0) { flash('请输入有效的标称值与误差边界', true); return; }
    const measure: BoundedMeasure = { value: v, tol: e };
    const r = await submitTicket(snap, {
      ticketNo, kind, stationId: kind === 'station' ? stationId : undefined,
      measure, calibrationValid: calib,
      submittedBy: account.id, submittedByName: account.name, offline: false,
    });
    flash(r.message, !r.ok);
  };

  const onRevise = async () => {
    const v = parseFloat(revValue);
    const e = parseFloat(revTol);
    if (isNaN(v) || isNaN(e)) { flash('请输入有效的终磅更正值', true); return; }
    const r = await reviseFinalTicket(snap, { measure: { value: v, tol: e }, calibrationValid: true, actor: account.name });
    flash(r.message, !r.ok);
  };

  const onReweigh = async () => {
    const r = await attemptBackstationReweigh(snap, { stationId: 'S3', actor: account.name });
    flash(r.message, true);
  };

  return (
    <div className="panel">
      <h3>① 票据修订（地磅票 / 站点秤票）</h3>
      <p className="muted small">
        同一票号同内容重传按幂等只计一次、<b>不增加清运量</b>；同票号不同内容判<b>冲突</b>并留痕、不覆盖原票。
        终磅更正会作废旧票并<b>重开联合复核</b>，但 S1/S2 逐站票据结论不撤回。
      </p>
      <Msg text={msg} bad={bad} />

      <table className="tbl small">
        <thead>
          <tr><th>票号</th><th>种类</th><th>站点</th><th>标称±误差(吨)</th><th>实测区间</th><th>校准</th><th>状态</th><th>提交/时刻</th><th>说明</th></tr>
        </thead>
        <tbody>
          {tickets.map((t) => {
            const iv = toInterval(t.measure);
            return (
              <tr key={t.id} className={t.lifecycle === 'current' ? '' : 'row-superseded'}>
                <td className="mono tiny">{t.ticketNo}</td>
                <td>{KIND_LABEL[t.kind]}</td>
                <td>{t.stationId ?? '—'}</td>
                <td className="mono">{t.measure.value.toFixed(2)}±{t.measure.tol.toFixed(2)}</td>
                <td className="mono small">[{iv.lo.toFixed(2)}, {iv.hi.toFixed(2)}]</td>
                <td>{t.calibrationValid ? <span className="badge green">有效</span> : <span className="badge red">失效</span>}</td>
                <td><TicketLifecycleBadge lifecycle={t.lifecycle} /></td>
                <td className="small">{t.submittedByName}<div className="mono tiny">{fmtMin(t.submittedAtMin)}</div></td>
                <td className="tiny muted">{t.conflictNote ?? t.note ?? '—'}{t.revisionOf && <div>修订自 {t.revisionOf}</div>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="form-grid">
        <div className="form-card">
          <h4>司机提交原票{canDrive(account.role) ? '' : '（只读，需司机身份）'}</h4>
          <label>票号（重复同号可验证幂等/冲突）</label>
          <input className="input" value={ticketNo} onChange={(e) => setTicketNo(e.target.value)} disabled={!canDrive(account.role)} />
          <div className="form-row">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as TicketKind)} disabled={!canDrive(account.role)}>
              <option value="station">站点秤票</option>
              <option value="tare">空载地磅票</option>
              <option value="final">终磅地磅票</option>
            </select>
            {kind === 'station' && (
              <select className="input" value={stationId} onChange={(e) => setStationId(e.target.value)} disabled={!canDrive(account.role)}>
                <option>S1</option><option>S2</option><option>S3</option>
              </select>
            )}
          </div>
          <div className="form-row">
            <input className="input" type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} disabled={!canDrive(account.role)} placeholder="标称值" />
            <input className="input" type="number" step="0.01" value={tol} onChange={(e) => setTol(e.target.value)} disabled={!canDrive(account.role)} placeholder="误差" />
          </div>
          <label className="switch"><input type="checkbox" checked={calib} onChange={(e) => setCalib(e.target.checked)} disabled={!canDrive(account.role)} /> 校准有效</label>
          <div className="btn-row">
            <button className="btn small primary" disabled={!canDrive(account.role)} onClick={onSubmit}>提交票据</button>
            <button className="btn small ghost" disabled={!canDrive(account.role)}
              onClick={() => { setTicketNo('WB-S1-001'); setKind('station'); setStationId('S1'); setValue('0.70'); setTol('0.05'); setCalib(true); }}>
              填入同号同内容（测幂等）
            </button>
            <button className="btn small ghost" disabled={!canDrive(account.role)}
              onClick={() => { setTicketNo('WB-S1-001'); setKind('station'); setStationId('S1'); setValue('0.95'); setTol('0.05'); setCalib(true); }}>
              填入同号异内容（测冲突）
            </button>
          </div>
        </div>

        <div className="form-card">
          <h4>终磅更正（复核员）{canReview(account.role) ? '' : '（只读）'}</h4>
          <p className="muted tiny">将终磅由 7.60±0.10 更正为 7.80±0.10：候选区间应变为 [1.80, 2.40]，已签发联合复核自动重开。</p>
          <div className="form-row">
            <input className="input" type="number" step="0.01" value={revValue} onChange={(e) => setRevValue(e.target.value)} disabled={!canReview(account.role)} placeholder="新标称值" />
            <input className="input" type="number" step="0.01" value={revTol} onChange={(e) => setRevTol(e.target.value)} disabled={!canReview(account.role)} placeholder="误差" />
          </div>
          <div className="btn-row">
            <button className="btn small primary" disabled={!canReview(account.role)} onClick={onRevise}>更正终磅并重开联合</button>
          </div>

          <h4 style={{ marginTop: 14 }}>回站补称（应被拒绝）</h4>
          <p className="muted tiny">混载后回站重新称重无法还原 S3 装载时点的历史站量，不能作为本站实收。</p>
          <button className="btn small" disabled={!canDrive(account.role) && !canReview(account.role)} onClick={onReweigh}>
            尝试以回站补称重建 S3 站量
          </button>
        </div>
      </div>
    </div>
  );
}
