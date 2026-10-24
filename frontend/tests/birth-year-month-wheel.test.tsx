// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { BirthYearMonthWheel } from '../src/components/forms/birth-year-month-wheel';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let box: HTMLDivElement;
afterEach(async () => { await act(async () => root.unmount()); box.remove(); vi.useRealTimers(); });
async function mount(value = '') { box = document.createElement('div'); document.body.append(box); root = createRoot(box); const change = vi.fn(); await act(async () => root.render(<BirthYearMonthWheel id="birth" value={value} onChange={change} now={new Date('2026-10-24T12:00:00Z')}/>)); return change; }
function wheel(name: string) { return box.querySelector<HTMLElement>(`[role="listbox"][aria-label="${name}"]`)!; }
async function choose(name: string, text: string) { await act(async () => { Array.from(wheel(name).querySelectorAll<HTMLElement>('[role="option"]')).find(el => el.textContent === text)!.click(); }); }
it('연도와 월은 미선택에서 시작하며 둘 다 선택해야 연월을 보낸다', async () => {
 const change = await mount(); expect(change).not.toHaveBeenCalled(); expect(box.querySelectorAll('input[type="date"], input[type="month"]')).toHaveLength(0);
 await choose('출생 연도', '2018년'); expect(change).toHaveBeenLastCalledWith('');
 await choose('출생 월', '3월'); expect(change).toHaveBeenLastCalledWith('2018-03');
 expect(wheel('출생 연도').querySelector('[aria-selected="true"]')?.textContent).toBe('2018년');
});
it('스크롤과 키보드로 각 다이얼을 독립 선택할 수 있다', async () => {
 vi.useFakeTimers(); const change = await mount('2018-03');
 const month = wheel('출생 월'); await act(async () => { month.scrollTop = 4 * 44; month.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(150); });
 expect(change).toHaveBeenLastCalledWith('2018-04');
 await act(async () => { wheel('출생 연도').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true})); });
 expect(change).toHaveBeenLastCalledWith('2017-04');
});
it('현재 연도를 고르면 미래 월은 선택 불가하고 이전 미래 월 선택을 해제한다', async () => {
 const change = await mount('2018-12'); await choose('출생 연도', '2026년'); expect(change).toHaveBeenLastCalledWith('');
 expect(Array.from(wheel('출생 월').querySelectorAll('[role="option"]')).some(el => el.textContent === '12월')).toBe(false);
 await choose('출생 월', '10월'); expect(change).toHaveBeenLastCalledWith('2026-10');
});
it('지연 중인 연도 스크롤은 그 사이 바꾼 월을 보존한다', async () => {
 vi.useFakeTimers(); const change = await mount('2018-03');
 await act(async () => { const year=wheel('출생 연도');year.scrollTop=10*44;year.dispatchEvent(new Event('scroll')); });
 await choose('출생 월', '4월');
 await act(async () => { vi.advanceTimersByTime(150); });
 expect(change).toHaveBeenLastCalledWith('2017-04');
});
