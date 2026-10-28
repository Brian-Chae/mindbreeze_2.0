// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BirthDateInput } from '../src/components/auth/BirthDateInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

function Harness({ initial = '', onIso, ageRule }: { initial?: string; onIso?: (v: string) => void; ageRule?: 'signup' | 'none' }) {
  const [v, setV] = useState(initial);
  return <BirthDateInput value={v} ageRule={ageRule} onChange={(iso) => { setV(iso); onIso?.(iso); }} />;
}

async function mount(el: JSX.Element) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(el));
}
const input = () => host!.querySelector('input') as HTMLInputElement;
const alertText = () => host!.querySelector('[role="alert"]')?.textContent ?? null;

async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function blur() {
  await act(async () => {
    input().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

describe('BirthDateInput', () => {
  it('숫자 입력 시 구분점이 붙고 ISO 값이 전달된다', async () => {
    const onIso = vi.fn();
    await mount(<Harness onIso={onIso} />);
    await type('19900315');
    expect(input().value).toBe('1990.03.15');
    expect(onIso).toHaveBeenLastCalledWith('1990-03-15');
  });
  it('입력 속성: numeric 키패드, date 아님', async () => {
    await mount(<Harness />);
    expect(input().getAttribute('inputmode')).toBe('numeric');
    expect(input().type).toBe('text');
    expect(input().getAttribute('autocomplete')).toBe('bday');
    expect(input().maxLength).toBe(10);
  });
  it('붙여넣기·구분자 혼합 형식을 같은 값으로 정리', async () => {
    await mount(<Harness />);
    await type('1990-03-15');
    expect(input().value).toBe('1990.03.15');
    await type('1990.03.15가나');
    expect(input().value).toBe('1990.03.15');
  });
  it('지우면 ISO 값이 빈 문자열', async () => {
    const onIso = vi.fn();
    await mount(<Harness initial="1990-03-15" onIso={onIso} />);
    expect(input().value).toBe('1990.03.15');
    await type('1990.03.1');
    expect(onIso).toHaveBeenLastCalledWith('');
    await type('');
    expect(input().value).toBe('');
  });
  it('입력 중에는 오류 미표시, blur 하면 미완성 안내', async () => {
    await mount(<Harness />);
    await type('1990');
    expect(alertText()).toBeNull();
    await blur();
    expect(alertText()).toContain('올바르게');
  });
  it('존재하지 않는 날짜·미래는 즉시 오류', async () => {
    await mount(<Harness />);
    await type('20231301');
    expect(alertText()).toContain('올바르게');
    await type('20990101');
    expect(alertText()).not.toBeNull();
  });
  it('만 14세 미만은 signup 규칙에서만 오류', async () => {
    await mount(<Harness />);
    await type('20200101');
    expect(alertText()).toContain('14세');
    await act(async () => root!.unmount());
    host!.remove();
    await mount(<Harness ageRule="none" />);
    await type('20200101');
    expect(alertText()).toBeNull();
  });
});
