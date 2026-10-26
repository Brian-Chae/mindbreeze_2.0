import { expect, it, vi } from 'vitest';
// SDD-219: 상담 공개(플래그 on) 기준의 기존 동작을 검증한다.
vi.stubEnv('VITE_COUNSELING_ENABLED', 'true');
import { dashboardSessionArea, dashboardSessionPath } from '../src/lib/class-structure/dashboard-navigation';
it('실제 명상 부모를 가진 일정은 명상 칩과 부모 회차 경로를 사용한다', () => {
  const row = { id: 's1', class_id: 'c1', counseling_relationship_id: null, area: 'meditation' };
  expect(dashboardSessionArea(row)).toBe('명상'); expect(dashboardSessionPath(row)).toBe('/classes/c1/sessions/s1');
});
it('실제 상담 부모를 가진 일정은 상담 칩과 상담 회차 경로를 사용한다', () => {
  const row = { id: 's1', class_id: null, counseling_relationship_id: 'r1', area: 'counseling' };
  expect(dashboardSessionArea(row)).toBe('상담'); expect(dashboardSessionPath(row)).toBe('/counseling/r1/sessions/s1');
});
it('부모가 없거나 서로 모순이면 영역을 추정하지 않고 기존 회차 경로를 유지한다', () => {
  for (const row of [{ id: 's1', area: 'meditation' }, { id: 's1', class_id: 'c1', counseling_relationship_id: 'r1', area: 'meditation' }]) {
    expect(dashboardSessionArea(row)).toBeNull(); expect(dashboardSessionPath(row)).toBe('/sessions/s1');
  }
});
