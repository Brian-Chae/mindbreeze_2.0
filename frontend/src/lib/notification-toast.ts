// SDD-250: 인앱 토스트 순수 규칙 — 유형·노출 시간·수업 중 억제·합침 키.
import type { NotificationExtra } from './api/notifications';

export type ToastKind = 'class' | 'general' | 'summary';

/** 화면에 동시에 쌓는 최대 개수. 초과분은 +N 으로 접는다. */
export const MAX_VISIBLE_TOASTS = 3;
export const GENERAL_TOAST_MS = 5000;
export const CLASS_TOAST_MS = 8000;

const CLASS_ENTER_EVENTS: ReadonlySet<string> = new Set([
  'class_invited', 'session_opened', 'session_started', 'session_waitlist_promoted',
]);

/** 클래스 초대·입장 가능형(보라 채움 + 입장하기)인지. 일반 클래스 공지(start_now 아님)는 일반형. */
export function classifyToast(extra: NotificationExtra | null | undefined): ToastKind {
  const event = typeof extra?.event_type === 'string' ? extra.event_type : '';
  if (!CLASS_ENTER_EVENTS.has(event)) return 'general';
  if (event === 'class_invited' && extra?.params?.start_now !== true) return 'general';
  return 'class';
}

export function toastDurationMs(kind: ToastKind): number {
  return kind === 'class' ? CLASS_TOAST_MS : GENERAL_TOAST_MS;
}

/** 같은 클래스·회차 클래스형 알림을 하나로 합치는 키. 합칠 수 없으면 null. */
export function mergeKeyOf(kind: ToastKind, extra: NotificationExtra | null | undefined): string | null {
  if (kind !== 'class' || !extra) return null;
  const sessionId = typeof extra.params?.session_id === 'string' ? extra.params.session_id : '';
  const targetId = typeof extra.target_id === 'string' ? extra.target_id : '';
  const key = sessionId || targetId;
  return key ? `class:${key}` : null;
}

/** 수업 진행 화면(플레이어)이면 토스트로 흐름을 끊지 않는다(D1). */
export function isPlayerPath(pathname: string): boolean {
  return /^\/sessions\/[^/]+\/(?:player|live)(?:\/|$)/.test(pathname);
}
