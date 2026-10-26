// @vitest-environment jsdom
// SDD-231 — 열리기 전 대기: 10분 초과 남은 시간 표시·실시간 갱신, 10분 이하 일반 문구, 열리면 자동 진행
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/client';
import { saveEntry, type EntryStateDto } from '../src/lib/api/class-flow';
import { formatRemaining, preOpenCountdown } from '../src/lib/class/flow/member-format';
import { notYetScheduledAt } from '../src/lib/class/flow/member-machine';

const api = vi.hoisted(() => ({ invited: vi.fn(), state: vi.fn() }));
vi.mock('../src/lib/api/class-flow', async (original) => ({
  ...(await original<typeof import('../src/lib/api/class-flow')>()),
  enterInvitedSession: api.invited, getEntryState: api.state,
}));
const presence = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock('../src/hooks/useWaitingRoomPresence', () => ({ useWaitingRoomPresence: (o: Record<string, unknown>) => { presence.calls.push(o); } }));
vi.mock('../src/hooks/useWakeLock', () => ({ useWakeLock: () => undefined }));
import EntryPage from '../src/pages/class/EntryPage';

const MIN = 60_000;
const T0 = new Date('2026-10-22T05:00:00Z');
const at = (minutes: number): string => new Date(T0.getTime() + minutes * MIN).toISOString();

describe('preOpenCountdown', () => {
  it('10분 초과일 때만 문구를 만든다', () => {
    expect(preOpenCountdown(at(32), T0)).toBe('시작까지 32분 남았어요');
    expect(preOpenCountdown(at(11), T0)).toBe('시작까지 11분 남았어요');
    expect(preOpenCountdown(at(10), T0)).toBeNull();
    expect(preOpenCountdown(at(9), T0)).toBeNull();
    expect(preOpenCountdown(at(-5), T0)).toBeNull();
    expect(preOpenCountdown(null, T0)).toBeNull();
  });
  it('1시간 이상은 시간·분으로', () => {
    expect(formatRemaining(90)).toBe('1시간 30분');
    expect(formatRemaining(120)).toBe('2시간');
    expect(preOpenCountdown(at(150), T0)).toBe('시작까지 2시간 30분 남았어요');
  });
  it('409 오류에서 시작 예정 시각을 꺼낸다', () => {
    expect(notYetScheduledAt(new ApiError(409, 'x', { detail: { code: 'session_not_open', scheduled_at: at(40) } }))).toBe(at(40));
    expect(notYetScheduledAt(new ApiError(409, 'x', { detail: { code: 'session_not_open' } }))).toBeNull();
  });
});

let root: Root;
let container: HTMLDivElement;
const text = (): string => container.textContent ?? '';

function stateDto(over: Partial<EntryStateDto> = {}): EntryStateDto {
  return {
    session_id: 's1', status: 'scheduled', guest_state: 'waiting', in_progress: false, ended: false, participant_id: 'p1',
    is_waitlisted: false, report_included: false, started_at: null, ended_at: null, chat_enabled: false, band_connected: false, ...over,
  };
}
function seedEntry(scheduledAt: string): void {
  saveEntry({
    sessionId: 's1', credential: 'cred', expiresAt: null, participantId: 'p1', isGuest: false,
    classInfo: {
      title: '마음챙김 명상', hostName: '채용욱', scheduledAt, startedAt: null, durationMin: 50, locationType: 'online',
      locationAddress: null, participantMode: 'group', linkbandMode: 'optional', maxParticipants: 10, recordAudio: true, recordVideo: true,
    },
  });
}
function page(path = '/class/s1/enter') {
  return <MemoryRouter initialEntries={[path]}><Routes><Route path="/class/:sessionId/enter" element={<EntryPage />} /></Routes></MemoryRouter>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(T0);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }) });
  sessionStorage.clear(); presence.calls.length = 0; api.invited.mockReset(); api.state.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

describe('EntryPage — 열리기 전 대기실', () => {
  it('32분 남았으면 남은 시간과 시작 시각을 보여 주고 시간이 흐르면 갱신된다', async () => {
    seedEntry(at(32)); api.state.mockResolvedValue(stateDto());
    await act(async () => root.render(page()));
    expect(text()).toContain('시작까지 32분 남았어요');
    expect(text()).toContain('시작');
    await act(async () => { vi.advanceTimersByTime(5 * MIN); });
    expect(text()).toContain('시작까지 27분 남았어요');
  });
  it('10분 이하로 줄면 일반 대기 문구로 바뀐다', async () => {
    seedEntry(at(12)); api.state.mockResolvedValue(stateDto());
    await act(async () => root.render(page()));
    expect(text()).toContain('시작까지 12분 남았어요');
    await act(async () => { vi.advanceTimersByTime(3 * MIN); });
    expect(text()).not.toContain('남았어요');
    expect(text()).toContain('열리면 자동으로 입장해요 · 이 화면을 열어 두세요');
  });
  it('열리기 전에도 상담사 로비 presence 를 켠다', async () => {
    seedEntry(at(32)); api.state.mockResolvedValue(stateDto());
    await act(async () => root.render(page()));
    expect(presence.calls.at(-1)).toMatchObject({ enabled: true, participantId: 'p1' });
  });
  it('서버 상태가 열림으로 바뀌면 자동으로 준비 단계로 이어진다', async () => {
    seedEntry(at(32)); api.state.mockResolvedValue(stateDto());
    await act(async () => root.render(page()));
    expect(text()).toContain('열리면 자동으로 입장해요') ;
    api.state.mockResolvedValue(stateDto({ status: 'open' }));
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await act(async () => { await Promise.resolve(); });
    expect(text()).not.toContain('열리면 자동으로 입장해요');
    expect(text()).toContain('시작 전에 확인해 주세요'); // 머신이 unopened→open 으로 준비 마법사 a 단계로 자동 진행
  });
  it('허용 구간 밖 409 는 아직 열리지 않았어요 카드에 남은 시간을 보여 준다', async () => {
    useAuth(true);
    api.invited.mockRejectedValue(new ApiError(409, 'Conflict', { detail: { code: 'session_not_open', scheduled_at: at(300) } }));
    await act(async () => root.render(page()));
    expect(text()).toContain('아직 열리지 않았어요');
    expect(text()).toContain('시작까지 5시간 남았어요');
  });
});

import { useAuthStore } from '../src/stores/authStore';
function useAuth(on: boolean): void { useAuthStore.setState({ isAuthenticated: on, user: null }); }
