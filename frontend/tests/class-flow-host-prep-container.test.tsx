// @vitest-environment jsdom
// SDD-209 H9 — HostPrepContainer: phase 별 화면, 열기 경고 도달, 시작 녹음 선언, 닫기 재확인, 종료 화면, 입장 코드 4자리
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostPrepContainer, type HostPrepContainerProps } from '../src/components/class/flow/host/HostPrepContainer';
import { ENDING_FIXTURES } from '../src/lib/class/flow/host-ending-fixtures';

function props(patch: Partial<HostPrepContainerProps> = {}): HostPrepContainerProps {
  const noop = (): void => undefined;
  return {
    phase: 'lobby', title: '마음챙김 명상 · 4회차', startText: '오늘 오후 3:00', address: null,
    ctx: { place: 'online', size: 'group', band: 'optional' }, accessCode: '4829',
    media: { mic: 'on', cam: 'on', level: 0.4, steps: 2, quiet: false, speakerPlaying: false },
    onOpen: noop, onToggleMic: noop, onToggleCamera: noop, onRecheck: noop, onPlayTone: noop,
    roster: [{ participantId: 'p1', name: '서연' }, { participantId: 'p2', name: '민준' }],
    presence: [{ participantId: 'p1', nickname: '서연', readiness: { surveyDone: true, bandDone: true, deviceDone: true } }],
    remindResults: new Map(), excluded: 0, research: 0, retentionDays: 90,
    onRemind: noop, onInviteAdd: noop, onCopyCode: noop,
    sheets: {
      bgm: { tracks: [], selectedId: null, playing: false, progress: 0, timeText: '00:00 / 00:00', volume: 0.5, onSelect: noop, onTogglePlay: noop, onVolume: noop },
      band: { connected: false, leadOff: null, onConnect: noop, onDisconnect: noop },
      speak: { raised: [], speaking: [], onAllow: noop, onStop: noop },
      chat: { enabled: true, messages: [], onToggle: noop, onSend: noop },
    },
    onStart: noop, onLeave: noop, onCloseClass: noop,
    ending: ENDING_FIXTURES['end-ai'], headcount: 8, onEnd: noop, onContinue: noop, onOpenRecord: noop,
    onStateAction: noop,
    ...patch,
  };
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(window, { matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }) });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
const mount = async (p: HostPrepContainerProps): Promise<void> => { await act(async () => root.render(createElement(HostPrepContainer, p))); };
const btn = (t: string): HTMLButtonElement | undefined => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
const click = async (el: Element | null | undefined): Promise<void> => { expect(el, '클릭할 행동이 표시되어야 함').toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); };
const dialog = (): string => container.querySelector('[role="dialog"]')?.textContent ?? '';

describe('HostPrepContainer', () => {
  it('세팅: 마이크 켜짐이면 바로 열고, 오프라인은 카메라 없음을 명시한다', async () => {
    const onOpen = vi.fn();
    await mount(props({ phase: 'setup', onOpen }));
    await click(btn('클래스 열기'));
    expect(onOpen).toHaveBeenCalledWith({ cameraOn: true, micOn: true });
    onOpen.mockClear();
    await mount(props({ phase: 'setup', onOpen, ctx: { place: 'offline', size: 'group', band: 'optional' } }));
    await click(btn('클래스 열기'));
    expect(onOpen).toHaveBeenCalledWith({ cameraOn: false, micOn: true });
  });

  it('세팅: 마이크 꺼짐 안내를 인라인으로 읽고 한 번에 음성 없이 연다', async () => {
    const onOpen = vi.fn();
    await mount(props({ phase: 'setup', onOpen, media: { mic: 'off', cam: 'on', level: 0, steps: 0, quiet: false, speakerPlaying: false } }));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await click(btn('음성 없이 클래스 열기'));
    expect(onOpen).toHaveBeenCalledWith({ cameraOn: true, micOn: false });
  });

  it('로비: 코드가 상시 보이고 첫 화면에서 회원 초대에 접근한다', async () => {
    await mount(props());
    expect(container.textContent).toContain('4829');
    await click(btn('회원 초대'));
    expect(dialog()).toContain('기존 회원');
  });

  it('시작: 요청 전 2초 동안 취소하면 서버 시작 0회, 다시 시작 연타는 1회', async () => {
    const onStart = vi.fn();
    await mount(props({ onStart }));
    await click(btn('클래스 시작'));
    expect(onStart).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1999); });
    await click(btn('취소'));
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(onStart).not.toHaveBeenCalled();
    await click(btn('클래스 시작'));
    await click(btn('시작 준비 중'));
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith('record');
  });

  it('시작: 녹음 선택 해제와 마이크 꺼짐은 manual, 고지는 항상 보인다', async () => {
    const onStart = vi.fn();
    await mount(props({ onStart }));
    await click(container.querySelector('input[type="checkbox"]'));
    expect(container.textContent).toContain('90일');
    expect(container.textContent).toContain('영상 녹화');
    await click(btn('클래스 시작'));
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(onStart).toHaveBeenLastCalledWith('manual');
  });

  it('대기 중 이탈은 시작 타이머를 취소하고 익명 조회 실패는 미확인이다', async () => {
    const onStart = vi.fn();
    await mount(props({ onStart, excluded: null, research: null }));
    expect(container.textContent).toContain('미확인');
    await click(btn('클래스 시작'));
    await mount(props({ phase: 'closed', onStart }));
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(onStart).not.toHaveBeenCalled();
  });

  it('시작 거절은 화면에 표시하고 재시도할 수 있다', async () => {
    const onStart = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
    await mount(props({ onStart }));
    await click(btn('클래스 시작'));
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(container.textContent).toContain('다시 시도');
    await click(btn('클래스 시작'));
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it('나가기 시트를 여는 즉시 타이머를 취소하고 phase 재진입도 시작 가능하다', async () => {
    const onStart = vi.fn();
    await mount(props({ onStart }));
    await click(btn('클래스 시작'));
    await click(container.querySelector('[data-pz="flow-back"]'));
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(onStart).not.toHaveBeenCalled();
    await mount(props({ phase: 'closed', onStart }));
    await mount(props({ onStart }));
    expect(btn('클래스 시작')?.disabled).toBe(false);
  });

  it('시작 대기 중 코드 확대를 열면 취소 행동이 가려지기 전에 타이머를 취소한다', async () => {
    const onStart = vi.fn();
    await mount(props({ onStart }));
    await click(btn('클래스 시작'));
    await click(btn('크게 보기'));
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(onStart).not.toHaveBeenCalled();
  });

  it('뒤로 → 클래스 닫기는 재확인을 거친 뒤에만 closeClass 를 부른다', async () => {
    const onCloseClass = vi.fn();
    await mount(props({ onCloseClass }));
    await click(container.querySelector('[data-pz="flow-back"]'));
    expect(dialog()).toContain('나갈까요?');
    await click(container.querySelector('button.fhb-opt.danger'));
    expect(onCloseClass).not.toHaveBeenCalled();
    expect(dialog()).toContain('클래스를 정말 닫을까요?');
    await click([...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === '클래스 닫기'));
    expect(onCloseClass).toHaveBeenCalledTimes(1);
  });

  it('나가기는 클래스를 닫지 않는다', async () => {
    const onLeave = vi.fn();
    const onCloseClass = vi.fn();
    await mount(props({ onLeave, onCloseClass }));
    await click(container.querySelector('[data-pz="flow-back"]'));
    await click(container.querySelector('button.fhb-opt:not(.danger)'));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onCloseClass).not.toHaveBeenCalled();
  });

  it('종료 확인 → 끝내기, 종료 씬은 같은 화면에서 진행 단계를 보이고 기록 보기로만 이동한다', async () => {
    const onEnd = vi.fn();
    const onOpenRecord = vi.fn();
    await mount(props({ phase: 'ending-confirm', onEnd }));
    await click(btn('클래스 끝내기'));
    expect(onEnd).toHaveBeenCalledTimes(1);
    await mount(props({ phase: 'ending', onOpenRecord }));
    expect(container.textContent).toContain('클래스가 끝났어요');
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(4);
    expect(onOpenRecord).not.toHaveBeenCalled();
    await click(btn('기록 보기'));
    expect(onOpenRecord).toHaveBeenCalledTimes(1);
  });

  it('닫힘·오류 phase 는 FH10 화면, 버튼은 action 으로 전달', async () => {
    const onStateAction = vi.fn();
    await mount(props({ phase: 'error', stateKind: 'error-forbidden', onStateAction }));
    expect(container.textContent).toContain('내가 연 클래스가 아니에요');
    await click(btn('내 클래스 보기'));
    expect(onStateAction).toHaveBeenCalledWith('list');
  });
});
