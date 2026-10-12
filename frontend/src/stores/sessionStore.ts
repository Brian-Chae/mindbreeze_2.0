// 세션 관리 전역 상태 (Zustand)

import { create } from 'zustand';
import type { SessionDto } from '../lib/api/session';

export type CalendarViewMode = 'daily' | 'weekly' | 'monthly' | 'list';

interface SessionState {
  selectedSession: SessionDto | null;
  viewMode: CalendarViewMode;
  currentDate: Date;

  setSelectedSession: (session: SessionDto | null) => void;
  setViewMode: (mode: CalendarViewMode) => void;
  setCurrentDate: (date: Date) => void;
  /** API7-11: 로그아웃 시 민감한 세션 데이터를 초기 상태로 되돌린다. */
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  selectedSession: null,
  viewMode: 'weekly',
  currentDate: new Date(),

  setSelectedSession: (session) => set({ selectedSession: session }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setCurrentDate: (date) => set({ currentDate: date }),
  reset: () => set({ selectedSession: null, viewMode: 'weekly', currentDate: new Date() }),
}));
