import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ClassDetailDto, ClassSessionDto } from '../../../lib/api/class-structure';
import { schedulingApi } from '../../../lib/api/class-scheduling';
import { operationButton, useClassOperation } from './class-operation-state';
import { OperationFeedback } from './class-operation-feedback';

interface Props { detail: ClassDetailDto; session: ClassSessionDto; admin: boolean; onSaved: () => void }
export function ClassSessionCancel(props: Props) {
  if (props.detail.capabilities?.schedule !== true || props.detail.status !== 'active' || props.detail.revision == null || props.session.state_version == null || !['ready', 'scheduled'].includes(props.session.status)) return null;
  return <CancelSheet key={`${props.detail.id}:${props.detail.revision}:${props.session.id}:${props.session.state_version}`} {...props} />;
}
function CancelSheet({ detail, session, admin, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const operation = useClassOperation(detail.revision, onSaved);
  const close = () => { if (!operation.busy) { setOpen(false); trigger.current?.focus(); } };
  const cancel = async () => {
    const ok = await operation.run(`cancel:${session.id}:${session.state_version}`, command => schedulingApi.bulk(detail.id, {
      ...command, action: 'cancel', session_ids: [session.id], expected_state_versions: { [session.id]: session.state_version! }, rows: [],
    }), admin);
    if (ok) { setOpen(false); trigger.current?.focus(); }
  };
  return <><button ref={trigger} className={operationButton} onClick={() => setOpen(true)}>이 회차 취소</button>{open && createPortal(<div className="co-backdrop"><section className="co-cancel-sheet" role="dialog" aria-modal="true" aria-labelledby="co-cancel-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const elements = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled)');
      const first = elements[0]; const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}><h2 id="co-cancel-title">{session.seq}회차를 취소할까요?</h2><p>{detail.title}</p><p>{session.scheduled_at ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long', timeStyle: 'short' }).format(new Date(session.scheduled_at)) : '일정 미확인'}</p><p>이 회차만 취소하고 회차 번호와 다른 회차는 유지해요. 참여 멤버에게 취소 안내가 전달돼요.</p><OperationFeedback operation={operation} admin={admin}/><div className="co-sheet-actions"><button autoFocus className={operationButton} disabled={operation.busy} onClick={close}>돌아가기</button><button className={`${operationButton} co-danger`} disabled={operation.busy} onClick={() => void cancel()}>회차 취소 확인</button></div></section></div>, document.body)}</>;
}
