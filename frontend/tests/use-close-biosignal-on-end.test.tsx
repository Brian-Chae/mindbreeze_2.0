// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloseBiosignalOnEnd } from '../src/hooks/useCloseBiosignalOnEnd';

let root: Root;
const close = vi.fn(async () => null);
function Probe({ ended }: { ended: boolean }) { useCloseBiosignalOnEnd(ended, close); return null; }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); close.mockClear(); root = createRoot(document.createElement('div')); });
afterEach(() => { act(() => root.unmount()); });

describe('회차 종료 시 biosignal close', () => {
  it('종료 전에는 호출하지 않고, 종료 phase 에서 한 번만 session_ended 로 호출한다', () => {
    act(() => root.render(<Probe ended={false} />));
    expect(close).not.toHaveBeenCalled();
    act(() => root.render(<Probe ended />));
    act(() => root.render(<Probe ended />));
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith('session_ended');
  });
  it('close 가 실패해도 예외를 밖으로 던지지 않는다', () => {
    close.mockRejectedValueOnce(new Error('boom'));
    expect(() => act(() => root.render(<Probe ended />))).not.toThrow();
  });
});
