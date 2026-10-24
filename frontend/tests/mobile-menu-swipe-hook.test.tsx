// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileMenuSwipe } from '../src/hooks/use-mobile-menu-swipe';
import { useMobileSwipeProtection } from '../src/hooks/use-mobile-swipe-protection';
import { registerMobileSwipeProtection } from '../src/lib/mobile-menu-swipe-protection';

let container: HTMLDivElement;
let reactRoot: Root;
let path = '';
let root: HTMLDivElement;
let page: HTMLElement;
let reduced = false;
let mobile = true;
function Probe({ busy = false, blocked = false }: { busy?: boolean; blocked?: boolean }) {
  const swipe = useMobileMenuSwipe('client', blocked, 'fixture');
  useMobileSwipeProtection(() => busy);
  const location = useLocation();
  useEffect(() => { path = location.pathname; }, [location.pathname]);
  return <section><h1>화면 제목</h1><div ref={swipe.containerRef}><div data-mobile-swipe-page><p id="start">본문</p></div></div></section>;
}
async function mount(busy = false, blocked = false, initialPath = '/app/classes') {
  await act(async () => { reactRoot.render(<MemoryRouter key={initialPath} initialEntries={[initialPath]}><Probe busy={busy} blocked={blocked} /></MemoryRouter>); });
  page = container.querySelector('[data-mobile-swipe-page]')!;
  root = page.parentElement as HTMLDivElement;
  root.getBoundingClientRect = () => ({ x: 0, y: 80, top: 80, bottom: 744, width: 390, height: 664, left: 0, right: 390, toJSON() {} });
}
function pointer(type: string, x: number, y = 250, time = 0, id = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerType: { value: 'touch' }, isPrimary: { value: id === 1 }, pointerId: { value: id }, clientX: { value: x }, clientY: { value: y }, timeStamp: { value: time } });
  container.querySelector('#start')!.dispatchEvent(event);
}
async function complete() { await act(async () => { vi.advanceTimersByTime(250); }); }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  reduced = false; mobile = true;
  vi.stubGlobal('matchMedia', (query: string) => ({ get matches() { return query.includes('reduced') ? reduced : mobile; }, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  container = document.createElement('div'); document.body.append(container); reactRoot = createRoot(container);
});
afterEach(async () => {
  await act(async () => { reactRoot.unmount(); });
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('제스처 수명주기', () => {
  it('잠금 전 정지·120px 1:1 추종·inert 미리보기 후 한 번 이동한다', async () => {
    await mount();
    pointer('pointerdown', 280);
    pointer('pointermove', 270, 250, 20);
    expect(page.style.transform).toBe('');
    pointer('pointermove', 160, 250, 200);
    expect(page.style.transform).toBe('translate3d(-120px,0,0)');
    expect(root.querySelector('[data-mobile-swipe-preview]')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('[data-mobile-swipe-preview]')?.hasAttribute('inert')).toBe(true);
    pointer('pointerup', 160, 250, 210);
    pointer('pointerup', 160, 250, 215);
    await complete();
    expect(path).toBe('/app/chat');
  });
  it('짧은 이동과 역방향 플릭은 복귀하며 현재 DOM을 유지한다', async () => {
    await mount(); const original = page.querySelector('#start');
    pointer('pointerdown', 260); pointer('pointermove', 230, 250, 200); pointer('pointerup', 230, 250, 300);
    await complete(); expect(path).toBe('/app/classes'); expect(page.querySelector('#start')).toBe(original); expect(page.style.transform).toBe('');
    pointer('pointerdown', 260, 250, 500); pointer('pointermove', 190, 250, 550); pointer('pointermove', 215, 250, 580); pointer('pointerup', 215, 250, 590);
    await complete(); expect(path).toBe('/app/classes');
  });
  it('빠른 45px 플릭은 완료한다', async () => {
    await mount(); pointer('pointerdown', 260); pointer('pointermove', 215, 250, 55); pointer('pointerup', 215, 250, 60); await complete(); expect(path).toBe('/app/chat');
  });
  it('세로·대각 시작은 이후 수평을 재획득하지 않는다', async () => {
    await mount(); pointer('pointerdown', 260); pointer('pointermove', 250, 270, 30); pointer('pointermove', 100, 270, 90); pointer('pointerup', 100, 270, 100); await complete(); expect(path).toBe('/app/classes');
  });
  it('수평 잠금 후 최종 대각 비율이 크면 취소한다', async () => {
    await mount(); pointer('pointerdown', 280); pointer('pointermove', 250, 250, 30); pointer('pointerup', 150, 400, 100); await complete(); expect(path).toBe('/app/classes');
  });
  it('pointercancel·다중터치·blur·resize는 잔여 이동 없이 취소한다', async () => {
    await mount();
    for (const cause of ['pointercancel', 'second', 'blur', 'resize']) {
      pointer('pointerdown', 280); pointer('pointermove', 160, 250, 80);
      if (cause === 'second') pointer('pointerdown', 170, 250, 90, 2);
      else if (cause === 'pointercancel') pointer(cause, 160, 250, 90);
      else window.dispatchEvent(new Event(cause));
      pointer('pointerup', 160, 250, 100); await complete(); expect(path).toBe('/app/classes'); expect(page.style.transform).toBe('');
    }
  });
  it('도중 보호 등록·drawer 상태 변경·오버레이가 취소한다', async () => {
    await mount(); pointer('pointerdown', 280); pointer('pointermove', 160, 250, 80);
    const release = registerMobileSwipeProtection(() => true);
    pointer('pointerup', 160, 250, 100); await complete(); expect(path).toBe('/app/classes'); release();
    pointer('pointerdown', 280); pointer('pointermove', 160, 250, 80); await mount(false, true); pointer('pointerup', 160, 250, 100); await complete(); expect(path).toBe('/app/classes');
    await mount(false, false); pointer('pointerdown', 280); pointer('pointermove', 160, 250, 80);
    const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); document.body.append(modal);
    pointer('pointerup', 160, 250, 100); await complete(); expect(path).toBe('/app/classes'); modal.remove();
  });
  it('24px 가장자리·데스크톱·활동 보호에서 시작하지 않는다', async () => {
    await mount(); pointer('pointerdown', 12); pointer('pointermove', 200, 250, 80); pointer('pointerup', 200, 250, 100); await complete(); expect(path).toBe('/app/classes');
    mobile = false; pointer('pointerdown', 280); pointer('pointermove', 160, 250, 80); pointer('pointerup', 160, 250, 100); await complete(); expect(path).toBe('/app/classes');
    mobile = true; await mount(true); pointer('pointerdown', 280); pointer('pointermove', 160, 250, 80); pointer('pointerup', 160, 250, 100); await complete(); expect(path).toBe('/app/classes');
  });
  it('리포트에서 왼쪽으로 설정 탭에 이동한다', async () => {
    await mount(false, false, '/app/reports');
    pointer('pointerdown', 280); pointer('pointermove', 160, 250, 80); pointer('pointerup', 160, 250, 100);
    await complete(); expect(path).toBe('/app/profile');
  });
  it('오른쪽으로 이전 메뉴에 이동하고 첫·마지막에서는 저항만 준다', async () => {
    await mount(); pointer('pointerdown', 100); pointer('pointermove', 220, 250, 80); pointer('pointerup', 220, 250, 100); await complete(); expect(path).toBe('/app');
    pointer('pointerdown', 100); pointer('pointermove', 220, 250, 80); expect(page.style.transform).toBe('translate3d(26.4px,0,0)'); pointer('pointerup', 220, 250, 100); await complete(); expect(path).toBe('/app');
    await mount(false, false, '/app/profile'); pointer('pointerdown', 280); pointer('pointermove', 160, 250, 80); expect(page.style.transform).toBe('translate3d(-26.4px,0,0)'); pointer('pointerup', 160, 250, 100); await complete(); expect(path).toBe('/app/profile');
  });
  it('auto 본문 padding에서는 수평 잠금 후 native pan만 막고 세로·레일·핀치는 유지한다', async () => {
    await mount();
    const touchMove = (count = 1) => {
      const event = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: Array.from({ length: count }, () => ({ clientX: 160, clientY: 250 })) });
      root.dispatchEvent(event); return event.defaultPrevented;
    };
    expect(touchMove()).toBe(false);
    pointer('pointerdown', 280); pointer('pointermove', 160, 250, 80);
    expect(touchMove()).toBe(true);
    expect(touchMove(2)).toBe(false);
    pointer('pointercancel', 160);
    pointer('pointerdown', 280); pointer('pointermove', 275, 300, 80);
    expect(touchMove()).toBe(false);
    page.querySelector('#start')!.setAttribute('data-no-swipe', '');
    pointer('pointerdown', 280); pointer('pointermove', 160, 250, 80);
    expect(touchMove()).toBe(false);
  });
  it('500ms 이상 길게 누른 뒤에는 가로 이동을 시작하지 않는다', async () => {
    await mount(); pointer('pointerdown', 280); pointer('pointermove', 160, 250, 501); pointer('pointerup', 160, 250, 550); await complete(); expect(path).toBe('/app/classes');
  });
  it('움직임 줄이기는 transform 없이 즉시 이동한다', async () => {
    await mount(); reduced = true; pointer('pointerdown', 280); pointer('pointermove', 160, 250, 80); expect(page.style.transform).toBe('');
    await act(async () => { pointer('pointerup', 160, 250, 100); }); expect(path).toBe('/app/chat');
  });
});
