import { create } from 'zustand';

interface AgentBadgeState {
  unread: number;
  setUnread: (unread: number) => void;
}
export const useAgentStore = create<AgentBadgeState>((set) => ({
  unread: 0,
  setUnread: (unread) => set({ unread }),
}));
