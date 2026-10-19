// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClassMembersPanel } from '../src/components/class/structure/class-members-panel';
import type { ClassDetailDto } from '../src/lib/api/class-structure';
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn().mockResolvedValue({}) }));
vi.mock('../src/lib/api/client', async (original) => ({ ...(await original<typeof import('../src/lib/api/client')>()), apiClient: api }));
const auth = vi.hoisted(() => ({ user: { id: 'admin', role: 'org_admin' } }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (s: typeof auth) => unknown) => selector(auth) }));
const detail = { id: 'class-id', status: 'active', capacity: 3, revision: 1, capabilities: { invite: true, host_request: true } } as ClassDetailDto;
let root: Root; let box: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); api.get.mockReset(); api.post.mockClear(); api.get.mockImplementation((path: string) => Promise.resolve(path.includes('member-candidates') ? { members: [{ id: 'new-member', name: '검색 회원', masked_email: 'me***@example.com' }], has_more: false } : path.endsWith('/members') ? { members: [{ id: 'membership', user_id: 'existing', name: '기존 회원', status: 'active' }] } : path.endsWith('email-invites') ? { invitations: [] } : { clients: [] })); box = document.createElement('div'); document.body.append(box); root = createRoot(box); });
afterEach(async () => { await act(async () => root.unmount()); box.remove(); vi.useRealTimers(); });
async function click(label: string) { const button = [...box.querySelectorAll('button')].find(b => b.textContent === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }
it('관리자 회원 초대는 상담 /clients 대신 클래스 후보 API를 사용한다', async () => {
  await act(async () => root.render(<ClassMembersPanel detail={detail} onSaved={() => {}} />));
  await click('회원 초대');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
  expect(api.get.mock.calls.some(([path]) => String(path).includes('/classes/member-candidates?class_id=class-id'))).toBe(true);
  expect(api.get.mock.calls.some(([path]) => String(path).startsWith('/clients'))).toBe(false);
  expect(box.textContent).toContain('검색 회원');
  expect(box.textContent).toContain('me***@example.com');
});

import { useState } from 'react';
import { ClassMemberPicker, type ClassMemberSelection } from '../src/components/class/structure/class-member-picker';
const candidateRows = [
  { id: 'one', name: '첫 회원', masked_email: 'fi***@example.com' },
  { id: 'two', name: '둘 회원', masked_email: 'se***@example.com' },
  { id: 'existing', name: '기존 회원', masked_email: 'ex***@example.com' },
];
function Harness({ disabled = false }: { disabled?: boolean }) {
  const [selected, setSelected] = useState<ClassMemberSelection[]>([]);
  return <><ClassMemberPicker selected={selected} onChange={setSelected} maxParticipants={1} excludeUserIds={['existing']} disabled={disabled} /><output>{JSON.stringify(selected)}</output></>;
}
async function searchText(value: string) {
  const input = box.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function settleSearch() { await act(async () => { await vi.advanceTimersByTimeAsync(200); }); }
it('생성 전 검색은 classId 없이 호출하고 정원·제외·선택해제를 지킨다', async () => {
  vi.useFakeTimers(); api.get.mockResolvedValue({ members: candidateRows, has_more: true });
  await act(async () => root.render(<Harness />)); await settleSearch();
  expect(api.get).toHaveBeenCalledWith('/classes/member-candidates', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(box.textContent).not.toContain('기존 회원');
  const checks = [...box.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  await act(async () => checks[0].click());
  expect(checks[1].disabled).toBe(true);
  expect(box.querySelector('output')?.textContent).toContain('"userId":"one"');
  expect(box.querySelector('output')?.textContent).not.toContain('"email"');
  await click('×'); expect(checks[1].disabled).toBe(false);
  expect(box.textContent).toContain('검색 결과가 더 있어요');
});
it('이전 검색을 취소하며 늦은 응답이 최신 결과를 덮지 않는다', async () => {
  vi.useFakeTimers();
  let finish!: (value: { members: typeof candidateRows; has_more: boolean }) => void;
  api.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ members: [candidateRows[1]], has_more: false });
  await act(async () => root.render(<Harness />)); await settleSearch();
  const previousSignal = api.get.mock.calls[0][1].signal as AbortSignal;
  await searchText('둘 회원'); expect(previousSignal.aborted).toBe(true); await settleSearch();
  await act(async () => finish({ members: [candidateRows[0]], has_more: false }));
  expect(box.textContent).toContain('둘 회원'); expect(box.textContent).not.toContain('첫 회원');
  expect(api.get.mock.calls[1][0]).toBe('/classes/member-candidates?q=%EB%91%98+%ED%9A%8C%EC%9B%90');
});
it('검색 오류를 안내하고 비활성 선택기는 추가 요청을 하지 않는다', async () => {
  vi.useFakeTimers(); api.get.mockRejectedValue(new Error('서버 내부 상세'));
  await act(async () => root.render(<Harness />)); await settleSearch();
  expect(box.textContent).toContain('회원을 불러오지 못했어요'); expect(box.textContent).not.toContain('서버 내부 상세');
  const count = api.get.mock.calls.length;
  await act(async () => root.render(<Harness disabled />)); await settleSearch();
  expect(api.get).toHaveBeenCalledTimes(count);
  expect(box.querySelector<HTMLInputElement>('input[type="search"]')?.disabled).toBe(true);
});
it('선택 회원은 이름·이메일 없이 UUID와 관리자 사유로 초대한다', async () => {
  vi.useFakeTimers();
  await act(async () => root.render(<ClassMembersPanel detail={detail} onSaved={() => {}} />));
  await click('회원 초대'); await settleSearch();
  await act(async () => box.querySelector<HTMLInputElement>('input[aria-label="검색 회원 선택"]')!.click());
  const reason = [...box.querySelectorAll('label')].find(label => label.textContent?.includes('센터 관리자 변경 사유'))!.querySelector('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reason, '신청 회원 초대'); reason.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('선택 회원 초대');
  expect(api.post).toHaveBeenCalledWith('/classes/class-id/members', expect.objectContaining({ user_ids: ['new-member'], reason: '신청 회원 초대', expected_revision: 1, reactivate: false }));
  expect(JSON.stringify(api.post.mock.calls)).not.toContain('me***@example.com');
  expect(box.textContent).toContain('저장했어요');
});

function BoundaryHarness({ classId, onClear }: { classId: string; onClear: (visibleSelection: string) => void }) {
  const [selected, setSelected] = useState<ClassMemberSelection[]>([{ userId: 'old-id', name: '이전 선택 회원' }]);
  return <><ClassMemberPicker classId={classId} selected={selected} onChange={next => {
    if (next.length === 0) onClear(box.querySelector('.class-member-picker__selected')?.textContent ?? '');
    setSelected(next);
  }} maxParticipants={2} /><output>{JSON.stringify(selected)}</output></>;
}
it.each(['account', 'class'])('%s 경계가 바뀌면 첫 렌더부터 이전 선택을 숨기고 부모 UUID도 비운다', async kind => {
  vi.useFakeTimers(); const onClear = vi.fn(); const oldId = auth.user.id;
  await act(async () => root.render(<BoundaryHarness classId="first-class" onClear={onClear} />));
  expect(box.textContent).toContain('이전 선택 회원');
  if (kind === 'account') auth.user.id = 'new-actor';
  try {
    await act(async () => root.render(<BoundaryHarness classId={kind === 'class' ? 'second-class' : 'first-class'} onClear={onClear} />));
    expect(onClear).toHaveBeenCalledWith('');
    expect(box.textContent).not.toContain('이전 선택 회원');
    expect(box.querySelector('output')?.textContent).toBe('[]');
  } finally { auth.user.id = oldId; }
});
it('같은 계정과 클래스에서 검색어만 바꾸면 기존 선택은 유지한다', async () => {
  vi.useFakeTimers(); const onClear = vi.fn();
  await act(async () => root.render(<BoundaryHarness classId="first-class" onClear={onClear} />));
  await searchText('다른 회원');
  expect(onClear).not.toHaveBeenCalled();
  expect(box.querySelector('output')?.textContent).toContain('old-id');
  expect(box.textContent).toContain('이전 선택 회원');
});
it('부모 선택 초기화가 늦어도 이전 이름을 다시 표시하거나 새 선택에 섞지 않는다', async () => {
  vi.useFakeTimers(); api.get.mockResolvedValue({ members: candidateRows, has_more: false });
  const onChange = vi.fn(); const selected = [{ userId: 'old-id', name: '이전 선택 회원' }];
  await act(async () => root.render(<ClassMemberPicker classId="old-class" selected={selected} onChange={onChange} maxParticipants={3} />));
  await act(async () => root.render(<ClassMemberPicker classId="new-class" selected={selected} onChange={onChange} maxParticipants={3} />));
  await settleSearch();
  expect(onChange).toHaveBeenCalledWith([]);
  expect(box.textContent).not.toContain('이전 선택 회원');
  expect([...box.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(input => input.disabled)).toBe(true);
});
it('회원 선택기를 닫고 계정을 바꾼 뒤 다시 열면 부모의 이전 선택도 복원되지 않는다', async () => {
  vi.useFakeTimers(); const previousActor = auth.user.id;
  try {
    await act(async () => root.render(<ClassMembersPanel detail={detail} onSaved={() => {}} />));
    await click('회원 초대'); await settleSearch();
    await act(async () => box.querySelector<HTMLInputElement>('input[aria-label="검색 회원 선택"]')!.click());
    expect(box.querySelector('.class-member-picker__selected')?.textContent).toContain('검색 회원');
    await click('회원 초대');
    expect(box.querySelector('[data-class-member-picker]')).toBeNull();
    auth.user.id = 'second-admin';
    await act(async () => root.render(<ClassMembersPanel detail={detail} onSaved={() => {}} />));
    await click('회원 초대'); await settleSearch();
    expect(box.querySelector('.class-member-picker__selected')).toBeNull();
    const invite = [...box.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '선택 회원 초대')!;
    expect(invite.disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  } finally { auth.user.id = previousActor; }
});
