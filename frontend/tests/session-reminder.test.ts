// SDD-097: 예약 사전 안내(리마인더) — 시점 유틸·회원 홈 카드 선정·API 계약 테스트

import { beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '../src/lib/api/client';
import { createSession, updateSession } from '../src/lib/api/session';
import {
  describeReminderOffsets,
  formatCountdown,
  formatReminderOffset,
  nextReminderAt,
  pickUpcomingClass,
  REMINDER_ON_OPTIONS,
} from '../src/lib/class/reminder';

vi.mock('../src/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  refreshAccessToken: vi.fn(),
  tokenStorage: { getAccess: vi.fn(() => null) },
}));

beforeEach(() => vi.clearAllMocks());

it('시점 옵션은 끄기/하루 전/1시간 전을 제공한다', () => {
  expect(REMINDER_ON_OPTIONS.map((o) => o.value)).toEqual([1440, 60]);
});

it('formatReminderOffset 은 사람이 읽는 라벨로 변환한다', () => {
  expect(formatReminderOffset(1440)).toBe('하루 전');
  expect(formatReminderOffset(2880)).toBe('2일 전');
  expect(formatReminderOffset(60)).toBe('1시간 전');
  expect(formatReminderOffset(30)).toBe('30분 전');
});

it('describeReminderOffsets 는 큰 간격 우선으로 요약하고 빈 값은 끔', () => {
  expect(describeReminderOffsets([60, 1440])).toBe('하루 전 · 1시간 전');
  expect(describeReminderOffsets([])).toBe('끔');
  expect(describeReminderOffsets(null)).toBe('끔');
  expect(describeReminderOffsets(undefined)).toBe('끔');
});

it('nextReminderAt 은 아직 지나지 않은 가장 빠른 시점을 반환한다', () => {
  const now = new Date('2026-10-01T09:00:00.000Z');
  // 시작 200분 뒤 → 하루 전(1440)은 지났고 1시간 전(60)은 now+140분.
  const start = new Date(now.getTime() + 200 * 60_000).toISOString();
  const next = nextReminderAt(start, [1440, 60], now);
  expect(next?.toISOString()).toBe(new Date(now.getTime() + 140 * 60_000).toISOString());

  // 모든 시점이 지났으면 null
  expect(nextReminderAt(new Date(now.getTime() + 10 * 60_000).toISOString(), [1440, 60], now)).toBeNull();
});

it('formatCountdown 은 남은 시간을 문구로 만든다', () => {
  const now = new Date('2026-10-01T09:00:00.000Z');
  expect(formatCountdown(new Date(now.getTime() + 125 * 60_000).toISOString(), now)).toBe('2시간 5분 후');
  expect(formatCountdown(new Date(now.getTime() + 30 * 60_000).toISOString(), now)).toBe('30분 후');
  expect(formatCountdown(new Date(now.getTime() - 5 * 60_000).toISOString(), now)).toBe('곧 시작');
});

it('pickUpcomingClass 는 예정 클래스 중 가장 임박한 1건을 고른다', () => {
  const now = new Date('2026-10-01T09:00:00.000Z');
  const sessions = [
    { id: 'done', status: 'completed', scheduled_at: '2026-10-02T10:00:00.000Z' },
    { id: 'late', status: 'scheduled', scheduled_at: '2026-10-03T10:00:00.000Z' },
    { id: 'soon', status: 'scheduled', scheduled_at: '2026-10-01T12:00:00.000Z' },
    { id: 'past', status: 'scheduled', scheduled_at: '2026-10-01T08:00:00.000Z' },
    { id: 'instant', status: 'ready', scheduled_at: null },
  ];
  expect(pickUpcomingClass(sessions, now)?.id).toBe('soon');
  expect(pickUpcomingClass([{ id: 'x', status: 'ready', scheduled_at: null }], now)).toBeNull();
});

it('createSession 은 reminder_offsets 를 그대로 전송한다', async () => {
  await createSession({
    type: 'meditation',
    duration_min: 30,
    scheduled_at: '2026-10-02T10:00:00.000Z',
    reminder_offsets: [1440, 60],
  });
  expect(apiClient.post).toHaveBeenCalledWith('/sessions', expect.objectContaining({
    reminder_offsets: [1440, 60],
  }));
});

it('updateSession 은 리마인더 시점 재설정을 PUT 으로 보낸다', async () => {
  await updateSession('session-1', { reminder_offsets: [60] });
  expect(apiClient.put).toHaveBeenCalledWith('/sessions/session-1', { reminder_offsets: [60] });
});
