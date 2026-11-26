// 面板三：联合候选与整趟封闭性（2 地磅票 + 3 封闭签认，共 5 项依赖），候选为推导值非独立实测。
import React, { useState } from 'react';
import type { JointDependencyCheck, SealRecord } from '../../types';
import { fmtMin } from '../../types';
import {
  issueJointReview, jointCandidate, reportMidUnload, submitSeal, toggleDependency,
} from '../../lib/reconActions';
import { DEPENDENCY_ITEMS, fmtInterval } from '../../lib/recon';
import { JointStatusBadge } from '../Shared';
import { canCrew, canReview, Msg, type ReconProps } from './common';

const STAGE_OPTION: { stage: SealRecord['stage']; label: string }[] = [
  { stage: 'depot-s1', label: '出车→S1' },
  { stage: 's1-s2', label: 'S1→S2' },
  { stage: 's2-final', label: 'S2→终磅' },
];

export function JointReviewPanel({ snap, account }: ReconProps) {
  const [msg, setMsg] = useState('');
  const [bad, setBad] = useState(false);
  const [offlineSeal, setOfflineSeal] = useState(false);
  const [unloadStage, setUnloadStage] = useState<SealRecord['stage']>('s1-s2');
  const flash = (m: string, isBad = false) => { setMsg(m); setBad(isBad); };

  const jr = snap.jointReviews.find((j) => j.tripId === 'TRIP-1')!;
  const view = jointCandidate(snap);

  const onToggle = async (key: keyof JointDependencyCheck) => {
    const r = await toggleDependency(snap, { key, actor: account.name });
    flash(r.message, !r.ok);
  };
  const onIssue = async () => {
    const r = await issueJointReview(snap, { actor: account.name });
    flash(r.message, !r.ok);
  };
  const onSeal = async (stage: SealRecord['stage'], label: string) => {
    const r = await submitSeal(snap, { stage, label, signedBy: account.name, offline: offlineSeal });
    flash(r.message, !r.ok);
  };
  const onUnload = async () => {
    const label = STAGE_OPTION.find((o) => o.stage === unloadStage)!.label;
    const r = await reportMidUnload(snap, { stage: unloadStage, detail: `${label} 途中私自倾倒被视频补发现`, actor: account.name });
    flash(r.message, false);
  };

  return (
    <div className="panel">
      <h3>③ 联合候选（对照边界 · 整趟封闭性 + 票据组成联合复核单）</h3>
      <div className="boundary-box">
        <div><b>正式选定边界：逐站独立核实</b>（S1/S2 已可独立出结论；S3 待补证，不量化）。</div>
        <div className="muted small">
          对照的联合边界：可用「总增重 − 已知站量」得到 S3 候选，但须另审 <b>2 张地磅票 + 3 段封闭签认（多 5 项工作）</b>，
          且推导共同依赖整趟材料；候选<b>不是独立实测</b>，封闭性一旦被证伪即不可采用。本面板允许查看与签发联合单，但不提供两套流程切换按钮。
        </div>
      </div>
      <Msg text={msg} bad={bad} />

      <div className="kpi-strip">
        <div className="kpi-card">
          <div className="kpi-label">总增重（终磅−空载）</div>
          <div className="kpi-num mono">{view.totalGain ? fmtInterval(view.totalGain) : '—'}</div>
          <div className="tiny muted">7.60±0.10 − 4.00±0.05</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">已知站量合计（S1+S2）</div>
          <div className="kpi-num mono">{fmtInterval(view.knownInterval)}</div>
          <div className="tiny muted">0.70±0.05 + 1.00±0.10</div>
        </div>
        <div className="kpi-card kpi-derived">
          <div className="kpi-label">S3 候选（推导，非实测）</div>
          <div className="kpi-num mono">{view.candidate ? fmtInterval(view.candidate) : '—'}</div>
          <div className="tiny muted">总增重 − 已知站量</div>
        </div>
      </div>

      <h4>5 项依赖逐项审核（客观状态 → 人工勾选）</h4>
      <table className="tbl small">
        <thead><tr><th>依赖项</th><th>客观材料</th><th>人工审核</th><th>操作（复核员）</th></tr></thead>
        <tbody>
          {DEPENDENCY_ITEMS.map((d) => {
            const objectiveOk = view.objectiveChecks[d.key];
            const manualOk = jr.checks[d.key];
            return (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td>{objectiveOk ? <span className="badge green">材料成立</span> : <span className="badge red">不成立/失效</span>}</td>
                <td>{manualOk ? <span className="badge blue">已审核</span> : <span className="badge gray">未审核</span>}</td>
                <td>
                  {canReview(account.role) && jr.status !== 'issued' && (
                    <button className="btn small" disabled={!objectiveOk && !manualOk} onClick={() => onToggle(d.key)}>
                      {manualOk ? '取消审核' : '审核通过'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="btn-row">
        <span className="muted small">人工审核 {Object.values(jr.checks).filter(Boolean).length}/5 · 客观成立 {view.checkedCount}/5</span>
        {canReview(account.role) && (
          <button className="btn primary small" disabled={jr.status === 'issued'} onClick={onIssue}>
            {jr.status === 'issued' ? '联合复核已签发' : '五项齐备后签发联合复核单'}
          </button>
        )}
        <JointStatusBadge status={jr.status} />
        {jr.reopenedReason && <span className="bad small">重开原因：{jr.reopenedReason}</span>}
      </div>

      <h4 style={{ marginTop: 14 }}>封闭签认与封闭性破坏（班组）</h4>
      <table className="tbl small">
        <thead><tr><th>阶段</th><th>签认人/时刻</th><th>无加料卸料换车</th><th>有效性</th><th>班组操作</th></tr></thead>
        <tbody>
          {STAGE_OPTION.map((o) => {
            const seal = snap.seals.find((s) => s.stage === o.stage);
            return (
              <tr key={o.stage}>
                <td>{o.label}</td>
                <td className="small">{seal ? <>{seal.signedBy} <span className="mono tiny">{fmtMin(seal.signedAtMin)}</span>{seal.offline && <span className="badge orange">离线晚到</span>}</> : '—'}</td>
                <td>{seal?.noAddNoUnload ? '是' : '—'}</td>
                <td>{seal ? (seal.valid ? <span className="badge green">有效</span> : <span className="badge red">失效</span>) : '—'}{seal?.invalidateReason && <div className="tiny bad">{seal.invalidateReason}</div>}</td>
                <td>
                  {canCrew(account.role) && (
                    <button className="btn small" onClick={() => onSeal(o.stage, o.label)}>
                      {offlineSeal ? '离线晚到补签（将失效）' : '补封闭签认'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="btn-row">
        <label className="switch"><input type="checkbox" checked={offlineSeal} onChange={(e) => setOfflineSeal(e.target.checked)} disabled={!canCrew(account.role)} /> 离线签认（晚到验证依赖失效）</label>
      </div>

      <h4 style={{ marginTop: 14 }}>中途卸料补发现（破坏整趟封闭性）</h4>
      <div className="btn-row">
        <select className="input" style={{ width: 160 }} value={unloadStage} onChange={(e) => setUnloadStage(e.target.value as SealRecord['stage'])} disabled={!canCrew(account.role) && !canReview(account.role)}>
          {STAGE_OPTION.map((o) => <option key={o.stage} value={o.stage}>{o.label}</option>)}
        </select>
        <button className="btn small" disabled={!canCrew(account.role) && !canReview(account.role)} onClick={onUnload}>登记中途卸料（失效签认/重开联合）</button>
      </div>

      <h4 style={{ marginTop: 14 }}>未结事项与历史解释（只追加）</h4>
      <table className="tbl small">
        <thead><tr><th>时刻</th><th>操作者</th><th>记录</th></tr></thead>
        <tbody>
          {jr.history.slice().reverse().map((h, i) => (
            <tr key={i}><td className="mono">{fmtMin(h.atMin)}</td><td>{h.actor}</td><td className="small">{h.message}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
