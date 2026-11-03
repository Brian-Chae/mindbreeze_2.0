// @vitest-environment jsdom
// SDD-279 V9~V17 — StartTimePicker 컴포넌트(데스크톱 팝오버 / 모바일 select)
import { act, createElement, useEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StartTimePicker } from '../../src/components/class/flow/host/start-time-picker';

let root: Root;
let container: HTMLDivElement;
let latest = 0;

function Harness({ initial, desktop }: { initial: number; desktop: boolean }): ReactNode {
  const [t, setT] = useState(initial);
  useEffect(() => { latest = t; }, [t]);
  return createElement(StartTimePicker, { timeMin: t, onChange: setT, desktop });
}
async function mount(initial: number, desktop = true): Promise<void> {
  latest = initial;
  await act(async () => root.render(createElement(Harness, { initial, desktop })));
}
const click = async (el: Element | null): Promise<void> => { await act(async () => { (el as HTMLElement).click(); }); };
const trigger = (): HTMLButtonElement => container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
const dialog = (): HTMLElement | null => container.querySelector<HTMLElement>('[role="dialog"]');
const opt = (list: string, text: string): HTMLElement =>
  [...container.querySelectorAll<HTMLElement>(`[role="listbox"][aria-label="${list}"] [role="option"]`)].find((e) => e.textContent === text)!;
const tab = (text: string): HTMLElement => [...container.querySelectorAll<HTMLElement>('[role="dialog"] button[aria-pressed]')].find((e) => e.textContent === text)!;
const keydown = async (el: Element, key: string): Promise<void> => {
  await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
};

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

describe('SDD-279 데스크톱 팝오버', () => {
  it('V9 트리거 aria 와 열기/닫기', async () => {
    await mount(1140);
    expect(trigger().textContent).toContain('오후 7:00');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(dialog()).toBeNull();
    await click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(dialog()).not.toBeNull();
    expect(dialog()!.getAttribute('aria-label')).toBeTruthy();
  });

  it('V10 열리면 현재 값이 선택 표시된다', async () => {
    await mount(1140 + 30);
    await click(trigger());
    expect(tab('오후').getAttribute('aria-pressed')).toBe('true');
    expect(tab('오전').getAttribute('aria-pressed')).toBe('false');
    expect(opt('시', '7시').getAttribute('aria-selected')).toBe('true');
    expect(opt('분', '30분').getAttribute('aria-selected')).toBe('true');
    expect(opt('시', '8시').getAttribute('aria-selected')).toBe('false');
  });

  it('V11 오후 7:00 → 오전 9:00 은 클릭 3회(트리거·오전·9시), 팝오버는 열린 채', async () => {
    await mount(1140);
    await click(trigger()); // 1
    await click(tab('오전')); // 2
    await click(opt('시', '9시')); // 3
    expect(latest).toBe(540);
    expect(dialog()).not.toBeNull();
    expect(trigger().textContent).toContain('오전 9:00');
  });

  it('V12 분 선택은 즉시 반영 후 닫히고 포커스가 트리거로 돌아간다', async () => {
    await mount(540);
    await click(trigger());
    await click(opt('분', '35분'));
    expect(latest).toBe(575);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('V13 Esc 로 닫히고 포커스 복귀, 바깥 pointerdown 으로 닫힌다', async () => {
    await mount(540);
    await click(trigger());
    await keydown(opt('시', '9시'), 'Escape');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    await click(trigger());
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(dialog()).toBeNull();
    expect(latest).toBe(540);
  });

  it('V14 키보드: ↑↓ 항목 이동, ←→ 시/분 열 이동', async () => {
    await mount(540);
    await click(trigger());
    const nine = opt('시', '9시');
    expect(document.activeElement).toBe(nine);
    await keydown(nine, 'ArrowDown');
    expect(document.activeElement).toBe(opt('시', '10시'));
    await keydown(document.activeElement!, 'ArrowUp');
    await keydown(document.activeElement!, 'ArrowUp');
    expect(document.activeElement).toBe(opt('시', '8시'));
    await keydown(document.activeElement!, 'ArrowRight');
    expect(document.activeElement).toBe(opt('분', '00분'));
    await keydown(document.activeElement!, 'ArrowLeft');
    expect(document.activeElement!.closest('[role="listbox"]')!.getAttribute('aria-label')).toBe('시');
  });

  it('V15 오후 10시는 분 00 외 비활성이고 눌러도 값이 변하지 않는다', async () => {
    await mount(1320);
    await click(trigger());
    expect(opt('분', '30분').getAttribute('aria-disabled')).toBe('true');
    expect(opt('분', '00분').getAttribute('aria-disabled')).not.toBe('true');
    await click(opt('분', '30분'));
    expect(latest).toBe(1320);
    expect(dialog()).not.toBeNull();
  });

  it('5분 단위가 아닌 값은 트리거에 그대로 보이고 팝오버에서는 가까운 칸이 선택 표시만 된다', async () => {
    await mount(540 + 17);
    expect(trigger().textContent).toContain('오전 9:17');
    await click(trigger());
    expect(opt('분', '15분').getAttribute('aria-selected')).toBe('true');
    expect(latest).toBe(557);
  });
});

describe('SDD-279 모바일 select', () => {
  it('V16 팝오버 없이 시·분 select 두 개가 같은 값을 갱신한다', async () => {
    await mount(1140, false);
    expect(container.querySelector('button[aria-haspopup="dialog"]')).toBeNull();
    const selects = container.querySelectorAll<HTMLSelectElement>('select');
    expect(selects.length).toBe(2);
    const [hour, minute] = [selects[0], selects[1]];
    expect([...hour.options].map((o) => o.textContent)).toContain('오전 9시');
    expect(hour.value).toBe('19');
    const set = async (sel: HTMLSelectElement, value: string): Promise<void> => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(sel, value);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    await set(hour, '9');
    expect(latest).toBe(540);
    await set(minute, '35');
    expect(latest).toBe(575);
    expect([...minute.options].map((o) => o.value)).toEqual(['0', '5', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']);
  });

  it('V17 팝오버 경로와 select 경로가 같은 입력에서 같은 timeMin 을 만든다', async () => {
    await mount(1140, false);
    const selects = container.querySelectorAll<HTMLSelectElement>('select');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(selects[0], '9');
      selects[0].dispatchEvent(new Event('change', { bubbles: true }));
    });
    const viaSelect = latest;
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount(1140, true);
    await click(trigger());
    await click(tab('오전'));
    await click(opt('시', '9시'));
    expect(latest).toBe(viaSelect);
  });
});
