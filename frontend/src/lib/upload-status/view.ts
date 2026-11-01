// SDD-261: 업로드 현황 화면의 순수 로직(표시 문구·필터·그룹·정렬·폴링 주기).
// 서버 수신 기준만 다룬다. 점수·종합점수·좋음/나쁨·완료·100% 표현을 만들지 않는다.
import type { UploadParticipantDto, UploadStatusKind } from '../api/upload-status';

export const STATUS_LABEL: Record<UploadStatusKind, string> = {
  needs_attention: '확인 필요',
  excluded: '수집 제외',
  uploading: '등록 건 업로드 중',
  received_unreconciled: '수신 확인 · 전체 대조 미확인',
  no_data: '미수신 · 착용 여부 미확인',
};
export const STATUS_ICON: Record<UploadStatusKind, string> = {
  needs_attention: '!', excluded: '−', uploading: '◷', received_unreconciled: '↓', no_data: '−',
};
/** 표시 순서(확인 필요 우선). */
export const STATUS_ORDER: readonly UploadStatusKind[] = ['needs_attention', 'uploading', 'no_data', 'received_unreconciled', 'excluded'];

export const REASON_LABEL: Record<string, string> = {
  raw_failed: '서버가 받지 않음(재전송해도 같음)',
  feature_internal_gap: 'feature 내부 결측 확인',
  raw_internal_gap: '원시 데이터 내부 결측 확인',
  raw_pending_stale: '서버 등록 후 60초 이상 대기',
  raw_pending: '서버 등록 후 업로드 대기',
  collection_excluded: '수집 동의 제외',
  collection_excluded_now: '현재 수집 제외',
  waitlisted: '대기열 참여자',
};
/** 원인을 확정하는 문구를 만들지 않는다. 알 수 없는 사유는 숨기지 않고 그대로 보인다. */
export const reasonLabel = (reason: string): string => REASON_LABEL[reason] ?? reason;

export const displayName = (p: Pick<UploadParticipantDto, 'display_name'>): string => (p.display_name?.trim() ? p.display_name : '이름 미확인');

export const COLLECTION_LABEL: Record<UploadParticipantDto['collection_state'], string> = {
  eligible: '수집 대상', excluded: '수집 제외', unknown: '수집 대상 미확인',
};

export interface UploadFilters {
  query: string;
  status: UploadStatusKind | 'all';
  collection: UploadParticipantDto['collection_state'] | 'all';
  report: 'all' | 'included' | 'excluded';
}
export const DEFAULT_FILTERS: UploadFilters = { query: '', status: 'all', collection: 'all', report: 'all' };
export type UploadGrouping = 'attention' | 'collection';

export function filterParticipants(rows: readonly UploadParticipantDto[], f: UploadFilters): UploadParticipantDto[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((p) =>
    (!q || displayName(p).toLowerCase().includes(q))
    && (f.status === 'all' || p.status === f.status)
    && (f.collection === 'all' || p.collection_state === f.collection)
    && (f.report === 'all' || (f.report === 'included' ? p.report_included === true : p.report_included === false)));
}

const collator = new Intl.Collator('ko');
/** 확인 필요 우선 → 이름 → participant_id. 원본을 바꾸지 않는다. */
export function sortParticipants(rows: readonly UploadParticipantDto[]): UploadParticipantDto[] {
  const rank = (p: UploadParticipantDto) => (p.status === 'needs_attention' ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || collator.compare(displayName(a), displayName(b)) || a.participant_id.localeCompare(b.participant_id));
}

export interface ParticipantGroup { key: string; label: string; rows: UploadParticipantDto[] }
export function groupParticipants(rows: readonly UploadParticipantDto[], by: UploadGrouping): ParticipantGroup[] {
  const sorted = sortParticipants(rows);
  const groups: ParticipantGroup[] = by === 'attention'
    ? [
      { key: 'attention', label: '확인 필요', rows: sorted.filter((p) => p.status === 'needs_attention') },
      { key: 'others', label: '그 외 참여자', rows: sorted.filter((p) => p.status !== 'needs_attention') },
    ]
    : (['eligible', 'excluded', 'unknown'] as const).map((k) => ({ key: k, label: COLLECTION_LABEL[k], rows: sorted.filter((p) => p.collection_state === k) }));
  return groups.filter((g) => g.rows.length > 0);
}

/** 신호 3종 합계. */
export function rawTotals(p: UploadParticipantDto): { registered: number; uploaded: number; pending: number; failed: number } {
  return p.raw.signals.reduce((acc, s) => ({
    registered: acc.registered + s.registered, uploaded: acc.uploaded + s.uploaded,
    pending: acc.pending + s.pending, failed: acc.failed + s.failed,
  }), { registered: 0, uploaded: 0, pending: 0, failed: 0 });
}
export const SIGNAL_LABEL = { eeg: 'EEG', ppg: 'PPG', acc: 'ACC' } as const;

/** 두 시각 중 늦은 값. */
export function latestReceived(p: UploadParticipantDto): string | null {
  const a = p.feature?.last_received_at ?? null; const b = p.raw?.last_received_at ?? null;
  if (a && b) return a > b ? a : b;
  return a ?? b;
}

// ── 폴링 주기 ──
export const ERROR_BACKOFF_SEC = [3, 6, 12, 30, 60] as const;
export const errorBackoffMs = (failures: number): number => ERROR_BACKOFF_SEC[Math.min(Math.max(failures, 1), ERROR_BACKOFF_SEC.length) - 1] * 1000;

/** 서버 X-Poll-Interval 우선, 없으면 회차 상태 기본값(spec §3-1). */
export function pollDelayMs(serverSec: number | null | undefined, sessionStatus: string | null | undefined): number {
  if (typeof serverSec === 'number' && Number.isFinite(serverSec) && serverSec > 0) return Math.round(serverSec * 1000);
  if (sessionStatus === 'in_progress') return 3000;
  if (sessionStatus === 'open') return 5000;
  if (sessionStatus === 'completed' || sessionStatus === 'cancelled') return 60_000;
  return 10_000;
}

export function secondsAgo(from: Date | null, now: Date): number | null {
  return from ? Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000)) : null;
}
export const formatClock = (iso: string | Date | null): string => {
  if (!iso) return '없음';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '없음';
  return d.toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
};
export const formatCount = (n: number): string => n.toLocaleString('ko-KR');

export const uploadStatusScreenPath = (classId: string, sessionId: string): string =>
  `/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}/upload-status`;
