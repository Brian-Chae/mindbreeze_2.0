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
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(window, { matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }) });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const mount = async (p: HostPrepContainerProps): Promise<void> => { await act(async () => root.render(createElement(HostPrepContainer, p))); };
const btn = (t: string): HTMLButtonElement | undefined => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
const click = async (el: Element | null | undefined): Promise<void> => { await act(async () => { (el as HTMLElement).click(); }); };
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

  it('세팅: 마이크가 꺼져 있으면 경고 시트가 먼저 뜨고, 꺼진 채로 열면 micOn=false 로 확정한다', async () => {
    const onOpen = vi.fn();
    await mount(props({ phase: 'setup', onOpen, media: { mic: 'off', cam: 'on', level: 0, steps: 0, quiet: false, speakerPlaying: false } }));
    await click(btn('클래스 열기'));
    expect(onOpen).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    const manual = [...container.querySelectorAll('button')].find((b) => /꺼진 채로|수동/.test(b.textContent ?? ''));
    await click(manual);
    expect(onOpen).toHaveBeenCalledWith({ cameraOn: true, micOn: false });
  });

  it('로비: 초대 N·대기실 M, 입장 코드는 초대 시트에서 4자리로만 보인다', async () => {
    await mount(props());
    expect(container.textContent).toContain('초대 2명 · 대기실 1명');
    expect(container.textContent).not.toContain('4829');
    await click(btn('다시 알림'));
    expect(dialog()).toContain('입장 코드 4829');
  });

  it('시작: 녹음 체크 + 마이크 켜짐 → record, 체크 해제 → manual 을 선언해 넘긴다. 시작은 시트 확인 뒤에만', async () => {
    const onStart = vi.fn();
    await mount(props({ onStart }));
    await click(btn('시작하기'));
    expect(onStart).not.toHaveBeenCalled();
    expect(dialog()).toContain('시작 전에 확인해요');
    await click([...container.querySelectorAll('[role="dialog"] button')].find((b) => /시작하기/.test(b.textContent ?? '')));
    expect(onStart).toHaveBeenLastCalledWith('record');
    await click(container.querySelector('[role="checkbox"]'));
    await click([...container.querySelectorAll('[role="dialog"] button')].find((b) => /시작하기/.test(b.textContent ?? '')));
    expect(onStart).toHaveBeenLastCalledWith('manual');
  });

  it('시작: 마이크가 꺼져 있으면 체크 상태와 무관하게 manual', async () => {
    const onStart = vi.fn();
    await mount(props({ onStart, media: { mic: 'off', cam: 'on', level: 0, steps: 0, quiet: false, speakerPlaying: false } }));
    await click(btn('시작하기'));
    await click([...container.querySelectorAll('[role="dialog"] button')].find((b) => /시작하기/.test(b.textContent ?? '')));
    expect(onStart).toHaveBeenCalledWith('manual');
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
