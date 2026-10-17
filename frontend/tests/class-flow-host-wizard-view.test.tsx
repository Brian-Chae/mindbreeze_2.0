// @vitest-environment jsdom
// SDD-209 H1 — 만들기 마법사 뷰(FH02a·FH02b): 렌더·상호작용·문구
import { act, createElement, useReducer, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WizardView } from '../src/components/class/flow/host/CreateWizard';
import { createInitialDraft, createInitialState, wizardReducer, type WizardDraft, type WizardState } from '../src/lib/class/class-wizard';

let root: Root;
let container: HTMLDivElement;

function Harness({ initial, onExit }: { initial: WizardState; onExit?: () => void }): ReactNode {
  const [state, dispatch] = useReducer(wizardReducer, initial);
  return createElement(WizardView, { state, dispatch, onExit });
}

async function mount(step: WizardState['step'], patch: Partial<WizardDraft> = {}, onExit?: () => void): Promise<void> {
  const initial: WizardState = { ...createInitialState({ ...createInitialDraft(), ...patch }), step };
  await act(async () => root.render(createElement(Harness, { initial, onExit })));
}
const text = (): string => container.textContent ?? '';
const click = async (el: Element | null): Promise<void> => { await act(async () => { (el as HTMLElement).click(); }); };
const byText = (sel: string, t: string): HTMLElement | null => [...container.querySelectorAll<HTMLElement>(sel)].find((el) => el.textContent?.includes(t)) ?? null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(window, { matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }) });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('FH02a 유형·방식·인원', () => {
  it('유형 4종·진행 방식·인원을 보이고 진행 점은 5개', async () => {
    await mount(1);
    expect(text()).toContain('어떤 클래스를 만들까요?');
    for (const label of ['임상심리상담', '최면심리상담', '명상', '기타', '온라인', '오프라인(대면)', '1:1', '그룹']) expect(text()).toContain(label);
    expect(container.querySelectorAll('[data-pz="flow-steps"] > i')).toHaveLength(5);
    expect(container.querySelectorAll('[data-pz="flow-cta"]')).toHaveLength(1);
  });

  it('1:1 을 고르면 최대 1명 고정 안내가 나온다', async () => {
    await mount(1);
    expect(text()).not.toContain('1:1은 참여자를 최대 1명으로 고정해요.');
    await click(byText('button', '1:1'));
    expect(text()).toContain('1:1은 참여자를 최대 1명으로 고정해요.');
  });

  it('오프라인이면 주소 입력, 온라인이면 하울링 안내', async () => {
    await mount(1);
    expect(text()).toContain('한 공간에서 여러 기기를 켜면 소리가 울릴 수 있어요.');
    await click(byText('button', '오프라인(대면)'));
    expect(container.querySelector('input[aria-label="장소 주소"]')).not.toBeNull();
  });

  it('기타 유형은 이름 입력을 보인다', async () => {
    await mount(1, { type: 'other', customName: '감정 코칭' });
    expect((container.querySelector('input[aria-label="기타 유형 이름"]') as HTMLInputElement).value).toBe('감정 코칭');
  });

  it('다음 버튼이 2단계로 이동시킨다', async () => {
    await mount(1);
    await click(container.querySelector('[data-pz="flow-cta"]'));
    expect(text()).toContain('기록과 분석을 정해요');
  });
});

describe('FH02a 정원 스텐퍼', () => {
  it('그룹 기본 정원 10명과 최대 안내', async () => {
    await mount(1);
    expect(text()).toContain('정원 10명');
    expect(text()).toContain('온라인 그룹은 최대 50명까지 정할 수 있어요.');
  });

  it('+/- 로 정원이 바뀐다', async () => {
    await mount(1);
    await click(container.querySelector('[aria-label="정원 늘리기"]'));
    expect(text()).toContain('정원 11명');
    await click(container.querySelector('[aria-label="정원 줄이기"]'));
    await click(container.querySelector('[aria-label="정원 줄이기"]'));
    expect(text()).toContain('정원 9명');
  });

  it('온라인 그룹 50명이면 + 가 비활성이고 안내가 바뀐다', async () => {
    await mount(1, { capacity: 50 });
    expect((container.querySelector('[aria-label="정원 늘리기"]') as HTMLButtonElement).disabled).toBe(true);
    expect(text()).toContain('온라인 그룹은 최대 50명이라 더 늘릴 수 없어요.');
  });

  it('오프라인 그룹은 최대 100명', async () => {
    await mount(1, { place: 'offline', capacity: 60 });
    expect((container.querySelector('[aria-label="정원 늘리기"]') as HTMLButtonElement).disabled).toBe(false);
    expect(text()).toContain('오프라인 그룹은 최대 100명까지 정할 수 있어요.');
  });

  it('1:1 은 스텐퍼 없이 1명 고정 안내', async () => {
    await mount(1, { size: 'solo' });
    expect(container.querySelector('[aria-label="정원 늘리기"]')).toBeNull();
    expect(text()).toContain('1:1은 참여자를 최대 1명으로 고정해요.');
  });
});

describe('FH02b LINK BAND·녹음', () => {
  it('필수여도 참가를 막지 않는 권장 문구', async () => {
    await mount(2, { band: 'required' });
    expect(text()).toContain('필수로 설정해도 참가자에게는 LINK BAND 사용을 권장해요. 없어도 참가할 수 있어요.');
  });

  it('AI 분석은 토글 없이 안내 행', async () => {
    await mount(2);
    expect(text()).toContain('AI 분석');
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(2);
  });

  it('오프라인은 영상 녹화 자리를 안내로 대체', async () => {
    await mount(2, { place: 'offline' });
    expect(text()).toContain('대면 클래스는 영상 녹화 없이 진행해요.');
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(1);
  });

  it('이전 버튼으로 1단계로 돌아간다', async () => {
    await mount(2);
    await click(byText('button', '이전'));
    expect(text()).toContain('어떤 클래스를 만들까요?');
  });
});

describe('나가기 확인 시트', () => {
  it('X 를 누르면 시트가 열리고 나가기가 onExit 을 부른다', async () => {
    let exited = 0;
    await mount(1, {}, () => { exited += 1; });
    await click(container.querySelector('[aria-label="나가기"]'));
    expect(text()).toContain('만들기를 그만둘까요?');
    expect(text()).toContain('입력한 내용은 저장되지 않아요.');
    await click([...container.querySelectorAll('button')].find((b) => b.textContent === '나가기') ?? null);
    expect(exited).toBe(1);
  });
});
