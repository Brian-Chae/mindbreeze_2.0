import { describe, expect, it } from 'vitest';
import { adaptMixedHome } from '../src/lib/class-structure/adapters';
import { homeRank, startedAgoLabel, withinOpenWindow } from '../src/lib/class-structure/home-next';
import type { ClassSummaryDto, NextSessionDto } from '../src/lib/api/class-structure';

const NOW = Date.parse('2030-01-01T12:00:00Z');
const iso = (offsetMin: number): string => new Date(NOW + offsetMin * 60_000).toISOString();
const sess = (id: string, offsetMin: number, status: string): NextSessionDto => ({ id, seq: 1, scheduled_at: iso(offsetMin), status, host: { id: 'h', name: '이서연' } });
const cls = (id: string, over: Partial<ClassSummaryDto>): ClassSummaryDto => ({
  id, title: id, status: 'active', schedule_mode: 'fixed', planned_session_count: 1, area: 'meditation',
  progress: { completed: 0, total: 1 }, session_count: 1, next_session: null, has_open_session: false, ...over,
});
const home = (classes: ClassSummaryDto[]) => adaptMixedHome(
  { status: 'success', data: { classes, total: classes.length } },
  { status: 'success', data: { relationships: [], total: 0 } }, NOW,
);
const nextId = (m: ReturnType<typeof home>): string | undefined => (m.next.kind === 'value' ? m.next.value.sessionId : undefined);

describe('SDD-250 홈 다음 일정 후보', () => {
  it('TS6 우선순위: 열린 즉석 > 열린 일반 > 예정', () => {
    const m = home([
      cls('예정', { next_session: sess('s-plan', 60, 'scheduled') }),
      cls('일반', { open_session: sess('s-open', -30, 'in_progress'), has_open_session: true }),
      cls('즉석', { open_session: sess('s-instant', -3, 'in_progress'), has_open_session: true, is_instant: true }),
    ]);
    expect(nextId(m)).toBe('s-instant');
    expect(m.upcoming.map((c) => c.sessionId)).toEqual(['s-open', 's-plan']);
  });
  it('TS7 열려 있지 않은 과거 회차는 후보가 아니다', () => {
    expect(nextId(home([cls('과거', { next_session: sess('s-past', -10, 'scheduled') })]))).toBeUndefined();
  });
  it('TS8 열린 회차도 6시간을 넘으면 제외한다', () => {
    expect(nextId(home([cls('오래', { open_session: sess('s-old', -361, 'open'), is_instant: true })]))).toBeUndefined();
    expect(nextId(home([cls('경계', { open_session: sess('s-edge', -360, 'open'), is_instant: true })]))).toBe('s-edge');
  });
  it('같은 회차는 한 번만, 종료 회차는 제외', () => {
    const same = sess('s-1', -1, 'open');
    const m = home([cls('a', { open_session: same, next_session: same }), cls('b', { open_session: sess('s-2', -1, 'completed') })]);
    expect(m.upcoming).toHaveLength(0);
    expect(nextId(m)).toBe('s-1');
  });
  it('구 서버(open_session 없음)는 기존 동작', () => {
    expect(nextId(home([cls('a', { next_session: sess('s-f', 30, 'scheduled') })]))).toBe('s-f');
  });
  it('같은 순위 열린 회차는 최근 시작이 앞', () => {
    const m = home([
      cls('a', { open_session: sess('s-a', -50, 'in_progress') }), cls('b', { open_session: sess('s-b', -5, 'in_progress') }),
    ]);
    expect(nextId(m)).toBe('s-b');
  });
});

describe('home-next 순수 함수', () => {
  it('rank', () => {
    expect([homeRank(true, true, 'in_progress'), homeRank(true, true, 'open'), homeRank(true, false, 'in_progress'), homeRank(true, false, 'open'), homeRank(false, true, 'scheduled')])
      .toEqual([0, 1, 2, 3, 4]);
  });
  it('window', () => {
    expect(withinOpenWindow(null, NOW)).toBe(false);
    expect(withinOpenWindow('x', NOW)).toBe(false);
  });
  it('경과 문구', () => {
    expect(startedAgoLabel(iso(0), NOW)).toBe('방금 시작했어요');
    expect(startedAgoLabel(iso(-3), NOW)).toBe('3분 전에 시작했어요');
    expect(startedAgoLabel(iso(-125), NOW)).toBe('2시간 전에 시작했어요');
    expect(startedAgoLabel(iso(30), NOW)).toBeNull();
  });
});
