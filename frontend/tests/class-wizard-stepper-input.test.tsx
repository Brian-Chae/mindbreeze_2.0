// @vitest-environment jsdom
// 클래스 만들기 1단계 정원 입력 — 다 지울 때 0이 끼고 "40"을 치면 "04"가 되던 문제 회귀 시험
import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WizardStepper } from '../src/pages/classes/wizard-visual-components';

let root: Root; let container: HTMLDivElement; const rec = { last: -1 };
function H({ initial, min = 2, max = 50, step = 1 }: { initial: number; min?: number; max?: number; step?: number }): ReactNode {
  const [v, setV] = useState(initial);
  return createElement(WizardStepper, { label: '정원', value: v, min, max, step, unit: '명', onChange: (x: number) => { rec.last = x; setV(x); } });
}
const input = () => container.querySelector('input') as HTMLInputElement;
// React 가 값 변경으로 인식하도록 네이티브 setter 로 값을 넣는다
async function type(value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function blur() { await act(async () => { input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })); }); }
async function mount(props: Parameters<typeof H>[0]) { rec.last = -1; await act(async () => root.render(createElement(H, props))); }

beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('WizardStepper 직접 입력', () => {
  it('다 지우면 0 이 아니라 빈 칸이 된다', async () => {
    await mount({ initial: 10 });
    await type('');
    expect(input().value).toBe('');
  });
  it('지운 뒤 4, 0 을 치면 40 이 된다(04 가 아님)', async () => {
    await mount({ initial: 10 });
    await type('');
    await type('4');
    expect(input().value).toBe('4');
    await type('40');
    expect(input().value).toBe('40');
    expect(rec.last).toBe(40);
  });
  it('앞자리 0 은 제거한다', async () => {
    await mount({ initial: 10 });
    await type('04');
    expect(input().value).toBe('4');
    await type('040');
    expect(input().value).toBe('40');
  });
  it('입력 중 최소값보다 작으면 값은 바꾸지 않고, 포커스를 잃으면 최소값으로 맞춘다', async () => {
    await mount({ initial: 10 });
    await type('1');
    expect(rec.last).toBe(-1);
    await blur();
    expect(input().value).toBe('2');
    expect(rec.last).toBe(2);
  });
  it('비운 채 포커스를 잃으면 직전 값으로 돌아간다', async () => {
    await mount({ initial: 10 });
    await type('');
    await blur();
    expect(input().value).toBe('10');
  });
  it('최대값을 넘기면 최대값으로 막는다', async () => {
    await mount({ initial: 10, max: 50 });
    await type('99');
    expect(input().value).toBe('50');
    expect(rec.last).toBe(50);
  });
  it('step 이 있으면 포커스를 잃을 때 가까운 단위로 맞춘다(소요 시간 5분 단위)', async () => {
    await mount({ initial: 60, min: 5, max: 480, step: 5 });
    await type('72');
    await blur();
    expect(input().value).toBe('70');
    expect(rec.last).toBe(70);
  });
  it('+ / − 버튼은 기존대로 동작한다', async () => {
    await mount({ initial: 10 });
    await act(async () => { (container.querySelector('button[aria-label="정원 늘리기"]') as HTMLElement).click(); });
    expect(input().value).toBe('11');
    await act(async () => { (container.querySelector('button[aria-label="정원 줄이기"]') as HTMLElement).click(); });
    expect(input().value).toBe('10');
  });
});
