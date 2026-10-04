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
vi.mock('../src/components/class/waiting-room-reminder', () => ({ WaitingRoomReminder: () => null }));
vi.mock('../src/components/class/WaitingRoomBandCheck', async () => {
  const { createElement } = await import('react');
  return {
    WaitingRoomBandCheck: ({ onCompleted }: { onCompleted?: () => void }) =>
      createElement('button', { type: 'button', onClick: () => onCompleted?.() }, '밴드 완료'),
  };
});
vi.mock('../src/components/class/PreCheckinPanel', async () => {
  const { createElement } = await import('react');
  return {
    PreCheckinPanel: ({ onSkipped }: { onSkipped?: () => void }) =>
      createElement('button', { type: 'button', onClick: () => onSkipped?.() }, '설문 건너뛰기'),
  };
});
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

/** 3단계 준비를 건너뛰기로 완료하고, 대기 화면 → [준비 다시 확인] 복귀까지 수행한다 */
async function completePreparationAndRecheck(): Promise<void> {
  await click(button('설문 건너뛰기'));
  await click(button('밴드 완료'));
  await click(button('기기 테스트 건너뛰기'));
  await click(button('준비 다시 확인하기'));
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
  const READY = { surveyDone: true, bandDone: true, deviceDone: true };

  it('이름과 3단계 준비를 모두 마치면 입장할 수 있다', () => {
    expect(resolveWaitingRoomGate({ nickname: '민지', readiness: READY })).toEqual({
      canEnter: true,
      missing: [],
    });
  });

  it('이름이 비면 이름 확인과 함께 막는다', () => {
    expect(resolveWaitingRoomGate({ nickname: '   ' })).toEqual({
      canEnter: false,
      missing: ['이름 확인', '설문', '링크밴드', '기기 테스트'],
    });
  });

  it('3단계 준비 중 하나라도 남아 있으면 해당 사유와 함께 막는다', () => {
    const gate = resolveWaitingRoomGate({
      nickname: '민지',
      readiness: { surveyDone: true, bandDone: false, deviceDone: false },
    });
    expect(gate.canEnter).toBe(false);
    expect(gate.missing).toEqual(['링크밴드', '기기 테스트']);
  });
});

// ── 컴포넌트: 게스트 ────────────────────────────────────────────────

it('게스트는 이름이 비면 입장할 수 없고 사유가 표시된다', async () => {
  const props = baseProps({ initialNickname: '' });
  await render(createElement(ClassWaitingRoom, props));
  expect(button('입장하기')?.disabled).toBe(true);
  expect(container.textContent).toContain('이름 확인');
  expect(container.textContent).toContain('아직 확인하지 않은 항목이 있어요');
  expect(container.textContent).toContain('잠시 후 시작합니다');
  // 설문·밴드 단계도 노출된다(게이트를 모두 통과해야 입장 가능)
  expect(container.textContent).toContain('설문 건너뛰기');
  expect(container.textContent).toContain('밴드 완료');
});

it('게스트가 이름을 입력해도 3단계 준비를 마치기 전에는 입장할 수 없다', async () => {
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

  // 이름을 입력해도 3단계 준비 전에는 여전히 비활성
  expect(button('입장하기')?.disabled).toBe(true);

  await completePreparationAndRecheck();
  expect(button('입장하기')?.disabled).toBe(false);
  await click(button('입장하기'));
  expect(props.onEnter).toHaveBeenCalledTimes(1);
  expect(props.onEnter).toHaveBeenCalledWith({ nickname: '지우', cameraOn: false, micOn: false });
  // 확정한 닉네임은 유지된다(새로고침 대비)
  expect(readStoredNickname()).toBe('지우');
});

it('회원은 프로필 이름이 고정되어 이름 입력 없이 3단계 완료 후 입장할 수 있다', async () => {
  const props = baseProps({ memberName: '채용욱', initialNickname: '' });
  await render(createElement(ClassWaitingRoom, props));

  expect(container.querySelector('#waiting-room-nickname')).toBeNull();
  expect(container.textContent).toContain('채용욱');
  // 이름은 고정이지만 3단계 준비를 마치기 전에는 입장할 수 없다
  expect(button('입장하기')?.disabled).toBe(true);

  await completePreparationAndRecheck();
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

    await completePreparationAndRecheck();
    await click(button('입장하기'));
    expect(props.onEnter).toHaveBeenCalledWith({
      nickname: '채용욱',
      cameraOn: false,
      micOn: true,
    });
    // 세션이 시작되기 전에는 같은 대기실의 미리보기를 유지한다.
    expect(track.stop).not.toHaveBeenCalled();
    await render(createElement(ClassWaitingRoom, { ...props, sessionLive: true }));
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

    await completePreparationAndRecheck();
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

    await completePreparationAndRecheck();
    await click(button('카메라 켜기'));
    await flushPreview();
    expect(container.querySelector('video')?.srcObject).toBe(stream);
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
    // 스피커 테스트를 하지 않아도 되지만, 입장은 3단계 준비를 마쳐야 가능하다
    expect(button('입장하기')?.disabled).toBe(true);
    await completePreparationAndRecheck();
    expect(button('입장하기')?.disabled).toBe(false);
    expect(container.textContent).toContain('스피커');
  } finally {
    (window as unknown as { AudioContext?: unknown }).AudioContext = original;
  }
});

it('세 준비 탭을 표시하고 기기 건너뛰기를 완료로 전달한다', async () => {
  await render(createElement(ClassWaitingRoom, baseProps()));
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3);
  await click([...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')][2]);
  await click(button('기기 테스트 건너뛰기'));
  expect(container.textContent).toContain('1/3 완료');
  expect(vi.mocked(useWaitingRoomPresence).mock.lastCall?.[0]).toMatchObject({
    readiness: { surveyDone: false, bandDone: false, deviceDone: true },
  });
});

it('상담사가 시작하면 3단계를 마친 회원을 자동 입장시킨다', async () => {
  const props = baseProps();
  await render(createElement(ClassWaitingRoom, props));
  expect(props.onEnter).not.toHaveBeenCalled();

  await click(button('설문 건너뛰기'));
  await click(button('밴드 완료'));
  await click(button('기기 테스트 건너뛰기'));
  // 3단계 완료 → 대기 화면으로 전환된다
  expect(button('준비 다시 확인하기')).toBeDefined();

  await render(createElement(ClassWaitingRoom, { ...props, sessionLive: true }));
  expect(props.onEnter).toHaveBeenCalledWith(expect.objectContaining({ nickname: '김민지' }));
});

it('언마운트 후 늦게 허용된 마이크 트랙을 즉시 중지한다', async () => {
  let resolveStream: (stream: MediaStream) => void = () => {};
  const stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn(() => new Promise<MediaStream>((resolve) => { resolveStream = resolve; })),
  }});
  await render(createElement(ClassWaitingRoom, baseProps()));
  await flushPreview();
  await render(null);
  await act(async () => resolveStream({ getTracks: () => [{ stop }] } as unknown as MediaStream));
  expect(stop).toHaveBeenCalledTimes(1);
});
