// 알림 전역 상태 — 읽지않음 카운트 + 실시간 이벤트

import { create } from 'zustand';
import { getUnreadCount } from '../lib/api/notifications';

export interface NotificationToast {
  id: string;
  type: string;
  title: string;
  body: string;
  roomId?: string;
}

interface NotificationState {
  unread: number;
  toast: NotificationToast | null;
  fetch: () => Promise<void>;
  showToast: (t: NotificationToast) => void;
  dismissToast: () => void;
  increment: (n?: number) => void;
  reset: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unread: 0,
  toast: null,

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
}));
