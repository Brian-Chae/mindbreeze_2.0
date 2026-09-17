import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  getAdminOrganization, listAdminOrganizationCounselors,
  type AdminOrganizationDto,
} from '../../lib/api/admin';

import OrgManagementActions from './org-management-actions';

export const orgKindLabel = (kind: string): string =>
  ({ institution: '일반 기관', individual: '개인 기관' })[kind] ?? '확인 필요';
const statusLabel = (status: string): string =>
  ({ active: '활성', pending: '가입 대기', suspended: '정지' })[status] ?? '확인 필요';
const roleLabel = (role: string): string =>
  ({ org_admin: '기관 관리자', counselor: '상담사' })[role] ?? '확인 필요';
export function orgDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '확인 필요' : new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}
const control = 'rounded-lg border border-[#DDDEE7] bg-white px-3 py-2 text-sm';

type LoadState<T> = { status: 'loading' } | { status: 'error' } | { status: 'success'; data: T };
function useOrgRequest<T>(id: string, fetcher: (id: string) => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetcher(id).then(
      (data) => { if (!cancelled) setState({ status: 'success', data }); },
      () => { if (!cancelled) setState({ status: 'error' }); },
    );
    return () => { cancelled = true; };
  }, [id, attempt, fetcher]);
  return { state, setData: (data: T) => setState({ status: 'success', data }), retry: () => { setState({ status: 'loading' }); setAttempt((value) => value + 1); } };
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs text-[#6F6F6F]">{label}</dt><dd className="mt-1 break-words text-sm">{children ?? '미등록'}</dd></div>;
}
function Retry({ label, onRetry }: { label: string; onRetry: () => void }) {
  return <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{label} 조회에 실패했습니다. <button type="button" onClick={onRetry} className={control}>다시 시도</button></div>;
}

export default function OrgDetailModal({ organization, onClose, onUpdated }: {
  organization: AdminOrganizationDto; onClose: () => void; onUpdated: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [guard, setGuard] = useState({ dirty: false, busy: false });
  const [confirmClose, setConfirmClose] = useState(false);
  const guardChange = useCallback((dirty: boolean, busy: boolean) => setGuard({ dirty, busy }), []);
  const requestClose = () => { if (guard.busy) return; if (guard.dirty) setConfirmClose(true); else onClose(); };
  const [tab, setTab] = useState<'info' | 'counselors'>('info');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const detail = useOrgRequest(organization.id, getAdminOrganization);
  const counselors = useOrgRequest(organization.id, listAdminOrganizationCounselors);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  const org = detail.state.status === 'success' ? detail.state.data : organization;
  const copyCode = async () => {
    if (!org.org_code) return;
    try { await navigator.clipboard.writeText(org.org_code); setCopyMessage('기관 코드를 복사했습니다.'); }
    catch { setCopyMessage('복사하지 못했습니다. 코드를 직접 선택해 복사해주세요.'); }
  };
  const members = counselors.state.status === 'success' ? counselors.state.data : [];
  const filtered = members.filter((member) =>
    [member.name, member.email, member.counselor_code ?? ''].some((value) => value.toLowerCase().includes(query.trim().toLowerCase()))
    && (!role || (role === 'unknown' ? !['org_admin', 'counselor'].includes(member.role) : member.role === role))
    && (!status || (status === 'unknown' ? !['active', 'pending', 'suspended'].includes(member.status) : member.status === status)),
  );
  const person = detail.state.status === 'success'
    ? (org.kind === 'individual' ? detail.state.data.owner : detail.state.data.primary_admin) : null;
  const count = counselors.state.status === 'success' ? String(members.length)
    : counselors.state.status === 'error' ? '조회 실패' : '조회 중';

  return <dialog ref={dialogRef} aria-labelledby="org-detail-title"
    onCancel={(event) => { event.preventDefault(); requestClose(); }}
    onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      // native dialog도 마지막 요소에서 브라우저 UI로 이동할 수 있어 순환을 보장한다.
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
      )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }}
    className="m-auto w-[calc(100%-2rem)] max-w-[960px] max-h-[85dvh] overflow-hidden rounded-2xl p-0 text-[#1F1F1F] shadow-xl backdrop:bg-black/50">
    <div className="flex max-h-[85dvh] flex-col">
      <header className="shrink-0 border-b p-5">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="org-detail-title" className="text-xl font-bold break-all">{org.name}</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-purple-50 px-2 py-1">{orgKindLabel(org.kind)}</span><span className="rounded-full bg-slate-100 px-2 py-1">{org.verified ? '인증됨' : '미인증'}</span></div>
          </div>
          <button type="button" autoFocus disabled={guard.busy} onClick={requestClose} className={control} aria-label="기관 상세 닫기">닫기</button>
        </div>
        <div className="mt-3 flex items-center gap-3 text-sm"><span>기관 코드 <strong className="font-mono">{org.org_code ?? '미등록'}</strong></span>
          {org.org_code && <button type="button" onClick={() => void copyCode()} className={control}>코드 복사</button>}
        </div>
        <p role="status" className="mt-1 text-xs">{copyMessage}</p>
      </header>
      {confirmClose && <div role="alertdialog" aria-label="미저장 변경 확인" className="border-b bg-amber-50 p-4 text-sm">
        <p>저장하지 않은 변경사항이 있습니다.</p>
        <button type="button" className={control} onClick={() => setConfirmClose(false)}>계속 편집</button>
        <button type="button" className={`${control} ml-2`} onClick={onClose}>변경사항 버리기</button>
      </div>}
      <div role="tablist" aria-label="기관 상세" className="flex shrink-0 border-b px-5">
        {(['info', 'counselors'] as const).map((value) => <button key={value} type="button" role="tab"
          id={`org-tab-${value}`} aria-controls={`org-panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
          onClick={() => setTab(value)} onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next = event.key === 'Home' ? 'info' : event.key === 'End' ? 'counselors' : value === 'info' ? 'counselors' : 'info';
              setTab(next); document.getElementById(`org-tab-${next}`)?.focus();
            }
          }} className={`px-4 py-3 text-sm font-semibold ${tab === value ? 'border-b-2 border-[#5F0080] text-[#5F0080]' : 'text-[#6F6F6F]'}`}>
          {value === 'info' ? '기관 정보' : `상담사 (${count})`}
        </button>)}
      </div>
      <div className="overflow-y-auto p-5">
        <section role="tabpanel" id="org-panel-info" aria-labelledby="org-tab-info" hidden={tab !== 'info'} tabIndex={0}>
          {detail.state.status === 'loading' && <p role="status">기관 정보를 불러오는 중...</p>}
          {detail.state.status === 'error' && <Retry label="기관 정보" onRetry={detail.retry} />}
          {detail.state.status === 'success' && <>
            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="기관명">{org.name}</Field><Field label="기관 코드">{org.org_code}</Field>
              <Field label="전화">{org.phone}</Field><Field label="주소">{detail.state.data.address}</Field>
              <Field label="인증 상태">{org.verified ? '인증됨' : '미인증'}</Field><Field label="생성일 (KST)">{orgDate(org.created_at)}</Field>
            </dl>
            <h3 className="mb-4 mt-7 border-t pt-5 font-bold">{org.kind === 'individual' ? '소유자' : '주 담당자'}</h3>
            {!person ? <p className="text-sm text-[#6F6F6F]">{org.kind === 'individual' ? '소유자 미지정' : '담당자 미지정'}</p> :
              <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="이름">{person.name}</Field><Field label="이메일">{person.email}</Field>
                <Field label="전화">{person.phone}</Field><Field label="계정 상태">{statusLabel(person.status)}</Field>
                {org.kind === 'individual' && <Field label="상담사 코드">{counselors.state.status === 'loading' ? '조회 중' : counselors.state.status === 'error'
                  ? <Retry label="상담사 코드" onRetry={counselors.retry} />
                  : members.find((member) => member.id === person.id)?.counselor_code ?? '미등록'}</Field>}
              </dl>}
            <OrgManagementActions key={`${org.id}-${detail.state.data.version}`} org={detail.state.data}
              onGuardChange={guardChange} onReload={() => { guardChange(false, false); detail.retry(); }}
              onSaved={(updated) => { detail.setData(updated); counselors.retry(); onUpdated(); }} />
          </>}
        </section>
        <section role="tabpanel" id="org-panel-counselors" aria-labelledby="org-tab-counselors" hidden={tab !== 'counselors'} tabIndex={0}>
          {counselors.state.status === 'loading' && <p role="status">상담사를 불러오는 중...</p>}
          {counselors.state.status === 'error' && <Retry label="상담사" onRetry={counselors.retry} />}
          {counselors.state.status === 'success' && <>
            <p className="mb-3 text-xs text-[#6F6F6F]">상담사와 기관 관리자를 포함한 총 {members.length}명 · 검색 결과 {filtered.length}명</p>
            <div className="mb-4 flex flex-wrap gap-2">
              <input aria-label="상담사 검색" placeholder="이름·이메일·상담사 코드" value={query} onChange={(event) => setQuery(event.target.value)} className={`${control} min-w-0 flex-1`} />
              <select aria-label="상담사 역할" value={role} onChange={(event) => setRole(event.target.value)} className={control}>
                <option value="">전체 역할</option><option value="counselor">상담사</option><option value="org_admin">기관 관리자</option><option value="unknown">확인 필요</option>
              </select>
              <select aria-label="상담사 상태" value={status} onChange={(event) => setStatus(event.target.value)} className={control}>
                <option value="">전체 상태</option><option value="active">활성</option><option value="pending">가입 대기</option><option value="suspended">정지</option><option value="unknown">확인 필요</option>
              </select>
            </div>
            {filtered.length === 0 ? <p className="py-8 text-center text-sm">{members.length === 0 ? '소속 상담사가 없습니다.' : '검색 조건에 맞는 상담사가 없습니다.'}</p> :
              <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-50"><tr>{['이름', '이메일', '상담사 코드', '역할', '계정 상태'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
                <tbody>{filtered.map((member) => <tr key={member.id} className="border-b">
                  <td className="p-3">{member.name}{member.is_primary_admin && <span className="ml-2 text-xs text-purple-800">주 담당자</span>}{member.is_owner && <span className="ml-2 text-xs text-purple-800">소유자</span>}</td>
                  <td className="p-3">{member.email}</td><td className="p-3 font-mono">{member.counselor_code ?? '미등록'}</td><td className="p-3">{roleLabel(member.role)}</td><td className="p-3">{statusLabel(member.status)}</td>
                </tr>)}</tbody>
              </table></div>}
          </>}
        </section>
      </div>
    </div>
  </dialog>;
}
