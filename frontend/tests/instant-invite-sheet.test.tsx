// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InstantInviteSheet } from '../src/pages/classes/instant-invite-sheet';
const mocks = vi.hoisted(() => ({ members: vi.fn(), inviteMembers: vi.fn(), inviteEmails: vi.fn(), getClass: vi.fn(), sent: vi.fn(), max: 0 }));
vi.mock('../src/lib/api/class-operations', () => ({ classOperationsApi: mocks }));
vi.mock('../src/lib/api/class-scheduling', () => ({ schedulingApi: mocks }));
vi.mock('../src/lib/api/class-structure', () => ({ getClass: mocks.getClass }));
vi.mock('../src/components/class/structure/class-member-picker', () => ({ ClassMemberPicker: ({ maxParticipants, disabled, onChange }: { maxParticipants: number; disabled: boolean; onChange: (value: { userId: string; name: string }[]) => void }) => { mocks.max = maxParticipants; return <button disabled={disabled || maxParticipants < 1} onClick={() => onChange([{ userId: 'u2', name: '회원' }])}>회원 선택</button>; } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let box: HTMLDivElement; let root: Root;
beforeEach(() => { mocks.members.mockResolvedValue({ members: [{ user_id: 'existing', status: 'active' }] }); mocks.getClass.mockResolvedValue({ revision: 7, capacity: 2 }); mocks.inviteMembers.mockResolvedValue({}); mocks.inviteEmails.mockResolvedValue({}); });
afterEach(async () => { if (root) await act(async () => root.unmount()); box?.remove(); vi.clearAllMocks(); });
async function mount() { box = document.createElement('div'); document.body.append(box); root = createRoot(box); await act(async () => root.render(<InstantInviteSheet classId="c1" capacity={2} admin={false} onClose={() => {}} onSent={mocks.sent} />)); }
async function press(text: string) { await act(async () => [...box.querySelectorAll('button')].find(button => button.textContent === text)!.click()); }
it('기존 인원만큼 정원을 제한하고 회원 UUID·revision·reactivate false로 초대한다', async () => { await mount(); expect(mocks.max).toBe(1); await press('회원 선택'); await press('초대 보내기'); expect(mocks.inviteMembers.mock.calls[0]).toEqual(['c1', expect.objectContaining({ user_ids: ['u2'], reactivate: false, expected_revision: 7 })]); expect(mocks.sent).toHaveBeenCalledTimes(1); expect(box.querySelectorAll('[role="tab"]')).toHaveLength(2); });
it('실패 재시도는 같은 키와 revision을 유지한다', async () => { mocks.inviteMembers.mockRejectedValueOnce(new Error('연결')); await mount(); await press('회원 선택'); await press('초대 보내기'); expect(mocks.sent).not.toHaveBeenCalled(); await press('초대 보내기'); expect(mocks.inviteMembers.mock.calls[0][1]).toEqual(mocks.inviteMembers.mock.calls[1][1]); expect(mocks.sent).toHaveBeenCalledTimes(1); });
it('이메일 탭은 이메일 API에만 전달한다', async () => { await mount(); await press('이메일'); const input = box.querySelector('textarea')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'person@example.com'); input.dispatchEvent(new Event('input', { bubbles: true })); }); await press('초대 보내기'); expect(mocks.inviteEmails).toHaveBeenCalledWith('c1', expect.objectContaining({ emails: ['person@example.com'], expected_revision: 7 })); expect(mocks.inviteMembers).not.toHaveBeenCalled(); });
