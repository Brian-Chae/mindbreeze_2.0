// @vitest-environment jsdom
// [MB261026][FIX] 채팅 신고 운영 처리·게시 필터(D4) — verify V-20, V-38, V-42, V-44~V-52.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adminApi = vi.hoisted(() => ({
  listChatReports: vi.fn(),
  getChatReport: vi.fn(),
  transitionChatReport: vi.fn(),
  listChatFilterTerms: vi.fn(),
  addChatFilterTerm: vi.fn(),
  removeChatFilterTerm: vi.fn(),
}));
vi.mock('../src/lib/api/admin', async (orig) => ({ ...(await orig<object>()), ...adminApi }));

const chatApi = vi.hoisted(() => ({
  listChatMessages: vi.fn(),
  listChatMessagesAround: vi.fn(),
  sendChatMessage: vi.fn(),
  markRoomRead: vi.fn(async () => ({})),
  markMessagesRead: vi.fn(async () => ({})),
  reportChatUser: vi.fn(),
  listChatBlocks: vi.fn(),
  unblockChatUser: vi.fn(),
  withdrawChatReport: vi.fn(),
}));
vi.mock('../src/lib/api/chat', async (orig) => ({ ...(await orig<object>()), ...chatApi }));
vi.mock('../src/components/layout/AppShell', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('../src/lib/socket', () => ({
  getChatSocket: vi.fn(() => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() })),
}));
vi.mock('../src/stores/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ fetch: vi.fn(async () => {}) }) },
}));

import ChatReportsPage from '../src/pages/admin/ChatReportsPage';
import { ChatRoom } from '../src/components/chat/ChatRoom';
import { ReportDialog } from '../src/components/chat/report-dialog';
import { BlockedUsersList } from '../src/components/chat/blocked-users-list';
import { TermsPage } from '../src/pages/terms-page';
import { ApiError } from '../src/lib/api/client';
import { CHAT_REPORT_CONTACT_EMAIL } from '../src/lib/api/chat';
import { OPERATIONS_EMAIL, findPublicCopyViolations } from '../src/lib/legal-copy';
import { useAuthStore } from '../src/stores/authStore';
import { useChatStore } from '../src/stores/chatStore';
import type { ChatReportDetailDto, ChatReportItemDto, ChatReportListResponse } from '../src/lib/api/admin';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const buttons = (): HTMLButtonElement[] => Array.from(document.querySelectorAll('button'));
const byText = (t: string): HTMLButtonElement | undefined => buttons().find((b) => b.textContent?.trim() === t);
const read = (path: string): string => readFileSync(resolve(__dirname, '../src', path), 'utf8');
const render = async (node: ReactNode): Promise<void> => { await act(async () => { root.render(node); }); await flush(); };
const click = async (el: Element | undefined | null): Promise<void> => {
  expect(el, '클릭할 요소').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
};
const typeInto = async (el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const person = (id: string, name: string) => ({ id, name });
function item(overrides: Partial<ChatReportItemDto>): ChatReportItemDto {
  return {
    id: 'r1',
    status: 'submitted',
    reason: 'abuse',
    created_at: '2026-10-26T01:00:00Z',
    reporter: person('u1', '신고자A'),
    reported_user: person('u2', '대상B'),
    room_type: 'direct',
    has_message: true,
    ack_due_at: '2026-10-28T14:59:59Z',
    decision_due_at: '2026-11-02T14:59:59Z',
    acknowledged_at: null,
    decided_at: null,
    withdrawn_at: null,
    ack_overdue: false,
    decision_overdue: false,
    handled_by_name: null,
    ...overrides,
  };
}
function listResponse(items: ChatReportItemDto[], configured = true): ChatReportListResponse {
  return {
    items,
    total: items.length,
    page: 1,
    size: 50,
    counts: { submitted: 1, reviewing: 0, actioned: 0, dismissed: 0, withdrawn: 0 },
    notice_email_configured: configured,
  };
}
const detailOf = (base: ChatReportItemDto): ChatReportDetailDto => ({
  ...base,
  reporter: { ...base.reporter, email: 'a@example.invalid' },
  reported_user: { ...base.reported_user, email: 'b@example.invalid' },
  room_id: 'room1',
  message_id: 'm1',
  message_excerpt: '신고된 원문',
  resolution_note: null,
  history: [],
});

beforeEach(() => {
  Object.values(adminApi).forEach((m) => m.mockReset());
  Object.values(chatApi).forEach((m) => m.mockReset());
  chatApi.markRoomRead.mockResolvedValue({});
  chatApi.markMessagesRead.mockResolvedValue({});
  adminApi.listChatFilterTerms.mockResolvedValue({ items: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

const renderPage = (): Promise<void> => render(createElement(MemoryRouter, null, createElement(ChatReportsPage)));

describe('관리자 채팅 신고 화면', () => {
  it('V-45 목록 열과 상태·기한 초과 배지를 보여 준다', async () => {
    adminApi.listChatReports.mockResolvedValue(listResponse([
      item({ id: 'r1' }),
      item({ id: 'r2', status: 'reviewing', acknowledged_at: '2026-10-27T01:00:00Z', decision_overdue: true }),
    ]));
    await renderPage();
    const headers = Array.from(container.querySelectorAll('th')).map((th) => th.textContent?.trim());
    expect(headers).toEqual(['접수 일시', '상태', '사유', '신고자', '대상', '접수 확인 기한', '1차 판단 기한', '처리자']);
    expect(container.textContent).toContain('신고자A');
    expect(container.textContent).toContain('대상B');
    expect(container.textContent).toContain('욕설·비하·괴롭힘');
    expect(container.querySelectorAll('[data-overdue="true"]')).toHaveLength(1);
    expect(container.textContent).toContain('기한 초과');
    expect(container.textContent).not.toContain('신고된 원문');
  });

  it('V-44 운영 수신 주소 미설정이면 배너를 보여 주고 주소 값은 없다', async () => {
    adminApi.listChatReports.mockResolvedValue(listResponse([item({})], false));
    await renderPage();
    expect(container.querySelector('[data-testid="notice-email-missing"]')?.textContent).toContain('운영 신고 수신 주소가 설정되지 않아');
    expect(container.textContent).not.toMatch(/@/);
  });

  it('V-46 행을 골라도 상세 API 는 부르지 않고, 메시지 보기를 눌러야 1회 부른다', async () => {
    const base = item({});
    adminApi.listChatReports.mockResolvedValue(listResponse([base]));
    adminApi.getChatReport.mockResolvedValue(detailOf(base));
    await renderPage();
    await click(container.querySelector('tbody tr'));
    expect(adminApi.getChatReport).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('신고된 원문');
    await click(byText('신고된 메시지 보기'));
    expect(adminApi.getChatReport).toHaveBeenCalledTimes(1);
    expect(adminApi.getChatReport).toHaveBeenCalledWith('r1');
    expect(container.textContent).toContain('신고된 원문');
  });

  it('V-47 판단 버튼은 메모가 있어야 눌리고, 제출하면 전이 API 를 1회 부른다', async () => {
    const base = item({ status: 'reviewing', acknowledged_at: '2026-10-27T01:00:00Z' });
    adminApi.listChatReports
      .mockResolvedValueOnce(listResponse([base]))
      .mockResolvedValue(listResponse([{ ...base, status: 'dismissed', decided_at: '2026-10-27T02:00:00Z' }]));
    adminApi.transitionChatReport.mockResolvedValue({ ...base, status: 'dismissed', resolution_note: '위반 아님', history: [] });
    await renderPage();
    await click(container.querySelector('tbody tr'));
    expect(byText('조치 완료')!.disabled).toBe(true);
    expect(byText('조치 없음 종결')!.disabled).toBe(true);
    await typeInto(container.querySelector('textarea[name="resolution-note"]') as HTMLTextAreaElement, '위반 아님');
    expect(byText('조치 없음 종결')!.disabled).toBe(false);
    await click(byText('조치 없음 종결'));
    expect(adminApi.transitionChatReport).toHaveBeenCalledTimes(1);
    expect(adminApi.transitionChatReport).toHaveBeenCalledWith('r1', 'dismissed', '위반 아님');
    expect(adminApi.listChatReports).toHaveBeenCalledTimes(2);
  });

  it('접수 상태에서는 검토 시작으로 접수를 확인한다', async () => {
    const base = item({});
    adminApi.listChatReports.mockResolvedValue(listResponse([base]));
    adminApi.transitionChatReport.mockResolvedValue({ ...base, status: 'reviewing', resolution_note: null, history: [] });
    await renderPage();
    await click(container.querySelector('tbody tr'));
    await click(byText('검토 시작'));
    expect(adminApi.transitionChatReport).toHaveBeenCalledWith('r1', 'reviewing', undefined);
  });

  it('V-20 철회된 신고는 회색 배지와 비활성 처리 버튼', async () => {
    adminApi.listChatReports.mockResolvedValue(listResponse([item({ status: 'withdrawn', withdrawn_at: '2026-10-26T02:00:00Z' })]));
    await renderPage();
    expect(container.querySelector('tbody')?.textContent).toContain('신고자 철회');
    await click(container.querySelector('tbody tr'));
    for (const label of ['검토 시작', '조치 완료', '조치 없음 종결']) {
      expect(byText(label)?.disabled, label).toBe(true);
    }
  });

  it('V-48 금칙어 탭에서 추가·삭제(확인)하고 중복은 안내한다', async () => {
    adminApi.listChatReports.mockResolvedValue(listResponse([]));
    adminApi.listChatFilterTerms
      .mockResolvedValueOnce({ items: [{ id: 't1', term: '기존단어', created_at: null, created_by_name: '운영자' }] })
      .mockResolvedValue({ items: [] });
    adminApi.addChatFilterTerm
      .mockResolvedValueOnce({ id: 't2', term: '새단어', created_at: null, created_by_name: '운영자' })
      .mockRejectedValueOnce(new ApiError(409, '이미 등록된 단어입니다', { detail: { code: 'CHAT_FILTER_TERM_EXISTS', message: '이미 등록된 단어입니다' } }));
    adminApi.removeChatFilterTerm.mockResolvedValue(undefined);
    await renderPage();
    await click(byText('금칙어'));
    expect(container.textContent).toContain('기존단어');

    const input = container.querySelector('input[name="filter-term"]') as HTMLInputElement;
    await typeInto(input, '새단어');
    await click(byText('추가'));
    expect(adminApi.addChatFilterTerm).toHaveBeenCalledWith('새단어');
    await typeInto(input, '새단어');
    await click(byText('추가'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('이미 등록된 단어입니다');

    adminApi.listChatFilterTerms.mockResolvedValue({ items: [{ id: 't1', term: '기존단어', created_at: null, created_by_name: '운영자' }] });
    await click(byText('금칙어')); // 목록 새로고침
    await click(byText('삭제'));
    expect(adminApi.removeChatFilterTerm).not.toHaveBeenCalled(); // 확인 전에는 지우지 않는다
    await click(byText('삭제 확인'));
    expect(adminApi.removeChatFilterTerm).toHaveBeenCalledWith('t1');
  });
});

describe('채팅 게시 필터 안내', () => {
  it('V-38 금칙어로 막히면 입력란에 원문을 되돌리고 다시보내기 버튼이 없다', async () => {
    Element.prototype.scrollTo = vi.fn();
    globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof IntersectionObserver;
    chatApi.listChatMessages.mockResolvedValue({ messages: [] });
    chatApi.sendChatMessage.mockRejectedValue(new ApiError(422, '운영정책에 맞지 않는 표현이 있어 보낼 수 없어요. 내용을 고쳐 다시 보내 주세요.', {
      detail: { code: 'CHAT_CONTENT_BLOCKED', message: '운영정책에 맞지 않는 표현이 있어 보낼 수 없어요. 내용을 고쳐 다시 보내 주세요.' },
    }));
    useChatStore.setState({ rooms: [], messagesByRoom: {} });
    useAuthStore.setState({ isAuthenticated: true, accessToken: 'token', user: { id: 'me', name: '나', email: 'me@x.com', role: 'client' } } as never);
    await render(createElement(ChatRoom, { roomId: 'room' }));
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await typeInto(textarea, '고쳐야 할 문장');
    await click(byText('전송'));
    expect(chatApi.sendChatMessage).toHaveBeenCalledTimes(1);
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('고쳐야 할 문장');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('운영정책에 맞지 않는 표현');
    expect(byText('다시보내기')).toBeUndefined();
    expect(useChatStore.getState().messagesByRoom.room ?? []).toHaveLength(0);
  });
});

describe('신고자 화면 문구', () => {
  it('V-49 신고 완료 화면에 영업일 기한과 운영 이메일이 보인다', async () => {
    chatApi.reportChatUser.mockResolvedValue({ reported: true, blocked: true, report_id: 'r1' });
    await render(createElement(ReportDialog, { targetUserId: 'u2', targetName: '대상B', onClose: vi.fn(), onReported: vi.fn() }));
    await click(byText('신고하고 차단'));
    const text = document.body.textContent ?? '';
    expect(text).toContain('영업일 기준 2일');
    expect(text).toContain('5일');
    const mail = document.body.querySelector('a[href^="mailto:"]') as HTMLAnchorElement;
    expect(mail.getAttribute('href')).toBe(`mailto:${OPERATIONS_EMAIL}`);
  });

  it('V-50 차단 목록이 운영 처리 상태를 보여 주고 철회 버튼은 접수일 때만', async () => {
    chatApi.listChatBlocks.mockResolvedValue({ blocks: [
      { user_id: 'u1', name: 'A', blocked_at: null, report_id: 'r1', report_status: 'reviewing' },
      { user_id: 'u2', name: 'B', blocked_at: null, report_id: 'r2', report_status: 'actioned' },
      { user_id: 'u3', name: 'C', blocked_at: null, report_id: 'r3', report_status: 'dismissed' },
    ] });
    await render(createElement(BlockedUsersList));
    const rows = Array.from(container.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(rows[0]).toContain('운영 검토 중');
    expect(rows[1]).toContain('처리 완료');
    expect(rows[2]).toContain('처리 완료');
    expect(byText('신고 철회')).toBeUndefined();
  });

  it('V-52 약관에 신고 처리 기한·필터 안내가 있고 공개 문구 금지어가 없다', async () => {
    await render(createElement(MemoryRouter, null, createElement(TermsPage)));
    const text = container.textContent ?? '';
    expect(text).toContain('영업일 기준 2일');
    expect(text).toContain('5일');
    expect(text).toContain('운영정책에 맞지 않는 표현');
    for (const banned of ['24시간', '자동 삭제', '자동 정지']) expect(text).not.toContain(banned);
    expect(findPublicCopyViolations(text)).toEqual([]);
    const dialog = read('components/chat/report-dialog.tsx');
    expect(findPublicCopyViolations(dialog)).toEqual([]);
    for (const banned of ['24시간', '자동 삭제', '자동 정지']) expect(dialog).not.toContain(banned);
  });
});

describe('소스 계약', () => {
  it('V-42 사용자에게 보이는 신고 연락처는 승인된 운영 이메일이고 개인 주소가 없다', () => {
    expect(CHAT_REPORT_CONTACT_EMAIL).toBe(OPERATIONS_EMAIL);
    for (const file of ['lib/api/chat.ts', 'components/chat/ChatRoom.tsx', 'components/chat/report-dialog.tsx', 'pages/admin/ChatReportsPage.tsx']) {
      expect(read(file), file).not.toContain('brian.chae@');
    }
  });

  it('V-51 관리자 신고 화면은 플랫폼 관리자 가드 안에 있고 사이드바에 메뉴가 있다', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/path="\/admin\/chat-reports"[\s\S]{0,200}<PlatformAdminRoute>/);
    expect(read('components/layout/SidebarNav.tsx')).toMatch(/to: '\/admin\/chat-reports', label: '채팅 신고'/);
  });
});

describe('실제 API 클라이언트 오류 문구 (E2E 에서 발견: {code,message} 가 "API 요청 실패 (422)"로 보이던 문제)', () => {
  it.each([
    ['CHAT_CONTENT_BLOCKED', '운영정책에 맞지 않는 표현'],
    ['CHAT_FILTER_TERM_EXISTS', '이미 등록된 단어입니다'],
    ['CHAT_FILTER_TERM_LIMIT', '최대 500개'],
    ['CHAT_FILTER_TERM_INVALID', '2~50자'],
    ['REPORT_CLOSED', '이미 판단이 끝난 신고'],
    ['REPORT_WITHDRAWN', '신고자가 철회한 신고'],
    ['INVALID_REPORT_TRANSITION', '이 상태로 바꿀 수 없습니다'],
    ['RESOLUTION_NOTE_REQUIRED', '메모'],
  ])('%s 코드는 사용자 문구로 바뀐다', async (code, expected) => {
    const { formatErrorDetail } = await import('../src/lib/api/client');
    const text = formatErrorDetail({ code, message: 'server' }) ?? '';
    expect(text).toContain(expected);
  });
});
