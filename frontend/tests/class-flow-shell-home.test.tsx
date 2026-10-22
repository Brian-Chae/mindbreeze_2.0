// @vitest-environment jsdom
// SDD-209 SH2 — FM01 회원 홈: 히어로(상태별 CTA)·코드로 입장하기 진입점·참여코드 칩 제거
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassHero, ClassHeroEmpty, type ClassHeroData } from '../src/components/class/flow/shell/ClassHero';
import { MemberHomeView } from '../src/components/class/flow/shell/MemberHomeView';
import { heroBackdrop, toHeroData } from '../src/components/class/flow/shell/shell-data';
import { deriveHeroAction, deriveHeroCopy } from '../src/lib/class/enter-action';
import ClientHomePage from '../src/pages/client/ClientHomePage';
import { listSessions, type SessionDto } from '../src/lib/api/session';
import { listReports } from '../src/lib/api/reports';
import { listNotifications } from '../src/lib/api/notifications';
import { listChatRooms } from '../src/lib/api/chat';
import { apiClient } from '../src/lib/api/client';

vi.mock('../src/lib/api/session', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/api/session')>()), listSessions: vi.fn() }));
vi.mock('../src/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api/client')>();
  return { ...actual, apiClient: { ...actual.apiClient, post: vi.fn() } };
});
vi.mock('../src/lib/api/reports', () => ({ listReports: vi.fn() }));
vi.mock('../src/lib/api/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/notifications')>()), listNotifications: vi.fn(), markRead: vi.fn(),
}));
vi.mock('../src/lib/api/chat', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/api/chat')>()), listChatRooms: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const q = <T extends Element = HTMLElement>(sel: string): T | null => container.querySelector<T>(sel);
const NOW = new Date(2026, 9, 17, 12, 0);
const L = (day: number, hour: number, minute = 0): string => new Date(2026, 9, day, hour, minute).toISOString();

beforeEach(() => {
  // 고정 일정이 실행 날짜에 따라 입장 가능 상태로 바뀌지 않게 한다.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function heroData(over: Partial<ClassHeroData> = {}): ClassHeroData {
  return {
    chip: 'open', countdown: '오늘 오후 3:00', title: '마음챙김 명상 · 4회차', meta: '오늘 오후 3:00 · 50분', hostName: '김하늘 상담사',
    place: 'online', mode: 'group', band: 'optional', backdropSrc: '/images/background8.webp',
    box: { icon: 'check', title: '지금 입장할 수 있어요', sub: '입장하면 간단한 준비를 먼저 해요' },
    ...over,
  };
}

describe('ClassHero', () => {
  it('입장 가능: 배지·제목·진행자·방식 칩·안내 박스·입장하기 버튼', async () => {
    const onAction = vi.fn();
    await render(<ClassHero data={heroData()} action={deriveHeroAction('open')} onAction={onAction} />);
    const hero = q('[data-testid="class-hero"]')!;
    expect(hero.querySelector('[data-chip="open"]')).not.toBeNull();
    expect(hero.textContent).toContain('마음챙김 명상 · 4회차');
    expect(hero.textContent).toContain('김하늘 상담사');
    expect(hero.textContent).toContain('LINK BAND 선택');
    expect(hero.textContent).toContain('지금 입장할 수 있어요');
    const cta = q<HTMLButtonElement>('[data-testid="class-hero-cta"]')!;
    expect(cta.textContent).toBe('입장하기');
    await act(async () => { cta.click(); });
    expect(onAction).toHaveBeenCalledTimes(1);
  });
  it('예정: 클래스 보기(윤곽선), 참여코드·코드 복사 UI 가 없다', async () => {
    await render(<ClassHero data={heroData({ chip: 'scheduled', countdown: 'D-3' })} action={deriveHeroAction('scheduled')} onAction={() => {}} />);
    const cta = q('[data-testid="class-hero-cta"]')!;
    expect(cta.textContent).toBe('클래스 보기');
    expect(cta.className).toContain('line');
    expect(container.textContent).not.toContain('참여코드');
    expect(container.textContent).not.toContain('코드 복사');
  });
  it('빈 상태: 신청 CTA', async () => {
    const onApply = vi.fn();
    await render(<ClassHeroEmpty backdropSrc="/images/background8.webp" onApply={onApply} />);
    expect(container.textContent).toContain('예정된 클래스가 없어요');
    await act(async () => { q<HTMLButtonElement>('[data-testid="class-hero-cta"]')!.click(); });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('클래스 신청하기');
  });
  it('배경은 클래스 id 로 고정(같은 id 는 같은 사진)', () => {
    expect(heroBackdrop('abc')).toBe(heroBackdrop('abc'));
    expect(heroBackdrop('abc')).toMatch(/^\/images\/background(1|4|5|8|10)\.webp$/);
  });
});

describe('deriveHeroCopy / toHeroData', () => {
  it('상태별 안내 박스 문구', () => {
    expect(deriveHeroCopy('scheduled', { startsInLabel: '3일 2시간', elapsedLabel: '' })).toMatchObject({ icon: 'bell', title: '클래스가 열리면 알려드려요' });
    expect(deriveHeroCopy('soon', { startsInLabel: '30분', elapsedLabel: '' }).title).toBe('30분 뒤에 클래스가 열려요');
    expect(deriveHeroCopy('open', { startsInLabel: '', elapsedLabel: '' })).toMatchObject({ icon: 'check', title: '지금 입장할 수 있어요' });
    expect(deriveHeroCopy('live', { startsInLabel: '', elapsedLabel: '12분째' }).title).toBe('12분째 진행 중이에요');
  });
  it('세션 → 히어로 데이터: 진행자 이름·방식·카운트다운', () => {
    const data = toHeroData(session({ id: 'x1', status: 'scheduled', scheduled_at: L(20, 15), host_name: '김하늘' }), NOW);
    expect(data.chip).toBe('scheduled');
    expect(data.countdown).toBe('D-3');
    expect(data.hostName).toBe('김하늘 상담사');
    expect(data.meta).toContain('50분');
    expect(data.place).toBe('online');
  });
});

describe('MemberHomeView', () => {
  it('목록 아래 코드로 입장하기 진입점, 참여코드 칩 없음', async () => {
    const onCode = vi.fn();
    await render(<MemberHomeView hero={heroData()} heroAction={deriveHeroAction('open')} rows={[]} onHeroAction={() => {}} onEnterByCode={onCode} onApply={() => {}} onOpenClass={() => {}} />);
    const btn = q<HTMLButtonElement>('[data-testid="enter-with-code"]')!;
    expect(btn.textContent).toContain('코드로 입장하기');
    await act(async () => { btn.click(); });
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('참여코드');
  });
});

function session(over: Partial<SessionDto> & { host_name?: string }): SessionDto {
  return {
    id: 's1', type: 'meditation', custom_type_name: null, status: 'open', host_id: 'h1', scheduled_at: L(17, 15), access_code: '4827',
    started_at: null, ended_at: null, duration_min: 50, title: '마음챙김 명상 · 4회차', notes: null, max_participants: 10,
    location_type: 'online', location_address: null, participant_mode: 'group', linkband_mode: 'optional', webrtc_room_id: null,
    sfu_enabled: false, record_audio: true, record_video: true, created_at: L(1, 9), participants: [], waitlist_count: 0,
    ...over,
  } as SessionDto;
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

async function renderHome(sessions: SessionDto[]): Promise<void> {
  vi.mocked(listSessions).mockResolvedValue({ sessions, total: sessions.length });
  vi.mocked(listReports).mockResolvedValue({ reports: [], total: 0 });
  vi.mocked(listNotifications).mockResolvedValue({ notifications: [], total: 0, unread: 0 });
  vi.mocked(listChatRooms).mockResolvedValue({ rooms: [] });
  await render(
    <MemoryRouter initialEntries={['/app']}>
      <Routes>
        <Route path="/app" element={<ClientHomePage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { await Promise.resolve(); });
}

describe('ClientHomePage — FM01', () => {
  it('열린 클래스가 히어로, 참여코드 값/복사가 화면 어디에도 없다', async () => {
    await renderHome([session({ id: 'open1', status: 'open' }), session({ id: 'sch1', status: 'scheduled', scheduled_at: L(20, 15), title: '다음 클래스' })]);
    const hero = q('[data-testid="class-hero"]')!;
    expect(hero.textContent).toContain('마음챙김 명상 · 4회차');
    expect(q('[data-testid="class-hero-cta"]')!.textContent).toBe('입장하기');
    expect(container.textContent).not.toContain('4827');
    expect(container.textContent).not.toContain('참여코드');
    expect(container.textContent).not.toContain('코드 복사');
  });
  it('코드로 입장하기 → /join', async () => {
    await renderHome([session({ status: 'scheduled', scheduled_at: L(20, 15) })]);
    await act(async () => { q<HTMLElement>('[data-testid="enter-with-code"]')!.click(); });
    expect(document.querySelector('[data-testid="where"]')!.textContent).toBe('/join');
  });
  it('예정 클래스 히어로의 클래스 보기 → 상세', async () => {
    await renderHome([session({ id: 'sch9', status: 'scheduled', scheduled_at: L(20, 15) })]);
    expect(q('[data-testid="class-hero-cta"]')!.textContent).toBe('클래스 보기');
    await act(async () => { q<HTMLButtonElement>('[data-testid="class-hero-cta"]')!.click(); });
    expect(document.querySelector('[data-testid="where"]')!.textContent).toBe('/app/sessions/sch9');
  });
  it('입장 가능 히어로의 입장하기 → POST enter → 입장 흐름', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ entry_credential: 'c', expires_at: null, participant_id: 'p', is_guest: false, is_waitlisted: false, session: {} });
    await renderHome([session({ id: 'open7', status: 'open' })]);
    await act(async () => { q<HTMLButtonElement>('[data-testid="class-hero-cta"]')!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(apiClient.post).toHaveBeenCalledWith('/sessions/open7/enter', {});
    expect(document.querySelector('[data-testid="where"]')!.textContent).toBe('/class/open7/enter');
  });
  it('클래스가 없으면 빈 히어로 + 신청 진입', async () => {
    await renderHome([]);
    expect(container.textContent).toContain('예정된 클래스가 없어요');
    await act(async () => { q<HTMLButtonElement>('[data-testid="class-hero-cta"]')!.click(); });
    expect(document.querySelector('[data-testid="where"]')!.textContent).toBe('/app/sessions');
  });
});
