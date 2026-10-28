// 알림 전역 상태 — 읽지않음 카운트 + 실시간 이벤트 + 세션 초대

import { create } from 'zustand';
import {
  classifyToast, mergeKeyOf, toastDurationMs, isPlayerPath, type ToastKind,
} from '../lib/notification-toast';
import {
  getUnreadCount,
  listUnreadSessionInvites,
  type NotificationExtra,
  type SessionInviteRef,
} from '../lib/api/notifications';

export interface NotificationToast {
  id: string;
  type: string;
  title: string;
  body: string;
  roomId?: string;
  extra?: NotificationExtra | null;
}

/** 큐에 쌓인 토스트(SDD-250). kind=summary 는 '놓친 알림 N건' 요약. */
export interface QueuedToast extends NotificationToast {
  kind: ToastKind;
  /** 같은 클래스·회차 알림이 합쳐진 건수 */
  count: number;
}

interface NotificationState {
  unread: number;
  /** 가장 최근 토스트(기존 호출부·테스트 호환). */
  toast: NotificationToast | null;
  /** SDD-250: 최신이 앞. 화면에는 앞 3개만 보이고 나머지는 +N. */
  toasts: QueuedToast[];
  wsConnected: boolean;
  /** 읽지 않은 세션 초대 목록 — 홈/세션 화면의 "초대된 클래스" 카드 표시용 */
  sessionInvites: SessionInviteRef[];
  fetch: () => Promise<void>;
  showToast: (t: NotificationToast) => void;
  /** id 를 주면 그 토스트만, 생략하면 가장 최근 토스트를 닫는다. */
  dismissToast: (id?: string) => void;
  /** 노출 시간 타이머 일시정지/재개(누르고 있는 동안 유지). */
  pauseToast: (id: string) => void;
  resumeToast: (id: string) => void;
  showMissedSummary: (count: number) => void;
  increment: (n?: number) => void;
  reset: () => void;
  setWsConnected: (v: boolean) => void;
  refreshSessionInvites: () => Promise<void>;
  addSessionInvite: (invite: SessionInviteRef) => void;
  removeSessionInvite: (sessionId: string) => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const clearTimer = (id: string): void => {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
};
// D1: 플레이어는 셸·소켓 훅 밖이라 알림이 와도 못 받는다 → 진입 시 읽지 않은 수를 기억했다가 복귀 시 증가분을 요약한다.
let playerEntryUnread: number | null = null;
export const notePlayerEntry = (unread: number): void => { playerEntryUnread = unread; };
export const takePlayerEntry = (): number | null => { const v = playerEntryUnread; playerEntryUnread = null; return v; };
const latest = (toasts: QueuedToast[]): NotificationToast | null => (toasts[0] ?? null);

export const useNotificationStore = create<NotificationState>((set, get) => ({
  unread: 0,
  toast: null,
  toasts: [],
  wsConnected: false,
  sessionInvites: [],

  fetch: async () => {
    try {
      const r = await getUnreadCount();
      set({ unread: r.unread });
    } catch {
      // 조용히 실패
    }
  },

  showToast: (t) => {
    // D1: 수업 진행 화면에서는 토스트를 띄우지 않는다(종 배지는 호출부가 갱신, 요약은 종료 후 별도 표시).
    if (typeof window !== 'undefined' && isPlayerPath(window.location.pathname)) return;
    const kind = classifyToast(t.extra);
    const key = mergeKeyOf(kind, t.extra);
    const current = get().toasts;
    // 같은 알림 id 는 1회만(소켓·푸시 이중 수신).
    if (current.some((item) => item.id === t.id)) return;
    const merged = key ? current.find((item) => mergeKeyOf(item.kind, item.extra) === key) : undefined;
    const queued: QueuedToast = { ...t, kind, count: merged ? merged.count + 1 : 1 };
    if (merged) clearTimer(merged.id);
    const next = [queued, ...current.filter((item) => item !== merged)];
    set({ toasts: next, toast: latest(next) });
    timers.set(t.id, setTimeout(() => get().dismissToast(t.id), toastDurationMs(kind)));
  },

  showMissedSummary: (count) => {
    if (count <= 0) return;
    const id = `missed-${Date.now()}`;
    get().showToast({ id, type: 'summary', title: `놓친 알림 ${count}건`, body: '수업 중에 도착한 알림이에요. 눌러서 확인하세요.', extra: { target_type: 'notifications' } });
    set((s) => ({ toasts: s.toasts.map((item) => (item.id === id ? { ...item, kind: 'summary' as const } : item)) }));
  },

  dismissToast: (id) => {
    const target = id ?? get().toasts[0]?.id;
    if (!target) return;
    clearTimer(target);
    const next = get().toasts.filter((item) => item.id !== target);
    set({ toasts: next, toast: latest(next) });
  },

  pauseToast: (id) => clearTimer(id),

  resumeToast: (id) => {
    const item = get().toasts.find((entry) => entry.id === id);
    if (!item) return;
    clearTimer(id);
    timers.set(id, setTimeout(() => get().dismissToast(id), toastDurationMs(item.kind)));
  },

  increment: (n = 1) =>
    set((s) => ({ unread: Math.max(0, s.unread + n) })),

  reset: () => {
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    set({ unread: 0, toast: null, toasts: [], wsConnected: false, sessionInvites: [] });
  },

  setWsConnected: (v) => set({ wsConnected: v }),

  refreshSessionInvites: async () => {
    try {
      const invites = await listUnreadSessionInvites();
      set({ sessionInvites: invites });
    } catch {
      // 조용히 실패
    }
  },

  addSessionInvite: (invite) =>
    set((s) => {
      if (s.sessionInvites.some((i) => i.sessionId === invite.sessionId)) return {};
      return { sessionInvites: [...s.sessionInvites, invite] };
    }),

  removeSessionInvite: (sessionId) =>
    set((s) => ({
      sessionInvites: s.sessionInvites.filter((i) => i.sessionId !== sessionId),
    })),
}));
