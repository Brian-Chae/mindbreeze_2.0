// @vitest-environment jsdom
// SDD-209 M9 — 진행 화면 연결: 입장 자격 전달(WS join·REST 업로드·LiveKit·손들기) · 대기→진행→종료 전이
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/client';
import type { EntryStateDto } from '../src/lib/api/class-flow';

const post = vi.fn();
const emit = vi.fn();
vi.mock('../src/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/client')>()),
  apiClient: { post: (...a: unknown[]) => post(...a), get: vi.fn(), put: vi.fn() },
  tokenStorage: { getAccess: () => null, subscribe: () => () => undefined },
  refreshAccessToken: vi.fn(),
}));

import { joinSessionLive } from '../src/lib/socket';
import { postEntryFeatures, raiseEntryHand, saveEntry } from '../src/lib/api/class-flow';
import { useMemberLiveKit } from '../src/hooks/useMemberLiveKit';

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const text = (): string => document.body.textContent ?? '';

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  post.mockReset();
  emit.mockReset();
  window.sessionStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('입장 자격 전달', () => {
  it('WS join 은 입장 자격이 있을 때만 entry_credential 을 싣는다(현행 동작 보존)', () => {
    const socket = { connected: true, disconnected: false, emit, once: vi.fn() } as unknown as Parameters<typeof joinSessionLive>[0];
    joinSessionLive(socket, 'sA', 'pA', 'cred-1');
    expect(emit).toHaveBeenCalledWith('join', { session_id: 'sA', participant_id: 'pA', entry_credential: 'cred-1' });
    joinSessionLive(socket, 'sB', 'pB');
    expect(emit).toHaveBeenLastCalledWith('join', { session_id: 'sB', participant_id: 'pB' });
  });
  it('feature 배치·손들기는 입장 자격 헤더로 보낸다', async () => {
    post.mockResolvedValue({});
    await postEntryFeatures('s1', 'cred', { participant_id: 'p1', features: [] });
    expect(post).toHaveBeenCalledWith('/sessions/s1/features', { participant_id: 'p1', features: [] }, { skipAuth: true, headers: { 'X-Entry-Credential': 'cred' } });
    await raiseEntryHand('s1', 'p1', 'cred');
    expect(post).toHaveBeenLastCalledWith('/sessions/s1/participants/p1/raise-hand', undefined, { skipAuth: true, headers: { 'X-Entry-Credential': 'cred' } });
  });
});

function LiveKitProbe({ credential, onToken }: { credential: string | null; onToken: (t: string | null, err: string | null, notReady: boolean) => void }) {
  const kit = useMemberLiveKit({ participantId: 'p1', entryCredential: credential, sessionId: 's1', listenSpeakingChanges: false });
  useEffect(() => {
    void kit.connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    onToken(kit.token, kit.error, kit.notReady);
  }, [kit.token, kit.error, kit.notReady, onToken]);
  return null;
}

describe('useMemberLiveKit — 입장 자격 경로', () => {
  it('코드 없이 entry/livekit-token 으로 토큰을 받고 구 by-code 경로를 부르지 않는다', async () => {
    post.mockResolvedValue({ livekit_token: 'lk-token', webrtc_room_id: 'room', can_publish: true });
    const seen = vi.fn();
    await render(<LiveKitProbe credential="cred" onToken={seen} />);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/sessions/s1/entry/livekit-token', undefined, { skipAuth: true, headers: { 'X-Entry-Credential': 'cred' } });
    expect(String(post.mock.calls[0]![0])).not.toContain('by-code');
    expect(seen).toHaveBeenLastCalledWith('lk-token', null, false);
  });
  it('상담사 화상이 아직 시작 전(400)이면 오류가 아니라 재시도 대기', async () => {
    post.mockRejectedValue(new ApiError(400, '아직 상담사 화상이 시작되지 않았습니다', null));
    const seen = vi.fn();
    await render(<LiveKitProbe credential="cred" onToken={seen} />);
    expect(seen).toHaveBeenLastCalledWith(null, null, true);
  });
});

// ── EntryPage: 시작 대기 → 진행 → 종료 ──
const getEntryState = vi.fn();
vi.mock('../src/lib/api/class-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/class-flow')>()),
  getEntryState: (...a: unknown[]) => getEntryState(...a),
}));
const containerProps = vi.fn();
vi.mock('../src/components/class/player/member/MemberClassContainer', () => ({
  MemberClassContainer: (props: Record<string, unknown>) => {
    containerProps(props);
    return <p>진행 화면</p>;
  },
}));
vi.mock('../src/hooks/useLobbyBgm', () => ({
  useLobbyBgm: () => ({ state: { track: null, volume: 0.6, blocked: false, muted: false }, setVolume: vi.fn(), toggleMute: vi.fn(), resume: vi.fn() }),
}));

import EntryPage from '../src/pages/class/EntryPage';

function stateDto(over: Partial<EntryStateDto> = {}): EntryStateDto {
  return {
    session_id: 's1', status: 'open', guest_state: 'waiting', in_progress: false, ended: false, participant_id: 'p1',
    is_waitlisted: false, report_included: false, started_at: null, ended_at: null, chat_enabled: false, band_connected: false, ...over,
  };
}

function renderPage(): Promise<void> {
  return render(
    <MemoryRouter initialEntries={['/class/s1/enter']}>
      <Routes>
        <Route path="/class/:sessionId/enter" element={<EntryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EntryPage — 진행 화면 연결 (M9)', () => {
  beforeEach(() => {
    getEntryState.mockReset();
    containerProps.mockReset();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
    });
  });
  function seed(): void {
    saveEntry({
      sessionId: 's1', credential: 'cred', expiresAt: null, participantId: 'p1', isGuest: true,
      classInfo: {
        title: '마음챙김 명상', hostName: '채용욱', scheduledAt: null, startedAt: null, durationMin: 50, locationType: 'online',
        locationAddress: null, participantMode: 'group', linkbandMode: 'optional', maxParticipants: 10, recordAudio: true, recordVideo: true,
      },
    });
  }
  it('이미 시작된 클래스에 준비를 마치고 들어가면 입장 자격으로 진행 화면을 연다(코드·참여자 토큰 없음)', async () => {
    seed();
    getEntryState.mockResolvedValue(stateDto({ status: 'in_progress' }));
    await renderPage();
    // 준비 마법사를 모두 건너뛰고 대기 → 시작 상태이므로 곧바로 진행 화면
    const find = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label);
    await act(async () => { find('입장하기')?.click(); });
    await act(async () => { find('확인하고 계속하기')?.click(); });
    await act(async () => { find('지금 입장하기')?.click(); });
    expect(text()).toContain('진행 화면');
    const props = containerProps.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(props.entryCredential).toBe('cred');
    expect(props.sessionId).toBe('s1');
    expect(props.participantId).toBe('p1');
    expect(props).not.toHaveProperty('classCode');
    expect(props).not.toHaveProperty('participantToken');
    expect(props.hostName).toBe('채용욱');
    expect(props.locationType).toBe('online');
  });
  it('진행 중 클래스가 종료되면 종료 화면(FM09)으로 넘어간다', async () => {
    seed();
    getEntryState.mockResolvedValue(stateDto({ status: 'in_progress' }));
    await renderPage();
    const find = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label);
    await act(async () => { find('입장하기')?.click(); });
    await act(async () => { find('확인하고 계속하기')?.click(); });
    await act(async () => { find('지금 입장하기')?.click(); });
    expect(text()).toContain('진행 화면');
    getEntryState.mockResolvedValue(stateDto({ status: 'completed', ended: true }));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(text()).toContain('수고하셨어요');
    expect(text()).toContain('보낼 리포트가 없어요');
  });
  it('종료 화면의 함께한 시간은 서버가 내려 준 시작·종료 시각의 차이다(처음 본 시각 근사 없음)', async () => {
    seed();
    getEntryState.mockResolvedValue(stateDto({ status: 'in_progress', started_at: '2026-10-17T01:00:00Z' }));
    await renderPage();
    const find = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label);
    await act(async () => { find('입장하기')?.click(); });
    await act(async () => { find('확인하고 계속하기')?.click(); });
    await act(async () => { find('지금 입장하기')?.click(); });
    getEntryState.mockResolvedValue(stateDto({ status: 'completed', ended: true, started_at: '2026-10-17T01:00:00Z', ended_at: '2026-10-17T01:37:00Z' }));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(text()).toContain('37분');
  });
});
