import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ChatRoom } from '../../lib/api/chat';
import { inviteRoleLabel, type InviteMode } from '../../lib/api/chat-invite';
import { chatRoomDisplayName } from '../../lib/chat-sort';
import { useChatInvite } from '../../hooks/use-chat-invite';
import { useAuthStore } from '../../stores/authStore';

interface Props {
  room: ChatRoom;
  onClose: () => void;
  onSuccess: (room: ChatRoom, mode: InviteMode) => void;
}
const primaryButton = 'rounded-xl bg-[#5F0080] px-4 py-3 text-sm font-semibold text-white hover:bg-[#4B0066] focus-visible:ring-2 focus-visible:ring-[#5F0080] disabled:opacity-50';
const secondaryButton = 'rounded-xl border border-[#DDDEE7] px-4 py-3 text-sm focus-visible:ring-2 focus-visible:ring-[#5F0080] disabled:opacity-50';

export function InviteMemberModal({ room, onClose, onSuccess }: Props) {
  const invite = useChatInvite(room, onSuccess);
  const userId = useAuthStore((state) => state.user?.id);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const searchId = useId();
  const nameId = useId();
  const modeName = useId();
  const { isBusy } = invite;

  useEffect(() => {
    if (!invite.permitted) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(dialogRef.current));
    const previousInert = background.map((element) => element.inert);
    background.forEach((element) => { element.inert = true; });
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); if (!isBusy()) closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []);
      const first = elements[0]; const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); titleRef.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !elements.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !elements.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      background.forEach((element, index) => { element.inert = previousInert[index]; });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isBusy, invite.permitted]);
  useEffect(() => { titleRef.current?.focus(); }, [invite.step]);

  if (!invite.permitted) return null;
  const close = (): void => { if (!invite.isBusy()) onClose(); };
  const total = new Set([...invite.memberIds, ...invite.selected.map((candidate) => candidate.userId)]).size;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-description`} aria-busy={invite.busy}
        className="flex max-h-[90dvh] w-full flex-col rounded-t-2xl bg-white text-[#1F1F1F] shadow-xl sm:max-w-lg sm:rounded-2xl">
        <header className="shrink-0 border-b border-[#EFEFEF] p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 ref={titleRef} id={titleId} tabIndex={-1} className="text-lg font-bold outline-none">{invite.step === 'select' ? '채팅방에 회원 초대' : '어떻게 초대할까요?'}</h2>
            <button type="button" disabled={invite.busy} onClick={close} aria-label="회원 초대 닫기" className="h-10 w-10 shrink-0 rounded-full bg-[#F2F3F8] focus-visible:ring-2 focus-visible:ring-[#5F0080] disabled:opacity-50">✕</button>
          </div>
          <p id={`${titleId}-description`} className="mt-2 text-sm text-[#6F6F6F]">{invite.step === 'select' ? '초대할 상담사 또는 내담자를 선택해 주세요.' : `선택한 ${invite.selected.length}명을 초대할 방을 선택해 주세요.`}</p>
          <p className="mt-2 break-words text-sm font-medium text-[#5F0080]">{chatRoomDisplayName(invite.detail)}</p>
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          {invite.loadingRoom && <p role="status" className="text-sm">기존 참여자를 확인하는 중…</p>}
          {invite.roomError && <p role="alert" className="text-sm text-red-600">{invite.roomError} <button type="button" onClick={invite.retryRoom} disabled={invite.busy} className="underline">다시 조회</button></p>}
          {invite.step === 'select' ? <>
            <div role="tablist" aria-label="초대 대상 유형" className="flex rounded-xl bg-[#F2F3F8] p-1">
              {(['counselor', 'client'] as const).map((tab, index) => <button key={tab} id={`${searchId}-${tab}`} role="tab" type="button" aria-selected={invite.tab === tab} aria-controls={`${searchId}-results`} tabIndex={invite.tab === tab ? 0 : -1}
                onClick={() => invite.setTab(tab)} onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault(); const next = index === 0 ? 'client' : 'counselor'; invite.setTab(next); document.getElementById(`${searchId}-${next}`)?.focus();
                  }
                }} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-[#5F0080] ${invite.tab === tab ? 'bg-white text-[#5F0080] shadow-sm' : 'text-[#6F6F6F]'}`}>{tab === 'counselor' ? '상담사' : '내담자'}</button>)}
            </div>
            <p className="text-xs text-[#6F6F6F]">{invite.tab === 'client' ? '나와 연결된 내담자를 검색합니다.' : '같은 기관에 소속된 상담사를 검색합니다.'}</p>
            <div><label htmlFor={searchId} className="mb-2 block text-sm font-medium">이름 또는 이메일 검색</label>
              <input id={searchId} value={invite.search.query} onChange={(event) => invite.setQuery(event.target.value)} placeholder="이름 또는 이메일을 입력하세요" className="w-full rounded-xl border border-[#DDDEE7] px-3 py-3 text-sm outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/15" />
            </div>
            <div id={`${searchId}-results`} role="tabpanel" aria-labelledby={`${searchId}-${invite.tab}`} className="space-y-2">
              {invite.search.items.map((candidate) => {
                const checked = invite.selected.some((item) => item.userId === candidate.userId);
                const self = candidate.userId === userId;
                const member = invite.memberIds.includes(candidate.userId);
                return <label key={candidate.userId} className="flex items-center gap-3 rounded-xl border border-[#EFEFEF] p-3 text-sm has-[:checked]:border-[#5F0080] has-[:checked]:bg-[#F5EDFC] has-[:disabled]:opacity-50">
                  <input type="checkbox" checked={checked} onChange={() => invite.toggleCandidate(candidate)} disabled={!invite.ready || self || member || (!checked && invite.selected.length >= 100)} className="h-4 w-4 shrink-0 accent-[#5F0080]" />
                  <span className="min-w-0 flex-1"><span className="break-words font-medium">{candidate.name}</span> <span className="text-xs text-[#5F0080]">{inviteRoleLabel(candidate.role)}</span>
                    {candidate.email && <span className="block break-all text-xs text-[#6F6F6F]">{candidate.email}</span>}
                    {candidate.orgNames.length > 0 && <span className="block break-words text-xs text-[#6F6F6F]">{candidate.orgNames.join(' · ')}</span>}
                  </span>{(self || member) && <span className="text-xs">{self ? '나' : '이미 참여 중'}</span>}
                </label>;
              })}
              {invite.search.loading ? <p role="status" className="py-3 text-sm">{invite.tab === 'counselor' ? '상담사를' : '내담자를'} 불러오는 중…</p>
                : invite.search.error ? <p role="alert" className="py-3 text-sm text-red-600">{invite.search.error} <button type="button" onClick={invite.retrySearch} className="underline">다시 시도</button></p>
                : invite.search.items.length === 0 && <p className="py-3 text-sm text-[#6F6F6F]">{invite.search.query.trim() ? '검색 결과가 없습니다. 이름 또는 이메일을 확인해 주세요.' : invite.tab === 'counselor' ? '초대 가능한 상담사가 없습니다. 같은 기관에 소속된 상담사만 초대할 수 있습니다.' : '초대 가능한 연결 내담자가 없습니다.'}</p>}
              {invite.search.items.length < invite.search.total && <button type="button" disabled={invite.search.loading || !!invite.search.error} onClick={invite.loadMore} className={`${secondaryButton} w-full`}>더 보기</button>}
            </div>
          </> : <>
            <p className="text-sm">기존 참여자 {invite.memberIds.length}명 · 초대 후 총 {total}명</p>
            <fieldset disabled={invite.busy || invite.blocked} className="space-y-3">
              <legend className="mb-2 text-sm font-semibold">초대 방식 선택</legend>
              <label className={`block rounded-xl border p-4 ${invite.detail.room_type === 'direct' ? 'border-[#DDDEE7] bg-[#F2F3F8] text-[#6F6F6F]' : invite.mode === 'existing' ? 'border-[#5F0080] bg-[#F5EDFC]' : 'border-[#DDDEE7]'}`}>
                <span className="flex items-center gap-2 font-semibold"><input type="radio" name={modeName} checked={invite.mode === 'existing'} onChange={() => invite.setMode('existing')} disabled={invite.detail.room_type === 'direct'} className="accent-[#5F0080]" />기존 대화 유지하고 추가</span>
                <span className="mt-2 block text-sm">현재 채팅방에 선택한 회원을 추가합니다.</span>
                <strong className="mt-2 block text-sm">새로 참여한 회원도 이전 메시지와 대화에 공유된 파일을 볼 수 있습니다.</strong>
                <span className="mt-2 block text-xs">채팅방과 기존 참여자는 그대로 유지됩니다.</span>
                {invite.detail.room_type === 'direct' && <span className="mt-2 block text-sm font-semibold">1:1 채팅은 새 그룹방으로만 초대할 수 있습니다.</span>}
              </label>
              {invite.mode === 'existing' && invite.detail.room_type === 'group' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={invite.acknowledged} onChange={(event) => invite.setAcknowledged(event.target.checked)} className="mt-1 accent-[#5F0080]" />선택한 회원에게 기존 대화가 공개됨을 확인했습니다.</label>}
              <label className={`block rounded-xl border p-4 ${invite.mode === 'fork' ? 'border-[#5F0080] bg-[#F5EDFC]' : 'border-[#DDDEE7]'}`}>
                <span className="flex items-center gap-2 font-semibold"><input type="radio" name={modeName} checked={invite.mode === 'fork'} onChange={() => invite.setMode('fork')} className="accent-[#5F0080]" />새 방으로 만들기</span>
                <span className="mt-2 block text-sm">기존 참여자와 선택한 회원이 함께하는 새 그룹 채팅방을 만듭니다.</span>
                <strong className="mt-2 block text-sm">이전 메시지와 파일은 새 방으로 옮겨지지 않습니다.</strong>
                <span className="mt-2 block text-xs">기존 채팅방은 그대로 남습니다.</span>
              </label>
              {invite.mode === 'fork' && <div><label htmlFor={nameId} className="mb-2 block text-sm font-medium">새 채팅방 이름 (선택)</label>
                <input id={nameId} value={invite.name} onChange={(event) => invite.setName(event.target.value)} aria-invalid={invite.invalidName} placeholder="비워 두면 기본 이름을 사용합니다" className="w-full rounded-xl border border-[#DDDEE7] px-3 py-3 text-sm outline-none focus:border-[#5F0080]" />
                {invite.invalidName && <p role="alert" className="mt-2 text-xs text-red-600">방 이름은 120자 이하이며 줄바꿈·제어문자를 사용할 수 없습니다.</p>}
              </div>}
            </fieldset>
          </>}
          <section aria-label="선택한 회원" className="rounded-xl bg-[#F8F8FB] p-3">
            <p role="status" className="mb-2 text-sm font-semibold">선택한 회원 {invite.selected.length}명 / 최대 100명</p>
            <div className="flex flex-wrap gap-2">{invite.selected.map((candidate) => <span key={candidate.userId} className="inline-flex max-w-full items-center gap-2 rounded-lg bg-[#F5EDFC] px-2 py-1 text-xs text-[#5F0080]">
              <span className="break-words">{candidate.name} · {inviteRoleLabel(candidate.role)}</span>
              {invite.step === 'select' && <button type="button" disabled={invite.busy} aria-label={`${candidate.name} ${inviteRoleLabel(candidate.role)} 선택 취소`} onClick={() => invite.removeCandidate(candidate.userId)} className="h-7 w-7 shrink-0 rounded focus-visible:ring-2 focus-visible:ring-[#5F0080]">✕</button>}
            </span>)}</div>
          </section>
          {invite.error && <p role="alert" className="text-sm text-red-600">{invite.error}</p>}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-[#EFEFEF] p-4">
          <button type="button" disabled={invite.busy} onClick={close} className={secondaryButton}>취소</button>
          {invite.step === 'select' ? <button type="button" disabled={!invite.ready || invite.selected.length === 0 || invite.blocked} onClick={invite.next} className={primaryButton}>다음 · {invite.selected.length}명</button>
            : <><button type="button" disabled={invite.busy || invite.blocked} onClick={invite.back} className={secondaryButton}>이전</button>
              <button type="button" disabled={!invite.canSubmit} onClick={() => void invite.submit()} className={primaryButton}>{invite.busy ? invite.mode === 'fork' ? '새 방 만드는 중…' : '초대 중…' : invite.mode === 'fork' ? '새 방 만들고 초대' : `${invite.selected.length}명 초대`}</button></>}
        </footer>
      </div>
    </div>, document.body,
  );
}
