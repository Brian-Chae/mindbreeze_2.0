// @vitest-environment jsdom
// SDD-208 M2 — 회원 미디어: 마이크·카메라 토글, 손들기(M02~M04), 내 PiP 3상태, 권한 거부(M15·M17), 재마운트 대비 camWanted
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MediaDeviceFailure } from 'livekit-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveMemberCase, deriveMemberMedia, memberInput, type MemberMediaState } from '../src/lib/class/member-player-case';
import { MemberMediaRow, MemberHostPip, MemberMyPip } from '../src/components/class/player/member/MemberPips';
import { MemberMediaControls, type MemberMediaBinding } from '../src/components/class/player/member/MemberMediaControls';

/* ───────── LiveKit 모킹: 방 연결 없이 props·로컬 참가자 호출만 관찰한다 ───────── */
const lk = vi.hoisted(() => {
  const state = { isCameraEnabled: false, isMicrophoneEnabled: true, connection: 'connected' };
  return {
    roomProps: [] as Array<Record<string, unknown>>,
    // 실제 LiveKit 처럼 호출하면 로컬 참가자의 켜짐 상태가 바뀐다(다음 렌더에서 훅이 읽는다)
    local: {
      setCameraEnabled: vi.fn(async (on: boolean) => { state.isCameraEnabled = on; }),
      setMicrophoneEnabled: vi.fn(async (on: boolean) => { state.isMicrophoneEnabled = on; }),
    },
    state,
    tracks: [] as unknown[],
    rendererVolume: [] as number[],
  };
});

vi.mock('@livekit/components-react', async () => {
  const React = await import('react');
  return {
    LiveKitRoom: (props: Record<string, unknown> & { children?: ReactNode }) => {
      lk.roomProps.push({ ...props, children: undefined });
      return React.createElement('div', { 'data-testid': 'lk-room' }, props.children);
    },
    RoomAudioRenderer: ({ volume }: { volume?: number }) => {
      lk.rendererVolume.push(volume ?? 1);
      return null;
    },
    useLocalParticipant: () => ({
      localParticipant: lk.local,
      isCameraEnabled: lk.state.isCameraEnabled,
      isMicrophoneEnabled: lk.state.isMicrophoneEnabled,
    }),
    useTracks: () => lk.tracks,
    useConnectionState: () => lk.state.connection,
  };
});

let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const qa = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const buttonByText = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
const lastRoomProps = (): Record<string, unknown> => lk.roomProps[lk.roomProps.length - 1] ?? {};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  lk.roomProps.length = 0;
  lk.rendererVolume.length = 0;
  lk.tracks = [];
  lk.state.isCameraEnabled = false;
  lk.state.isMicrophoneEnabled = true;
  lk.state.connection = 'connected';
  lk.local.setCameraEnabled.mockClear();
  lk.local.setMicrophoneEnabled.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/* ───────── deriveMemberMedia — 서버 권한·본인 선택·장치 실패 → 케이스 입력 ───────── */

const base: MemberMediaState = {
  place: 'online', mode: '1on1', canPublish: true, speaking: false, raisedHand: false,
  micWanted: true, camWanted: false, micFailure: null, camFailure: null,
};
const media = (override: Partial<MemberMediaState>) => deriveMemberMedia({ ...base, ...override });

describe('deriveMemberMedia', () => {
  it('온라인 1:1 기본: 마이크 켜짐 · 카메라 꺼짐(회원 영상은 기본 비공개, 결정 #1)', () => {
    expect(media({})).toEqual({ mic: 'on', cam: 'off', hand: 'idle' });
  });
  it('회원이 카메라를 켜면 on, 끄면 off', () => {
    expect(media({ camWanted: true }).cam).toBe('on');
    expect(media({ micWanted: false }).mic).toBe('off');
  });
  it('장치 실패: 권한 거부 → denied, 장치 없음 → nodevice (켜 두려던 값보다 우선)', () => {
    expect(media({ micFailure: 'denied' }).mic).toBe('denied');
    expect(media({ camWanted: true, camFailure: 'denied' }).cam).toBe('denied');
    expect(media({ camWanted: true, camFailure: 'nodevice' }).cam).toBe('nodevice');
  });
  it('온라인 그룹: 발언권 전에는 뮤트·손들기 idle, 손들면 waiting', () => {
    expect(media({ mode: 'group', canPublish: false })).toMatchObject({ mic: 'muted', hand: 'idle' });
    expect(media({ mode: 'group', canPublish: false, raisedHand: true })).toMatchObject({ mic: 'muted', hand: 'waiting' });
  });
  it('온라인 그룹: 발언권을 받으면 마이크 on · speaking, 말하기 종료(마이크 끔) 후에는 다시 muted · idle', () => {
    expect(media({ mode: 'group', canPublish: true, speaking: true })).toMatchObject({ mic: 'on', hand: 'speaking' });
    expect(media({ mode: 'group', canPublish: true, speaking: true, micWanted: false })).toMatchObject({ mic: 'muted', hand: 'idle' });
  });
  it('발언 이벤트는 왔지만 토큰이 아직 갱신 전(speaking=true, canPublish=false)이어도 손들기 상태로 되돌아가지 않는다', () => {
    expect(media({ mode: 'group', canPublish: false, speaking: true }).hand).toBe('speaking');
  });
  it('오프라인: 마이크·카메라 UI 자체가 없다', () => {
    expect(media({ place: 'offline' })).toEqual({ mic: 'none', cam: 'none', hand: 'idle' });
  });
});

/* ───────── MemberMediaRow · PiP (순수 뷰) ───────── */

const noopActions = { onToggleMic: vi.fn(), onToggleCam: vi.fn(), onRaiseHand: vi.fn(), onEndSpeaking: vi.fn() };

describe('MemberMediaRow', () => {
  it('M01: 마이크·카메라 버튼 2개, 같은 폭 그리드(data-pz=media-row/mbtn)', async () => {
    await render(<MemberMediaRow c={deriveMemberCase(memberInput())} sheetOpen={false} actions={noopActions} />);
    expect(q('[data-pz="media-row"]')).not.toBeNull();
    expect(qa('[data-pz="mbtn"]').map((b) => b.textContent)).toEqual(['마이크 켜짐', '카메라 켜짐']);
    expect(qa('[data-pz="mbtn"]').every((b) => b.getAttribute('aria-disabled') === 'false')).toBe(true);
  });
  it('M02: 마이크 "뮤트 중"은 상태 표시(aria-disabled) · 손들기만 눌린다 · 카메라 버튼 없음', async () => {
    const actions = { ...noopActions, onToggleMic: vi.fn(), onRaiseHand: vi.fn() };
    await render(<MemberMediaRow c={deriveMemberCase(memberInput({ mode: 'group', mic: 'muted' }))} sheetOpen={false} actions={actions} />);
    const labels = qa('[data-pz="mbtn"]').map((b) => b.textContent);
    expect(labels).toEqual(['뮤트 중', '손들기']);
    expect(buttonByText('뮤트 중')?.getAttribute('aria-disabled')).toBe('true');
    await act(async () => { buttonByText('뮤트 중')?.click(); });
    expect(actions.onToggleMic).not.toHaveBeenCalled();
    await act(async () => { buttonByText('손들기')?.click(); });
    expect(actions.onRaiseHand).toHaveBeenCalledTimes(1);
  });
  it('M03: 손들기 대기는 "손 내리기" 활성 버튼 — 누르면 콜백', async () => {
    const actions = { ...noopActions, onRaiseHand: vi.fn() };
    await render(<MemberMediaRow c={deriveMemberCase(memberInput({ mode: 'group', mic: 'muted', hand: 'waiting' }))} sheetOpen={false} actions={actions} />);
    expect(buttonByText('손 내리기')?.getAttribute('aria-disabled')).not.toBe('true');
    await act(async () => { buttonByText('손 내리기')?.click(); });
    expect(actions.onRaiseHand).toHaveBeenCalledTimes(1);
  });
  it('M04: "말하는 중"(상태) + "말하기 종료"(버튼) → 종료 콜백', async () => {
    const actions = { ...noopActions, onEndSpeaking: vi.fn() };
    await render(<MemberMediaRow c={deriveMemberCase(memberInput({ mode: 'group', mic: 'on', hand: 'speaking' }))} sheetOpen={false} actions={actions} />);
    expect(buttonByText('말하는 중')?.getAttribute('aria-disabled')).toBe('true');
    await act(async () => { buttonByText('말하기 종료')?.click(); });
    expect(actions.onEndSpeaking).toHaveBeenCalledTimes(1);
  });
  it('M14·M15·M16·M17: 꺼짐은 눌러 켤 수 있고, 막힘은 눌리지 않는다', async () => {
    const actions = { ...noopActions, onToggleMic: vi.fn(), onToggleCam: vi.fn() };
    await render(<MemberMediaRow c={deriveMemberCase(memberInput({ mic: 'off', cam: 'denied' }))} sheetOpen={false} actions={actions} />);
    expect(qa('[data-pz="mbtn"]').map((b) => b.textContent)).toEqual(['마이크 꺼짐', '카메라 막힘']);
    await act(async () => { buttonByText('마이크 꺼짐')?.click(); });
    expect(actions.onToggleMic).toHaveBeenCalledTimes(1);
    await act(async () => { buttonByText('카메라 막힘')?.click(); });
    expect(actions.onToggleCam).not.toHaveBeenCalled();
  });
  it('오프라인(M05·M06)·네트워크 끊김(M19)에는 미디어 줄 DOM 이 없다', async () => {
    await render(<MemberMediaRow c={deriveMemberCase(memberInput({ place: 'offline', mic: 'none', cam: 'none' }))} sheetOpen={false} actions={noopActions} />);
    expect(q('[data-pz="media-row"]')).toBeNull();
    await render(<MemberMediaRow c={deriveMemberCase(memberInput({ net: 'down' }))} sheetOpen={false} actions={noopActions} />);
    expect(q('[data-pz="media-row"]')).toBeNull();
  });
  it('아이콘 + 라벨을 함께 가진다(R8: 색만으로 전달하지 않음)', async () => {
    await render(<MemberMediaRow c={deriveMemberCase(memberInput({ mic: 'denied' }))} sheetOpen={false} actions={noopActions} />);
    for (const b of qa('[data-pz="mbtn"]')) {
      expect(b.querySelector('svg')).not.toBeNull();
      expect(b.textContent?.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('PiP', () => {
  it('코치 PiP: 이름 칩·크게 보기 토글·재연결 중 "영상 멈춤" 표시', async () => {
    await render(<MemberHostPip name="채용욱" frozen={false} video={null} />);
    const pip = q('[data-pz="pip"]');
    expect(pip?.textContent).toContain('채용욱');
    expect(pip?.textContent).toContain('코치');
    expect(pip?.getAttribute('aria-label')).toContain('채용욱');
    expect(pip?.getAttribute('data-expanded')).toBe('false');
    await act(async () => { pip?.click(); });
    expect(q('[data-pz="pip"]')?.getAttribute('data-expanded')).toBe('true');
    expect(q('[data-pz="pip"]')?.textContent).not.toContain('영상 멈춤');
    await render(<MemberHostPip name="채용욱" frozen video={null} />);
    expect(q('[data-pz="pip"]')?.textContent).toContain('영상 멈춤');
  });
  it('이름이 없으면 "코치" 만 표시', async () => {
    await render(<MemberHostPip name={null} frozen={false} video={null} />);
    expect(q('[data-pz="pip"]')?.textContent).toContain('코치');
  });
  it('내 PiP 3상태: on=영상/아바타 · off=이니셜 + "카메라 꺼짐" 칩 · denied=안내', async () => {
    await render(<MemberMyPip cam="on" initial="수" video={null} />);
    expect(q('[data-pz="mypip"]')?.getAttribute('data-cam')).toBe('on');
    expect(q('[data-pz="mypip"]')?.textContent).toContain('나');
    await render(<MemberMyPip cam="off" initial="수" video={null} />);
    expect(q('[data-pz="mypip"]')?.textContent).toContain('수');
    expect(q('[data-pz="mypip"]')?.textContent).toContain('카메라 꺼짐');
    await render(<MemberMyPip cam="denied" initial="수" video={null} />);
    expect(q('[data-pz="mypip"]')?.textContent).toContain('카메라를 쓸 수 없어요');
    await render(<MemberMyPip cam="nodevice" initial="수" video={null} />);
    expect(q('[data-pz="mypip"]')?.textContent).toContain('카메라를 쓸 수 없어요');
  });
});

/* ───────── MemberMediaControls — LiveKit 연동(모킹) ───────── */

interface ControlsOverride {
  place?: 'online' | 'offline';
  mode?: '1on1' | 'group';
  token?: string | null;
  canPublish?: boolean;
  speaking?: boolean;
  raisedHand?: boolean;
  speakerOn?: boolean;
  raiseHand?: () => Promise<void>;
  lowerHand?: () => Promise<void>;
  raiseHandError?: string | null;
}

function Controls({ override = {} }: { override?: ControlsOverride }) {
  const p = { place: 'online' as const, mode: '1on1' as const, token: 'tok', canPublish: true, speaking: false, raisedHand: false, speakerOn: true, ...override };
  return (
    <MemberMediaControls
      place={p.place}
      mode={p.mode}
      token={p.token}
      serverUrl="wss://lk.test"
      canPublish={p.canPublish}
      speaking={p.speaking}
      raisedHand={p.raisedHand}
      raiseHand={p.raiseHand ?? (async () => undefined)}
      lowerHand={p.lowerHand}
      raiseHandError={p.raiseHandError}
      speakerOn={p.speakerOn}
    >
      {(m: MemberMediaBinding) => (
        <MemberMediaRow
          c={deriveMemberCase(memberInput({ place: p.place, mode: p.mode, ...m.input }))}
          sheetOpen={false}
          actions={m.actions}
        />
      )}
    </MemberMediaControls>
  );
}
const labels = (): string[] => qa('[data-pz="mbtn"]').map((b) => b.textContent ?? '');

describe('MemberMediaControls — LiveKitRoom 설정(P8: 회원 영상 기본 비공개)', () => {
  it('video 는 항상 false, audio 는 발행 권한·마이크 선택에 따른다', async () => {
    await render(<Controls />);
    expect(lastRoomProps()).toMatchObject({ video: false, audio: true, token: 'tok', serverUrl: 'wss://lk.test', connect: true });
    expect(lk.local.setCameraEnabled).not.toHaveBeenCalled();
  });
  it('발행 권한이 없으면(그룹 뮤트) audio=false', async () => {
    await render(<Controls override={{ mode: 'group', canPublish: false }} />);
    expect(lastRoomProps()).toMatchObject({ video: false, audio: false });
  });
  it('토큰이 없거나 오프라인이면 방을 만들지 않는다', async () => {
    await render(<Controls override={{ token: null }} />);
    expect(q('[data-testid="lk-room"]')).toBeNull();
    await render(<Controls override={{ place: 'offline' }} />);
    expect(q('[data-testid="lk-room"]')).toBeNull();
  });
  it('코치 음성은 스피커 선택에 따라 볼륨 0/1', async () => {
    await render(<Controls override={{ speakerOn: false }} />);
    expect(lk.rendererVolume.at(-1)).toBe(0);
    await render(<Controls override={{ speakerOn: true }} />);
    expect(lk.rendererVolume.at(-1)).toBe(1);
  });
});

describe('MemberMediaControls — 카메라·마이크 토글', () => {
  it('처음에는 카메라 꺼짐 · 켜기 클릭 → setCameraEnabled(true), 다시 클릭 → false', async () => {
    await render(<Controls />);
    expect(labels()).toEqual(['마이크 켜짐', '카메라 꺼짐']);
    await act(async () => { buttonByText('카메라 꺼짐')?.click(); });
    expect(lk.local.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(labels()).toEqual(['마이크 켜짐', '카메라 켜짐']);
    await act(async () => { buttonByText('카메라 켜짐')?.click(); });
    expect(lk.local.setCameraEnabled).toHaveBeenLastCalledWith(false);
    expect(labels()[1]).toBe('카메라 꺼짐');
  });
  it('마이크 끄기 → setMicrophoneEnabled(false) · 켜기 → true', async () => {
    await render(<Controls />);
    await act(async () => { buttonByText('마이크 켜짐')?.click(); });
    expect(lk.local.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(labels()[0]).toBe('마이크 꺼짐');
    await act(async () => { buttonByText('마이크 꺼짐')?.click(); });
    expect(lk.local.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
  });
  it('M15: 마이크 권한 거부 → "마이크 막힘"(비활성)', async () => {
    await render(<Controls />);
    const onFailure = lastRoomProps().onMediaDeviceFailure as (f?: MediaDeviceFailure, k?: MediaDeviceKind) => void;
    await act(async () => { onFailure(MediaDeviceFailure.PermissionDenied, 'audioinput'); });
    expect(labels()[0]).toBe('마이크 막힘');
    expect(buttonByText('마이크 막힘')?.getAttribute('aria-disabled')).toBe('true');
  });
  it('M17: 카메라 권한 거부·장치 없음 → "카메라 막힘", 켜 두려던 선택은 해제된다', async () => {
    await render(<Controls />);
    await act(async () => { buttonByText('카메라 꺼짐')?.click(); });
    const onFailure = lastRoomProps().onMediaDeviceFailure as (f?: MediaDeviceFailure, k?: MediaDeviceKind) => void;
    await act(async () => { onFailure(MediaDeviceFailure.NotFound, 'videoinput'); });
    expect(labels()[1]).toBe('카메라 막힘');
  });
  it('방이 다시 만들어져도(발언권 변경 → key 변경) 켜 둔 카메라는 다시 켠다(camWanted 보관)', async () => {
    await render(<Controls override={{ canPublish: true }} />);
    await act(async () => { buttonByText('카메라 꺼짐')?.click(); });
    // 방이 새로 만들어지면 로컬 카메라는 꺼진 채로 시작한다
    lk.state.isCameraEnabled = false;
    lk.local.setCameraEnabled.mockClear();
    await render(<Controls override={{ canPublish: false }} />);
    await render(<Controls override={{ canPublish: true }} />);
    expect(lk.local.setCameraEnabled).toHaveBeenCalledWith(true);
  });
  it('카메라를 켜 두지 않았다면 재마운트 때도 켜지 않는다', async () => {
    await render(<Controls override={{ canPublish: true }} />);
    await render(<Controls override={{ canPublish: false }} />);
    await render(<Controls override={{ canPublish: true }} />);
    expect(lk.local.setCameraEnabled).not.toHaveBeenCalled();
  });
});

describe('MemberMediaControls — 그룹 손들기·발언권', () => {
  it('M02: 손들기 → raiseHand() 1회', async () => {
    const raiseHand = vi.fn(async () => undefined);
    await render(<Controls override={{ mode: 'group', canPublish: false, raiseHand }} />);
    expect(labels()).toEqual(['뮤트 중', '손들기']);
    await act(async () => { buttonByText('손들기')?.click(); });
    expect(raiseHand).toHaveBeenCalledTimes(1);
  });
  it('M03: 대기 중 "손 내리기" → lowerHand() 1회, raiseHand() 호출 없음', async () => {
    const raiseHand = vi.fn(async () => undefined);
    const lowerHand = vi.fn(async () => undefined);
    await render(<Controls override={{ mode: 'group', canPublish: false, raisedHand: true, raiseHand, lowerHand }} />);
    expect(labels()).toEqual(['뮤트 중', '손 내리기']);
    await act(async () => { buttonByText('손 내리기')?.click(); });
    expect(lowerHand).toHaveBeenCalledTimes(1);
    expect(raiseHand).not.toHaveBeenCalled();
  });
  it('M03b: 손 내리기 실패 안내를 보여 준다', async () => {
    await render(<Controls override={{ mode: 'group', canPublish: false, raisedHand: true, raiseHandError: '손을 내리지 못했어요' }} />);
    expect(q('[data-pz="hand-error"]')?.textContent).toBe('손을 내리지 못했어요');
  });
  it('M04: 말하기 종료 = 로컬 마이크 끄기(B2 미적용) → 다시 뮤트·손들기, 서버 호출 없음', async () => {
    const raiseHand = vi.fn(async () => undefined);
    await render(<Controls override={{ mode: 'group', canPublish: true, speaking: true, raiseHand }} />);
    expect(labels()).toEqual(['말하는 중', '말하기 종료']);
    expect(lastRoomProps()).toMatchObject({ video: false, audio: true });
    await act(async () => { buttonByText('말하기 종료')?.click(); });
    expect(lk.local.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(raiseHand).not.toHaveBeenCalled();
    expect(labels()).toEqual(['뮤트 중', '손들기']);
  });
  it('말하기 종료 뒤 같은 발언권 안에서 손들기를 누르면 서버 호출 없이 마이크만 다시 켠다', async () => {
    const raiseHand = vi.fn(async () => undefined);
    await render(<Controls override={{ mode: 'group', canPublish: true, speaking: true, raiseHand }} />);
    await act(async () => { buttonByText('말하기 종료')?.click(); });
    await act(async () => { buttonByText('손들기')?.click(); });
    expect(lk.local.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
    expect(raiseHand).not.toHaveBeenCalled();
    expect(labels()).toEqual(['말하는 중', '말하기 종료']);
  });
  it('발언권이 회수되면(canPublish → false) 다음 발언을 위해 마이크 선택이 초기화된다', async () => {
    await render(<Controls override={{ mode: 'group', canPublish: true, speaking: true }} />);
    await act(async () => { buttonByText('말하기 종료')?.click(); });
    await render(<Controls override={{ mode: 'group', canPublish: false, speaking: false }} />);
    await render(<Controls override={{ mode: 'group', canPublish: true, speaking: true }} />);
    expect(labels()).toEqual(['말하는 중', '말하기 종료']);
  });
});
