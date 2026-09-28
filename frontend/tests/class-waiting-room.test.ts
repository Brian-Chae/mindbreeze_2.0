// @vitest-environment jsdom
// 개선 3: 입장 전 대기실 — 닉네임 확정 · 기기(카메라·마이크) 확인 · 스피커 테스트 ·
//         셀프체크 체크리스트 · 입장 게이트 · LINK BAND 는 선택(opt-in)
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassWaitingRoom } from '../src/components/class/ClassWaitingRoom';
import { useAuthStore } from '../src/stores/authStore';
import {
  areDevicesResolved,
  clearStoredNickname,
  isNicknameValid,
  normalizeNickname,
  readStoredNickname,
  resolveWaitingRoomGate,
  storeNickname,
  WAITING_ROOM_CHECKLIST,
  WAITING_ROOM_NICKNAME_KEY,
  type WaitingRoomCheckState,
} from '../src/lib/class/class-waiting-room';

/** LiveKit/BLE 를 끌어오지 않도록 밴드 카드와 소켓은 대체한다(대기실 게이트와 무관). */
vi.mock('../src/components/class/WaitingRoomBandCheck', () => ({
  WaitingRoomBandCheck: () => 'BAND_CHECK',
}));

const socket = vi.hoisted(() => {
  const fake = {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    once: vi.fn(),
  };
  return {
    fake,
    getSessionLiveSocket: vi.fn(() => fake),
    joinSessionLive: vi.fn(),
    emitWaitingRoomPresence: vi.fn(() => true),
  };
});

vi.mock('../src/lib/socket', () => ({
  getSessionLiveSocket: socket.getSessionLiveSocket,
  joinSessionLive: socket.joinSessionLive,
  emitWaitingRoomPresence: socket.emitWaitingRoomPresence,
}));

let root: Root;
let container: HTMLDivElement;

function button(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((el) => el.textContent === text);
}

function checkboxOf(label: string): HTMLInputElement | undefined {
  return [...document.querySelectorAll('input[type="checkbox"]')].find((el) => {
    const wrap = el.closest('label');
    return wrap?.textContent?.includes(label) ?? false;
  }) as HTMLInputElement | undefined;
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

/** 미리보기 시작은 다음 태스크로 미뤄지므로 타이머·권한 프라미스를 흘려보낸다 */
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
    onEnter: vi.fn(),
    onLeave: vi.fn(),
    ...overrides,
  };
}

/** 셀프체크(조용한 공간·이어폰)를 모두 체크 */
async function checkAllSelfChecks(): Promise<void> {
  for (const item of WAITING_ROOM_CHECKLIST) {
    await click(checkboxOf(item.label));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  socket.fake.connected = true;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // jsdom 은 matchMedia 를 제공하지 않을 수 있다(배경 컴포넌트가 사용).
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

// ── 순수 로직: 입장 게이트 ───────────────────────────────────────────

describe('입장 게이트', () => {
  const allChecked: WaitingRoomCheckState = { space: true, headset: true };
  const base = {
    nickname: '민지',
    devicesChecked: true,
    speakerVerified: true,
    speakerSupported: true,
    checks: allChecked,
  };

  it('모두 확인하면 입장할 수 있다', () => {
    expect(resolveWaitingRoomGate(base)).toEqual({ canEnter: true, missing: [] });
  });

  it('이름·기기·스피커·셀프체크 미확인 항목을 사유로 알려준다', () => {
    const gate = resolveWaitingRoomGate({
      ...base,
      nickname: '  ',
      devicesChecked: false,
      speakerVerified: false,
      checks: { space: false, headset: true },
    });
    expect(gate.canEnter).toBe(false);
    expect(gate.missing).toContain('이름 확인');
    expect(gate.missing).toContain('카메라·마이크 확인');
    expect(gate.missing).toContain('스피커 테스트');
    expect(gate.missing).toEqual(expect.arrayContaining([WAITING_ROOM_CHECKLIST[0].label]));
  });

  it('스피커 미지원 브라우저는 스피커 테스트 없이도 통과한다', () => {
    const gate = resolveWaitingRoomGate({ ...base, speakerSupported: false, speakerVerified: false });
    expect(gate.canEnter).toBe(true);
  });

  it('LINK BAND 는 게이트 항목이 아니다(opt-in) — 미연결이어도 입장 가능', () => {
    // 게이트 입력에 밴드 상태가 아예 없다 = 밴드 미연결로 인한 차단이 구조적으로 불가능
    expect(resolveWaitingRoomGate(base).canEnter).toBe(true);
    expect(resolveWaitingRoomGate({ ...base, speakerSupported: false }).missing).not.toContain(
      'LINK BAND 연결',
    );
  });

  it('기기 상태가 확정(pending 아님)되면 확인 버튼을 쓸 수 있다', () => {
    expect(areDevicesResolved('pending', 'on')).toBe(false);
    expect(areDevicesResolved('denied', 'unsupported')).toBe(true);
    expect(areDevicesResolved('off', 'off')).toBe(true);
  });
});

// ── 컴포넌트: 게스트 ────────────────────────────────────────────────

it('게스트는 이름이 비면 입장할 수 없고 사유가 표시된다', async () => {
  const props = baseProps({ initialNickname: '' });
  await render(createElement(ClassWaitingRoom, props));
  expect(button('입장하기')?.disabled).toBe(true);
  expect(container.textContent).toContain('이름 확인');
  expect(container.textContent).toContain('입장 전 준비');
  // 밴드 카드는 선택 항목으로 노출되지만 게이트를 막지 않는다
  expect(container.textContent).toContain('BAND_CHECK');
});

it('게스트가 이름·기기·셀프체크를 확인하면 입장할 수 있다', async () => {
  const props = baseProps({ initialNickname: '' });
  await render(createElement(ClassWaitingRoom, props));

  // 미지원 브라우저(jsdom) → 미리보기 없이도 [기기 확인 완료] 사용 가능
  const cameraMicItem = button('기기 확인 완료');
  expect(cameraMicItem?.disabled).toBe(false);
  await click(cameraMicItem);
  await checkAllSelfChecks();

  // 이름을 아직 비웠으므로 여전히 비활성
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

it('회원은 프로필 이름이 고정되어 이름 입력 없이 진행한다', async () => {
  const props = baseProps({ memberName: '채용욱', initialNickname: '' });
  await render(createElement(ClassWaitingRoom, props));

  expect(container.querySelector('#waiting-room-nickname')).toBeNull();
  expect(container.textContent).toContain('채용욱');
  expect(button('입장하기')?.disabled).toBe(true); // 기기·셀프체크는 아직

  await click(button('기기 확인 완료'));
  await checkAllSelfChecks();
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

it('대기실에 있는 동안 상담사 화면용 입장 알림(join)을 보낸다', async () => {
  await render(createElement(ClassWaitingRoom, baseProps({ memberName: '채용욱' })));
  expect(socket.getSessionLiveSocket).toHaveBeenCalled();
  expect(socket.emitWaitingRoomPresence).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ session_id: 'session-1', action: 'join', nickname: '채용욱' }),
  );
});

// ── 컴포넌트: 기기 미리보기 ──────────────────────────────────────────

it('카메라·마이크 권한이 있으면 켜짐 상태로 확정 값에 반영한다', async () => {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });

  try {
    const props = baseProps({ memberName: '채용욱' });
    await render(createElement(ClassWaitingRoom, props));
    await flushPreview();

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="meter"]')).not.toBeNull();
    expect(container.textContent).toContain('말해보면 초록 막대가 움직입니다');

    await click(button('기기 확인 완료'));
    await checkAllSelfChecks();
    await click(button('입장하기'));

    expect(props.onEnter).toHaveBeenCalledWith({
      nickname: '채용욱',
      cameraOn: true,
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
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });

  try {
    const props = baseProps({ memberName: '채용욱' });
    await render(createElement(ClassWaitingRoom, props));
    await flushPreview();

    await click(container.querySelector<HTMLButtonElement>('[aria-label="마이크 끄기"]') ?? undefined);
    await click(button('기기 확인 완료'));
    await checkAllSelfChecks();
    await click(button('입장하기'));

    expect(props.onEnter).toHaveBeenCalledWith({
      nickname: '채용욱',
      cameraOn: true,
      micOn: false,
    });
  } finally {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  }
});

// ── 컴포넌트: 스피커 테스트 ──────────────────────────────────────────

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

it('스피커 테스트음 재생 전에는 입장할 수 없다', async () => {
  const original = (window as unknown as { AudioContext?: unknown }).AudioContext;
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  try {
    await render(createElement(ClassWaitingRoom, baseProps({ memberName: '채용욱' })));
    await click(button('기기 확인 완료'));
    await checkAllSelfChecks();

    expect(button('테스트음 재생')).toBeDefined();
    expect(button('입장하기')?.disabled).toBe(true);
    expect(container.textContent).toContain('스피커 테스트');

    await click(button('테스트음 재생'));
    expect(container.textContent).toContain('재생 완료');
    expect(button('입장하기')?.disabled).toBe(false);
  } finally {
    (window as unknown as { AudioContext?: unknown }).AudioContext = original;
  }
});
