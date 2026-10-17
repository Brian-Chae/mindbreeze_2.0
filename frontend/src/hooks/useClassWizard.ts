// SDD-209 H1 — 만들기 마법사 상태 훅. useReducer 1개(zustand 불사용): 단계 이동은 라우트를 바꾸지 않아 이탈 가드에 걸리지 않는다.
import { useMemo, useReducer, type Dispatch } from 'react';
import { createInitialState, wizardReducer, isDraftDirty, type WizardAction, type WizardState } from '../lib/class/class-wizard';

export interface UseClassWizard {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  /** 일정 계산 기준일(마운트 시각 고정) */
  base: Date;
  dirty: boolean;
}

export function useClassWizard(initial?: WizardState): UseClassWizard {
  const [state, dispatch] = useReducer(wizardReducer, initial ?? createInitialState());
  const base = useMemo(() => new Date(), []);
  return { state, dispatch, base, dirty: isDraftDirty(state.draft) };
}
