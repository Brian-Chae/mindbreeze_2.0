// 세션 상세 페이지 (UI Kit)

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  deleteSession,
  getSession,
  inviteParticipant,
  removeParticipant,
  transitionSession,
  type SessionAction,
  type SessionDto,
} from '../../lib/api/session';
import { StatusBadge } from '../../components/session/StatusBadge';
import { ParticipantPicker, type SelectedParticipant } from '../../components/session/ParticipantPicker';
import AppShell from '../../components/layout/AppShell';

const TYPE_LABELS: Record<string, string> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상수업',
  custom: '기타',
};

const ACTIONS_BY_STATUS: Record<SessionDto['status'], SessionAction[]> = {
  ready: ['start', 'cancel'],
  scheduled: ['start', 'cancel'],
  in_progress: ['pause', 'end', 'cancel'],
  paused: ['resume', 'end', 'cancel'],
  completed: [],
  cancelled: [],
};

const ACTION_LABELS: Record<SessionAction, string> = {
  start: '시작',
  pause: '일시정지',
  resume: '재개',
  end: '종료',
  cancel: '취소',
};

const participantLabel = (participant: SessionDto['participants'][number]): string =>
  participant.user_name
  || participant.user_email
  || participant.guest_name
  || (participant.user_id ? participant.user_id.slice(0, 8) : '게스트');

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteSelected, setInviteSelected] = useState<SelectedParticipant[]>([]);

  const activeParticipants = (session?.participants ?? []).filter((p) => !p.is_waitlisted);
  const waitlisted = (session?.participants ?? []).filter((p) => p.is_waitlisted);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const loadSession = (): void => {
      getSession(id)
        .then((nextSession) => {
          if (!cancelled) setSession(nextSession);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        });
    };

    loadSession();
    const timer = window.setInterval(loadSession, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id]);

  const handleAction = async (action: SessionAction): Promise<void> => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await transitionSession(id, action);
      setSession(updated);
      if (action === 'start') {
        navigate(`/sessions/${id}/live`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '상태 변경에 실패했습니다');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!id) return;
    if (!confirm('정말 삭제하시겠습니까?')) return;
    setBusy(true);
    try {
      await deleteSession(id);
      navigate('/sessions');
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제에 실패했습니다');
      setBusy(false);
    }
  };

  const handleInvite = async (): Promise<void> => {
    if (!id || inviteSelected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      let updated = session;
      for (const s of inviteSelected) {
        updated = await inviteParticipant(id, s.userId);
      }
      setSession(updated);
      setShowInvite(false);
      setInviteSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '초대에 실패했습니다');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveParticipant = async (userId: string): Promise<void> => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await removeParticipant(id, userId);
      setSession(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : '참여자 제거에 실패했습니다');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyCode = async (): Promise<void> => {
    if (!session?.access_code) return;
    try {
      await navigator.clipboard.writeText(session.access_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('클래스 코드를 복사하지 못했습니다. 코드를 직접 선택해 주세요.');
    }
  };

  if (error && !session) {
    return (
      <AppShell title="세션 상세" sub="DETAIL">
        <div className="max-w-3xl mx-auto">
          <p className="text-[#B3261E]">{error}</p>
        </div>
      </AppShell>
    );
  }
  if (!session) {
    return (
      <AppShell title="세션 상세" sub="DETAIL">
        <div className="max-w-3xl mx-auto">
          <p className="text-[#6F6F6F]">불러오는 중...</p>
        </div>
      </AppShell>
    );
  }

  const actions = ACTIONS_BY_STATUS[session.status];

  const rightSlot = (
    <div className="flex items-center gap-2">
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => handleAction(action)}
          disabled={busy}
          className="mb-btn text-sm"
        >
          {ACTION_LABELS[action]}
        </button>
      ))}
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy}
        className="mb-btn mb-btn--ghost text-sm !text-[#B3261E]"
      >
        삭제
      </button>
    </div>
  );

  return (
    <AppShell
      title="세션 상세"
      sub="DETAIL"
      rightSlot={rightSlot}
      noScroll
    >
      <div className="max-w-3xl mx-auto space-y-4 pb-6 h-full overflow-y-auto">
        {/* 뒤로 가기 + 상태 */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/sessions')}
            className="text-sm text-[#6F6F6F] hover:text-[#1F1F1F] transition-colors"
          >
            ← 목록으로
          </button>
          <StatusBadge status={session.status} />
        </div>

        {/* 세션 정보 카드 */}
        <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#F5EDFC] text-[#5F0080]">
              {TYPE_LABELS[session.type]}
            </span>
          </div>
          <h1 className="text-xl font-bold text-[#1F1F1F]">
            {session.title || '제목 없음'}
          </h1>
          {session.access_code && (
            <div className="rounded-xl bg-[#F5EDFC] border border-[#DDD0EA] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <dt className="text-xs text-[#6F6F6F] mb-1">클래스 코드</dt>
                <dd className="font-mono text-3xl font-black tracking-[0.16em] text-[#5F0080]">
                  {session.access_code}
                </dd>
              </div>
              <button type="button" onClick={handleCopyCode} className="mb-btn text-sm">
                {copied ? '복사 완료' : '코드 복사'}
              </button>
            </div>
          )}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-[#6F6F6F] mb-0.5">일시</dt>
              <dd className="text-sm text-[#1F1F1F] font-medium">
                {session.scheduled_at ? new Date(session.scheduled_at).toLocaleString('ko-KR') : '즉시 클래스'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#6F6F6F] mb-0.5">소요 시간</dt>
              <dd className="text-sm text-[#1F1F1F] font-medium">{session.duration_min}분</dd>
            </div>
            <div>
              <dt className="text-xs text-[#6F6F6F] mb-0.5">참여자</dt>
              <dd className="text-sm text-[#1F1F1F] font-medium">
                {session.participants.length} / {session.max_participants}
              </dd>
            </div>
          </dl>
          {session.notes && (
            <div>
              <dt className="text-xs text-[#6F6F6F] mb-1">메모</dt>
              <p className="text-sm text-[#1F1F1F] whitespace-pre-wrap leading-relaxed">
                {session.notes}
              </p>
            </div>
          )}
        </div>

        {/* 참여자 카드 */}
        <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#1F1F1F]">
              참여자 ({activeParticipants.length}/{session.max_participants}명)
              {session.waitlist_count > 0 && (
                <span className="ml-2 text-[#6F6F6F] font-normal text-xs">
                  대기 {session.waitlist_count}명
                </span>
              )}
            </h2>
            <button
              type="button"
              onClick={() => setShowInvite(true)}
              disabled={busy}
              className="text-xs text-[#5F0080] font-medium hover:underline"
            >
              + 참여자 초대
            </button>
          </div>

          {activeParticipants.length === 0 && waitlisted.length === 0 ? (
            <p className="text-sm text-[#6F6F6F]">아직 참여자가 없습니다</p>
          ) : (
            <ul className="divide-y divide-[#EFEFEF] -mx-2">
              {activeParticipants.map((p, index) => (
                <li key={p.user_id ?? `guest-${p.guest_name ?? index}`} className="flex items-center justify-between px-2 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2 h-2 rounded-full bg-[#1F8A5B]" />
                    <span className="text-sm text-[#1F1F1F]">
                      {participantLabel(p)}
                    </span>
                  </div>
                  {p.user_id && (
                    <button
                      type="button"
                      onClick={() => handleRemoveParticipant(p.user_id!)}
                      disabled={busy}
                      className="text-xs text-[#B3261E] hover:underline disabled:opacity-50"
                    >
                      제거
                    </button>
                  )}
                </li>
              ))}
              {waitlisted.length > 0 && (
                <>
                  <li className="px-2 py-2 text-xs text-[#6F6F6F] font-medium bg-[#FAFAFA]">
                    대기열
                  </li>
                  {waitlisted
                    .sort((a, b) => (a.waitlist_position ?? 99) - (b.waitlist_position ?? 99))
                    .map((p, index) => (
                      <li key={p.user_id ?? `waitlisted-guest-${p.guest_name ?? index}`} className="flex items-center justify-between px-2 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="w-2 h-2 rounded-full bg-[#E6A817]" />
                          <span className="text-sm text-[#6F6F6F]">
                            {participantLabel(p)}
                          </span>
                          <span className="text-xs text-[#A0A0B0]">
                            {p.waitlist_position}순위
                          </span>
                        </div>
                        {p.user_id && (
                          <button
                            type="button"
                            onClick={() => handleRemoveParticipant(p.user_id!)}
                            disabled={busy}
                            className="text-xs text-[#B3261E] hover:underline disabled:opacity-50"
                          >
                            제거
                          </button>
                        )}
                      </li>
                    ))}
                </>
              )}
            </ul>
          )}

          {showInvite && (
            <div className="border-t border-[#EFEFEF] pt-4 mt-2">
              <ParticipantPicker
                selected={inviteSelected}
                onChange={setInviteSelected}
                maxParticipants={session.max_participants - activeParticipants.length}
              />
              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={handleInvite}
                  disabled={busy || inviteSelected.length === 0}
                  className="mb-btn text-sm"
                >
                  초대
                </button>
                <button
                  type="button"
                  onClick={() => { setShowInvite(false); setInviteSelected([]); }}
                  className="mb-btn mb-btn--ghost text-sm"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-[#B3261E] bg-[#FDECEC] px-4 py-3 rounded-xl">{error}</p>
        )}
      </div>
    </AppShell>
  );
}
