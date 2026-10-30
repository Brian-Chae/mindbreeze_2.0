// @vitest-environment jsdom
// 아이패드 코치 화면 — 셀프뷰의 마이크 아이콘을 눌러도 음소거가 안 되던 문제 회귀 테스트
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostSelfView } from '../src/components/class/player/host/HostHeadSlot';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function mount(mic: 'on' | 'off' | 'denied', onPress: () => void, onToggleMic?: () => void): Promise<void> {
  await act(async () => {
    root.render(<HostSelfView cam="on" mic={mic} big={false} stream={null} netBad={false} onPress={onPress} onToggleMic={onToggleMic} />);
  });
}
const micIcon = (): HTMLElement => container.querySelector('.hp-selfview__mic') as HTMLElement;

describe('셀프뷰 마이크 아이콘', () => {
  it('마이크 아이콘 탭 = 음소거 토글만 호출하고 크기 전환은 일어나지 않는다', async () => {
    const press = vi.fn(); const toggle = vi.fn();
    await mount('on', press, toggle);
    await act(async () => { micIcon().querySelector('svg')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(press).not.toHaveBeenCalled();
  });
  it('꺼짐 상태에서도 토글(켜기)이 호출된다', async () => {
    const toggle = vi.fn();
    await mount('off', vi.fn(), toggle);
    await act(async () => { micIcon().click(); });
    expect(toggle).toHaveBeenCalledTimes(1);
  });
  it('아이콘 밖 영역 탭 = 기존대로 크기 전환', async () => {
    const press = vi.fn(); const toggle = vi.fn();
    await mount('on', press, toggle);
    await act(async () => { (container.querySelector('button') as HTMLElement).click(); });
    expect(press).toHaveBeenCalledTimes(1);
    expect(toggle).not.toHaveBeenCalled();
  });
  it('권한 거부(denied)면 아이콘 탭은 토글하지 않는다', async () => {
    const press = vi.fn(); const toggle = vi.fn();
    await mount('denied', press, toggle);
    await act(async () => { micIcon().click(); });
    expect(toggle).not.toHaveBeenCalled();
    expect(press).toHaveBeenCalledTimes(1);
  });
});
