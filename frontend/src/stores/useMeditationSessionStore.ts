/**
 * SDD-034 — 명상 시뮬레이터 세션 상태.
 * idle → running → stopped, 리셋으로 idle 복귀.
 */

import { create } from 'zustand';

export type MeditationSessionStatus = 'idle' | 'running' | 'stopped';

interface MeditationSessionState {
  status: MeditationSessionStatus;
  /** 세션 경과(초) — running 중 1Hz 누적 */
  elapsedSec: number;
  /** 고요(calm) 구간 누적(초) */
  calmSec: number;
  /** 버퍼/패널 초기화 신호 — start·reset 시 증가 */
  generation: number;
  start: () => void;
  stop: () => void;
  reset: () => void;
  /** 1Hz 틱 — isCalm이면 calmSec도 +1 */
  tick: (isCalm: boolean) => void;
}

export const useMeditationSessionStore = create<MeditationSessionState>((set) => ({
  status: 'idle',
  elapsedSec: 0,
  calmSec: 0,
  generation: 0,

  start: () =>
    set((s) => {
      if (s.status === 'running') return s;
      return {
        status: 'running',
        elapsedSec: 0,
        calmSec: 0,
        generation: s.generation + 1,
      };
    }),

  stop: () =>
    set((s) => {
      if (s.status !== 'running') return s;
      return { status: 'stopped' };
    }),

  reset: () =>
    set((s) => ({
      status: 'idle',
      elapsedSec: 0,
      calmSec: 0,
      generation: s.generation + 1,
    })),

  tick: (isCalm) =>
    set((s) => {
      if (s.status !== 'running') return s;
      return {
        elapsedSec: s.elapsedSec + 1,
        calmSec: isCalm ? s.calmSec + 1 : s.calmSec,
      };
    }),
}));
