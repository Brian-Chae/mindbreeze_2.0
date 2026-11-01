// SDD-265: 숫자 중심 상황판의 순수 로직(상태 판정·표기·조치 문구). 정본 시안: designs/sdd-265-upload-status-redesign-v2/안3-A.html
// 규칙: 점수·종합점수·좋음/나쁨·'보증'·'완료' 표현 없음. 모르면 '—'/'집계 대기'. 100% 는 서버가 '모두 도착'으로 판정한 경우에만 표시한다.
import type { UploadOverviewItem } from '../api/upload-overview';
import type { PersonProgress, ProgressRatio, SessionMetrics, SessionProgress } from '../api/upload-progress';
import { overviewStatus, isLiveSession } from './overview-view';

/** 상황판 상태 4종 + 집계 대기. 오프라인은 서버가 알 수 없어 상태가 아니라 배너로만 다룬다. */
export type BoardState = 'warn' | 'live' | 'sending' | 'ok' | 'pending';
export const BOARD_ORDER: readonly BoardState[] = ['warn', 'live', 'sending', 'pending', 'ok'];
export const BOARD_LABEL: Record<BoardState, string> = {
  warn: '확인할 사람', live: '측정 중', sending: '전송 중', ok: '모두 도착', pending: '집계 대기',
};
/** 회원 화면 라벨(주어가 본인). */
export const MEMBER_LABEL: Record<BoardState, string> = {
  warn: '확인 필요', live: '전송 중', sending: '전송 중', ok: '모두 도착', pending: '집계 대기',
};
export const BOARD_ICON: Record<BoardState, string> = { warn: '!', live: '●', sending: '◷', ok: '✓', pending: '−' };
export const BOARD_TONE: Record<BoardState, string> = {
  warn: 'bg-[#FFF2DD] text-[#805000]',
  live: 'bg-[#F4EDF8] text-[#5F0080]',
  sending: 'bg-[#F4EDF8] text-[#5F0080]',
  ok: 'bg-[#E8F3ED] text-[#226146]',
  pending: 'bg-[#F2EFF5] text-[#655173]',
};

/** 회차 상태 판정. 서버 progress 가 없으면 '모두 도착'을 만들지 않고 집계 대기로 둔다. */
export function boardState(i: Pick<UploadOverviewItem, 'progress' | 'summary' | 'session_status' | 'status'>): BoardState {
  const p = i.progress?.participants;
  const attention = p ? p.needs_attention : i.summary.needs_attention;
  if (attention > 0 || (!p && overviewStatus(i as UploadOverviewItem) === 'needs_attention')) return 'warn';
  if (isLiveSession(i.session_status)) return 'live';
  if (!p) return i.summary.uploading > 0 ? 'sending' : 'pending';
  if (p.counted > 0 && p.all_received === p.counted) return 'ok';
  if (p.counted === 0 || p.expected_unknown === p.counted) return 'pending';
  return 'sending';
}

/** SDD-267: 최종 확인 대기 인원(회차 기준). 판정(boardState)은 바꾸지 않는 보조 표기. */
export const finalPendingCount = (i: Pick<UploadOverviewItem, 'progress'>): number => i.progress?.participants.final_pending ?? 0;
/** 칩/안내는 측정이 끝났고 확인할 사람이 없을 때만(경고와 섞지 않는다). */
export const showFinalPending = (state: BoardState, n: number): boolean => n > 0 && (state === 'sending' || state === 'pending');
/** 안내 한 줄은 남은 사람이 전부 최종 확인 대기일 때만(contract §3: final_pending === counted − all_received − not_collected). */
export function finalPendingAll(p: SessionProgress | null | undefined): boolean {
  if (!p) return false;
  const q = p.participants;
  return q.final_pending > 0 && q.final_pending === q.counted - q.all_received;
}
export const FINAL_PENDING_CHIP = '모두 도착 · 최종 확인 대기';
export const FINAL_PENDING_COACH = '서버에 모두 도착했어요. 폰의 최종 확인만 기다리고 있어요';
export const FINAL_PENDING_PERSON_NOTE = '조치는 필요 없어요. 폰에서 앱을 한 번 열면 곧 확인돼요';
export const FINAL_PENDING_MEMBER = '서버에 모두 도착했어요. 앱을 한 번 열어 두면 최종 확인이 끝나요';

/** 확인할 사람 수(회차 기준). */
export const attentionCount = (i: Pick<UploadOverviewItem, 'progress' | 'summary'>): number =>
  i.progress ? i.progress.participants.needs_attention : i.summary.needs_attention;

// ── 표기 ──
export const DASH = '—';
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return DASH;
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))}KB`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1000) return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)}MB`;
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(2)}GB`;
}
export function formatMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min) || min < 0) return DASH;
  if (min >= 60 * 100) return `${Math.round(min / 60).toLocaleString('ko-KR')}시간`;
  if (min >= 600) return `${Math.round(min / 6) / 10}시간`;
  return `${Math.round(min)}분`;
}
/** 참여자 합계 시간 — 항상 '시간' 단위. */
export const formatTotalHours = (min: number | null | undefined): string =>
  (min === null || min === undefined || !Number.isFinite(min) || min < 0 ? DASH : `${Math.round(min / 6) / 10}시간`);

/**
 * 전송 현황 %. 도착한 크기/예상 크기를 우선하고, 없으면 서버 진행 합계를 쓴다. 내림해 99.9% 가 100% 로 보이지 않게 하고,
 * 서버가 '모두 도착'으로 보지 않은 상태에서는 99% 를 넘기지 않는다. 모르면 null.
 */
export function transferPercent(metrics: SessionMetrics | undefined, overall: ProgressRatio | null | undefined, allArrived: boolean): number | null {
  let pct: number | null = null;
  if (metrics && metrics.bytes_expected !== null && metrics.bytes_expected > 0 && metrics.bytes_arrived !== null) {
    pct = Math.floor(Math.min(metrics.bytes_arrived, metrics.bytes_expected) / metrics.bytes_expected * 100);
  } else if (overall && overall.percent !== null) {
    pct = Math.floor(overall.percent);
  }
  if (pct === null) return null;
  return allArrived ? 100 : Math.min(pct, 99);
}

/** 도착한 참여자 N/M명. 분모를 모르면 —. */
export function arrivedText(m: Pick<SessionMetrics, 'participants_arrived' | 'participants_expected'> | undefined): string {
  return m && m.participants_arrived !== null && m.participants_expected !== null && m.participants_expected > 0 ? formatArrived(m.participants_arrived, m.participants_expected) : DASH;
}
export const percentText = (p: number | null): string => (p === null ? '집계 대기' : `${p}%`);

export const formatArrived = (arrived: number, counted: number): string => `${arrived.toLocaleString('ko-KR')}/${counted.toLocaleString('ko-KR')}명`;

// ── 조치 한 줄(실제 가능한 것만, 알림·메일 발송 없음) ──
export function coachAction(state: BoardState, n: number): string | null {
  if (state === 'warn') return `${n}명이 앱을 다시 켜고 와이파이에 연결하면 이어서 도착해요`;
  if (state === 'live') return '앱을 켠 채 측정을 이어가 주세요';
  if (state === 'sending') return '전송이 이어지고 있어요. 잠시 뒤 새로고침해 주세요';
  if (state === 'pending') return '예상 크기를 확인하고 있어요';
  return null;
}
export const COACH_OK_NOTE = '추가 조치는 없어요';
export function memberAction(state: BoardState): string {
  if (state === 'warn') return '앱을 켠 채 와이파이에 연결하거나 앱을 다시 실행해 주세요';
  if (state === 'live' || state === 'sending') return '앱을 켠 채 와이파이에 연결해 두면 이어서 도착해요';
  if (state === 'pending') return '예상 크기를 확인하고 있어요. 잠시 뒤 다시 확인해 주세요';
  return '모두 도착했어요';
}

/** 참여자 한 명의 할 일 문구. 원인 단정 없이 실제 가능한 행동만. */
export function personAction(p: { failed: boolean; stalled: boolean }): string {
  return p.failed ? '앱 다시 켜기' : p.stalled ? '와이파이 연결' : '앱 켜 두기';
}

// ── 참여자 분류 ──
export type PersonBucket = 'attention' | 'arrived' | 'final_pending' | 'waiting' | 'excluded';
export function personBucket(p: { progress?: PersonProgress | null; status?: string; collection_state?: string; participation_status?: string }): PersonBucket {
  const excluded = p.collection_state === 'excluded' || p.participation_status === 'waitlisted';
  const prog = p.progress;
  if (!prog) return p.status === 'needs_attention' ? 'attention' : excluded ? 'excluded' : 'waiting'; // 구 서버: 기존 상태로 후퇴
  switch (prog.state) {
    case 'needs_attention': return 'attention';
    case 'all_received': return 'arrived';
    case 'not_collected': return 'excluded';
    case 'in_progress': case 'expected_unknown': return prog.final_pending ? 'final_pending' : 'waiting';
    default: return 'waiting'; // in_progress·expected_unknown
  }
}

/** 측정 중·도착 중 참여자는 '대기' 접힘에 들어간다. 라벨은 상태에 맞게. */
export const BUCKET_LABEL: Record<PersonBucket, string> = {
  attention: '확인할 사람', arrived: '모두 도착', final_pending: '최종 확인 대기', waiting: '집계 대기·전송 중', excluded: '수집 제외',
};

export const PAGE_SIZE = 10;
export const pageCount = (n: number): number => Math.max(1, Math.ceil(n / PAGE_SIZE));
export const slicePage = <T,>(rows: readonly T[], page: number): T[] => rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

/** 상세 상단 근거 한 줄(전체를 단정하지 않음). */
export function basisNote(p: SessionProgress | null, state: BoardState): string {
  if (state === 'live') return '측정 중 · 예상 크기는 바뀔 수 있어요';
  if (!p) return '전체 예상 크기 확인 전';
  const { counted, expected_unknown: unknown, not_collected: excluded, all_received: arrived } = p.participants;
  if (state === 'ok') return `${arrived.toLocaleString('ko-KR')}명 모두 도착`;
  const parts: string[] = [`확인된 ${(counted - unknown).toLocaleString('ko-KR')}명 기준`];
  if (unknown > 0) parts.push(`${unknown}명 집계 대기`);
  if (excluded > 0) parts.push(`${excluded}명 수집 제외`);
  return parts.join(' · ');
}
