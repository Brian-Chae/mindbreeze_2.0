// 세션 목록 페이지 (목록 + 캘린더 토글)

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listSessions, type SessionDto } from '../../lib/api/session';
import { SessionCard } from '../../components/session/SessionCard';
import { CalendarView } from '../../components/session/CalendarView';
import { useSessionStore } from '../../stores/sessionStore';

export default function SessionListPage(){
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { viewMode, setViewMode, currentDate, setCurrentDate } = useSessionStore();

  useEffect(() => {
    let active = true;
    setLoading(true);
    listSessions()
      .then((res) => {
        if (active) setSessions(res.sessions);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const shiftWeek = (direction: 1 | -1): void => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + direction * 7);
    setCurrentDate(next);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">세션 관리</h1>
        <Link
          to="/sessions/new"
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium"
        >
          + 새 세션
        </Link>
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
    </div>
  );
}
