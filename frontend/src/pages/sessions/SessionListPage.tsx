// 세션 목록 페이지 (목록 + 캘린더 토글 + 생성 모달)

import { useEffect, useState, useCallback } from 'react';

import { listSessions, createSession, type SessionDto, type SessionType, type CreateSessionPayload } from '../../lib/api/session';
import { SessionCard } from '../../components/session/SessionCard';
import { CalendarView } from '../../components/session/CalendarView';
import { useSessionStore } from '../../stores/sessionStore';

/* ─── 오늘+1시간 ISO 문자열 ─── */
const nowPlusOneHour = (): string => {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/* ─── 생성 모달 ─── */
function CreateSessionModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<SessionType>('clinical');
  const [scheduledAt, setScheduledAt] = useState(nowPlusOneHour());
  const [durationMin, setDurationMin] = useState(50);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [maxParticipants, setMaxParticipants] = useState(1);
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: CreateSessionPayload = {
        type,
        scheduled_at: new Date(scheduledAt).toISOString(),
        duration_min: durationMin,
        title: title || undefined,
        notes: notes || undefined,
        max_participants: maxParticipants,
        force,
      };
      await createSession(payload);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '세션 생성에 실패했습니다');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setError(null);
    setType('clinical');
    setScheduledAt(nowPlusOneHour());
    setDurationMin(50);
    setTitle('');
    setNotes('');
    setMaxParticipants(1);
    setForce(false);
    onClose();
  };

  if (!open) return null;

  const inputCls =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm';
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">새 세션 생성</h2>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelCls}>세션 유형</label>
            <select value={type} onChange={(e) => setType(e.target.value as SessionType)} className={inputCls}>
              <option value="clinical">임상심리상담</option>
              <option value="hypnosis">최면심리상담</option>
              <option value="meditation">명상수업</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>일시</label>
            <input
              type="datetime-local"
              required
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>소요 시간(분)</label>
              <input
                type="number"
                min={1}
                max={600}
                required
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>최대 참여자 수</label>
              <input
                type="number"
                min={1}
                max={100}
                required
                value={maxParticipants}
                onChange={(e) => setMaxParticipants(Number(e.target.value))}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>제목</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>메모</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputCls} />
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            시간 충돌 무시
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
            >
              {submitting ? '생성 중...' : '생성'}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-200 text-sm"
            >
              취소
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── 메인 페이지 ─── */
export default function SessionListPage() {
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const { viewMode, setViewMode, currentDate, setCurrentDate } = useSessionStore();

  const refreshSessions = useCallback(() => {
    setLoading(true);
    listSessions()
      .then((res) => setSessions(res.sessions))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const shiftWeek = (direction: 1 | -1): void => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + direction * 7);
    setCurrentDate(next);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">세션 관리</h1>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium"
        >
          + 새 세션
        </button>
      </div>

      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 text-sm ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200'}`}
          >
            목록
          </button>
          <button
            type="button"
            onClick={() => setViewMode('weekly')}
            className={`px-3 py-1.5 text-sm ${viewMode === 'weekly' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200'}`}
          >
            주간
          </button>
        </div>
        {viewMode === 'weekly' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftWeek(-1)}
              className="px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-200"
            >
              ‹
            </button>
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {currentDate.toLocaleDateString('ko-KR')}
            </span>
            <button
              type="button"
              onClick={() => shiftWeek(1)}
              className="px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-200"
            >
              ›
            </button>
          </div>
        )}
      </div>

      {loading && <p className="text-gray-500 dark:text-gray-400">불러오는 중...</p>}
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}

      {!loading && !error && viewMode === 'list' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 col-span-full text-center py-8">
              등록된 세션이 없습니다.
            </p>
          ) : (
            sessions.map((s) => <SessionCard key={s.id} session={s} />)
          )}
        </div>
      )}

      {!loading && !error && viewMode === 'weekly' && (
        <CalendarView sessions={sessions} currentDate={currentDate} />
      )}

      {/* 생성 모달 */}
      <CreateSessionModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={refreshSessions}
      />
    </div>
  );
}
