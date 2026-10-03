// 알림 전역 상태 — 읽지않음 카운트 + 실시간 이벤트 + 세션 초대

import { create } from 'zustand';
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

interface NotificationState {
  unread: number;
  toast: NotificationToast | null;
  wsConnected: boolean;
  /** 읽지 않은 세션 초대 목록 — 홈/세션 화면의 "초대된 클래스" 카드 표시용 */
  sessionInvites: SessionInviteRef[];
  fetch: () => Promise<void>;
  showToast: (t: NotificationToast) => void;
  dismissToast: () => void;
  increment: (n?: number) => void;
  reset: () => void;
  setWsConnected: (v: boolean) => void;
  refreshSessionInvites: () => Promise<void>;
  addSessionInvite: (invite: SessionInviteRef) => void;
  removeSessionInvite: (sessionId: string) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unread: 0,
  toast: null,
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
    set({ toast: t });
    // 4초 후 자동 dismiss
    setTimeout(() => {
      set((s) => (s.toast?.id === t.id ? { toast: null } : {}));
    }, 4000);
  },

  dismissToast: () => set({ toast: null }),

  increment: (n = 1) =>
    set((s) => ({ unread: Math.max(0, s.unread + n) })),

  reset: () => set({ unread: 0 }),

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
