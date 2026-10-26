// @vitest-environment jsdom
// SDD-222 T-J9 — EntryPage 가 수업 대기·진행 구간에서만 백그라운드 세션을 켜는지, 배터리 안내가 뜨는지
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveEntry } from '../src/lib/api/class-flow';
import type { EntryStateDto } from '../src/lib/api/class-flow';

const h = vi.hoisted(() => ({
  bgArgs: [] as boolean[],
  wakeArgs: [] as boolean[],
  guideOpen: false,
  dismiss: vi.fn(),
}));
const getEntryState = vi.fn();
vi.mock('../src/lib/api/class-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/class-flow')>()),
  getEntryState: (...a: unknown[]) => getEntryState(...a),
  setReportChoice: vi.fn(async () => ({ participant_id: 'p1', report_included: false, changed: false })),
}));
vi.mock('../src/hooks/useWaitingRoomPresence', () => ({ useWaitingRoomPresence: () => undefined }));
vi.mock('../src/hooks/useWakeLock', () => ({ useWakeLock: (on: boolean) => { h.wakeArgs.push(on); } }));
vi.mock('../src/hooks/useBackgroundSession', () => ({
  useBackgroundSession: (on: boolean) => {
    h.bgArgs.push(on);
    return { batteryGuideOpen: on && h.guideOpen, dismissBatteryGuide: h.dismiss };
  },
}));
vi.mock('../src/components/class/player/member/MemberClassContainer', () => ({
  MemberClassContainer: () => <p>진행 화면</p>,
}));

import EntryPage from '../src/pages/class/EntryPage';

let root: Root;
let container: HTMLDivElement;
const text = (): string => document.body.textContent ?? '';
const find = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label);
const render = (node: ReactNode) => act(async () => { root.render(node); });

function stateDto(over: Partial<EntryStateDto> = {}): EntryStateDto {
  return {
    session_id: 's1', status: 'in_progress', guest_state: 'waiting', in_progress: true, ended: false, participant_id: 'p1',
    is_waitlisted: false, report_included: false, started_at: null, ended_at: null, chat_enabled: false, band_connected: false, ...over,
  };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  h.bgArgs.length = 0; h.wakeArgs.length = 0; h.guideOpen = false; h.dismiss.mockClear();
  getEntryState.mockReset().mockResolvedValue(stateDto());
  window.sessionStorage.clear();
  saveEntry({
    sessionId: 's1', credential: 'cred', expiresAt: null, participantId: 'p1', isGuest: true,
    classInfo: {
      title: '마음챙김 명상', hostName: '채용욱', scheduledAt: null, startedAt: null, durationMin: 50, locationType: 'online',
      locationAddress: null, participantMode: 'group', linkbandMode: 'none', maxParticipants: 10, recordAudio: true, recordVideo: true,
    },
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const renderPage = () => render(
  <MemoryRouter initialEntries={['/class/s1/enter']}>
    <Routes><Route path="/class/:sessionId/enter" element={<EntryPage />} /></Routes>
  </MemoryRouter>,
);
async function toLive(): Promise<void> {
  await renderPage();
  await act(async () => { find('입장하기')?.click(); });
  await act(async () => { find('지금 입장하기')?.click(); });
}

describe('EntryPage 백그라운드 세션', () => {
  it('입장 확인·준비 단계에서는 켜지 않고, 진행 화면(live)에서 화면 꺼짐 방지와 같은 조건으로 켠다', async () => {
    await renderPage();
    expect(h.bgArgs.at(-1)).toBe(false);
    await act(async () => { find('입장하기')?.click(); });
    expect(h.bgArgs.at(-1)).toBe(false);
    await act(async () => { find('확인하고 계속하기')?.click(); });
    await act(async () => { find('지금 입장하기')?.click(); });
    expect(text()).toContain('진행 화면');
    expect(h.bgArgs.at(-1)).toBe(true);
    expect(h.wakeArgs.at(-1)).toBe(true);
    // 렌더마다 두 훅의 인자가 항상 같다
    expect(h.bgArgs).toEqual(h.wakeArgs);
  });

  it('배터리 최적화 안내가 열려 있으면 진행 화면 위에 안내를 보여 주고, 확인하면 닫는다', async () => {
    h.guideOpen = true;
    await renderPage();
    await act(async () => { find('입장하기')?.click(); });
    await act(async () => { find('확인하고 계속하기')?.click(); });
    await act(async () => { find('지금 입장하기')?.click(); });
    expect(text()).toContain('진행 화면');
    const dialog = document.querySelector('[role="dialog"][aria-label="배터리 최적화 안내"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('배터리');
    await act(async () => { find('확인')?.click(); });
    expect(h.dismiss).toHaveBeenCalledTimes(1);
  });

  it('건너뛰기도 안내를 닫는다', async () => {
    h.guideOpen = true;
    await renderPage();
    await act(async () => { find('입장하기')?.click(); });
    await act(async () => { find('확인하고 계속하기')?.click(); });
    await act(async () => { find('지금 입장하기')?.click(); });
    await act(async () => { find('건너뛰기')?.click(); });
    expect(h.dismiss).toHaveBeenCalledTimes(1);
  });

  it('안내가 닫혀 있으면 안내를 렌더하지 않는다', async () => {
    await toLive().catch(() => undefined);
    expect(document.querySelector('[aria-label="배터리 최적화 안내"]')).toBeNull();
  });
});
