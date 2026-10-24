import { EVENT_LABELS } from './notification-format';
import type { NotificationPreferencesResponse } from './api/notifications';

export const NOTIFICATION_GROUPS = [
  { id: 'schedule', label: '일정·참여', description: '클래스와 상담 일정, 참여 안내를 받아요.' },
  { id: 'conversation', label: '대화', description: '새 메시지와 대화방 소식을 받아요.' },
  { id: 'operations', label: '리포트·운영', description: '리포트 발행과 계정·기관 소식을 받아요.' },
] as const;
export type NotificationGroup = typeof NOTIFICATION_GROUPS[number]['id'];
export type NotificationChannel = 'email' | 'in_app';
export type GroupState = boolean | 'mixed';
// 기본 47종만 묶음으로 제어한다. 추가 키는 기존 선택을 보존한다.
const supportedEvents = new Set(Object.keys(EVENT_LABELS));
export const COMPATIBILITY_EVENTS = { schedule_change_request: '일정 변경 문의', agent_message: 'AI 대화 안내', risk_signal: '대화 확인 안내' } as const;
export function notificationGroupFor(event: string): NotificationGroup | null {
  if (!supportedEvents.has(event)) return null;
  if (event.startsWith('session_') || event.startsWith('class_')) return 'schedule';
  if (event.startsWith('chat_')) return 'conversation';
  return 'operations';
}
export function groupKeys(values: Record<string, boolean>, group: NotificationGroup): string[] {
  return Object.keys(values).filter((event) => notificationGroupFor(event) === group);
}
export function aggregateNotificationGroup(values: Record<string, boolean>, group: NotificationGroup): GroupState {
  const keys = groupKeys(values, group);
  if (keys.length === 0 || keys.every((key) => !values[key])) return false;
  if (keys.every((key) => values[key])) return true;
  return 'mixed';
}
/** 변경한 묶음만 전송한다. 미제출 채널/레거시/push는 서버 병합 계약으로 보존된다. */
export function notificationGroupPatch(prefs: NotificationPreferencesResponse, channel: NotificationChannel, group: NotificationGroup, enabled: boolean): NotificationPreferencesResponse {
  return { email: {}, in_app: {}, [channel]: Object.fromEntries(groupKeys(prefs[channel], group).map((key) => [key, enabled])) };
}
export function applyNotificationGroup(prefs: NotificationPreferencesResponse, channel: NotificationChannel, group: NotificationGroup, enabled: boolean): NotificationPreferencesResponse {
  const patch = notificationGroupPatch(prefs, channel, group, enabled);
  return { ...prefs, [channel]: { ...prefs[channel], ...patch[channel] } };
}
