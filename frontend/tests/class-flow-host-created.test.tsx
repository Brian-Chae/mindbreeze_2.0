// @vitest-environment jsdom
// SDD-209 H3 — 생성 완료(FH03): 오케스트레이션(생성→초대→재시도) · 화면 문구 · 컨테이너 연결
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InviteEmailResponse } from '../src/lib/api/class-flow-host';
import type { SessionDto } from '../src/lib/api/session';
import { CreateWizardContainer } from '../src/components/class/flow/host/CreateWizardContainer';
import { CreatedScreen } from '../src/components/class/flow/host/CreatedScreen';
import { createInitialDraft, type WizardDraft } from '../src/lib/class/class-wizard';
import { inviteHeading, inviteRowText, retryInvite, runCreate, type CreatedView, type HostCreateApi } from '../src/lib/class/flow/host-create-flow';
import { FIXTURE_BASE, FIXTURE_MEMBERS, fixtureDraft } from '../src/lib/class/flow/host-fixture-data';

const session = { id: 's-1', title: '마음챙김 명상 4회차', access_code: '4827' } as SessionDto;

function makeApi(overrides: Partial<HostCreateApi> = {}): HostCreateApi & { calls: string[] } {
  const calls: string[] = [];
  const api: HostCreateApi = {
    createSession: vi.fn(async () => { calls.push('create'); return session; }),
    inviteMember: vi.fn(async (_id, userId) => { calls.push(`invite:${userId}`); return session; }),
    inviteByEmail: vi.fn(async (_id, emails): Promise<InviteEmailResponse> => {
      calls.push(`email:${emails.join('|')}`);
      return { session_id: 's-1', cooldown_sec: 60, summary: {}, results: emails.map((email) => ({ email, registered: true, request: 'queued' })) };
    }),
    ...overrides,
  };
  return Object.assign(api, { calls });
}

describe('runCreate', () => {
  it('생성 → 회원 초대 → 이메일 초대 순서로 호출하고 결과를 구조화한다', async () => {
    const api = makeApi();
    const draft = fixtureDraft({ members: FIXTURE_MEMBERS.slice(0, 2).map((m) => ({ ...m })), emails: ['hana@example.com'] });
    const view = await runCreate(api, draft, FIXTURE_BASE, false);
    expect(api.calls).toEqual(['create', 'invite:m1', 'invite:m2', 'email:hana@example.com']);
    expect(view.code).toBe('4827');
    expect(view.rows.map((r) => [r.kind, r.label, r.ok])).toEqual([['member', '김서연', true], ['member', '이민준', true], ['email', 'ha***@…', true]]);
    expect(view.scheduleText).toBe('내일 오후 3:15');
  });

  it('초대가 실패해도 생성은 성공이고 실패 행만 ok=false', async () => {
    const api = makeApi({ inviteMember: vi.fn(async (_id, userId) => { if (userId === 'm2') throw new Error('boom'); return session; }) });
    const view = await runCreate(api, fixtureDraft({ members: FIXTURE_MEMBERS.slice(0, 3).map((m) => ({ ...m })) }), FIXTURE_BASE, false);
    expect(view.rows.map((r) => r.ok)).toEqual([true, false, true]);
  });

  it('이미 초대된 회원(409)은 성공으로 본다', async () => {
    const api = makeApi({ inviteMember: vi.fn(async () => { throw Object.assign(new Error('dup'), { status: 409 }); }) });
    const view = await runCreate(api, fixtureDraft(), FIXTURE_BASE, false);
    expect(view.rows.every((r) => r.ok)).toBe(true);
  });

  it('이메일: enqueue_failed·invalid_email 은 실패, skipped_cooldown 은 이미 요청한 것으로 성공, 호출 실패는 전체 실패', async () => {
    const results: InviteEmailResponse['results'] = [
      { email: 'a@x.com', registered: true, request: 'queued' },
      { email: 'b@x.com', registered: true, request: 'enqueue_failed' },
      { email: 'c@x.com', registered: false, request: 'skipped_cooldown' },
    ];
    const api = makeApi({ inviteByEmail: vi.fn(async () => ({ session_id: 's-1', cooldown_sec: 60, summary: {}, results })) });
    const view = await runCreate(api, fixtureDraft({ members: [], emails: ['a@x.com', 'b@x.com', 'c@x.com'] }), FIXTURE_BASE, false);
    expect(view.rows.map((r) => r.ok)).toEqual([true, false, true]);
    const failing = makeApi({ inviteByEmail: vi.fn(async () => { throw new Error('x'); }) });
    const all = await runCreate(failing, fixtureDraft({ members: [], emails: ['a@x.com'] }), FIXTURE_BASE, false);
    expect(all.rows.map((r) => r.ok)).toEqual([false]);
  });

  it('충돌이 있으면 force 로 보낸다, 초대 대상이 없으면 초대 API 를 부르지 않는다', async () => {
    const api = makeApi();
    await runCreate(api, fixtureDraft({ members: [] }), FIXTURE_BASE, true);
    expect(vi.mocked(api.createSession).mock.calls[0][0].force).toBe(true);
    expect(api.inviteMember).not.toHaveBeenCalled();
    expect(api.inviteByEmail).not.toHaveBeenCalled();
  });

  it('생성 자체가 실패하면 초대를 시작하지 않고 오류를 전파한다', async () => {
    const api = makeApi({ createSession: vi.fn(async () => { throw new Error('create failed'); }) });
    await expect(runCreate(api, fixtureDraft(), FIXTURE_BASE, false)).rejects.toThrow('create failed');
    expect(api.inviteMember).not.toHaveBeenCalled();
  });
});

describe('retryInvite', () => {
  it('실패한 한 건만 다시 호출한다', async () => {
    let fail = true;
    const api = makeApi({ inviteMember: vi.fn(async (_id, userId) => { if (userId === 'm2' && fail) throw new Error('x'); return session; }) });
    const first = await runCreate(api, fixtureDraft({ members: FIXTURE_MEMBERS.slice(0, 3).map((m) => ({ ...m })) }), FIXTURE_BASE, false);
    vi.mocked(api.inviteMember).mockClear();
    fail = false;
    const next = await retryInvite(api, first, 'member:m2');
    expect(api.inviteMember).toHaveBeenCalledTimes(1);
    expect(api.inviteMember).toHaveBeenCalledWith('s-1', 'm2');
    expect(next.rows.every((r) => r.ok)).toBe(true);
    const again = await retryInvite(api, next, 'member:m2');
    expect(again).toBe(next);
  });

  it('이메일 재시도는 /invite/email 에 그 주소만 보낸다', async () => {
    let first = true;
    const api = makeApi({
      inviteByEmail: vi.fn(async (_id, emails): Promise<InviteEmailResponse> => {
        const request = first ? 'enqueue_failed' : 'queued';
        first = false;
        return { session_id: 's-1', cooldown_sec: 60, summary: {}, results: emails.map((email) => ({ email, registered: true, request })) };
      }),
    });
    const view = await runCreate(api, fixtureDraft({ members: [], emails: ['a@x.com'] }), FIXTURE_BASE, false);
    expect(view.rows[0].ok).toBe(false);
    const retried = await retryInvite(api, view, 'email:a@x.com');
    expect(vi.mocked(api.inviteByEmail).mock.calls[1][1]).toEqual(['a@x.com']);
    expect(retried.rows[0].ok).toBe(true);
  });
});

describe('초대 문구', () => {
  const row = (kind: 'member' | 'email', ok: boolean) => ({ key: `${kind}${ok}`, kind, label: 'x', ok });
  it('등록 성공은 초대했어요, 전달·열람을 단정하지 않는다', () => {
    expect(inviteRowText(row('member', true))).toBe('초대했어요');
    expect(inviteRowText(row('member', false))).toBe('초대하지 못했어요');
    expect(inviteRowText(row('email', true))).toBe('메일 발송을 요청했어요');
    expect(inviteRowText(row('email', false))).toBe('발송하지 못했어요');
    for (const t of [inviteRowText(row('member', true)), inviteRowText(row('email', true))]) expect(t).not.toMatch(/받았|열었|전달|도착|수신/);
  });

  it('제목: 없음/이메일만/일부 실패/전원', () => {
    expect(inviteHeading([]).heading).toBe('초대한 회원이 아직 없어요');
    expect(inviteHeading([row('email', true)]).heading).toBe('메일 발송을 요청했어요');
    expect(inviteHeading([row('member', true), row('member', false)]).heading).toBe('회원 1명을 초대했어요');
    expect(inviteHeading([row('member', true), row('member', true)]).heading).toBe('초대한 회원 2명을 초대했어요');
  });
});

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
const text = (): string => container.textContent ?? '';
const click = async (el: Element | null | undefined): Promise<void> => { await act(async () => { (el as HTMLElement).click(); }); };
const byText = (sel: string, t: string): HTMLElement | undefined => [...container.querySelectorAll<HTMLElement>(sel)].find((el) => el.textContent?.includes(t));

function view(patch: Partial<WizardDraft> = {}, rows: CreatedView['rows'] = []): CreatedView {
  return { sessionId: 's-1', title: '제목', code: '4827', place: 'online', size: 'group', capacity: 10, band: 'optional', scheduleText: null, rows, ...patch } as CreatedView;
}

describe('CreatedScreen', () => {
  const noop = (): void => undefined;
  const props = { onCopyCode: noop, onOpenClass: noop, onDetail: noop, onList: noop, onRetry: noop, onSaveTemplate: noop };

  it('코드 4자리 큰 글자·복사·안내, QR 없음, 열러 가기 주 버튼 1개', async () => {
    await act(async () => root.render(createElement(CreatedScreen, { view: view(), ...props })));
    expect(container.querySelector('[data-pz="host-code"]')?.textContent).toBe('4827');
    expect(text()).toContain('코드 복사');
    expect(text()).toContain('코드는 참가자에게만 전달하세요');
    expect(text()).not.toContain('열리면 사용할 수 있어요');
    expect(text()).not.toMatch(/QR/);
    expect(container.querySelectorAll('[data-pz="flow-cta"]')).toHaveLength(1);
    expect(text()).toContain('클래스 열러 가기');
  });

  it('예약이면 일정 칩과 열리면 사용할 수 있다는 안내', async () => {
    await act(async () => root.render(createElement(CreatedScreen, { view: view({ scheduleText: '내일 오후 3:15' } as never), ...props })));
    expect(text()).toContain('내일 오후 3:15 예정');
    expect(text()).toContain('열리면 사용할 수 있어요. 코드는 참가자에게만 전달하세요');
  });

  it('초대 없음: 안내와 회원 초대하러 가기', async () => {
    let detail = 0;
    await act(async () => root.render(createElement(CreatedScreen, { view: view(), ...props, onDetail: () => { detail += 1; } })));
    expect(text()).toContain('초대한 회원이 아직 없어요');
    expect(text()).toContain('클래스 상세에서 언제든 회원을 초대할 수 있어요.');
    await click(byText('button', '회원 초대하러 가기'));
    expect(detail).toBe(1);
  });

  it('실패 행에만 다시 시도, 누르면 그 key 로 onRetry', async () => {
    const retried: string[] = [];
    const rows = [
      { key: 'member:m1', kind: 'member' as const, label: '김서연', ok: true },
      { key: 'member:m2', kind: 'member' as const, label: '이민준', ok: false },
      { key: 'email:a', kind: 'email' as const, label: 'ha***@…', ok: false },
    ];
    await act(async () => root.render(createElement(CreatedScreen, { view: view({}, rows), ...props, onRetry: (k: string) => retried.push(k) })));
    const buttons = [...container.querySelectorAll('button')].filter((b) => b.textContent?.includes('다시 시도'));
    expect(buttons).toHaveLength(2);
    expect(text()).toContain('ha***@…');
    expect(text()).toContain('발송하지 못했어요');
    await click(buttons[0]);
    expect(retried).toEqual(['member:m2']);
  });

  it('템플릿 저장 상태에 따라 버튼 문구', async () => {
    await act(async () => root.render(createElement(CreatedScreen, { view: view(), ...props, templateState: 'saved' })));
    expect(text()).toContain('템플릿 저장됨');
  });
});

vi.mock('../src/lib/api/clients', () => ({
  listClients: vi.fn(async () => ({ clients: [{ id: 'm1', name: '김서연', email: 'seoyeon@example.com', concerns: [], last_session_at: null }, { id: 'm2', name: '이민준', email: 'minjun@example.com', concerns: [], last_session_at: null }], total: 2, page: 1 })),
}));
vi.mock('../src/lib/api/counselor', () => ({ getCounselorProfile: vi.fn(async () => ({ org_id: null, address_line1: '서울 강남구', address_line2: '7층' })) }));
vi.mock('../src/lib/api/org', () => ({ getOrg: vi.fn(async () => null) }));
const sessionApi = vi.hoisted(() => ({
  createSession: vi.fn(), listSessions: vi.fn(), saveSessionAsTemplate: vi.fn(),
}));
vi.mock('../src/lib/api/session', () => sessionApi);
const hostApi = vi.hoisted(() => ({ inviteMember: vi.fn(), inviteByEmail: vi.fn() }));
vi.mock('../src/lib/api/class-flow-host', () => hostApi);

describe('CreateWizardContainer', () => {
  it('5단계를 지나 제출하면 생성 API → 초대 API 순서로 호출하고 완료 화면과 코드를 보인다', async () => {
    sessionApi.listSessions.mockResolvedValue({ sessions: [], total: 0 });
    sessionApi.createSession.mockResolvedValue({ id: 's-9', title: '새 클래스', access_code: '1234' });
    hostApi.inviteMember.mockResolvedValue({});
    const router = createMemoryRouter([
      { path: '/sessions/new', element: createElement(CreateWizardContainer) },
      { path: '/sessions/:id/player', element: createElement('div', null, '플레이어 화면') },
      { path: '/sessions', element: createElement('div', null, '목록 화면') },
    ], { initialEntries: ['/sessions/new'] });
    await act(async () => root.render(createElement(RouterProvider, { router })));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    // 1~4단계 이동 후 회원 선택
    await click(container.querySelector('[data-pz="flow-cta"]'));
    await click(container.querySelector('[data-pz="flow-cta"]'));
    await click(container.querySelector('[data-pz="flow-cta"]'));
    expect(text()).toContain('누구를 초대할까요?');
    await click(container.querySelector('button.fh-prow'));
    await click(container.querySelector('[data-pz="flow-cta"]'));
    expect(text()).toContain('이렇게 만들까요?');
    await click(container.querySelector('[data-pz="flow-cta"]'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(sessionApi.createSession).toHaveBeenCalledTimes(1);
    const payload = sessionApi.createSession.mock.calls[0][0] as { max_participants: number; location_type: string; scheduled_at?: string };
    expect(payload.max_participants).toBe(10);
    expect(payload.location_type).toBe('online');
    expect(payload.scheduled_at).toBeDefined();
    expect(hostApi.inviteMember).toHaveBeenCalledWith('s-9', 'm1');
    expect(text()).toContain('클래스를 만들었어요');
    expect(container.querySelector('[data-pz="host-code"]')?.textContent).toBe('1234');
    await click(byText('button', '클래스 열러 가기'));
    expect(router.state.location.pathname).toBe('/sessions/s-9/player');
  });

  it('생성이 실패하면 정해진 문구로 안내하고 서버 메시지는 보이지 않는다', async () => {
    sessionApi.listSessions.mockResolvedValue({ sessions: [], total: 0 });
    sessionApi.createSession.mockRejectedValue(new Error('SECRET_SERVER_DETAIL'));
    const router = createMemoryRouter([{ path: '/sessions/new', element: createElement(CreateWizardContainer) }], { initialEntries: ['/sessions/new'] });
    await act(async () => root.render(createElement(RouterProvider, { router })));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    for (let i = 0; i < 4; i += 1) await click(container.querySelector('[data-pz="flow-cta"]'));
    await click(container.querySelector('[data-pz="flow-cta"]'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(text()).toContain('클래스를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    expect(text()).not.toContain('SECRET_SERVER_DETAIL');
  });

  it('입력이 없으면 X 가 시트 없이 바로 목록으로 나간다', async () => {
    sessionApi.listSessions.mockResolvedValue({ sessions: [], total: 0 });
    const router = createMemoryRouter([
      { path: '/sessions/new', element: createElement(CreateWizardContainer) },
      { path: '/sessions', element: createElement('div', null, '목록 화면') },
    ], { initialEntries: ['/sessions/new'] });
    await act(async () => root.render(createElement(RouterProvider, { router })));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    await click(container.querySelector('[aria-label="나가기"]'));
    expect(router.state.location.pathname).toBe('/sessions');
  });

  it('입력이 있으면 X 가 시트를 열고 나가기를 눌러야 이동한다(dirty 일 때만 차단)', async () => {
    sessionApi.listSessions.mockResolvedValue({ sessions: [], total: 0 });
    const router = createMemoryRouter([
      { path: '/sessions/new', element: createElement(CreateWizardContainer) },
      { path: '/sessions', element: createElement('div', null, '목록 화면') },
    ], { initialEntries: ['/sessions/new'] });
    await act(async () => root.render(createElement(RouterProvider, { router })));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    await click(byText('button', '1:1'));
    await click(container.querySelector('[aria-label="나가기"]'));
    expect(text()).toContain('만들기를 그만둘까요?');
    expect(router.state.location.pathname).toBe('/sessions/new');
    await click([...container.querySelectorAll('button')].find((b) => b.textContent === '나가기'));
    expect(router.state.location.pathname).toBe('/sessions');
  });
});

void createInitialDraft;
