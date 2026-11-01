// SDD-263: 전체 회차 목록의 순수 로직(대표 상태·필터·그룹·정렬·폴링 주기).
// SDD-261 용어 그대로: 서버 수신 기준, 완료·보증·점수 표현 금지, 미착용≠미수신.
import type { UploadOverviewItem } from '../api/upload-overview';
import type { UploadStatusKind } from '../api/upload-status';
import { STATUS_ORDER } from './view';

export type OverviewPeriod = 'today' | '7d' | '30d' | '90d';
export type OverviewGrouping = 'none' | 'class' | 'status' | 'date';
export interface OverviewFilters { query: string; classId: string; status: UploadStatusKind | 'all'; period: OverviewPeriod }
export const DEFAULT_OVERVIEW_FILTERS: OverviewFilters = { query: '', classId: 'all', status: 'all', period: '30d' };

export const PERIOD_LABEL: Record<OverviewPeriod, string> = { today: '오늘', '7d': '최근 7일', '30d': '최근 30일', '90d': '최근 90일(최대)' };
export const SESSION_STATUS_LABEL: Record<string, string> = {
  in_progress: '진행 중', open: '입장 중', scheduled: '예정', ready: '예정', completed: '종료', cancelled: '취소',
};
export const sessionStatusLabel = (s: string): string => SESSION_STATUS_LABEL[s] ?? s;
export const isLiveSession = (s: string): boolean => s === 'in_progress' || s === 'open';

/** 회차 대표 상태. 서버 값 우선, 없으면 summary 우선순위(확인 필요 → 업로드 중 → 수신 확인 → 미수신 → 수집 제외). */
export function overviewStatus(i: UploadOverviewItem): UploadStatusKind {
  if (i.status) return i.status;
  const s = i.summary;
  if (s.needs_attention > 0) return 'needs_attention';
  if (s.uploading > 0) return 'uploading';
  if (s.received_unreconciled > 0) return 'received_unreconciled';
  if (s.no_data > 0) return 'no_data';
  return s.participants > 0 ? 'excluded' : 'no_data';
}

export const periodSince = (period: OverviewPeriod, now: Date): string | null => {
  const d = new Date(now);
  if (period === 'today') d.setHours(0, 0, 0, 0); else d.setTime(d.getTime() - { '7d': 7, '30d': 30, '90d': 89 }[period] * 86_400_000);
  return d.toISOString();
};

const collator = new Intl.Collator('ko');
const label = (i: UploadOverviewItem) => `${i.class_title ?? ''} ${i.seq ?? ''}회차 ${i.host_name ?? ''}`.toLowerCase();

export function filterOverview(rows: readonly UploadOverviewItem[], f: OverviewFilters, now: Date): UploadOverviewItem[] {
  const q = f.query.trim().toLowerCase();
  const since = periodSince(f.period, now);
  return rows.filter((i) =>
    (!q || label(i).includes(q))
    && (f.classId === 'all' || i.class_id === f.classId)
    && (f.status === 'all' || overviewStatus(i) === f.status)
    && (!since || !i.session_at || i.session_at >= since || isLiveSession(i.session_status)));
}

/** 진행 중 우선 → 최근순 → 클래스명·회차. 원본을 바꾸지 않는다. */
export function sortOverview(rows: readonly UploadOverviewItem[]): UploadOverviewItem[] {
  const rank = (i: UploadOverviewItem) => (isLiveSession(i.session_status) ? 0 : 1);
  return [...rows].sort((a, b) =>
    rank(a) - rank(b)
    || (b.session_at ?? '').localeCompare(a.session_at ?? '')
    || collator.compare(a.class_title ?? '', b.class_title ?? '')
    || (a.seq ?? 0) - (b.seq ?? 0)
    || a.session_id.localeCompare(b.session_id));
}

export interface OverviewGroup { key: string; label: string; rows: UploadOverviewItem[] }
const dayKey = (iso: string | null): string => (iso ? iso.slice(0, 10) : '일정 미정');

export function groupOverview(rows: readonly UploadOverviewItem[], by: OverviewGrouping): OverviewGroup[] {
  const sorted = sortOverview(rows);
  if (by === 'none') return sorted.length ? [{ key: 'all', label: '전체 회차', rows: sorted }] : [];
  const map = new Map<string, OverviewGroup>();
  for (const i of sorted) {
    const [key, text] = by === 'class' ? [i.class_id, i.class_title ?? '이름 없는 클래스']
      : by === 'status' ? [overviewStatus(i), '']
        : [dayKey(i.session_at), dayKey(i.session_at)];
    const g = map.get(key) ?? { key, label: text, rows: [] };
    g.rows.push(i); map.set(key, g);
  }
  const groups = [...map.values()];
  if (by === 'status') return STATUS_ORDER.filter((k) => map.has(k)).map((k) => ({ ...(map.get(k) as OverviewGroup), label: k }));
  return groups;
}

export function overviewTotals(rows: readonly UploadOverviewItem[]) {
  return rows.reduce((a, i) => ({
    sessions: a.sessions + 1, participants: a.participants + i.summary.participants,
    needs_attention: a.needs_attention + i.summary.needs_attention, uploading: a.uploading + i.summary.uploading,
    received_unreconciled: a.received_unreconciled + i.summary.received_unreconciled, no_data: a.no_data + i.summary.no_data,
    attentionSessions: a.attentionSessions + (overviewStatus(i) === 'needs_attention' ? 1 : 0),
  }), { sessions: 0, participants: 0, needs_attention: 0, uploading: 0, received_unreconciled: 0, no_data: 0, attentionSessions: 0 });
}

/** 서버 X-Poll-Interval 우선. 없으면 진행 중 회차가 있을 때 4초, 아니면 15초. */
export function overviewPollMs(serverSec: number | null | undefined, rows: readonly UploadOverviewItem[]): number {
  if (typeof serverSec === 'number' && Number.isFinite(serverSec) && serverSec > 0) return Math.round(serverSec * 1000);
  return rows.some((i) => isLiveSession(i.session_status)) ? 4000 : 15_000;
}

export const detailPathFor = (role: string | null | undefined, classId: string, sessionId: string): string =>
  role === 'platform_admin'
    ? `/admin/upload-status/${encodeURIComponent(classId)}/${encodeURIComponent(sessionId)}`
    : `/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}/upload-status`;

export const overviewHomePath = (role: string | null | undefined): string => (role === 'platform_admin' ? '/admin/upload-status' : '/upload-status');
