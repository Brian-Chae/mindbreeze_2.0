// @vitest-environment jsdom
// SDD-281 V4~V10 — StartDatePicker / WizardDateTime(date)
import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StartDatePicker } from '../../src/components/class/flow/host/start-date-picker';
import { WizardDateTime } from '../../src/pages/classes/wizard-visual-components';

let root: Root; let container: HTMLDivElement; const rec = { last: '', calls: 0 };
const TODAY = '2026-11-03';
function H({ initial = TODAY, desktop, max }: { initial?: string; desktop: boolean; max?: string }): ReactNode {
  const [v, setV] = useState(initial);
  return createElement(StartDatePicker, { label: '시작 날짜', value: v, min: TODAY, max, today: TODAY, desktop, onChange: (x: string) => { rec.last = x; rec.calls += 1; setV(x); } });
}
const mount = async (desktop: boolean, initial = TODAY, max?: string) => { await act(async () => root.render(createElement(H, { initial, desktop, max }))); };
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); }); };
const key = async (el: Element, k: string) => { await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }); };
const trigger = () => container.ownerDocument.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const cell = (iso: string) => document.querySelector<HTMLElement>(`[data-date="${iso}"]`)!;

beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); rec.last = ''; rec.calls = 0; });
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); document.body.innerHTML = '';
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); // 시트 닫힘 뒤 지연 history.back() 의 popstate 가 다음 시험으로 새지 않게 비운다
  window.history.replaceState(null, '');
});

describe('SDD-281 StartDatePicker 공통', () => {
  for (const desktop of [true, false]) {
    describe(desktop ? '데스크톱 팝오버' : '모바일 시트', () => {
      it('트리거는 단일 필드 "11/3(화)", 열기 전 dialog 없음', async () => {
        await mount(desktop); expect(trigger().textContent).toContain('11/3(화)'); expect(dialog()).toBeNull();
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
      });
      it('열면 dialog aria-modal, 제목 연결, 선택 불가·오늘 라벨', async () => {
        await mount(desktop); await click(trigger());
        const d = dialog()!; expect(d.getAttribute('aria-modal')).toBe('true');
        const title = document.getElementById(d.getAttribute('aria-labelledby')!); expect(title?.textContent).toBe('시작 날짜 선택');
        expect(cell('2026-11-03').getAttribute('aria-label')).toBe('2026년 11월 3일 화요일, 오늘, 선택됨');
        expect(cell('2026-11-02').getAttribute('aria-label')).toBe('2026년 11월 2일 월요일, 선택 불가');
        expect(cell('2026-11-02').getAttribute('aria-disabled')).toBe('true');
      });
      it('날짜 탭 → onChange("YYYY-MM-DD") 후 닫힘, 포커스 트리거 복귀', async () => {
        await mount(desktop); await click(trigger()); await click(cell('2026-11-24'));
        expect(rec.last).toBe('2026-11-24'); expect(dialog()).toBeNull(); expect(trigger().textContent).toContain('11/24(화)');
        await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); // 포커스 복귀는 setTimeout(0)
        expect(document.activeElement).toBe(trigger());
      });
      it('지난 날짜 클릭은 무시(값·닫힘 유지)', async () => {
        await mount(desktop); await click(trigger()); await click(cell('2026-11-02'));
        expect(rec.calls).toBe(0); expect(dialog()).not.toBeNull();
      });
      it('월 이동 › 후 12월 선택, ‹ 는 현재 달에서 막힘', async () => {
        await mount(desktop); await click(trigger());
        const prev = document.querySelector<HTMLButtonElement>('button[aria-label="이전 달"]')!; expect(prev.disabled).toBe(true);
        await click(document.querySelector('button[aria-label="다음 달"]')); expect(document.body.textContent).toContain('2026년 12월');
        await click(cell('2026-12-15')); expect(rec.last).toBe('2026-12-15');
      });
      it('오늘→3주 뒤 같은 요일은 열기+선택 2탭(같은 달)', async () => {
        await mount(desktop); await click(trigger()); await click(cell('2026-11-24')); expect(rec.last).toBe('2026-11-24');
      });
      it('max 이후 비활성, 다음 달 이동 차단', async () => {
        await mount(desktop, TODAY, '2026-11-20'); await click(trigger());
        expect(cell('2026-11-21').getAttribute('aria-disabled')).toBe('true');
        expect(document.querySelector<HTMLButtonElement>('button[aria-label="다음 달"]')!.disabled).toBe(true);
      });
      it('ESC 로 닫고 값 유지', async () => {
        await mount(desktop); await click(trigger()); await key(dialog()!, 'Escape');
        expect(dialog()).toBeNull(); expect(rec.calls).toBe(0);
      });
      it('방향키 이동 + Enter 선택, PageDown 월 이동', async () => {
        await mount(desktop); await click(trigger());
        const start = document.activeElement as HTMLElement; expect(start.getAttribute('data-date')).toBe(TODAY);
        await key(start, 'ArrowRight'); expect((document.activeElement as HTMLElement).getAttribute('data-date')).toBe('2026-11-04');
        await key(document.activeElement!, 'ArrowDown'); expect((document.activeElement as HTMLElement).getAttribute('data-date')).toBe('2026-11-11');
        await key(document.activeElement!, 'ArrowLeft'); await key(document.activeElement!, 'ArrowLeft'); await key(document.activeElement!, 'ArrowLeft');
        await key(document.activeElement!, 'ArrowLeft'); // 11/7
        await key(document.activeElement!, 'ArrowUp'); // 10/31 → min 아래라 오늘로 보정
        expect((document.activeElement as HTMLElement).getAttribute('data-date')).toBe(TODAY);
        await key(document.activeElement!, 'PageDown'); expect(document.body.textContent).toContain('2026년 12월');
        await key(document.activeElement!, 'Enter'); expect(rec.last).toBe('2026-12-03');
      });
      it('오늘로 이동은 달력 위치만 되돌리고 값은 바꾸지 않는다', async () => {
        await mount(desktop); await click(trigger()); await click(document.querySelector('button[aria-label="다음 달"]'));
        const today = [...document.querySelectorAll('button')].find(b => b.textContent === '오늘로 이동')!;
        await click(today); expect(document.body.textContent).toContain('2026년 11월'); expect(rec.calls).toBe(0);
      });
    });
  }
  it('6주 달을 모두 그린다(2027-05)', async () => {
    await mount(true, '2027-05-10'); await click(trigger());
    expect(document.querySelectorAll('.cw-datecell[data-date]').length).toBe(31); expect(document.querySelectorAll('.cw-daterow').length).toBe(6);
  });
});

describe('SDD-281 분기 차이', () => {
  it('데스크톱: 팝오버, 시트 핸들·닫기 버튼 없음 / 바깥 클릭으로 닫힘', async () => {
    await mount(true); await click(trigger());
    expect(document.querySelector('.cw-date-pop')).not.toBeNull(); expect(document.querySelector('.cw-date-sheet')).toBeNull();
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(dialog()).toBeNull();
  });
  it('모바일: 시트·핸들·닫기 버튼, 안내문, 배경 탭·닫기 버튼으로 닫힘, 스크롤 잠금 해제', async () => {
    await mount(false); await click(trigger());
    expect(document.querySelector('.cw-date-sheet')).not.toBeNull(); expect(document.querySelector('.cw-date-handle')).not.toBeNull();
    expect(document.body.textContent).toContain('날짜를 누르면 바로 적용돼요'); expect(document.body.style.overflow).toBe('hidden');
    await click(document.querySelector('.cw-date-scrim')); expect(dialog()).toBeNull(); expect(document.body.style.overflow).not.toBe('hidden');
    await click(trigger()); await click(document.querySelector('button[aria-label="닫기"]')); expect(dialog()).toBeNull(); expect(rec.calls).toBe(0);
  });
  it('모바일: 뒤로가기(popstate)로 닫힘', async () => {
    await mount(false); await click(trigger()); expect(dialog()).not.toBeNull();
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); }); expect(dialog()).toBeNull();
  });
});

describe('SDD-281 WizardDateTime date', () => {
  const mm = (desktop: boolean) => Object.assign(window, { matchMedia: (q: string) => ({ matches: desktop && q.includes('768'), addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }) });
  function W(): ReactNode {
    const [v, setV] = useState('2026-11-03');
    return createElement(WizardDateTime, { label: '시작 날짜', type: 'date', min: '2026-11-03', value: v, onChange: (x: string) => { rec.last = x; setV(x); } });
  }
  it('−/+ 스테퍼와 native date input 이 없고 단일 필드', async () => {
    mm(true); await act(async () => root.render(createElement(W)));
    expect(container.querySelector('button[aria-label="시작 날짜 이전"]')).toBeNull(); expect(container.querySelector('button[aria-label="시작 날짜 다음"]')).toBeNull();
    expect(container.querySelector('input[type="date"]')).toBeNull(); expect(container.querySelector('.w-stepper')).toBeNull();
    expect(container.querySelector('button[aria-haspopup="dialog"]')!.textContent).toContain('11/3(화)');
  });
  it('날짜를 고르면 onChange', async () => {
    mm(true); await act(async () => root.render(createElement(W)));
    await click(container.querySelector('button[aria-haspopup="dialog"]')); await click(document.querySelector('[data-date="2026-11-24"]'));
    expect(rec.last).toBe('2026-11-24');
  });
});
