// 세션 상세 페이지

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  deleteSession,
  getSession,
  transitionSession,
  type SessionAction,
  type SessionDto,
} from '../../lib/api/session';
import { StatusBadge } from '../../components/session/StatusBadge';

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
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
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
