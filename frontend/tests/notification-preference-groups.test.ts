import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { aggregateNotificationGroup, applyNotificationGroup, notificationGroupFor, notificationGroupPatch, NOTIFICATION_GROUPS } from '../src/lib/notification-preference-groups';

const events: { key: string; group: string; email: boolean }[] = JSON.parse(readFileSync(new URL('../../designs/settings-tab-playground/audit-data.json', import.meta.url), 'utf8'));
const prefs = {
  email: Object.fromEntries(events.map((event) => [event.key, event.email])),
  in_app: Object.fromEntries(events.map((event) => [event.key, true])),
  push: { chat_message: false },
};
describe('알림 목적별 집계와 부분 적용', () => {
  it('47키를 승인된 23/4/20 매핑에 중복 없이 배치한다', () => {
    expect(events).toHaveLength(47);
    expect(new Set(events.map((event) => event.key)).size).toBe(47);
    for (const event of events) expect(NOTIFICATION_GROUPS.find((group) => group.id === notificationGroupFor(event.key))?.label).toBe(event.group);
    expect(NOTIFICATION_GROUPS.map((group) => events.filter((event) => notificationGroupFor(event.key) === group.id).length)).toEqual([23, 4, 20]);
  });
  it('전부 켜짐·꺼짐·일부와 빈 그룹을 집계하고 원본을 바꾸지 않는다', () => {
    const before = structuredClone(prefs);
    expect(aggregateNotificationGroup(prefs.email, 'schedule')).toBe('mixed');
    expect(aggregateNotificationGroup(prefs.email, 'conversation')).toBe(false);
    for (const group of NOTIFICATION_GROUPS) expect(aggregateNotificationGroup(prefs.in_app, group.id)).toBe(true);
    expect(aggregateNotificationGroup({}, 'operations')).toBe(false);
    expect(prefs).toEqual(before);
  });
  it.each([true, false])('명시 변경(%s)만 해당 그룹에 적용하며 다른 채널·legacy·push는 보존한다', (next) => {
    const original = { ...prefs, email: { ...prefs.email, retired_event: false } };
    const before = structuredClone(original);
    const result = applyNotificationGroup(original, 'email', 'schedule', next);
    for (const event of events) expect(result.email[event.key]).toBe(event.group === '일정·참여' ? next : original.email[event.key]);
    expect(result.email.retired_event).toBe(false);
    expect(result.in_app).toEqual(original.in_app);
    expect(result.push).toEqual(original.push);
    expect(original).toEqual(before);
    const patch = notificationGroupPatch(original, 'email', 'schedule', next);
    expect(Object.keys(patch.email)).toHaveLength(23);
    expect(patch.in_app).toEqual({});
    expect(patch.email).not.toHaveProperty('retired_event');
    expect(patch).not.toHaveProperty('push');
  });
  it('표 외 추가 이벤트와 미지원 키는 묶음 변경에서 제외한다', () => {
    expect(notificationGroupFor('schedule_change_request')).toBeNull();
    expect(notificationGroupFor('agent_message')).toBeNull();
    expect(notificationGroupFor('risk_signal')).toBeNull();
    expect(notificationGroupFor('retired_event')).toBeNull();
  });
});
