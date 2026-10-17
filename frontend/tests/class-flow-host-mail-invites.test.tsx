// @vitest-environment jsdom
// SDD-209 I2 — FH04 이메일 초대 목록(B14 GET /sessions/{id}/invite/email)과 `다시 보내기`(POST invite/email) 연결
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toMailInviteInput } from '../src/components/class/flow/shell/host-shell-data';
import SessionDetailPage from '../src/pages/sessions/SessionDetailPage';
import { getSession, type SessionDto } from '../src/lib/api/session';
import { inviteByEmail, listEmailInvites, type InviteEmailItem } from '../src/lib/api/class-flow-host';
import { maskEmail } from '../src/lib/class/flow/member-format';

vi.mock('../src/lib/api/session', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/api/session')>()), getSession: vi.fn() }));
vi.mock('../src/lib/api/class-flow-host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/class-flow-host')>()),
  listEmailInvites: vi.fn(), inviteByEmail: vi.fn(),
}));
vi.mock('../src/hooks/useSessionLiveSocket', () => ({ useSessionLiveSocket: () => ({ isReady: false }) }));
vi.mock('../src/components/layout/AppShell', () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const NOW = new Date('2026-10-17T03:00:00Z');
const item = (over: Partial<InviteEmailItem> = {}): InviteEmailItem => ({
  invite_id: 'i1', email: 'sera@example.com', status: 'requested', stale: false, request_count: 1,
  queued_at: new Date(NOW.getTime() - 300_000).toISOString(), requested_at: NOW.toISOString(), pii_scrubbed: false, ...over,
});

describe('toMailInviteInput', () => {
  it('requested·queued 는 발송 요청함, failed·stale 은 발송하지 못했어요 로 본다', () => {
    expect(toMailInviteInput(item(), NOW, 60, maskEmail).state).toBe('requested');
    expect(toMailInviteInput(item({ status: 'queued' }), NOW, 60, maskEmail).state).toBe('requested');
    expect(toMailInviteInput(item({ status: 'failed' }), NOW, 60, maskEmail).state).toBe('failed');
    expect(toMailInviteInput(item({ status: 'queued', stale: true }), NOW, 60, maskEmail).state).toBe('failed');
  });
  it('주소는 가려서 보이고, 지워진 주소는 null', () => {
    expect(toMailInviteInput(item(), NOW, 60, maskEmail).maskedEmail).toBe('se***@example.com');
    expect(toMailInviteInput(item({ email: null, pii_scrubbed: true }), NOW, 60, maskEmail).maskedEmail).toBeNull();
  });
  it('쿨다운은 마지막 요청 시각부터 남은 초(음수 없음)', () => {
    const recent = item({ queued_at: new Date(NOW.getTime() - 18_000).toISOString() });
    expect(toMailInviteInput(recent, NOW, 60, maskEmail).cooldownSec).toBe(42);
    expect(toMailInviteInput(item(), NOW, 60, maskEmail).cooldownSec).toBe(0);
  });
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(getSession).mockResolvedValue({
    id: 's1', type: 'meditation', custom_type_name: null, status: 'scheduled', host_id: 'h1', scheduled_at: null, access_code: '4827',
    started_at: null, ended_at: null, duration_min: 50, title: '명상', notes: null, max_participants: 10, location_type: 'online', location_address: null,
    participant_mode: 'group', linkband_mode: 'optional', webrtc_room_id: null, sfu_enabled: false, record_audio: true, record_video: true,
    created_at: NOW.toISOString(), participants: [], waitlist_count: 0,
  } as unknown as SessionDto);
  vi.mocked(listEmailInvites).mockResolvedValue({ session_id: 's1', invites: [item()], summary: {} });
  vi.mocked(inviteByEmail).mockResolvedValue({ session_id: 's1', cooldown_sec: 60, results: [], summary: {} });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function renderPage(): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/sessions/s1']}>
        <Routes><Route path="/sessions/:id" element={<SessionDetailPage />} /></Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

describe('FH04 이메일 초대 구역', () => {
  it('목록 API 결과를 그리고, 다시 보내기는 원래 주소로 POST invite/email 을 부른 뒤 목록을 새로 받는다', async () => {
    await renderPage();
    expect(listEmailInvites).toHaveBeenCalledWith('s1');
    expect(document.querySelector('[data-testid="mail-invites"]')?.textContent).toContain('se***@example.com');
    expect(document.querySelector('[data-testid="mail-invites"]')?.textContent).toContain('발송 요청함');
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="resend-mail"]')?.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(inviteByEmail).toHaveBeenCalledWith('s1', ['sera@example.com']);
    expect(vi.mocked(listEmailInvites).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('목록 API 가 실패해도 상세는 그대로 보이고 이메일 구역만 없다', async () => {
    vi.mocked(listEmailInvites).mockRejectedValue(new Error('boom'));
    await renderPage();
    expect(document.querySelector('[data-testid="mail-invites"]')).toBeNull();
    expect(document.body.textContent).toContain('명상');
  });
});
