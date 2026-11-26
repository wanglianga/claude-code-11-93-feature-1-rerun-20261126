// 复核面板共享：角色能力判定与通用小组件
import React from 'react';
import type { Account } from '../../types';

export interface ReconProps {
  snap: import('../../lib/db').Snapshot;
  account: Account;
}

export const ROLE_LABEL: Record<string, string> = {
  dispatcher: '调度员',
  driver: '司机',
  cs: '客服',
  reviewer: '复核员',
  'station-admin': '站点管理员',
  crew: '班组',
};

export function canReview(role: string): boolean {
  return role === 'reviewer';
}
export function canDrive(role: string): boolean {
  return role === 'driver';
}
export function canCrew(role: string): boolean {
  return role === 'crew';
}
export function canAdmin(role: string): boolean {
  return role === 'station-admin';
}

export function Msg({ text, bad }: { text: string; bad?: boolean }) {
  if (!text) return null;
  return <div className={`demo-msg ${bad ? 'demo-msg-bad' : ''}`}>{text}</div>;
}

export function ReadOnlyHint({ role }: { role: string }) {
  return (
    <div className="muted tiny">
      当前身份「{ROLE_LABEL[role] ?? role}」对此面板为只读；写操作需对应责任角色（司机提交原票/补证、班组补封闭、复核员签发/采用、站长查明缺失原件）。
    </div>
  );
}
