// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostSignalToast } from '../src/components/class/player/host/HostSignalToast';
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.innerHTML = ''; vi.useRealTimers(); });
describe('무음 신호 토스트 접근과 조치', () => {
  it('polite 한 장을 표시하고 탭은 시트만 열며 소리·진동을 호출하지 않는다', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const onOpen = vi.fn(); const onDismiss = vi.fn();
    const vibrate = vi.fn(); Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    const node = document.createElement('div'); document.body.append(node); const root = createRoot(node); roots.push(root);
    await act(async () => root.render(<HostSignalToast toast={{ topic: 'signals', message: '조용한 신호 · 조금 어려워요 2', durationMs: 6000 }} onOpen={onOpen} onDismiss={onDismiss} />));
    expect(node.querySelectorAll('[role=status]')).toHaveLength(1);
    expect(node.querySelector('[role=status]')?.getAttribute('aria-live')).toBe('polite');
    await act(async () => node.querySelector('button')?.click());
    expect(onOpen).toHaveBeenCalledWith('signals'); expect(vibrate).not.toHaveBeenCalled();
    await act(async () => node.querySelectorAll('button')[1].click()); expect(onDismiss).toHaveBeenCalledOnce();
  });
  it('주제별 행만 닫고 hover와 focus가 모두 해제될 때 타이머를 재개한다', async () => {
    const onDismiss = vi.fn(); const onPause = vi.fn(); const onResume = vi.fn();
    const node = document.createElement('div'); document.body.append(node); const root = createRoot(node); roots.push(root);
    const toast = { topic: 'hands' as const, message: '지은님이 손을 들었어요', durationMs: 6000, rows: [
      { topic: 'hands' as const, message: '지은님이 손을 들었어요', detail: '현재 대기 1명 · 발언권 0명', durationMs: 6000 },
      { topic: 'signals' as const, message: '서연 · 잠시 쉴게요', durationMs: 6000 },
    ] };
    await act(async () => root.render(<HostSignalToast toast={toast} onOpen={vi.fn()} onDismiss={onDismiss} onPause={onPause} onResume={onResume} />));
    expect(node.querySelectorAll('button')).toHaveLength(4);
    const panel = node.firstElementChild!;
    await act(async () => { panel.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); node.querySelector('button')?.focus(); });
    expect(onPause).toHaveBeenCalledOnce();
    await act(async () => panel.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
    expect(onResume).not.toHaveBeenCalled();
    await act(async () => node.querySelector('button')?.blur()); expect(onResume).toHaveBeenCalledOnce();
    await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="신호 알림 닫기"]')?.click());
    expect(onDismiss).toHaveBeenCalledWith('signals');
  });
  it('이름과 집계는 즉시 갱신하고 aria 반복 읽기만 1초에 한 번 통합한다', async () => {
    vi.useFakeTimers(); vi.setSystemTime(10000);
    const node = document.createElement('div'); document.body.append(node); const root = createRoot(node); roots.push(root);
    const render = (message: string) => root.render(<HostSignalToast toast={{ topic: 'signals', message, durationMs: 6000 }} onOpen={vi.fn()} onDismiss={vi.fn()} />);
    await act(async () => render('서연 · 잠시 쉴게요'));
    await act(async () => { vi.advanceTimersByTime(100); render('지은 · 조금 어려워요'); });
    expect(node.querySelector('button')?.textContent).toContain('지은');
    expect(node.querySelector('[role=status]')?.textContent).toContain('서연');
    await act(async () => vi.advanceTimersByTime(900));
    expect(node.querySelector('[role=status]')?.textContent).toContain('지은');
  });

  it('시트 이동 등으로 정지 중 알림이 사라지면 재개해 다른 행을 영구 정지하지 않는다', async () => {
    const onResume = vi.fn(); const node = document.createElement('div'); document.body.append(node);
    const root = createRoot(node); roots.push(root);
    await act(async () => root.render(<HostSignalToast toast={{ topic: 'hands', message: '손들기', durationMs: 6000 }} onOpen={vi.fn()} onDismiss={vi.fn()} onPause={vi.fn()} onResume={onResume} />));
    await act(async () => node.firstElementChild?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    await act(async () => root.render(null));
    expect(onResume).toHaveBeenCalledOnce();
  });

});
