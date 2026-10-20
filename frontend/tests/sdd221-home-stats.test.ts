import { describe, expect, it } from 'vitest';
import type { ClassSummary } from '../src/lib/api/dashboard';
import { liveClasses, pendingReviewTotal, todayRemaining, visibleDashboardRows } from '../src/lib/dashboard/home-stats';
import { liveTileHint, liveTileTarget } from '../src/lib/dashboard/home-links';

function row(o: Partial<ClassSummary>): ClassSummary {
  return {
    id: 'x', title: 't', type: 'meditation', custom_type_name: null, status: 'scheduled', access_code: null,
    participant_mode: 'registered', participant_count: 0, guest_count: 0, scheduled_at: null, started_at: null,
    ended_at: null, created_at: null, has_record: false, record_status: null, has_summary: false,
    report_count: 0, pending_review_count: 0, ...o,
  } as ClassSummary;
}

describe('SDD-221 홈 수치', () => {
  it('A1 진행 중 = in_progress + open', () => {
    const rows = [row({ id: 'a', status: 'in_progress' }), row({ id: 'b', status: 'open' }), row({ id: 'c' })];
    expect(liveClasses(rows)).toHaveLength(2);
  });
  it('A2 검토 대기 합', () => {
    expect(pendingReviewTotal([row({ pending_review_count: 2 }), row({ pending_review_count: 1 }), row({ pending_review_count: 4 })])).toBe(7);
  });
  it('A3 오늘 예정은 완료·취소 제외', () => {
    const now = new Date(2026, 9, 20, 12, 0);
    const at = new Date(2026, 9, 20, 15, 0).toISOString();
    const rows = [
      row({ scheduled_at: at }), row({ scheduled_at: at, status: 'ready' }), row({ scheduled_at: at, status: 'in_progress' }),
      row({ scheduled_at: at, status: 'completed' }), row({ scheduled_at: at, status: 'cancelled' }),
    ];
    expect(todayRemaining(rows, now)).toHaveLength(3);
  });
  it('A4 자정 경계', () => {
    const now = new Date(2026, 9, 20, 12, 0);
    const rows = [
      row({ scheduled_at: new Date(2026, 9, 20, 0, 0).toISOString() }),
      row({ scheduled_at: new Date(2026, 9, 20, 23, 59).toISOString() }),
      row({ scheduled_at: new Date(2026, 9, 21, 0, 0).toISOString() }),
    ];
    expect(todayRemaining(rows, now)).toHaveLength(2);
  });
  it('A5 상담 행 제외(플래그 off)', () => {
    const rows = [
      row({ id: 'm', area: 'meditation', class_id: 'c1' }),
      row({ id: 'k', area: 'counseling', counseling_relationship_id: 'r1', pending_review_count: 5 }),
    ];
    const v = visibleDashboardRows(rows);
    expect(v.map((r) => r.id)).toEqual(['m']);
    expect(pendingReviewTotal(v)).toBe(0);
  });
  it('A6 0건', () => {
    expect(liveClasses([])).toEqual([]);
    expect(pendingReviewTotal([])).toBe(0);
    expect(todayRemaining([], new Date())).toEqual([]);
  });
  it('B1~B3 이동·문구', () => {
    expect(liveTileTarget([row({ id: 'a b' })])).toBe('/sessions/a%20b/player');
    expect(liveTileTarget([row({}), row({})])).toBe('/classes');
    expect(liveTileTarget([])).toBe('/classes');
    expect(liveTileHint(0)).toBe('클래스 목록 →');
    expect(liveTileHint(1)).toBe('입장하기 →');
  });
});
