// @vitest-environment jsdom
// 개선 3: 대기실 LINK BAND 카드 — 선택(opt-in) 안내 · 미지원 브라우저 안내 · 연결/해제 위임
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WaitingRoomBandCheck } from '../src/components/class/WaitingRoomBandCheck';
import { useBand } from '../src/hooks/useBand';
import { useAuthStore } from '../src/stores/authStore';

vi.mock('../src/hooks/useBand', () => ({ useBand: vi.fn() }));

const connect = vi.fn(async () => {});
const disconnect = vi.fn(async () => {});

/** 카드가 실제로 읽는 필드만 채운다(나머지는 이 화면에서 쓰지 않는다). */
function bandResult(overrides: Record<string, unknown> = {}): ReturnType<typeof useBand> {
  return {
    isSupported: true,
    isMock: false,
    connectionState: 'disconnected',
    battery: null,
    signalQuality: null,
    signalQualityLevel: 'unknown',
    deviceStatus: null,
    leadOff: null,
    lastEegAt: null,
    error: null,
    connect,
    disconnect,
    ...overrides,
  } as unknown as ReturnType<typeof useBand>;
}

let root: Root;
let container: HTMLDivElement;

function button(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((el) => el.textContent === text);
}

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

async function click(el: HTMLElement | undefined): Promise<void> {
  await act(async () => {
    el?.click();
  });
}

/** 대기실 카드는 선택 항목이라 입장 게이트를 막지 않는다 — 그 계약을 문서화한다. */
function withBluetooth(value: boolean): void {
  if (value) {
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: {} });
  } else {
    Reflect.deleteProperty(navigator, 'bluetooth');
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAuthStore.setState({ isAuthenticated: false, accessToken: null, user: null });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(navigator, 'bluetooth');
});

it('연결하지 않아도 입장할 수 있다는 선택 항목임을 안내한다', async () => {
  withBluetooth(true);
  vi.mocked(useBand).mockReturnValue(bandResult());
  await render(createElement(WaitingRoomBandCheck, { sessionId: 'session-1', participantId: 'p1' }));

  expect(container.textContent).toContain('LINK BAND 연결');
  expect(container.textContent).toContain('선택');
  expect(container.textContent).toContain('연결하지 않아도 클래스 참여와 AI 기록은 그대로');
  expect(container.textContent).toContain('연결하지 않고 건너뛰어도 됩니다');
});

it('미연결 상태에서 연결 버튼이 band.connect 로 위임된다', async () => {
  withBluetooth(true);
  vi.mocked(useBand).mockReturnValue(bandResult({ connectionState: 'disconnected' }));
  await render(createElement(WaitingRoomBandCheck, { sessionId: 'session-1', participantId: 'p1' }));

  await click(button('LINK BAND 연결'));
  expect(connect).toHaveBeenCalledTimes(1);
});

it('연결되면 배터리·접촉 상태와 연결 해제를 보여준다', async () => {
  withBluetooth(true);
  vi.mocked(useBand).mockReturnValue(
    bandResult({ connectionState: 'connected', battery: 82, deviceStatus: 'ok' }),
  );
  await render(createElement(WaitingRoomBandCheck, { sessionId: 'session-1', participantId: 'p1' }));

  expect(container.textContent).toContain('연결됨');
  expect(container.textContent).toContain('배터리 82%');
  await click(button('연결 해제'));
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it('Web Bluetooth 미지원 브라우저에는 밴드 없이 진행할 수 있다고 안내한다', async () => {
  withBluetooth(false);
  vi.mocked(useBand).mockReturnValue(bandResult({ isSupported: false, connectionState: 'unsupported' }));
  await render(createElement(WaitingRoomBandCheck, { sessionId: 'session-1', participantId: 'p1' }));

  expect(container.textContent).toContain('Web Bluetooth를 지원하지 않습니다');
  expect(container.textContent).toContain('밴드 없이 진행할 수 있어요');
  expect(button('LINK BAND 연결')).toBeUndefined();
});
