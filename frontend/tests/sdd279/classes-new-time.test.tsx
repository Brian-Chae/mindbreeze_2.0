// @vitest-environment jsdom
// SDD-279 보정 — /classes/new 의 WizardDateTime(type=time) 이 C-3 팝업/시·분 select 를 쓰는지
import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WizardDateTime } from '../../src/pages/classes/wizard-visual-components';
import { formatClock, parseClock, allowedHours, minuteOptions } from '../../src/lib/class/start-time';

let root: Root; let container: HTMLDivElement; const rec = { last: '' };
function H({ initial, min = '07:00', max = '22:00' }: { initial: string; min?: string; max?: string }): ReactNode {
  const [v, setV] = useState(initial);
  return createElement(WizardDateTime, { label: '시작 시각', type: 'time', min, max, value: v, onChange: (x: string) => { rec.last = x; setV(x); } });
}
const mm = (desktop: boolean) => Object.assign(window, { matchMedia: (q: string) => ({ matches: desktop && q.includes('768'), addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }) });
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); }); };
const byText = (sel: string, t: string) => [...container.querySelectorAll(sel)].find((e) => e.textContent === t);
async function mount(initial: string, desktop: boolean, min?: string, max?: string) { mm(desktop); await act(async () => root.render(createElement(H, { initial, min, max }))); }

beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); rec.last = ''; });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('SDD-279 보정 변환', () => {
  it('parseClock/formatClock 경계', () => {
    expect(parseClock('07:00')).toBe(420); expect(parseClock('22:00')).toBe(1320); expect(parseClock('19:05')).toBe(1145);
    expect(parseClock('')).toBeNull(); expect(parseClock('25:00')).toBeNull(); expect(parseClock('9:60')).toBeNull();
    expect(formatClock(540)).toBe('09:00'); expect(formatClock(1320)).toBe('22:00');
  });
  it('min/max 를 존중한다', () => {
    expect(allowedHours('am', { minMin: 9 * 60, maxMin: 20 * 60 })).toEqual([9, 10, 11]);
    expect(allowedHours('pm', { minMin: 9 * 60, maxMin: 20 * 60 })).toEqual([12, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(minuteOptions(20, { maxMin: 20 * 60 }).filter((m) => !m.disabled).map((m) => m.value)).toEqual([0]);
  });
});

describe('SDD-279 보정 WizardDateTime time', () => {
  it('데스크톱: ± 버튼 없음, 팝업으로 오후 7:00 → 오전 9:00 3클릭 → "09:00"', async () => {
    await mount('19:00', true);
    expect(container.querySelector('button[aria-label="시작 시각 이전"]')).toBeNull();
    expect(container.querySelector('button[aria-label="시작 시각 다음"]')).toBeNull();
    await click(container.querySelector('.fh-timebtn'));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await click(byText('.fh-timetab', '오전'));
    await click(byText('[aria-label="시"] [role="option"]', '9시'));
    await click(byText('[aria-label="분"] [role="option"]', '00분'));
    expect(rec.last).toBe('09:00');
    expect(container.querySelector('.fh-timebtn')!.textContent).toContain('오전 9:00');
  });
  it('모바일: 시·분 select', async () => {
    await mount('19:00', false);
    const h = container.querySelector<HTMLSelectElement>('select[aria-label="시작 시각 시"]')!;
    expect(h.value).toBe('19');
    await act(async () => { h.value = '9'; h.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(rec.last).toBe('09:00');
  });
  it('범위 밖 값은 draft 를 바꾸지 않는다(표시만)', async () => {
    await mount('06:00', true);
    expect(rec.last).toBe('');
    expect(container.querySelector('.fh-timebtn')).not.toBeNull();
  });
  it('min/max props 존중: 09:00~20:00', async () => {
    await mount('10:00', true, '09:00', '20:00');
    await click(container.querySelector('.fh-timebtn'));
    const hours = [...container.querySelectorAll('[aria-label="시"] [role="option"]')].map((e) => e.textContent);
    expect(hours).toEqual(['9시', '10시', '11시']);
  });
  it('날짜는 SDD-281 이후 − / + 없이 단일 캘린더 필드', async () => {
    mm(true);
    await act(async () => root.render(createElement(WizardDateTime, { label: '시작 날짜', type: 'date', min: '2020-01-01', value: '2026-12-21', onChange: () => undefined })));
    expect(container.querySelector('button[aria-label="시작 날짜 이전"]')).toBeNull();
    expect(container.querySelector('button[aria-haspopup="dialog"]')).not.toBeNull();
  });
});
