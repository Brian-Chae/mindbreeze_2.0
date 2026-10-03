// @vitest-environment jsdom
// 개선 3 재설계: 입장 전 대기실 — 참여 이름(필수) · 입장 전 체크인(선택·스킵 가능) ·
//         마이크 자동 확인(문제 시에만 안내, 비차단) · 카메라/스피커 선택 · LINK BAND opt-in.
// 입장 게이트는 이름 확인만 남고, 기기·체크인은 입장을 막지 않는다.
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassWaitingRoom } from '../src/components/class/ClassWaitingRoom';
import { useAuthStore } from '../src/stores/authStore';
import { useWaitingRoomPresence } from '../src/hooks/useWaitingRoomPresence';
import {
  clearStoredNickname,
  isNicknameValid,
  normalizeNickname,
  readStoredNickname,
  resolveWaitingRoomGate,
  storeNickname,
  WAITING_ROOM_NICKNAME_KEY,
} from '../src/lib/class/class-waiting-room';

// 대기실 게이트와 무관한 외부 의존성(밴드·체크인·BGM·소켓)은 mock 으로 대체한다.
vi.mock('../src/components/class/WaitingRoomBandCheck', () => ({
  WaitingRoomBandCheck: () => 'BAND_CHECK',
}));
vi.mock('../src/components/class/PreCheckinPanel', () => ({
  PreCheckinPanel: () => 'CHECKIN',
}));
vi.mock('../src/components/class/LobbyBgmBar', () => ({
  LobbyBgmBar: () => 'BGM_BAR',
}));
vi.mock('../src/hooks/useLobbyBgm', () => ({
  useLobbyBgm: () => ({
    state: { track: null, volume: 0.5, blocked: false, muted: false },
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    resume: vi.fn(),
  }),
}));
vi.mock('../src/hooks/useWaitingRoomPresence', () => ({
  useWaitingRoomPresence: vi.fn(),
}));

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

/** 마이크 자동 확인은 다음 태스크로 미뤄지므로 타이머·권한 프라미스를 흘려보낸다 */
async function flushPreview(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {});
}

function baseProps(overrides: Partial<Parameters<typeof ClassWaitingRoom>[0]> = {}) {
  return {
    title: '저녁 명상 클래스',
    classCode: 'A1B2C3',
    statusLabel: '입장 가능',
    sessionId: 'session-1',
    participantId: 'participant-1',
    memberName: null,
    initialNickname: '김민지',
    participantToken: null,
    isLoggedIn: false,
    onEnter: vi.fn(),
    onLeave: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  if (!window.matchMedia) {
    Object.assign(window, {
      matchMedia: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
  }
  sessionStorage.clear();
  useAuthStore.setState({ isAuthenticated: false, accessToken: null, user: null });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  sessionStorage.clear();
});

// ── 순수 로직: 닉네임 ────────────────────────────────────────────────

describe('닉네임 정리', () => {
  it('공백을 정리하고 20자로 제한한다', () => {
    expect(normalizeNickname('  김   민지  ')).toBe('김 민지');
    expect(normalizeNickname('가'.repeat(40))).toHaveLength(20);
    expect(normalizeNickname('   ')).toBe('');
    expect(isNicknameValid('   ')).toBe(false);
    expect(isNicknameValid('민지')).toBe(true);
  });

  it('확정 닉네임을 sessionStorage 에 저장·복원·삭제한다', () => {
    storeNickname('  지우  ');
    expect(sessionStorage.getItem(WAITING_ROOM_NICKNAME_KEY)).toBe('지우');
    expect(readStoredNickname()).toBe('지우');
    clearStoredNickname();
    expect(readStoredNickname()).toBeNull();
  });
});

// ── 순수 로직: 입장 게이트 (이름만 필수) ────────────────────────────

describe('입장 게이트', () => {
  it('이름이 있으면 입장할 수 있다', () => {
    expect(resolveWaitingRoomGate({ nickname: '민지' })).toEqual({
      canEnter: true,
      missing: [],
    });
  });

  it('이름이 비면 사유와 함께 막는다', () => {
    expect(resolveWaitingRoomGate({ nickname: '   ' })).toEqual({
      canEnter: false,
      missing: ['이름 확인'],
    });
  });

  it('기기·체크인·LINK BAND 는 게이트 항목이 아니다 — 이름만 필수', () => {
    // 게이트 입력에 이름 외 필드가 아예 없다 = 기기/체크인으로 인한 차단이 구조적으로 불가능
    const gate = resolveWaitingRoomGate({ nickname: '민지' });
    expect(gate.canEnter).toBe(true);
    expect(gate.missing).not.toContain('카메라·마이크 확인');
    expect(gate.missing).not.toContain('스피커 테스트');
    expect(gate.missing).not.toContain('LINK BAND 연결');
  });
});

// ── 컴포넌트: 게스트 ────────────────────────────────────────────────

it('게스트는 이름이 비면 입장할 수 없고 사유가 표시된다', async () => {
  const props = baseProps({ initialNickname: '' });
  await render(createElement(ClassWaitingRoom, props));
  expect(button('입장하기')?.disabled).toBe(true);
  expect(container.textContent).toContain('이름 확인');
  expect(container.textContent).toContain('입장 전 준비');
  // 체크인·밴드는 선택 항목으로 노출되지만 게이트를 막지 않는다
  expect(container.textContent).toContain('CHECKIN');
  expect(container.textContent).toContain('BAND_CHECK');
});

it('게스트가 이름을 입력하면 입장할 수 있다', async () => {
  const props = baseProps({ initialNickname: '' });
  await render(createElement(ClassWaitingRoom, props));

  // 이름을 아직 비웠으므로 비활성
  expect(button('입장하기')?.disabled).toBe(true);

  const input = container.querySelector<HTMLInputElement>('#waiting-room-nickname');
  await act(async () => {
    // React 의 onChange 를 직접 트리거한다
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, '지우');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });

  expect(button('입장하기')?.disabled).toBe(false);
  await click(button('입장하기'));
  expect(props.onEnter).toHaveBeenCalledTimes(1);
  expect(props.onEnter).toHaveBeenCalledWith({ nickname: '지우', cameraOn: false, micOn: false });
  // 확정한 닉네임은 유지된다(새로고침 대비)
  expect(readStoredNickname()).toBe('지우');
});

it('회원은 프로필 이름이 고정되어 이름 입력 없이 바로 입장할 수 있다', async () => {
  const props = baseProps({ memberName: '채용욱', initialNickname: '' });
  await render(createElement(ClassWaitingRoom, props));

  expect(container.querySelector('#waiting-room-nickname')).toBeNull();
  expect(container.textContent).toContain('채용욱');
  // 이름만 게이트 → 기기·체크인 없이도 즉시 입장 가능
  expect(button('입장하기')?.disabled).toBe(false);

  await click(button('입장하기'));
  expect(props.onEnter).toHaveBeenCalledWith({
    nickname: '채용욱',
    cameraOn: false,
    micOn: false,
  });
});

it('나가기를 누르면 onLeave 를 호출한다', async () => {
  const props = baseProps();
  await render(createElement(ClassWaitingRoom, props));
  await click(button('나가기'));
  expect(props.onLeave).toHaveBeenCalledTimes(1);
});

it('대기실에 머무는 동안 참여 알림 훅을 호출한다', async () => {
  await render(createElement(ClassWaitingRoom, baseProps({ memberName: '채용욱' })));
  expect(useWaitingRoomPresence).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: 'session-1',
      participantId: 'participant-1',
      nickname: '채용욱',
    }),
  );
});

// ── 컴포넌트: 마이크 자동 확인 · 카메라 선택 ─────────────────────────

function mockMediaDevices(stream: MediaStream): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
}

it('마이크는 자동 확인되고 켜지면 확정 값에 반영한다(카메라는 자동 요청 안 함)', async () => {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  mockMediaDevices(stream);

  try {
    const props = baseProps({ memberName: '채용욱' });
    await render(createElement(ClassWaitingRoom, props));
    await flushPreview();

    // 마이크만 자동 확인(1회) — 카메라는 선택이라 마운트 시 요청하지 않는다
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(container.querySelector('[role="meter"]')).not.toBeNull();
    expect(container.textContent).toContain('말해보면 초록 막대가 움직입니다');

    await click(button('입장하기'));
    expect(props.onEnter).toHaveBeenCalledWith({
      nickname: '채용욱',
      cameraOn: false,
      micOn: true,
    });
    // 입장 시 미리보기 트랙을 즉시 중지한다(저장·전송 없음)
    expect(track.stop).toHaveBeenCalled();
  } finally {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  }
});

it('마이크를 끄면 확정 값이 micOn=false 로 전달된다', async () => {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  mockMediaDevices(stream);

  try {
    const props = baseProps({ memberName: '채용욱' });
    await render(createElement(ClassWaitingRoom, props));
    await flushPreview();

    await click(container.querySelector<HTMLButtonElement>('[aria-label="마이크 끄기"]') ?? undefined);
    await click(button('입장하기'));

    expect(props.onEnter).toHaveBeenCalledWith({
      nickname: '채용욱',
      cameraOn: false,
      micOn: false,
    });
  } finally {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  }
});

it('카메라는 선택 — 켜기를 누를 때만 켜지고 확정 값에 반영된다', async () => {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  mockMediaDevices(stream);

  try {
    const props = baseProps({ memberName: '채용욱' });
    await render(createElement(ClassWaitingRoom, props));
    await flushPreview();

    // 기본 꺼짐 + 마운트 시 카메라 요청 없음(마이크 1회만)
    expect(button('카메라 켜기')).toBeDefined();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);

    await click(button('카메라 켜기'));
    await flushPreview();
    await click(button('입장하기'));

    expect(props.onEnter).toHaveBeenCalledWith({
      nickname: '채용욱',
      cameraOn: true,
      micOn: true,
    });
  } finally {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  }
});

// ── 컴포넌트: 스피커 테스트(선택·비강제) ────────────────────────────

class FakeAudioNode {
  connect(): void {}
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = new FakeAudioNode();
  createOscillator(): FakeAudioNode & {
    type: string;
    frequency: { setValueAtTime: () => void };
    start: () => void;
    stop: () => void;
  } {
    return Object.assign(new FakeAudioNode(), {
      type: 'sine',
      frequency: { setValueAtTime: () => {} },
      start: () => {},
      stop: () => {},
    });
  }
  createGain(): FakeAudioNode & {
    gain: { setValueAtTime: () => void; exponentialRampToValueAtTime: () => void };
  } {
    return Object.assign(new FakeAudioNode(), {
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
    });
  }
  async resume(): Promise<void> {}
  async close(): Promise<void> {}
}

it('스피커 테스트는 선택 — 재생 여부와 무관하게 입장할 수 있다', async () => {
  const original = (window as unknown as { AudioContext?: unknown }).AudioContext;
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  try {
    const props = baseProps({ memberName: '채용욱' });
    await render(createElement(ClassWaitingRoom, props));

    expect(button('테스트음 듣기')).toBeDefined();
    // 스피커 테스트를 하지 않아도(이름만 게이트) 입장 가능
    expect(button('입장하기')?.disabled).toBe(false);
    expect(container.textContent).toContain('스피커');
  } finally {
    (window as unknown as { AudioContext?: unknown }).AudioContext = original;
  }
});
