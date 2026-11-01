// SDD-263: 목록 순수 로직 — 정렬·필터·그룹·상태·폴링·금지 문구
import { describe, expect, it } from 'vitest';
import type { UploadOverviewItem } from '../../src/lib/api/upload-overview';
import { normalizeOverview, uploadOverviewPath } from '../../src/lib/api/upload-overview';
import { detailPathFor, filterOverview, groupOverview, overviewPollMs, overviewStatus, overviewTotals, sortOverview, DEFAULT_OVERVIEW_FILTERS } from '../../src/lib/upload-status/overview-view';
import { STATUS_LABEL } from '../../src/lib/upload-status/view';

const sum = (o: Partial<UploadOverviewItem['summary']> = {}) => ({ participants: 10, needs_attention: 0, uploading: 0, received_unreconciled: 10, no_data: 0, excluded: 0, ...o });
const item = (o: Partial<UploadOverviewItem>): UploadOverviewItem => ({
  class_id: 'c1', class_title: 'A반', session_id: 's1', seq: 1, session_status: 'completed', band_not_connected: 0, org_id: null, org_name: null, host_name: '김코치',
  session_at: '2026-10-30T01:00:00Z', last_received_at: null, summary: sum(), status: null, ...o,
});
const NOW = new Date('2026-11-01T00:00:00Z');

describe('SDD-263 overview-view', () => {
  it('V-O 대표 상태: 서버 값 우선, 없으면 확인 필요 > 업로드 중 > 수신 확인 > 미수신', () => {
    expect(overviewStatus(item({ summary: sum({ needs_attention: 1, uploading: 2 }) }))).toBe('needs_attention');
    expect(overviewStatus(item({ summary: sum({ uploading: 2 }) }))).toBe('uploading');
    expect(overviewStatus(item({ summary: sum({ received_unreconciled: 0, no_data: 3 }) }))).toBe('no_data');
    expect(overviewStatus(item({ status: 'excluded' }))).toBe('excluded');
  });
  it('V-O 정렬: 진행 중 우선 → 최근순', () => {
    const rows = [item({ session_id: 'old', session_at: '2026-10-01T00:00:00Z' }), item({ session_id: 'new', session_at: '2026-10-31T00:00:00Z' }), item({ session_id: 'live', session_status: 'in_progress', session_at: '2026-10-15T00:00:00Z' })];
    expect(sortOverview(rows).map((r) => r.session_id)).toEqual(['live', 'new', 'old']);
    expect(rows[0].session_id).toBe('old'); // 원본 불변
  });
  it('V-O 필터: 클래스·상태·기간·검색', () => {
    const rows = [item({ session_id: 'a' }), item({ session_id: 'b', class_id: 'c2', class_title: 'B반', summary: sum({ needs_attention: 1 }) }), item({ session_id: 'c', session_at: '2026-09-15T00:00:00Z' })];
    const f = DEFAULT_OVERVIEW_FILTERS;
    expect(filterOverview(rows, f, NOW).map((r) => r.session_id)).toEqual(['a', 'b']); // 30일 밖 제외
    expect(filterOverview(rows, { ...f, period: '90d' }, NOW)).toHaveLength(3);
    expect(filterOverview(rows, { ...f, classId: 'c2' }, NOW).map((r) => r.session_id)).toEqual(['b']);
    expect(filterOverview(rows, { ...f, status: 'needs_attention' }, NOW).map((r) => r.session_id)).toEqual(['b']);
    expect(filterOverview(rows, { ...f, query: 'b반' }, NOW).map((r) => r.session_id)).toEqual(['b']);
  });
  it('V-O 그룹핑: 클래스·상태(확인 필요 먼저)·날짜', () => {
    const rows = [item({ session_id: 'a' }), item({ session_id: 'b', class_id: 'c2', class_title: 'B반', summary: sum({ needs_attention: 1 }) })];
    expect(groupOverview(rows, 'class').map((g) => g.key).sort()).toEqual(['c1', 'c2']);
    expect(groupOverview(rows, 'status').map((g) => g.key)).toEqual(['needs_attention', 'received_unreconciled']);
    expect(groupOverview(rows, 'date')[0].key).toBe('2026-10-30');
    expect(groupOverview([], 'none')).toEqual([]);
  });
  it('V-O 합계·폴링 주기·상세 경로', () => {
    expect(overviewTotals([item({}), item({ summary: sum({ needs_attention: 2, uploading: 1 }) })]).attentionSessions).toBe(1);
    expect(overviewPollMs(3, [])).toBe(3000);
    expect(overviewPollMs(null, [item({ session_status: 'in_progress' })])).toBe(4000);
    expect(overviewPollMs(null, [item({})])).toBe(15000);
    expect(detailPathFor('counselor', 'c', 's')).toBe('/classes/c/sessions/s/upload-status');
    expect(detailPathFor('platform_admin', 'c', 's')).toBe('/admin/upload-status/c/s');
  });
  it('V-O 정규화·요청 경로: 누락 필드 안전, 잘못된 항목 제외', () => {
    const r = normalizeOverview({ truncated: true, total_candidates: 62, items: [{ class_id: 'c', session_id: 's', organization_name: '기관', started_at: '2026-10-30T00:00:00Z', participants: 3, band_not_connected: 1 }, { session_id: 'x' }] });
    expect(r.truncated).toBe(true); expect(r.total_candidates).toBe(62);
    expect(r.items[0].org_name).toBe('기관'); expect(r.items[0].session_at).toBe('2026-10-30T00:00:00Z'); expect(r.items[0].band_not_connected).toBe(1);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].summary).toEqual({ participants: 3, needs_attention: 0, uploading: 0, received_unreconciled: 0, no_data: 0, excluded: 0 });
    expect(uploadOverviewPath({ limit: 50, since: '2026-10-01T00:00:00.000Z', orgId: 'o', classId: 'k', status: 'uploading' })).toBe('/upload-status/overview?limit=50&since=2026-10-01T00%3A00%3A00.000Z&org_id=o&class_id=k&status=uploading');
    expect(uploadOverviewPath()).toBe('/upload-status/overview');
  });
  it('V-O 금지 문구: 상태 라벨에 완료·점수·100%·좋음 없음', () => {
    expect(Object.values(STATUS_LABEL).join(' ')).not.toMatch(/완료|점수|100%|좋음|나쁨|보증/);
  });
});
