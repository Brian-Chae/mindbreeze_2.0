// @vitest-environment jsdom
// SDD-209 SH4 — FM03 회원 클래스 상세 + 입장 CTA(useEnterClass: 초대된 회원은 POST /sessions/{id}/enter)
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassDetailBody, ClassDetailFoot, type ClassDetailData } from '../src/components/class/flow/shell/ClassDetailView';
import { toDetailData } from '../src/components/class/flow/shell/shell-data';
import { deriveDetailAction, deriveDetailBox, derivePrepRows } from '../src/lib/class/enter-action';
import { ENTRY_STORAGE_PREFIX, useEnterClass, type EnterClassError } from '../src/hooks/useEnterClass';
import ClientSessionDetailPage from '../src/pages/client/ClientSessionDetailPage';
import { apiClient, ApiError } from '../src/lib/api/client';
import { getSession, type SessionDto } from '../src/lib/api/session';

vi.mock('../src/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api/client')>();
  return { ...actual, apiClient: { ...actual.apiClient, post: vi.fn() } };
});
vi.mock('../src/lib/api/session', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/api/session')>()), getSession: vi.fn() }));
vi.mock('../src/hooks/useSessionLiveSocket', () => ({ useSessionLiveSocket: () => ({ isReady: false }) }));
vi.mock('../src/components/client/ClientShell', () => ({ default: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div> }));
vi.mock('../src/pages/client/ClientReportDetailModal', () => ({ ClientReportDetailModal: () => <div data-testid="report-modal" /> }));

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const NOW = new Date(2026, 9, 17, 12, 0);
const L = (day: number, hour: number, minute = 0): string => new Date(2026, 9, day, hour, minute).toISOString();

function session(over: Partial<SessionDto> & { host_name?: string } = {}): SessionDto {
  return {
    id: 's1', type: 'meditation', custom_type_name: null, status: 'open', host_id: 'h1', scheduled_at: L(17, 15), access_code: '4827',
    started_at: null, ended_at: null, duration_min: 50, title: '마음챙김 명상 · 4회차', notes: null, max_participants: 10,
    location_type: 'online', location_address: null, participant_mode: 'group', linkband_mode: 'optional', webrtc_room_id: null,
    sfu_enabled: false, record_audio: true, record_video: true, created_at: L(1, 9), participants: [], waitlist_count: 0,
    host_name: '김하늘', ...over,
  } as SessionDto;
}

beforeEach(() => {
  // 고정 일정이 실행 날짜에 따라 입장 가능 상태로 바뀌지 않게 한다.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  sessionStorage.clear();
});
afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('상세 문구 파생', () => {
  it('준비물 3줄: 온라인=조용한 곳·이어폰·밴드, 오프라인=장소·무음·10분 전 도착', () => {
    const online = derivePrepRows('open', { place: 'online', band: 'optional', address: null, durationMin: 50 });
    expect(online.title).toBe('준비하면 좋아요');
    expect(online.rows.map((r) => r.title)).toEqual(['조용한 곳', '이어폰', 'LINK BAND (선택)']);
    const offline = derivePrepRows('scheduled', { place: 'offline', band: 'none', address: '서울 강남구 테헤란로 123 · 4층', durationMin: 50 });
    expect(offline.rows.map((r) => r.title)).toEqual(['장소', '휴대폰 무음', '10분 전 도착']);
    expect(offline.rows[0].sub).toBe('서울 강남구 테헤란로 123 · 4층');
  });
  it('밴드 필수 모드도 권장 문구(참가를 막지 않는다)', () => {
    const rows = derivePrepRows('open', { place: 'online', band: 'required', address: null, durationMin: 50 }).rows;
    expect(rows[2]).toMatchObject({ title: 'LINK BAND (권장)', sub: 'LINK BAND 사용을 권장해요. 없어도 참가할 수 있어요' });
  });
  it('완료·취소는 안내 3줄로 대체', () => {
    expect(derivePrepRows('done', { place: 'online', band: 'optional', address: null, durationMin: 50 }).title).toBe('이번 클래스');
    expect(derivePrepRows('cancelled', { place: 'online', band: 'optional', address: null, durationMin: 50 }).title).toBe('안내');
  });
  it('안내 박스: 예정은 시작까지, 완료는 진행 시간, 취소는 진행자 취소', () => {
    expect(deriveDetailBox('scheduled', { startsInLabel: '3일 2시간', elapsedLabel: '', durationMin: 50 }).title).toBe('시작까지 3일 2시간');
    expect(deriveDetailBox('done', { startsInLabel: '', elapsedLabel: '', durationMin: 50 })).toMatchObject({ title: '50분 동안 진행했어요', sub: '리포트가 준비됐어요' });
    expect(deriveDetailBox('cancelled', { startsInLabel: '', elapsedLabel: '', durationMin: 50 })).toMatchObject({ icon: 'calendar-x', title: '진행자가 클래스를 취소했어요' });
  });
});

describe('ClassDetailBody / ClassDetailFoot', () => {
  const data = (over: Partial<ClassDetailData> = {}): ClassDetailData => toDetailData(session(), NOW, over);
  it('히어로(유형·상태·제목·진행자·방식)와 준비물 카드', async () => {
    await render(<ClassDetailBody data={data()} />);
    const hero = q('[data-testid="class-detail-hero"]')!;
    expect(hero.textContent).toContain('명상 클래스');
    expect(hero.querySelector('[data-chip="open"]')).not.toBeNull();
    expect(hero.textContent).toContain('마음챙김 명상 · 4회차');
    expect(hero.textContent).toContain('김하늘 상담사');
    expect(q('.sh-prep')!.querySelectorAll('li')).toHaveLength(3);
  });
  it('푸터: 안내 한 줄 + 주 버튼 1개(flow-cta). 비활성이면 disabled', async () => {
    const onAction = vi.fn();
    await render(<ClassDetailFoot note="준비는 2분이면 끝나요" action={deriveDetailAction('open')} onAction={onAction} />);
    const cta = q<HTMLButtonElement>('[data-pz="flow-cta"]')!;
    expect(cta.textContent).toBe('입장하기');
    await act(async () => { cta.click(); });
    expect(onAction).toHaveBeenCalledTimes(1);
    await render(<ClassDetailFoot note="클래스가 열리면 알려드려요" action={deriveDetailAction('scheduled')} onAction={onAction} />);
    expect(q<HTMLButtonElement>('[data-pz="flow-cta"]')!.disabled).toBe(true);
    expect(document.querySelectorAll('[data-pz="flow-cta"]')).toHaveLength(1);
  });
});

function Harness({ id, onState }: { id: string; onState: (s: { error: EnterClassError | null; enteringId: string | null }) => void }) {
  const { enter, error, enteringId } = useEnterClass();
  onState({ error, enteringId });
  return <button type="button" data-testid="go" onClick={() => void enter(id)}>go</button>;
}
function Probe() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}
async function renderHarness(id = 's1') {
  let last: { error: EnterClassError | null; enteringId: string | null } = { error: null, enteringId: null };
  await render(
    <MemoryRouter initialEntries={['/app']}>
      <Routes>
        <Route path="/app" element={<Harness id={id} onState={(s) => { last = s; }} />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
  return () => last;
}

describe('useEnterClass', () => {
  it('성공: POST /sessions/{id}/enter → 입장 자격 저장 → 입장 흐름으로 이동', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      entry_credential: 'cred-1', expires_at: '2026-10-17T18:00:00Z', participant_id: 'p1', is_guest: false, is_waitlisted: false, session: {},
    });
    const last = await renderHarness();
    await act(async () => { q<HTMLButtonElement>('[data-testid="go"]')!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(apiClient.post).toHaveBeenCalledWith('/sessions/s1/enter', {});
    const stored = JSON.parse(sessionStorage.getItem(`${ENTRY_STORAGE_PREFIX}s1`)!);
    expect(stored).toMatchObject({ entry_credential: 'cred-1', participant_id: 'p1', is_waitlisted: false });
    expect(q('[data-testid="where"]')!.textContent).toBe('/class/s1/enter');
    expect(last().error).toBeNull();
  });
  it('403(초대 행 없음) → 코드 입장 안내 오류, 이동하지 않는다', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new ApiError(403, 'forbidden', {}));
    const last = await renderHarness();
    await act(async () => { q<HTMLButtonElement>('[data-testid="go"]')!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(last().error).toMatchObject({ kind: 'invite-required' });
    expect(last().error!.message).toContain('코드');
    expect(q('[data-testid="go"]')).not.toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
  it('409(종료)·404·네트워크 오류는 각각 다른 문구, 서버 문구를 그대로 노출하지 않는다', async () => {
    const results: string[] = [];
    for (const err of [new ApiError(409, '서버 원문 종료', {}), new ApiError(404, '서버 원문 없음', {}), new TypeError('failed to fetch')]) {
      vi.mocked(apiClient.post).mockRejectedValue(err);
      const last = await renderHarness();
      await act(async () => { q<HTMLButtonElement>('[data-testid="go"]')!.click(); });
      await act(async () => { await Promise.resolve(); });
      results.push(`${last().error!.kind}:${last().error!.message}`);
    }
    expect(results.map((r) => r.split(':')[0])).toEqual(['closed', 'not-found', 'failed']);
    expect(results.join('|')).not.toContain('서버 원문');
  });
  it('처리 중에는 두 번째 호출을 무시한다', async () => {
    let resolve: (v: unknown) => void = () => {};
    vi.mocked(apiClient.post).mockImplementation(() => new Promise((r) => { resolve = r; }));
    const last = await renderHarness();
    await act(async () => { q<HTMLButtonElement>('[data-testid="go"]')!.click(); });
    await act(async () => { q<HTMLButtonElement>('[data-testid="go"]')!.click(); });
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(last().enteringId).toBe('s1');
    await act(async () => { resolve({ entry_credential: 'c', expires_at: null, participant_id: 'p', is_guest: false, is_waitlisted: false, session: {} }); await Promise.resolve(); });
  });
});

async function renderPage(s: SessionDto): Promise<void> {
  vi.mocked(getSession).mockResolvedValue(s);
  await render(
    <MemoryRouter initialEntries={[`/app/sessions/${s.id}`]}>
      <Routes>
        <Route path="/app/sessions/:id" element={<ClientSessionDetailPage />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { await Promise.resolve(); });
}

describe('ClientSessionDetailPage — FM03', () => {
  it('열린 클래스: 입장하기 → enter 호출 → 입장 흐름. 입장 코드 값이 화면에 없다', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ entry_credential: 'c', expires_at: null, participant_id: 'p', is_guest: false, is_waitlisted: false, session: {} });
    await renderPage(session());
    expect(document.body.textContent).not.toContain('4827');
    const cta = q<HTMLButtonElement>('[data-pz="flow-cta"]')!;
    expect(cta.textContent).toBe('입장하기');
    await act(async () => { cta.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(apiClient.post).toHaveBeenCalledWith('/sessions/s1/enter', {});
    expect(q('[data-testid="where"]')!.textContent).toBe('/class/s1/enter');
  });
  it('열리기 전: 입장하기 비활성 + 열리면 알려드려요. 코드가 없어도 입장 조건이 아니다', async () => {
    await renderPage(session({ status: 'scheduled', scheduled_at: L(20, 15), access_code: null }));
    const cta = q<HTMLButtonElement>('[data-pz="flow-cta"]')!;
    expect(cta.disabled).toBe(true);
    expect(document.body.textContent).toContain('클래스가 열리면 알려드려요');
    expect(document.body.textContent).not.toContain('참여 코드가 아직 발급되지 않아');
  });
  it('완료: 리포트 보기 → 모달, 취소: 클래스 목록 보기', async () => {
    await renderPage(session({ status: 'completed' }));
    await act(async () => { q<HTMLButtonElement>('[data-pz="flow-cta"]')!.click(); });
    expect(q('[data-testid="report-modal"]')).not.toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderPage(session({ status: 'cancelled' }));
    await act(async () => { q<HTMLButtonElement>('[data-pz="flow-cta"]')!.click(); });
    expect(q('[data-testid="where"]')!.textContent).toBe('/app/sessions');
  });
  it('입장 거절(403)이면 오류 한 줄 + 코드로 입장하기', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new ApiError(403, 'x', {}));
    await renderPage(session());
    await act(async () => { q<HTMLButtonElement>('[data-pz="flow-cta"]')!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(q('[role="alert"]')!.textContent).toContain('코드');
    await act(async () => { q<HTMLButtonElement>('[data-testid="detail-enter-with-code"]')!.click(); });
    expect(q('[data-testid="where"]')!.textContent).toBe('/join');
  });
});
