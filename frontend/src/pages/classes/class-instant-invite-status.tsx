import { useEffect, useRef, useState } from 'react';
import { getClass } from '../../lib/api/class-structure';
import { schedulingApi, type EmailInvite, type WriteCommand } from '../../lib/api/class-scheduling';
import { ApiError } from '../../lib/api/client';
import { asClassId } from '../../lib/class-structure/read-model';
import { schedulingError } from '../../lib/class-structure/scheduling-model';

/** 초대 요청 접수와 실제 서버 발송 결과를 구분한다. */
export function ClassInstantInviteStatus({ classId, admin, reason }: { classId: string; admin: boolean; reason: string }) {
  const [invitations, setInvitations] = useState<EmailInvite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(false);
  const locked = useRef(false);
  const pending = useRef(new Map<string, WriteCommand>());

  async function refresh() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await schedulingApi.emailInvites(classId);
      if (alive.current) setInvitations(result.invitations);
    } catch (cause) { if (alive.current) setError(schedulingError(cause)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; };
    // 이 컴포넌트는 완료된 클래스마다 새로 마운트한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function retry(invitationId: string) {
    if (locked.current) return;
    if (admin && !reason.trim()) { setError('센터 관리자 대행 사유를 입력해 주세요.'); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      let command = pending.current.get(invitationId);
      if (!command) {
        const detail = await getClass(asClassId(classId));
        if (!alive.current) return;
        if (detail.revision === undefined) throw new Error('클래스 버전을 확인할 수 없어요.');
        command = { operation_key: crypto.randomUUID(), expected_revision: detail.revision, ...(reason.trim() ? { reason: reason.trim() } : {}) };
        pending.current.set(invitationId, command);
      }
      // 응답이 유실되면 같은 명령을 재전송해 발송 작업이 중복되지 않게 한다.
      await schedulingApi.retryEmail(classId, invitationId, command);
      pending.current.delete(invitationId);
      if (!alive.current) return;
      const result = await schedulingApi.emailInvites(classId);
      if (alive.current) setInvitations(result.invitations);
    } catch (cause) {
      const code = cause instanceof ApiError ? (cause.data as { detail?: { code?: string } } | null)?.detail?.code : undefined;
      if (code === 'stale_class') pending.current.delete(invitationId);
      if (alive.current) setError(schedulingError(cause));
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }

  return <div className="cw-invite-status">
    <p className="w-info">서버 발송 처리 결과예요. 수신함 도착 여부는 확인할 수 없어요. 대기 중이면 상태를 새로고침해 주세요.</p>
    <button className="fl-btn soft" disabled={busy} onClick={() => void refresh()}>발송 상태 새로고침</button>
    {busy && <p role="status">발송 상태를 확인하고 있어요.</p>}
    {!busy && !invitations.length && !error && <p role="status">아직 표시할 발송 결과가 없어요.</p>}
    <ul aria-label="이메일 발송 상태">{invitations.map(invitation => <li className="cw-invite-status-row" key={invitation.id}>
      <span>{invitation.email}</span><span>{{ pending: '발송 대기', sent: '발송 처리됨', failed: '발송 실패' }[invitation.status]}</span>
      {invitation.status === 'failed' && <button className="fl-btn soft" disabled={busy} onClick={() => void retry(invitation.id)}>다시 보내기</button>}
    </li>)}</ul>
    {error && <p role="alert">{error}</p>}
  </div>;
}
