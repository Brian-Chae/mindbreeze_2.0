// 호스트 클래스 목록 표 — 1.0 LectureScreen Table 패리티 (SDD-029 P2)
// 흰 배경 + 평평한 테이블 + 보라 강조. 카드 그리드 대체.

import { useNavigate } from 'react-router-dom';
import type { SessionDto } from '../../lib/api/session';
import { StatusBadge } from './StatusBadge';

interface SessionListTableProps {
  sessions: SessionDto[];
  loading?: boolean;
  emptyMessage?: string;
  loadingMessage?: string;
}

function formatTime(iso: string | null): string {
  if (!iso) return '즉시';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SessionListTable({
  sessions,
  loading = false,
  emptyMessage = '생성된 클래스가 없습니다.',
  loadingMessage = '클래스 목록을 불러오는 중입니다.',
}: SessionListTableProps) {
  const navigate = useNavigate();

  return (
    <div className="overflow-hidden bg-[var(--mb-white)]">
      {/* 헤더 — 1.0 #F2F3F8 */}
      <div className="hidden grid-cols-[minmax(0,3fr)_1fr_1fr_1fr_1.2fr_auto] items-center gap-2 bg-[var(--mb-bg-10)] px-4 py-2 text-sm text-[var(--mb-fg)] sm:grid">
        <span className="text-left font-medium">클래스명</span>
        <span className="text-center font-medium">코드</span>
        <span className="text-center font-medium">참여인원</span>
        <span className="text-center font-medium">상태</span>
        <span className="text-center font-medium">시간</span>
        <span className="w-[9.5rem] text-center font-medium">동작</span>
      </div>

      {loading && (
        <p className="py-8 text-center text-xl text-[var(--mb-black-40)]">{loadingMessage}</p>
      )}

      {!loading && sessions.length === 0 && (
        <p className="py-8 text-center text-xl text-[var(--mb-black-40)]">{emptyMessage}</p>
      )}

      {!loading &&
        sessions.map((session, index) => {
          const rowBg = index % 2 === 0 ? 'bg-[var(--mb-white)]' : 'bg-[var(--mb-bg-10)]';
          const canStart = session.status === 'ready' || session.status === 'scheduled';
          const title = session.title || '제목 없음';

          return (
            <div key={session.id}>
              {/* 데스크톱 행 */}
              <div
                className={`hidden grid-cols-[minmax(0,3fr)_1fr_1fr_1fr_1.2fr_auto] items-center gap-2 px-4 py-2 text-sm sm:grid ${rowBg}`}
              >
                <span className="truncate text-left font-medium text-[var(--mb-fg)]">{title}</span>
                <span className="text-center font-mono tracking-wider text-[var(--mb-primary)]">
                  {session.access_code ?? '—'}
                </span>
                <span className="text-center text-[var(--mb-fg)]">
                  {session.participants.length}/{session.max_participants}
                </span>
                <span className="flex justify-center">
                  <StatusBadge status={session.status} />
                </span>
                <span className="text-center font-mono text-[var(--mb-fg-muted)]">
                  {formatTime(session.scheduled_at ?? session.started_at ?? session.created_at)}
                </span>
                <div className="flex w-[9.5rem] items-center justify-end gap-2">
                  {canStart && (
                    <button
                      type="button"
                      onClick={() => navigate(`/sessions/${session.id}/live`)}
                      className="mb-btn px-3 py-1.5 text-xs"
                    >
                      시작
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        session.status === 'in_progress' || session.status === 'paused'
                          ? `/sessions/${session.id}/live`
                          : `/sessions/${session.id}`,
                      )
                    }
                    className="mb-btn px-3 py-1.5 text-xs"
                  >
                    입장
                  </button>
                </div>
              </div>

              {/* 모바일: 동일 정보 1열 카드 (표 정보 유지) */}
              <div className={`border-b border-[var(--mb-divider)] px-4 py-3 sm:hidden ${rowBg}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--mb-fg)]">{title}</p>
                    <p className="mt-1 font-mono text-sm tracking-wider text-[var(--mb-primary)]">
                      {session.access_code ?? '—'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--mb-fg-muted)]">
                      <StatusBadge status={session.status} />
                      <span>
                        {session.participants.length}/{session.max_participants}명
                      </span>
                      <span className="font-mono">
                        {formatTime(session.scheduled_at ?? session.started_at ?? session.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    {canStart && (
                      <button
                        type="button"
                        onClick={() => navigate(`/sessions/${session.id}/live`)}
                        className="mb-btn px-3 py-1.5 text-xs"
                      >
                        시작
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          session.status === 'in_progress' || session.status === 'paused'
                            ? `/sessions/${session.id}/live`
                            : `/sessions/${session.id}`,
                        )
                      }
                      className="mb-btn px-3 py-1.5 text-xs"
                    >
                      입장
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
    </div>
  );
}
