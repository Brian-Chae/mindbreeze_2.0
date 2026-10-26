// @vitest-environment jsdom
// 입장 설문: 보기를 고르면 약 300ms 뒤 다음 문항으로 자동 이동한다.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_ADVANCE_MS, useEntrySurvey, type UseEntrySurveyResult } from '../src/hooks/useEntrySurvey';

let root: Root;
let container: HTMLDivElement;
let hook: { current: UseEntrySurveyResult };

function Harness() {
  hook.current = useEntrySurvey({ sessionId: 's1', credential: null, participantId: 'p1' });
  return null;
}

const pick = (axis: 'arousal' | 'valence' | 'emotion', value: 1 | 2 | 3 | 4 | 5, auto?: boolean) => act(() => hook.current.select(axis, value, auto));
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  hook = { current: undefined as unknown as UseEntrySurveyResult };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

describe('useEntrySurvey 자동 다음', () => {
  it('보기를 고르면 300ms 뒤 다음 문항으로 넘어간다', () => {
    pick('arousal', 3, true);
    expect(hook.current.question).toBe(1);
    expect(hook.current.draft.answers.arousal).toBe(3);
    tick(AUTO_ADVANCE_MS);
    expect(hook.current.question).toBe(2);
  });

  it('연달아 두 번 눌러도 한 칸만 넘어간다', () => {
    pick('arousal', 3, true);
    tick(100);
    pick('arousal', 4, true);
    tick(1000);
    expect(hook.current.question).toBe(2);
    expect(hook.current.draft.answers.arousal).toBe(4);
  });

  it('auto 없이 고르면(키보드 화살표) 넘어가지 않는다', () => {
    pick('arousal', 2);
    tick(1000);
    expect(hook.current.question).toBe(1);
  });

  it('뒤로 갔다가 다시 골라도 다시 한 칸 넘어간다', () => {
    pick('arousal', 3, true);
    tick(AUTO_ADVANCE_MS);
    act(() => { hook.current.back(); });
    expect(hook.current.question).toBe(1);
    pick('arousal', 5, true);
    tick(AUTO_ADVANCE_MS);
    expect(hook.current.question).toBe(2);
  });

  it('대기 중 뒤로 가면 취소돼 넘어가지 않는다', () => {
    pick('arousal', 3, true);
    act(() => { hook.current.back(); });
    tick(1000);
    expect(hook.current.question).toBe(1);
  });

  it('전할 말(마지막 문항)은 자동으로 넘어가지 않는다', () => {
    for (const axis of ['arousal', 'valence', 'emotion'] as const) {
      pick(axis, 3, true);
      tick(AUTO_ADVANCE_MS);
    }
    expect(hook.current.question).toBe(4);
    pick('emotion', 2, true);
    tick(1000);
    expect(hook.current.question).toBe(4);
  });
});
