// SDD-209 M1 — 참가자 입장 흐름 상태 머신(순수). EntryPage 가 서버 상태(entry-state)를 sync 로 흘려 넣고 화면은 phase 만 본다.
// 어떤 선택·동의의 성공 여부도 입장·녹음·업로드를 막지 않는다 — 머신에는 그런 분기가 없다.
import { ApiError } from '../../api/client';
import type { SessionStatus } from '../../api/session';
import type { FlowBandMode, FlowPlace } from './types';

/** 준비 마법사 단계: a 고지·선택 · b 오늘의 상태 · c LINK BAND · d 기기(온라인만) · e 요약 */
export type WizardKey = 'a' | 'b' | 'c' | 'd' | 'e';

/** 온라인 5 · 오프라인 4(기기 점검 없음) · 밴드 사용 안 함이면 −1 */
export function buildSteps(place: FlowPlace, bandMode: FlowBandMode): WizardKey[] {
  const steps: WizardKey[] = ['a', 'b'];
  if (bandMode !== 'none') steps.push('c');
  if (place === 'online') steps.push('d');
  steps.push('e');
  return steps;
}

/** 시작 후 시트(상담사가 클래스를 시작했어요)는 건너뛸 수 있는 단계에서만 뜬다 */
export function startedSheetApplies(step: WizardKey): boolean {
  return step === 'b' || step === 'c' || step === 'd';
}

export type EnterStage = 'unopened' | 'open' | 'started' | 'waitlisted' | 'completed' | 'cancelled';

export function deriveEnterStage(input: { status: SessionStatus; isWaitlisted: boolean }): EnterStage {
  if (input.status === 'cancelled') return 'cancelled';
  if (input.status === 'completed') return 'completed';
  if (input.isWaitlisted) return 'waitlisted';
  if (input.status === 'ready' || input.status === 'scheduled') return 'unopened';
  if (input.status === 'open') return 'open';
  return 'started';
}

export type FlowStateKind = 'cancelled' | 'closed' | 'notyet' | 'error' | 'offline' | 'entry-expired';

const NETWORK_STATUS: ReadonlySet<number> = new Set([408, 502, 503, 504]);

/** FM10 종류. 서버 문구는 쓰지 않고 상태 코드·클래스 상태·연결 여부로만 정한다 */
export function deriveFlowStateKind(input: { error?: unknown; status?: SessionStatus | null; online?: boolean }): FlowStateKind {
  if (input.online === false) return 'offline';
  const { error } = input;
  if (error !== undefined && error !== null) {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) return 'entry-expired';
      if (error.status === 404 || error.status === 410) return 'closed';
      if (NETWORK_STATUS.has(error.status)) return 'offline';
      return 'error';
    }
    if (error instanceof TypeError) return 'offline';
    return 'error';
  }
  if (input.status === 'cancelled') return 'cancelled';
  if (input.status === 'completed') return 'closed';
  if (input.status === 'ready' || input.status === 'scheduled') return 'notyet';
  return 'error';
}

export type EntryPhase = 'confirm' | 'wizard' | 'wait' | 'waitlist' | 'live' | 'end' | 'state';

export interface EntryMachineState {
  phase: EntryPhase;
  step: WizardKey;
  stage: EnterStage | null;
  /** 준비를 다 마치지 않고 진행 화면으로 들어왔다 — 진행 화면이 건너뛴 준비를 안내한다 */
  prepSkipped: boolean;
  stateKind: FlowStateKind | null;
}

export function initialEntryState(): EntryMachineState {
  return { phase: 'confirm', step: 'a', stage: null, prepSkipped: false, stateKind: null };
}

export type EntryAction =
  | { type: 'sync'; stage: EnterStage }
  | { type: 'enter' }
  | { type: 'next'; steps: readonly WizardKey[] }
  | { type: 'back'; steps: readonly WizardKey[] }
  | { type: 'goto'; step: WizardKey }
  | { type: 'finishPrep' }
  | { type: 'recheck' }
  | { type: 'enterNow' }
  | { type: 'showState'; kind: FlowStateKind }
  | { type: 'resume' };

function sync(state: EntryMachineState, stage: EnterStage): EntryMachineState {
  const base: EntryMachineState = state.stage === stage ? state : { ...state, stage };
  if (stage === 'cancelled') {
    return base.phase === 'state' && base.stateKind === 'cancelled' ? base : { ...base, phase: 'state', stateKind: 'cancelled' };
  }
  if (stage === 'completed') {
    if (base.phase === 'end' || base.phase === 'state') return base;
    return base.phase === 'live' ? { ...base, phase: 'end' } : { ...base, phase: 'state', stateKind: 'closed' };
  }
  if (base.phase === 'live' || base.phase === 'end' || base.phase === 'state') return base;
  if (stage === 'waitlisted') return base.phase === 'waitlist' ? base : { ...base, phase: 'waitlist' };
  // 열림·시작
  if (base.phase === 'waitlist') return { ...base, phase: 'wizard', step: 'a' };
  if (base.phase === 'confirm' && state.stage === 'unopened' && stage !== 'unopened') return { ...base, phase: 'wizard', step: 'a' };
  if (base.phase === 'wait' && stage === 'started') return { ...base, phase: 'live', prepSkipped: false };
  return base;
}

export function entryReducer(state: EntryMachineState, action: EntryAction): EntryMachineState {
  switch (action.type) {
    case 'sync':
      return sync(state, action.stage);
    case 'enter':
      if (state.phase !== 'confirm' || state.stage === null || state.stage === 'unopened' || state.stage === 'waitlisted') return state;
      return { ...state, phase: 'wizard', step: 'a' };
    case 'next': {
      if (state.phase !== 'wizard') return state;
      const index = action.steps.indexOf(state.step);
      if (index >= 0 && index < action.steps.length - 1) return { ...state, step: action.steps[index + 1]! };
      return entryReducer(state, { type: 'finishPrep' });
    }
    case 'back': {
      if (state.phase !== 'wizard') return state;
      const index = action.steps.indexOf(state.step);
      if (index <= 0) return { ...state, phase: 'confirm' };
      return { ...state, step: action.steps[index - 1]! };
    }
    case 'goto':
      return state.phase === 'wizard' ? { ...state, step: action.step } : state;
    case 'finishPrep':
      return state.stage === 'started' ? { ...state, phase: 'live', prepSkipped: false } : { ...state, phase: 'wait' };
    case 'recheck':
      return state.phase === 'wait' ? { ...state, phase: 'wizard', step: 'e' } : state;
    case 'enterNow':
      return state.stage === 'started' ? { ...state, phase: 'live', prepSkipped: true } : state;
    case 'showState':
      return { ...state, phase: 'state', stateKind: action.kind };
    case 'resume':
      return state.phase === 'state' ? { ...state, phase: 'confirm', stateKind: null } : state;
  }
}
