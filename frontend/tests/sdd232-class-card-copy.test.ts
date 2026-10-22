import { describe, expect, it } from 'vitest';
import { classCardCopy } from '../src/lib/class-structure/class-card-copy';
import { adaptMemberClass } from '../src/lib/class-structure/adapters';
import type { ClassSummaryDto } from '../src/lib/api/class-structure';
import { pickHeroSession, pickScheduleRows, sortHomeClasses, liveTileDetailTarget } from '../src/lib/dashboard/counselor-home-model';
import type { ClassSummary } from '../src/lib/api/dashboard';

const base = { id: 'c1', title: '호흡', status: 'active', schedule_mode: 'fixed', planned_session_count: 4, area: 'meditation', progress: { completed: 1, total: 4 }, session_count: 4, next_session: null, has_open_session: false } as unknown as ClassSummaryDto;
const copy = (patch: Partial<ClassSummaryDto>) => classCardCopy(adaptMemberClass({ ...base, ...patch }), (iso) => iso);

describe('SDD-232 카드 빈 값 규칙', () => {
  it('제목 없음/공백', () => { expect(copy({ title: null }).title).toBe('이름 없는 클래스'); expect(copy({ title: '  ' }).title).toBe('이름 없는 클래스'); });
  it('다음 회차 없음: 완료/열림/미완료', () => {
    expect(copy({ status: 'completed', progress: { completed: 4, total: 4 } }).nextHeadline).toBe('모든 회차를 마쳤어요');
    expect(copy({ has_open_session: true }).nextHeadline).toBe('열린 회차가 있어요');
    expect(copy({}).nextHeadline).toBe('다음 일정이 아직 없어요');
    expect(copy({ has_open_session: true, status: 'completed' }).nextHeadline).toBe('열린 회차가 있어요');
  });
  it('next 있고 일시/순번/지도사 없음', () => {
    const c = copy({ next_session: { id: 's', seq: null, scheduled_at: null, status: 'scheduled', host: null } as never });
    expect(c.nextHeadline).toBe('다음 회차'); expect(c.nextDetail).toBe('다음 일정 확인 중'); expect(c.host).toBeNull();
  });
  it('전체 회차 없음/0이면 진행 막대 생략, 완료 수만 표시', () => {
    expect(copy({ progress: { completed: 0, total: 0 } }).progress).toBeNull();
    expect(copy({ progress: { completed: 0, total: 0 } }).completedOnly).toBeNull();
    expect(copy({ progress: { completed: 3, total: 0 } }).completedOnly).toBe(3);
    expect(copy({ progress: undefined as never }).progress).toBeNull();
  });
  it('데이터 없음 문구를 만들지 않는다', () => {
    const c = copy({ title: null, progress: undefined as never });
    expect(JSON.stringify(c)).not.toContain('데이터 없음');
  });
});

const row = (p: Partial<ClassSummary>): ClassSummary => ({ id: 'x', title: 't', type: 'meditation', custom_type_name: null, status: 'scheduled', access_code: null, participant_mode: 'open', participant_count: 0, guest_count: 0, scheduled_at: null, started_at: null, ended_at: null, created_at: null, has_record: false, record_status: null, has_summary: false, report_count: 0, pending_review_count: 0, ...p } as ClassSummary);
const now = new Date('2026-10-22T09:00:00Z');

describe('SDD-232 홈 모델', () => {
  it('히어로: 진행 중 우선, 없으면 가장 가까운 예정, 취소 제외', () => {
    const rows = [row({ id: 'a', scheduled_at: '2026-10-25T01:00:00Z' }), row({ id: 'b', scheduled_at: '2026-10-23T01:00:00Z' }), row({ id: 'c', scheduled_at: '2026-10-22T10:00:00Z', status: 'cancelled' })];
    expect(pickHeroSession(rows, now)?.session.id).toBe('b');
    expect(pickHeroSession([...rows, row({ id: 'l', status: 'in_progress' })], now)).toMatchObject({ live: true, session: { id: 'l' } });
    expect(pickHeroSession([], now)).toBeNull();
  });
  it('일정: 진행 중 먼저, 최대 5건, 완료·취소 제외', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row({ id: `s${i}`, scheduled_at: `2026-10-${23 + i}T01:00:00Z` }));
    const out = pickScheduleRows([...rows, row({ id: 'live', status: 'open' }), row({ id: 'done', status: 'completed', scheduled_at: '2026-10-23T01:00:00Z' })], now);
    expect(out).toHaveLength(5); expect(out[0].id).toBe('live'); expect(out.some((r) => r.id === 'done')).toBe(false);
  });
  it('진행 타일: 1개면 상세, 복수·0이면 목록', () => {
    const path = (r: ClassSummary) => `/d/${r.id}`;
    expect(liveTileDetailTarget([row({ id: 'a' })], path)).toBe('/d/a');
    expect(liveTileDetailTarget([row({ id: 'a' }), row({ id: 'b' })], path)).toBe('/classes');
    expect(liveTileDetailTarget([], path)).toBe('/classes');
  });
  it('클래스 정렬: 활성 → 열린 회차 → 다음 시각 → 종료 뒤, 입력 불변', () => {
    const m = (id: string, patch: Partial<ClassSummaryDto>) => adaptMemberClass({ ...base, id, ...patch });
    const input = [m('z-done', { status: 'completed' }), m('b', { next_session: { id: 's', seq: 1, scheduled_at: '2026-10-30T00:00:00Z', status: 'scheduled', host: null } as never }), m('a-open', { has_open_session: true }), m('c', { next_session: { id: 's', seq: 1, scheduled_at: '2026-10-24T00:00:00Z', status: 'scheduled', host: null } as never })];
    const ids = sortHomeClasses(input).map((x) => x.id);
    expect(ids).toEqual(['a-open', 'c', 'b', 'z-done']);
    expect(input[0].id).toBe('z-done');
  });
});
