// @vitest-environment jsdom
// SDD-279 V18 — 시간 예약 화면 통합: 시작 시각 라벨 1개, 중복 보조 라벨 없음, 지금 바로는 불변
import { act, createElement, useEffect, useReducer, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.stubEnv('VITE_COUNSELING_ENABLED', 'true');
import { WizardView } from '../../src/components/class/flow/host/CreateWizard';
import { FIXTURE_BASE, FIXTURE_MEMBERS } from '../../src/lib/class/flow/host-fixture-data';
import { createInitialDraft, createInitialState, wizardReducer, type WizardDraft, type WizardState } from '../../src/lib/class/class-wizard';

let root: Root;
let container: HTMLDivElement;
let last: WizardDraft;

function Harness({ initial }: { initial: WizardState }): ReactNode {
  const [state, dispatch] = useReducer(wizardReducer, initial);
  useEffect(() => { last = state.draft; }, [state.draft]);
  return createElement(WizardView, { state, dispatch, base: FIXTURE_BASE, members: FIXTURE_MEMBERS, conflictTitle: null, onCsvText: () => undefined });
}
async function mount(patch: Partial<WizardDraft>, desktop: boolean): Promise<void> {
  Object.assign(window, {
    matchMedia: (q: string) => ({ matches: desktop && q.includes('768'), addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  });
  const base = createInitialState({ ...createInitialDraft(), ...patch });
  await act(async () => root.render(createElement(Harness, { initial: { ...base, step: 3 } })));
}
const labels = (): string[] => [...container.querySelectorAll('.fh-when3 .fl-label')].map((e) => e.textContent ?? '');
const click = async (el: Element | null | undefined): Promise<void> => { await act(async () => { (el as HTMLElement).click(); }); };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('SDD-279 시간 예약 화면', () => {
  it('V18 첫 행 라벨 3개(시작 날짜·시작 시각 · 5분·소요 시간), 보조 라벨 없음', async () => {
    await mount({ when: 'later', timeMin: 1140 }, true);
    expect(labels()).toEqual(['시작 날짜', '시작 시각 · 5분', '소요 시간 · 5분 단위']);
    expect(container.querySelectorAll('.fh-when3 .fh-timebtn').length).toBe(1);
    expect(container.querySelector('.fh-when3 select')).toBeNull();
    expect(container.querySelector('.fh-when3 .fh-c5')).toBeNull(); // 바로 선택 칩은 다음 행
    expect(container.querySelector('.fh-c5')).not.toBeNull();
  });

  it('데스크톱 오후 7:00 → 오전 9:00 이 draft.timeMin 에 반영되고 다른 값은 그대로다', async () => {
    await mount({ when: 'later', timeMin: 1140, durationMin: 50 }, true);
    await click(container.querySelector('.fh-timebtn'));
    await click([...container.querySelectorAll('.fh-timetab')].find((e) => e.textContent === '오전'));
    await click([...container.querySelectorAll('[role="option"]')].find((e) => e.textContent === '9시'));
    expect(last.timeMin).toBe(540);
    expect(last.durationMin).toBe(50);
    expect(last.when).toBe('later');
  });

  it('모바일: 같은 화면이 select 두 개로 같은 draft 를 갱신한다', async () => {
    await mount({ when: 'later', timeMin: 1140 }, false);
    expect(container.querySelector('.fh-timebtn')).toBeNull();
    const hour = container.querySelector<HTMLSelectElement>('select[aria-label="시작 시각 시"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(hour, '9');
      hour.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(last.timeMin).toBe(540);
  });

  it('지금 바로: 시작 시각 없이 소요 시간 묶음 그대로', async () => {
    await mount({ when: 'now' }, true);
    expect(container.querySelector('.fh-when3')).toBeNull();
    expect(container.textContent).toContain('소요 시간 · 5분 단위');
    expect(container.querySelector('.fh-c5')).not.toBeNull();
  });
});
