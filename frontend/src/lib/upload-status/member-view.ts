// SDD-265: 회원 본인 "내 데이터 저장 현황" 순수 로직. 서버에 도착한 기록 기준이며 점수·완료·보증 표현을 만들지 않는다.
// 수집 제외(미착용·마이크 OFF)는 문제가 아니다. 한 줄 조치는 서버가 주지 않으므로 상태로 FE 가 만든다.
import type { MySessionRow } from '../api/my-upload-status';
import { FINAL_PENDING_MEMBER, MEMBER_LABEL, memberAction, type BoardState } from './board';

export type MemberKind = BoardState | 'excluded';
export const MEMBER_KIND_LABEL: Record<MemberKind, string> = { ...MEMBER_LABEL, excluded: '수집 제외' };
export const MEMBER_KIND_ICON: Record<MemberKind, string> = { warn: '!', live: '●', sending: '◷', ok: '✓', pending: '−', excluded: '−' };
export const MEMBER_KIND_TONE: Record<MemberKind, string> = {
  warn: 'bg-[#FFF2DD] text-[#805000]', live: 'bg-[#F4EDF8] text-[#5F0080]', sending: 'bg-[#F4EDF8] text-[#5F0080]',
  ok: 'bg-[#E8F3ED] text-[#226146]', pending: 'bg-[#F2EFF5] text-[#655173]', excluded: 'bg-[#F2EFF5] text-[#655173]',
};

export const isLiveSession = (status: string): boolean => status === 'in_progress' || status === 'open';

/** 본인 한 회차의 상태. 수집 제외 → 확인 필요 → 측정 중 → 서버 판정 순으로 본다. */
export function memberKind(r: MySessionRow): MemberKind {
  if (r.collection_state === 'excluded' || r.progress_state === 'not_collected') return 'excluded';
  if (r.status === 'needs_attention' || r.progress_state === 'needs_attention') return 'warn';
  if (isLiveSession(r.session_status)) return 'live';
  if (r.progress_state === 'all_received') return 'ok';
  if (r.status === 'uploading' || r.progress_state === 'in_progress') return 'sending';
  return 'pending';
}

/** SDD-267: 전송 중인데 서버에 모두 도착(최종 확인 대기)인 본인 회차. */
export const memberFinalPending = (r: MySessionRow, k: MemberKind): boolean => r.final_pending && (k === 'sending' || k === 'pending');
export const memberLine = (k: MemberKind, finalPending = false): string => finalPending ? FINAL_PENDING_MEMBER : (k === 'excluded' ? '이 회차는 수집 대상이 아니에요. 문제가 아니에요' : memberAction(k));

/** 전송 현황 %. 서버 percent 우선, 없으면 도착/예상 크기. 모두 도착이 아니면 99% 상한(내림). */
export function memberPercent(r: MySessionRow, kind: MemberKind): number | null {
  if (kind === 'excluded') return null;
  let pct: number | null = null;
  if (r.percent !== null) pct = Math.floor(r.percent);
  else if (r.bytes_expected !== null && r.bytes_expected > 0 && r.bytes_arrived !== null) pct = Math.floor(Math.min(r.bytes_arrived, r.bytes_expected) / r.bytes_expected * 100);
  if (pct === null) return null;
  return kind === 'ok' ? 100 : Math.min(pct, 99);
}
