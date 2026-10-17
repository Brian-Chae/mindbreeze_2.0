// SDD-209 H1 — 하니스용 마법사 래퍼: 시안 프리셋 상태에서 시작해 useReducer 로 실제처럼 조작된다.
import { useReducer } from 'react';
import { wizardReducer, type WizardMember, type WizardState } from '../../../../lib/class/class-wizard';
import { FIXTURE_BASE, FIXTURE_MEMBERS } from '../../../../lib/class/flow/host-fixture-data';
import { WizardView } from './CreateWizard';

interface WizardFixtureProps {
  initial: WizardState;
  backdropSrc: string;
  conflictTitle?: string | null;
  /** 회원 목록(기본: 시안 12명) */
  members?: readonly WizardMember[];
}

export function WizardFixture({ initial, backdropSrc, conflictTitle = null, members = FIXTURE_MEMBERS }: WizardFixtureProps) {
  const [state, dispatch] = useReducer(wizardReducer, initial);
  return (
    <WizardView
      state={state}
      dispatch={dispatch}
      backdropSrc={backdropSrc}
      base={FIXTURE_BASE}
      conflictTitle={conflictTitle}
      members={members}
      onCsvText={() => undefined}
      onExit={() => dispatch({ type: 'closeLeave' })}
    />
  );
}
