import { useEffect, useRef, useState } from 'react';
import type { ClassDetailDto } from '../../../../lib/api/class-structure';
import { classOperationsApi, type ClassMember } from '../../../../lib/api/class-operations';
import { schedulingApi } from '../../../../lib/api/class-scheduling';
import { invalidateClassReads } from '../../../../lib/class-structure/invalidation';
import { useAuthStore } from '../../../../stores/authStore';
import { ClassMemberPicker, type ClassMemberSelection } from '../../structure/class-member-picker';
import { operationError, operationInput, useClassOperation } from '../../structure/class-operation-state';
import { OperationFeedback } from '../../structure/class-operation-feedback';
import { FlowButton, FlowSheet } from '../shared/flow-primitives';

interface Props {
  open: boolean;
  detail: ClassDetailDto;
  code: string | null;
  codeCopied?: boolean;
  onCopyCode: () => void;
  onClose: () => void;
  /** 클래스 revision과 현재 회차 명부를 함께 갱신한다. */
  onSaved: () => Promise<ClassDetailDto>;
}

export function MemberInviteSheet(props: Props) {
  const user = useAuthStore(state => state.user);
  if (!props.open || props.detail.status !== 'active' || props.detail.capabilities?.invite !== true) return null;
  return <MemberInviteSheetState key={`${props.detail.id}:${user?.id}:${user?.role}`} {...props} />;
}

function MemberInviteSheetState({ detail, code, codeCopied, onCopyCode, onClose, onSaved }: Props) {
  const admin = useAuthStore(state => state.user?.role === 'org_admin');
  const [current, setCurrent] = useState(detail);
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [selected, setSelected] = useState<ClassMemberSelection[]>([]);
  const [emails, setEmails] = useState('');
  const [reactivate, setReactivate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [success, setSuccess] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void classOperationsApi.members(detail.id).then(result => {
      if (mounted.current) setMembers(result.members);
    }).catch(error => { if (mounted.current) setLoadError(operationError(error)); })
      .finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; };
  }, [detail.id]);

  const reload = async () => {
    setLoading(true); setLoadError('');
    invalidateClassReads();
    try {
      const [next, result] = await Promise.all([onSaved(), classOperationsApi.members(detail.id)]);
      if (mounted.current) { setCurrent(next); setMembers(result.members); setLoading(false); }
    } catch {
      // 변경은 성공했지만 revision을 확인하지 못하면 추가 쓰기를 막는다.
      if (mounted.current) setLoadError('최신 명부를 불러오지 못했어요. 다시 불러와 주세요.');
    }
  };
  const operation = useClassOperation(current.revision, () => { void reload(); });
  const disabled = operation.busy || loading || !!loadError || current.status !== 'active' || current.capabilities?.invite !== true;
  const inviteMembers = async () => {
    const ids = selected.map(member => member.userId);
    setSuccess('');
    if (await operation.run(JSON.stringify(['members', ids, reactivate]), command => classOperationsApi.inviteMembers(detail.id, { ...command, user_ids: ids, reactivate }), admin)) {
      if (mounted.current) { setSelected([]); setSuccess('초대했어요. 지금 바로 입장할 수 있어요'); }
    }
  };
  const inviteEmails = async () => {
    const values = [...new Set(emails.split(/[\s,;]+/).map(value => value.trim().toLowerCase()).filter(Boolean))];
    if (!values.length) return;
    setSuccess('');
    let message = '이메일 초대를 요청했어요. 이메일을 확인하도록 알려 주세요.';
    if (await operation.run(JSON.stringify(['emails', values]), async command => {
      const result = await schedulingApi.inviteEmails(detail.id, { ...command, emails: values });
      if (result.invitations.some(invitation => invitation.status === 'failed')) message = '발송에 실패한 이메일 초대가 있어요. 클래스 상세에서 결과를 확인해 주세요.';
      return result;
    }, admin)) {
      if (mounted.current) { setEmails(''); setSuccess(message); }
    }
  };
  const active = members.filter(member => member.status === 'active');
  return <div className="pz-root fixed inset-0 z-[70] flex items-end justify-end bg-black/50 p-3 sm:items-center [&_input]:text-gray-900 [&_textarea]:text-gray-900 [&_input]:placeholder:text-gray-500 [&_textarea]:placeholder:text-gray-500 [&>.pz-sheet]:max-h-[90dvh] [&>.pz-sheet]:w-full [&>.pz-sheet]:max-w-xl"
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)');
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement?.getAttribute('role') === 'dialog')) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <FlowSheet open title="회원 초대" onClose={onClose}>
      {success && <p role="status">{success}</p>}
      {loading && !loadError && <p role="status">최신 명부를 불러오는 중이에요.</p>}
      {loadError && <div><p role="alert">{loadError}</p><FlowButton kind="soft" onClick={() => void reload()}>다시 불러오기</FlowButton></div>}
      <section className="space-y-3 rounded-2xl bg-white p-4 text-gray-900">
        <h3 className="text-sm font-semibold">기존 회원 선택</h3>
        <ClassMemberPicker classId={detail.id} selected={selected} onChange={setSelected} disabled={disabled}
          excludeUserIds={active.flatMap(member => member.user_id ? [member.user_id] : [])}
          maxParticipants={Math.max(0, current.capacity - active.length)} />
        <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" checked={reactivate} disabled={disabled} onChange={event => setReactivate(event.target.checked)} />수료·탈퇴한 회원도 다시 초대해요</label>
        <FlowButton disabled={disabled || selected.length === 0} onClick={() => void inviteMembers()}>선택 회원 초대</FlowButton>
      </section>
      <section className="space-y-3 rounded-2xl bg-white p-4 text-gray-900">
        <label className="block text-sm font-semibold">이메일 초대<textarea className={operationInput} value={emails} disabled={disabled} onChange={event => setEmails(event.target.value)} placeholder="여러 주소는 쉼표 또는 줄바꿈으로 구분" /></label>
        <FlowButton disabled={disabled || !emails.trim()} onClick={() => void inviteEmails()}>이메일로 초대</FlowButton>
      </section>
      {(admin || operation.error) && <div className="rounded-2xl bg-white p-4 text-gray-900"><OperationFeedback operation={{ ...operation, message: '' }} admin={admin} /></div>}
      {operation.error && <FlowButton kind="soft" disabled={operation.busy} onClick={() => void reload()}>최신 명부 다시 불러오기</FlowButton>}
      {code && <div className="space-y-2"><p>입장 코드 {code}</p><FlowButton kind="soft" onClick={onCopyCode}>입장 코드 복사</FlowButton>{codeCopied && <p role="status">복사했어요.</p>}</div>}
    </FlowSheet>
  </div>;
}
