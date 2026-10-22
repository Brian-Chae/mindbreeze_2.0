// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostSignalToast } from '../src/components/class/player/host/HostSignalToast';
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.innerHTML = ''; });
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
});
