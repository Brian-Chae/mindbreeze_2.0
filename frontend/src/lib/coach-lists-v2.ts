// SDD-320 F-1 — 코치 목록 3종(ui-v2) 표시 모델. 순수 함수만 둔다(API 호출 없음).
// 리포트 탭 매핑(시안 ↔ 실제 상태, 서버 탭 파라미터와 1:1):
//   검토 대기 = 서버 tab=needs_review  (기존 '검토 필요' 탭)
//   승인       = 서버 tab=all 중 status completed (기존 '전체' 탭의 승인 행)
//   발송 실패  = 승인 탭 안의 필터(서버 tab=failed). 기존 '발송 실패' 탭이 사라지지 않고 승인 안에 남는다.
import type { HierarchyTab, HierarchyDoc, HierarchyGroup, HierarchySession, HierarchyMember } from './api/report-hierarchy';
import type { HostClassReadModel } from './class-structure/adapters';
import type { DisplayField } from './class-structure/read-model';
import { rowState } from './report-ops-labels';

export type ReportTabV2 = 'review' | 'approved';
export type DeliveryFilterV2 = 'all' | 'failed';

export interface ReportRowV2 {
  key: string;
  reportId: string | null;
  who: string;
  path: string;
  tab: ReportTabV2;
  stateLabel: string;
  hint: string;
  deliveryFailed: boolean;
  action: string | null;
  groupTitle: string;
  scheduledAt: string | null;
  isCommon: boolean;
}

/** 화면 탭·필터 → 서버 계층 API 탭. */
export function serverTabFor(tab: ReportTabV2, delivery: DeliveryFilterV2): HierarchyTab {
  if (tab === 'review') return 'needs_review';
  return delivery === 'failed' ? 'failed' : 'all';
}

export function reportTabOf(doc: HierarchyDoc | null): ReportTabV2 | null {
  if (!doc) return null;
  return doc.status === 'completed' ? 'approved' : 'review';
}

export function isDeliveryFailed(doc: HierarchyDoc | null): boolean {
  return !!doc && doc.status === 'completed' && doc.delivery_status === 'failed';
}

function memberRow(group: HierarchyGroup, session: HierarchySession, member: HierarchyMember): ReportRowV2 | null {
  const doc = member.client_report;
  const tab = reportTabOf(doc);
  if (!doc || !tab) return null;
  const state = rowState(doc);
  return {
    key: `${session.session_id}:${member.participant_id}`,
    reportId: doc.report_id,
    who: member.name ?? '이름 미확인',
    path: `${group.title} › ${session.title ?? '회차'}`,
    tab, stateLabel: state.label, hint: state.hint, deliveryFailed: isDeliveryFailed(doc), action: state.action,
    groupTitle: `${group.title} · ${session.title ?? '회차'} · ${session.counselor_name ?? '코치'}`,
    scheduledAt: session.scheduled_at, isCommon: false,
  };
}

/** 계층 응답 → 평면 행. 회원용 리포트가 없는 회원은 제외하고, 회차 공통(코치용) 문서는 별도 행으로 둔다. */
export function flattenReportRows(groups: readonly HierarchyGroup[]): ReportRowV2[] {
  const rows: ReportRowV2[] = [];
  for (const group of groups) {
    for (const session of group.sessions) {
      const common = session.common_report;
      if (common) {
        const state = rowState(common);
        rows.push({
          key: `${session.session_id}:common`, reportId: common.report_id, who: '코치용 · 회차 공통',
          path: `${group.title} › ${session.title ?? '회차'}`, tab: common.status === 'completed' ? 'approved' : 'review',
          stateLabel: state.label, hint: state.hint, deliveryFailed: isDeliveryFailed(common), action: state.action,
          groupTitle: `${group.title} · ${session.title ?? '회차'} · ${session.counselor_name ?? '코치'}`,
          scheduledAt: session.scheduled_at, isCommon: true,
        });
      }
      for (const member of session.members) {
        const row = memberRow(group, session, member);
        if (row) rows.push(row);
      }
    }
  }
  return rows;
}

export function filterReportRows(rows: readonly ReportRowV2[], tab: ReportTabV2, delivery: DeliveryFilterV2): ReportRowV2[] {
  return rows.filter((row) => row.tab === tab && (delivery === 'all' || row.deliveryFailed));
}

export function reportTabCounts(rows: readonly ReportRowV2[]): { review: number; approved: number; deliveryFailed: number } {
  return {
    review: rows.filter((r) => r.tab === 'review').length,
    approved: rows.filter((r) => r.tab === 'approved').length,
    deliveryFailed: rows.filter((r) => r.deliveryFailed).length,
  };
}

export function groupRowsByTitle<T extends { groupTitle: string }>(rows: readonly T[]): { title: string; rows: T[] }[] {
  const map = new Map<string, T[]>();
  for (const row of rows) map.set(row.groupTitle, [...(map.get(row.groupTitle) ?? []), row]);
  return [...map.entries()].map(([title, list]) => ({ title, rows: list }));
}

/* ───────── 클래스 목록 ───────── */
export type ClassGroupMode = 'none' | 'status';
const STATUS_LABELS: Record<string, string> = { active: '진행 중', ready: '준비', draft: '편성 중', completed: '완료', cancelled: '취소' };
export const CLASS_FILTERS: readonly [string, string][] = [['all', '전체'], ['instant', '즉석'], ['active', '진행 중'], ['draft', '편성 중'], ['completed', '완료'], ['cancelled', '취소']];

const valueOf = <T,>(field: DisplayField<T>): T | undefined => (field.kind === 'value' ? field.value : undefined);

export interface ClassRowV2 {
  id: string; title: string; instant: boolean; status: string; statusLabel: string; progress: string;
  nextAt: string | null; nextSeq: number | null; host: string; hasOpen: boolean;
  openSessionId: string | null; canEnter: boolean;
}

export function toClassRow(model: HostClassReadModel, viewerId: string | undefined, viewerRole: string | undefined): ClassRowV2 {
  const next = valueOf(model.nextSession);
  const progress = valueOf(model.progress);
  const status = valueOf(model.status) ?? '';
  return {
    id: model.id, title: valueOf(model.title) ?? '제목 없음', instant: model.is_instant === true, status, statusLabel: STATUS_LABELS[status] ?? '확인 중',
    progress: progress && progress.total > 0 ? `${progress.completed} / ${progress.total}회차` : '정기형',
    nextAt: next ? valueOf(next.scheduledAt) ?? null : null, nextSeq: next ? valueOf(next.seq) ?? null : null,
    host: (next ? valueOf(next.hostName) : undefined) ?? (model.hostName ? valueOf(model.hostName) : undefined) ?? '확인 중',
    hasOpen: valueOf(model.hasOpenSession) === true, openSessionId: model.openSessionId ?? null,
    canEnter: Boolean(model.openSessionId && viewerRole === 'counselor' && viewerId === model.openSessionHostId && model.openSessionHostState === 'assigned'),
  };
}

export function filterClassRows(rows: readonly ClassRowV2[], filter: string, query: string): ClassRowV2[] {
  const q = query.trim().toLocaleLowerCase();
  return rows.filter((row) => (filter === 'all' || (filter === 'instant' ? row.instant : row.status === filter)) && row.title.toLocaleLowerCase().includes(q));
}

export function groupClassRows(rows: readonly ClassRowV2[], mode: ClassGroupMode): { title: string; rows: ClassRowV2[] }[] {
  if (mode === 'none') return [{ title: '', rows: [...rows] }];
  const order = ['active', 'ready', 'draft', 'completed', 'cancelled'];
  return order.map((status) => ({ title: STATUS_LABELS[status], rows: rows.filter((row) => row.status === status) })).filter((g) => g.rows.length > 0)
    .concat(rows.some((row) => !order.includes(row.status)) ? [{ title: '기타', rows: rows.filter((row) => !order.includes(row.status)) }] : []);
}
