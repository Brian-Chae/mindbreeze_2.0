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
}

export const useSessionStore = create<SessionState>((set) => ({
  selectedSession: null,
  viewMode: 'weekly',
  currentDate: new Date(),

  setSelectedSession: (session) => set({ selectedSession: session }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setCurrentDate: (date) => set({ currentDate: date }),
}));
