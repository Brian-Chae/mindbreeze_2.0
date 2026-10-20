// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemberInviteSheet } from '../src/components/class/flow/host/MemberInviteSheet';
import { ToolsSheet } from '../src/components/class/player/host/sheets/ToolsSheet';
import type { ClassDetailDto } from '../src/lib/api/class-structure';
const api = vi.hoisted(() => ({ invite: vi.fn(), emails: vi.fn(), members: vi.fn(), candidates: vi.fn(), saved: vi.fn(), copy: vi.fn() }));
vi.mock('../src/lib/api/class-operations', () => ({ classOperationsApi: { inviteMembers: api.invite, members: api.members } }));
vi.mock('../src/lib/api/class-scheduling', () => ({ schedulingApi: { inviteEmails: api.emails } }));
vi.mock('../src/lib/api/class-member-candidates', () => ({ searchClassMemberCandidates: api.candidates }));
const detail = { id: 'class-1', status: 'active', revision: 7, capacity: 10, capabilities: { invite: true, manage: true, schedule: true } } as ClassDetailDto;
let root: Root; let el: HTMLDivElement;
async function render(open = true, value = detail) {
  await act(async () => root.render(<MemberInviteSheet open={open} detail={value} code="1234" onCopyCode={api.copy} onClose={() => undefined} onSaved={api.saved} />));
}
async function click(label: string) {
  const button = [...el.querySelectorAll('button')].find(node => node.textContent === label);
  expect(button, label).toBeTruthy(); await act(async () => button!.click());
}
async function select() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 240)); });
  await act(async () => el.querySelector<HTMLInputElement>('[aria-label="홍길동 선택"]')!.click());
}
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.members.mockResolvedValue({ members: [] });
  api.candidates.mockResolvedValue({ members: [{ id: 'member-1', name: '홍길동', masked_email: 'h***@test.com' }], has_more: false });
  api.invite.mockResolvedValue({ current_session_id: 'session-1' }); api.emails.mockResolvedValue({ invitations: [] });
  api.saved.mockResolvedValue({ ...detail, revision: 8 });
  el = document.createElement('div'); document.body.append(el); root = createRoot(el);
});
afterEach(async () => { await act(async () => root.unmount()); el.remove(); });
it('열렸을 때 회원 초대 시트와 입장 코드 복사를 제공한다', async () => {
  await render(false); expect(el.querySelector('[role="dialog"]')).toBeNull();
  await render(); expect(el.querySelector('[role="dialog"]')?.textContent).toContain('회원 초대');
  await click('입장 코드 복사'); expect(api.copy).toHaveBeenCalledOnce();
});
it('선택 회원을 revision command로 초대하고 성공 안내와 명부 갱신을 한다', async () => {
  await render(); await select(); await click('선택 회원 초대');
  expect(api.invite).toHaveBeenCalledWith('class-1', expect.objectContaining({ expected_revision: 7, operation_key: expect.any(String), user_ids: ['member-1'], reactivate: false }));
  expect(el.textContent).toContain('초대했어요. 지금 바로 입장할 수 있어요');
  expect(api.saved).toHaveBeenCalledOnce(); expect(api.members).toHaveBeenCalledTimes(2);
  await select(); await click('선택 회원 초대');
  expect(api.invite).toHaveBeenLastCalledWith('class-1', expect.objectContaining({ expected_revision: 8 }));
});
it('초대 실패 메시지를 표시하고 성공 갱신을 하지 않는다', async () => {
  api.invite.mockRejectedValue(new Error('초대 권한이 없어요'));
  await render(); await select(); await click('선택 회원 초대');
  expect(el.querySelector('[role="alert"]')?.textContent).toContain('초대 권한이 없어요'); expect(api.saved).not.toHaveBeenCalled();
});
it('비활성 클래스와 초대 권한 없는 클래스에는 시트를 표시하지 않는다', async () => {
  await render(true, { ...detail, status: 'completed' }); expect(el.querySelector('[role="dialog"]')).toBeNull();
  await render(true, { ...detail, capabilities: { ...detail.capabilities!, invite: false } }); expect(el.querySelector('[role="dialog"]')).toBeNull();
});
it('이메일을 정규화하고 중복을 제거해 초대한다', async () => {
  await render();
  await act(async () => {
    const field = el.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'TEST@EXAMPLE.COM; test@example.com, second@example.com');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('이메일로 초대');
  expect(api.emails).toHaveBeenCalledWith('class-1', expect.objectContaining({ expected_revision: 7, emails: ['test@example.com', 'second@example.com'] }));
  expect(el.textContent).toContain('이메일 초대를 요청했어요');
  expect(el.textContent).not.toContain('지금 바로 입장할 수 있어요');
});

it('발송 실패 상태의 이메일은 성공이나 즉시 입장으로 안내하지 않는다', async () => {
  api.emails.mockResolvedValue({ invitations: [{ id: 'email-1', email: 'test@example.com', status: 'failed' }] });
  await render();
  await act(async () => {
    const field = el.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'test@example.com');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('이메일로 초대');
  expect(el.textContent).toContain('발송에 실패한 이메일 초대가 있어요');
  expect(el.textContent).not.toContain('지금 바로 입장할 수 있어요');
});
it('진행 중 도구에서 초대 콜백이 있을 때 44px 회원 초대 버튼을 제공한다', async () => {
  const invite = vi.fn();
  const props = { sort: 'join' as const, onSort: vi.fn(), showHandsFirst: false, handsFirst: false, onHandsFirst: vi.fn(), table: false, onTable: vi.fn(), accessCode: '1234', codeCopied: false, onCopyCode: vi.fn(), selfBandText: '미착용', onOpenMyband: vi.fn() };
  await act(async () => root.render(<ToolsSheet {...props} onInvite={invite} />));
  const button = [...el.querySelectorAll('button')].find(node => node.textContent === '회원 초대')!;
  expect(button.className).toContain('min-h-[44px]');
  await click('회원 초대'); expect(invite).toHaveBeenCalledOnce();
  await act(async () => root.render(<ToolsSheet {...props} />));
  expect([...el.querySelectorAll('button')].some(node => node.textContent === '회원 초대')).toBe(false);
});
