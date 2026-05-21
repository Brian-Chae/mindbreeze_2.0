// 세션 상세 페이지

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

const TYPE_LABELS: Record<SessionDto['type'], string> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상수업',
};

const ACTIONS_BY_STATUS: Record<SessionDto['status'], SessionAction[]> = {
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

export default function SessionDetailPage(){
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteSelected, setInviteSelected] = useState<SelectedParticipant[]>([]);

  const activeParticipants = (session?.participants ?? []).filter((p) => !p.is_waitlisted);
  const waitlisted = (session?.participants ?? []).filter((p) => p.is_waitlisted);

  useEffect(() => {
    if (!id) return;
    getSession(id)
      .then(setSession)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const handleAction = async (action: SessionAction): Promise<void> => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await transitionSession(id, action);
      setSession(updated);
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

  if (error && !session) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <p className="text-gray-500 dark:text-gray-400">불러오는 중...</p>
      </div>
    );
  }

  const actions = ACTIONS_BY_STATUS[session.status];

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/sessions')}
          className="text-sm text-gray-600 dark:text-gray-300 hover:underline"
        >
          ← 목록으로
        </button>
        <StatusBadge status={session.status} />
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 space-y-3">
        <div className="text-sm text-indigo-700 dark:text-indigo-300">{TYPE_LABELS[session.type]}</div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {session.title || '제목 없음'}
        </h1>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 text-sm">
          <dt className="text-gray-500 dark:text-gray-400">일시</dt>
          <dd className="text-gray-900 dark:text-gray-100">
            {new Date(session.scheduled_at).toLocaleString('ko-KR')}
          </dd>
          <dt className="text-gray-500 dark:text-gray-400">소요 시간</dt>
          <dd className="text-gray-900 dark:text-gray-100">{session.duration_min}분</dd>
          <dt className="text-gray-500 dark:text-gray-400">참여자</dt>
          <dd className="text-gray-900 dark:text-gray-100">
            {session.participants.length} / {session.max_participants}
          </dd>
        </dl>
        {session.notes && (
          <div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">메모</div>
            <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">{session.notes}</p>
          </div>
        )}
      </div>

      {/* 참여자 섹션 */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            참여자 ({activeParticipants.length}/{session.max_participants}명)
            {session.waitlist_count > 0 && (
              <span className="ml-2 text-gray-400 font-normal">대기 {session.waitlist_count}명</span>
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
          <p className="text-sm text-gray-400">아직 참여자가 없습니다</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {activeParticipants.map((p) => (
              <li key={p.user_id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-sm text-gray-800">
                    {p.user_name || p.user_email || p.user_id.slice(0, 8)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveParticipant(p.user_id)}
                  disabled={busy}
                  className="text-xs text-red-400 hover:text-red-600"
                >
                  제거
                </button>
              </li>
            ))}
            {waitlisted.length > 0 && (
              <>
                <li className="py-2 text-xs text-gray-400 font-medium">대기열</li>
                {waitlisted
                  .sort((a, b) => (a.waitlist_position ?? 99) - (b.waitlist_position ?? 99))
                  .map((p) => (
                    <li key={p.user_id} className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        <span className="text-sm text-gray-500">
                          {p.user_name || p.user_email || p.user_id.slice(0, 8)}
                        </span>
                        <span className="text-xs text-gray-400">({p.waitlist_position}순위)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveParticipant(p.user_id)}
                        disabled={busy}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        제거
                      </button>
                    </li>
                  ))}
              </>
            )}
          </ul>
        )}

        {showInvite && (
          <div className="border-t border-gray-200 pt-3 mt-3">
            <ParticipantPicker
              selected={inviteSelected}
              onChange={setInviteSelected}
              maxParticipants={session.max_participants - activeParticipants.length}
            />
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={handleInvite} disabled={busy || inviteSelected.length === 0} className="mb-btn text-sm">초대</button>
              <button type="button" onClick={() => { setShowInvite(false); setInviteSelected([]); }} className="mb-btn mb-btn--ghost text-sm">취소</button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => handleAction(action)}
            disabled={busy}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm disabled:opacity-50"
          >
            {ACTION_LABELS[action]}
          </button>
        ))}
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy}
          className="px-4 py-2 border border-red-300 text-red-600 dark:text-red-400 dark:border-red-700 rounded-md text-sm disabled:opacity-50 ml-auto"
        >
          삭제
        </button>
      </div>
    </div>
  );
}
