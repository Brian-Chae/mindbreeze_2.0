// SDD-209 H1 — 하니스용 마법사 래퍼: 시안 프리셋 상태에서 시작해 useReducer 로 실제처럼 조작된다.
import { useReducer } from 'react';
import { wizardReducer, type WizardState } from '../../../../lib/class/class-wizard';
import { WizardView } from './CreateWizard';

export function WizardFixture({ initial, backdropSrc }: { initial: WizardState; backdropSrc: string }) {
  const [state, dispatch] = useReducer(wizardReducer, initial);
  return <WizardView state={state} dispatch={dispatch} backdropSrc={backdropSrc} onExit={() => dispatch({ type: 'closeLeave' })} />;
}
