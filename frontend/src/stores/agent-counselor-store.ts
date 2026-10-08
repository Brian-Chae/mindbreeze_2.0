import { create } from 'zustand';

interface CounselorAgentState {
  unread: number;
  setUnread: (unread: number) => void;
}
export const useCounselorAgentStore = create<CounselorAgentState>((set) => ({
  unread: 0,
  setUnread: (unread) => set({ unread }),
}));
