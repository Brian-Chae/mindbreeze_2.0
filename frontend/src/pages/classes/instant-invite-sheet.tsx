import { useEffect, useRef, useState } from 'react';
import { ClassMemberPicker, type ClassMemberSelection } from '../../components/class/structure/class-member-picker';
import { classOperationsApi } from '../../lib/api/class-operations';
import { ApiError } from '../../lib/api/client';
import { getClass } from '../../lib/api/class-structure';
import { schedulingApi } from '../../lib/api/class-scheduling';
import { asClassId } from '../../lib/class-structure/read-model';
import { operationKeys, parseInviteEmails, schedulingError } from '../../lib/class-structure/scheduling-model';
import { WizardSheet } from './wizard-visual-components';
export interface InstantInviteSelection { members: ClassMemberSelection[]; emails: string[] }
interface Props { classId?: string; capacity: number; admin: boolean; selected?: InstantInviteSelection; onClose: () => void; onSent: (selection: InstantInviteSelection) => void }
export function InstantInviteSheet({ classId, capacity, admin, selected, onClose, onSent }: Props) {
  const [tab, setTab] = useState<'members' | 'emails'>('members');
  const [members, setMembers] = useState(selected?.members ?? []);
  const [emails, setEmails] = useState(selected?.emails.join('\n') ?? '');
  const [existing, setExisting] = useState<string[]>([]); const [existingCount, setExistingCount] = useState(0); const [membersReady, setMembersReady] = useState(!classId);
  const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(classId));
  useEffect(() => { let active = true; if (!classId) return; classOperationsApi.members(classId).then(result => { if (active) { const activeMembers = result.members.filter(member => member.status === 'active' || member.status === 'invited'); setExisting(activeMembers.flatMap(member => member.user_id ? [member.user_id] : [])); setExistingCount(activeMembers.length); setMembersReady(true); } }).catch(() => { if (active) setError('현재 인원을 확인하지 못했어요. 시트를 다시 열어 주세요.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [classId]);
  const locked = useRef(false); const keyFor = useRef(operationKeys());
  const pending = useRef<{ signature: string; revision: number } | null>(null);
  async function send() {
    if (locked.current || !membersReady) return;
    const addresses = parseInviteEmails(emails);
    if (addresses.some(email => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) || addresses.length > 100) { setError('이메일은 올바른 주소로 100개까지 입력해 주세요.'); return; }
    if (!classId) { if (members.length + addresses.length > capacity) { setError('정원을 초과했어요.'); return; } onSent({ members, emails: addresses }); return; }
    if (admin && !reason.trim()) { setError('센터 관리자 대행 사유를 입력해 주세요.'); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      const signature = JSON.stringify({ tab, members, addresses, reason });
      if (pending.current?.signature !== signature) {
        const [detail, result] = await Promise.all([getClass(asClassId(classId)), classOperationsApi.members(classId)]);
        const active = result.members.filter(member => member.status === 'active' || member.status === 'invited');
        setExisting(active.flatMap(member => member.user_id ? [member.user_id] : []));
        const count = tab === 'members' ? members.filter(member => !active.some(item => item.user_id === member.userId)).length : addresses.length;
        if (active.length + count > detail.capacity) throw new Error('capacity');
        if (detail.revision === undefined) throw new Error('revision');
        pending.current = { signature, revision: detail.revision };
      }
      const common = { expected_revision: pending.current.revision, ...(reason.trim() ? { reason: reason.trim() } : {}) };
      if (tab === 'members') { const payload = { ...common, user_ids: members.map(member => member.userId), reactivate: false }; await classOperationsApi.inviteMembers(classId, { ...payload, operation_key: keyFor.current({ classId, ...payload }) }); }
      else { const payload = { ...common, emails: addresses }; await schedulingApi.inviteEmails(classId, { ...payload, operation_key: keyFor.current({ classId, ...payload }) }); }
      onSent({ members: tab === 'members' ? members : [], emails: tab === 'emails' ? addresses : [] });
    } catch (cause) { if (cause instanceof ApiError && (cause.data as { detail?: { code?: string } } | null)?.detail?.code === 'stale_class') pending.current = null; setError(cause instanceof Error && cause.message === 'capacity' ? '정원을 초과했어요. 선택을 줄여 주세요.' : schedulingError(cause)); }
    finally { locked.current = false; setBusy(false); }
  }
  return <WizardSheet title="회원 초대" onClose={() => { if (!busy) onClose(); }} footer={<button className="fl-btn primary block" disabled={busy || loading || !membersReady || (tab === 'members' ? !members.length : !parseInviteEmails(emails).length)} onClick={() => void send()}>{busy ? '보내는 중…' : classId ? '초대 보내기' : '선택 완료'}</button>}>
    <div className="fl-seg" role="tablist" aria-label="초대 방법"><button role="tab" aria-selected={tab === 'members'} className={tab === 'members' ? 'on' : ''} onClick={() => setTab('members')}>회원</button><button role="tab" aria-selected={tab === 'emails'} className={tab === 'emails' ? 'on' : ''} onClick={() => setTab('emails')}>이메일</button></div>
    {tab === 'members' ? <><p className="w-info">회원을 선택해 지금 입장할 수 있도록 초대해요.</p><ClassMemberPicker classId={classId} selected={members} onChange={setMembers} maxParticipants={Math.max(0, capacity - existingCount - (!classId ? parseInviteEmails(emails).length : 0))} excludeUserIds={existing} disabled={busy || loading || !membersReady} /></> : <label className="fl-field"><span className="fl-label">이메일 주소</span><textarea className="fl-input" aria-label="초대 이메일" value={emails} disabled={busy} onChange={event => setEmails(event.target.value)} placeholder="이메일을 줄바꿈 또는 쉼표로 구분해 주세요" /><span className="w-hint">입장 링크와 클래스 코드를 이메일로 보내요.</span></label>}
    {classId && admin && <label className="fl-field"><span className="fl-label">센터 관리자 대행 사유</span><input className="fl-input" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} /></label>}
    {error && <p role="alert">{error}</p>}
  </WizardSheet>;
}
