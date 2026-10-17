// SDD-209 M1 — 입장 상태 머신(순수) · 단계 구성 · 상태 종류 파생
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api/client';
import {
  buildSteps, deriveEnterStage, deriveFlowStateKind, entryReducer, initialEntryState, startedSheetApplies,
  type EntryAction, type EntryMachineState,
} from '../src/lib/class/flow/member-machine';

function run(actions: EntryAction[], from: EntryMachineState = initialEntryState()): EntryMachineState {
  return actions.reduce(entryReducer, from);
}

describe('buildSteps — 단계 구성', () => {
  it('온라인 5 · 오프라인 4(기기 점검 없음) · 밴드 사용 안 함이면 밴드 단계 없음', () => {
    expect(buildSteps('online', 'opt')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(buildSteps('online', 'req')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(buildSteps('offline', 'opt')).toEqual(['a', 'b', 'c', 'e']);
    expect(buildSteps('online', 'none')).toEqual(['a', 'b', 'd', 'e']);
    expect(buildSteps('offline', 'none')).toEqual(['a', 'b', 'e']);
  });
});

describe('deriveEnterStage', () => {
  it('서버 상태 → 입장 단계', () => {
    expect(deriveEnterStage({ status: 'ready', isWaitlisted: false })).toBe('unopened');
    expect(deriveEnterStage({ status: 'scheduled', isWaitlisted: false })).toBe('unopened');
    expect(deriveEnterStage({ status: 'open', isWaitlisted: false })).toBe('open');
    expect(deriveEnterStage({ status: 'in_progress', isWaitlisted: false })).toBe('started');
    expect(deriveEnterStage({ status: 'open', isWaitlisted: true })).toBe('waitlisted');
    expect(deriveEnterStage({ status: 'in_progress', isWaitlisted: true })).toBe('waitlisted');
    expect(deriveEnterStage({ status: 'completed', isWaitlisted: true })).toBe('completed');
    expect(deriveEnterStage({ status: 'cancelled', isWaitlisted: false })).toBe('cancelled');
  });
});

describe('deriveFlowStateKind — FM10 종류', () => {
  it('오류는 상태 코드로, 서버 문구는 쓰지 않는다', () => {
    expect(deriveFlowStateKind({ error: new ApiError(401, 'x', null) })).toBe('entry-expired');
    expect(deriveFlowStateKind({ error: new ApiError(403, 'x', null) })).toBe('entry-expired');
    expect(deriveFlowStateKind({ error: new ApiError(404, 'x', null) })).toBe('closed');
    expect(deriveFlowStateKind({ error: new ApiError(408, 'x', null) })).toBe('offline');
    expect(deriveFlowStateKind({ error: new ApiError(503, 'x', null) })).toBe('offline');
    expect(deriveFlowStateKind({ error: new TypeError('Failed to fetch') })).toBe('offline');
    expect(deriveFlowStateKind({ error: new ApiError(500, 'x', null) })).toBe('error');
    expect(deriveFlowStateKind({ error: new Error('?') })).toBe('error');
  });
  it('오프라인이면 무엇보다 먼저 offline', () => {
    expect(deriveFlowStateKind({ online: false, error: new ApiError(500, 'x', null) })).toBe('offline');
  });
  it('오류가 없으면 클래스 상태로', () => {
    expect(deriveFlowStateKind({ status: 'cancelled' })).toBe('cancelled');
    expect(deriveFlowStateKind({ status: 'completed' })).toBe('closed');
    expect(deriveFlowStateKind({ status: 'scheduled' })).toBe('notyet');
    expect(deriveFlowStateKind({ status: 'ready' })).toBe('notyet');
    expect(deriveFlowStateKind({ status: 'open' })).toBe('error');
  });
});

describe('entryReducer — 입장 상태 머신', () => {
  it('열리기 전에는 확인 화면에서 기다리다가 열리면 자동으로 준비 단계 a 로 간다', () => {
    let s = run([{ type: 'sync', stage: 'unopened' }]);
    expect(s.phase).toBe('confirm');
    s = entryReducer(s, { type: 'enter' });
    expect(s.phase).toBe('confirm'); // 아직 못 들어간다
    s = entryReducer(s, { type: 'sync', stage: 'open' });
    expect(s).toMatchObject({ phase: 'wizard', step: 'a' });
  });
  it('열려 있으면 입장하기로 a 단계, 다음/이전/바로가기', () => {
    const steps = buildSteps('online', 'opt');
    let s = run([{ type: 'sync', stage: 'open' }, { type: 'enter' }]);
    expect(s).toMatchObject({ phase: 'wizard', step: 'a' });
    s = entryReducer(s, { type: 'next', steps });
    expect(s.step).toBe('b');
    s = entryReducer(s, { type: 'back', steps });
    expect(s.step).toBe('a');
    s = entryReducer(s, { type: 'goto', step: 'd' });
    expect(s.step).toBe('d');
    s = entryReducer(s, { type: 'next', steps });
    expect(s.step).toBe('e');
    s = entryReducer(s, { type: 'next', steps });
    expect(s.phase).toBe('wait'); // 마지막 단계에서 다음 = 입장 대기
  });
  it('a 단계에서 이전은 입장 확인으로 돌아간다', () => {
    const steps = buildSteps('online', 'opt');
    const s = run([{ type: 'sync', stage: 'open' }, { type: 'enter' }, { type: 'back', steps }]);
    expect(s.phase).toBe('confirm');
  });
  it('시작 대기에서 준비 다시 확인하기는 요약 단계(e)로 초안을 보존한 채 돌아간다', () => {
    const s = run([{ type: 'sync', stage: 'open' }, { type: 'enter' }, { type: 'finishPrep' }, { type: 'recheck' }]);
    expect(s).toMatchObject({ phase: 'wizard', step: 'e' });
  });
  it('시작 대기 중 상담사가 시작하면 자동으로 진행 화면(시트 없음)', () => {
    const s = run([{ type: 'sync', stage: 'open' }, { type: 'enter' }, { type: 'finishPrep' }, { type: 'sync', stage: 'started' }]);
    expect(s.phase).toBe('live');
    expect(s.prepSkipped).toBe(false);
  });
  it('준비 중 시작되면 단계는 그대로 두고, 지금 입장하기 → 진행 화면 + prepSkipped', () => {
    let s = run([{ type: 'sync', stage: 'open' }, { type: 'enter' }, { type: 'goto', step: 'b' }, { type: 'sync', stage: 'started' }]);
    expect(s).toMatchObject({ phase: 'wizard', step: 'b', stage: 'started' });
    s = entryReducer(s, { type: 'enterNow' });
    expect(s).toMatchObject({ phase: 'live', prepSkipped: true });
  });
  it('시작된 뒤에도 준비를 끝까지 마치면 prepSkipped 없이 바로 진행 화면', () => {
    const s = run([{ type: 'sync', stage: 'started' }, { type: 'enter' }, { type: 'finishPrep' }]);
    expect(s).toMatchObject({ phase: 'live', prepSkipped: false });
  });
  it('시작 후 시트는 b·c·d 단계에서만', () => {
    expect(startedSheetApplies('b')).toBe(true);
    expect(startedSheetApplies('c')).toBe(true);
    expect(startedSheetApplies('d')).toBe(true);
    expect(startedSheetApplies('a')).toBe(false);
    expect(startedSheetApplies('e')).toBe(false);
  });
  it('정원 초과는 준비 마법사를 건너뛰고 대기열로, 승격되면 a 단계로', () => {
    let s = run([{ type: 'sync', stage: 'waitlisted' }]);
    expect(s.phase).toBe('waitlist');
    s = entryReducer(s, { type: 'sync', stage: 'open' });
    expect(s).toMatchObject({ phase: 'wizard', step: 'a' });
  });
  it('취소되면 어느 단계에서든 FM10 cancelled', () => {
    for (const from of ['confirm', 'wizard', 'wait', 'live'] as const) {
      const base = { ...initialEntryState(), phase: from, stage: 'open' as const };
      expect(entryReducer(base, { type: 'sync', stage: 'cancelled' })).toMatchObject({ phase: 'state', stateKind: 'cancelled' });
    }
  });
  it('종료: 진행 화면에 있었으면 종료 화면(FM09), 아니면 종료됨 상태(FM10 closed)', () => {
    expect(entryReducer({ ...initialEntryState(), phase: 'live', stage: 'started' }, { type: 'sync', stage: 'completed' }).phase).toBe('end');
    expect(entryReducer({ ...initialEntryState(), phase: 'wizard', stage: 'open' }, { type: 'sync', stage: 'completed' })).toMatchObject({ phase: 'state', stateKind: 'closed' });
  });
  it('진행 화면에서는 같은 단계 동기화에 흔들리지 않는다', () => {
    const live = { ...initialEntryState(), phase: 'live' as const, stage: 'started' as const };
    expect(entryReducer(live, { type: 'sync', stage: 'started' })).toEqual(live);
  });
  it('요약에서 행을 눌러 고친 단계는 다음/이전 모두 요약(e)으로 바로 돌아온다', () => {
    const steps = buildSteps('online', 'opt');
    let s = run([{ type: 'sync', stage: 'open' }, { type: 'enter' }, { type: 'goto', step: 'e' }, { type: 'goto', step: 'c', fromSummary: true }]);
    expect(s).toMatchObject({ phase: 'wizard', step: 'c' });
    s = entryReducer(s, { type: 'next', steps });
    expect(s).toMatchObject({ phase: 'wizard', step: 'e' });
    s = run([{ type: 'goto', step: 'b', fromSummary: true }, { type: 'back', steps }], s);
    expect(s).toMatchObject({ phase: 'wizard', step: 'e' });
    // 요약에 돌아온 뒤에는 보통의 이동으로 복귀
    s = entryReducer(s, { type: 'back', steps });
    expect(s.step).toBe('d');
  });
  it('상태 화면에서 다시 시도하면 확인 화면으로 돌아가 동기화를 이어 간다', () => {
    const s = run([{ type: 'showState', kind: 'error' }, { type: 'resume' }]);
    expect(s.phase).toBe('confirm');
  });
});
