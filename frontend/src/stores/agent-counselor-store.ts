import { create } from 'zustand';

interface CounselorAgentState {
  unread: number;
  openRisk: number;
  riskRevision: number;
  setOpenRisk: (count: number) => void;
  decrementOpenRisk: () => void;
  setUnread: (unread: number) => void;
}
export const useCounselorAgentStore = create<CounselorAgentState>((set) => ({
  unread: 0,
  openRisk: 0,
  riskRevision: 0,
  setOpenRisk: (openRisk) => set((state) => ({ openRisk, riskRevision: state.riskRevision + 1 })),
  decrementOpenRisk: () => set((state) => ({ openRisk: Math.max(0, state.openRisk - 1), riskRevision: state.riskRevision + 1 })),
  setUnread: (unread) => set({ unread }),
}));
