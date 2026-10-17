// LEGACY(D-5② 에서 제거) — 상담사 목록의 월간 캘린더·일간/주간 타임라인과 표. SDD-209 SH5 까지는 새 카드 목록 아래에 그대로 둔다.
// 이 파일과 SessionListPage 의 import·사용 한 줄을 지우는 커밋이 D-5② 이다(되돌리려면 그 커밋을 revert).
import { useState } from 'react';
import type { SessionDto } from '../../lib/api/session';
import { SessionListTable } from '../../components/session/SessionListTable';
import { CalendarView } from '../../components/session/CalendarView';
import { MonthCalendar } from '../../components/session/MonthCalendar';
import { MobileTimetable } from '../../components/session/MobileTimetable';
import { useSessionStore } from '../../stores/sessionStore';

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

const startOfWeek = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
};

const formatWeekRange = (date: Date): string => {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${start.getFullYear()}.${pad(start.getMonth() + 1)}.${pad(start.getDate())} – ${pad(end.getMonth() + 1)}.${pad(end.getDate())}`;
};

const formatDay = (date: Date): string =>
  `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} (${WEEKDAY[date.getDay()]})`;


type MobileMode = 'daily' | 'weekly';

const formatMobileDay = (date: Date): string =>
  `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY[date.getDay()]})`;

const formatMobileWeekRange = (date: Date): string => {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.getMonth() + 1}.${start.getDate()} – ${end.getMonth() + 1}.${end.getDate()}`;
};

interface MobileSectionProps {
  sessions: SessionDto[];
  loading: boolean;
  error: string | null;
  currentDate: Date;
  setSelectedDate: (d: Date) => void;
  shiftMonth: (dir: 1 | -1) => void;
  shiftDay: (dir: 1 | -1) => void;
  shiftWeek: (dir: 1 | -1) => void;
}

function MobileSection({
  sessions, loading, error, currentDate, setSelectedDate, shiftMonth, shiftDay, shiftWeek,
}: MobileSectionProps) {
  const [mode, setMode] = useState<MobileMode>('daily');
  const { setCurrentDate } = useSessionStore();
  const navLabel = mode === 'daily' ? formatMobileDay(currentDate) : formatMobileWeekRange(currentDate);
  const onShift = (dir: 1 | -1): void => {
    if (mode === 'daily') shiftDay(dir);
    else shiftWeek(dir);
  };

  // MonthCalendar 날짜 선택 → sessionStore + 로컬 selectedDate 동기화
  const handleCalendarSelect = (date: Date) => {
    setCurrentDate(date);
    setSelectedDate(date);
  };

  return (
    <div className="md:hidden space-y-4">
      <MonthCalendar
        sessions={sessions}
        currentDate={currentDate}
        selectedDate={mode === 'daily' ? currentDate : undefined}
        weekHighlight={mode === 'weekly' ? currentDate : undefined}
        onSelectDate={handleCalendarSelect}
        onShiftMonth={shiftMonth}
      />

      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-full bg-[#F2F3F8] p-1">
          {(['daily', 'weekly'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-4 py-2.5 text-sm rounded-full transition-colors ${
                mode === m ? 'bg-[#5F0080] text-white font-bold' : 'text-[#1F1F1F] font-medium'
              }`}
            >
              {m === 'daily' ? '일간' : '주간'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onShift(-1)}
            className="w-11 h-11 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#1F1F1F] flex items-center justify-center"
            aria-label="이전"
          >
            ‹
          </button>
          <span className="text-xs font-mono text-[#1F1F1F] min-w-[110px] text-center">{navLabel}</span>
          <button
            type="button"
            onClick={() => onShift(1)}
            className="w-11 h-11 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#1F1F1F] flex items-center justify-center"
            aria-label="다음"
          >
            ›
          </button>
        </div>
      </div>

      {loading && <p className="text-[var(--mb-fg-muted)]">불러오는 중...</p>}
      {error && <p className="text-[var(--mb-danger-deep)]">{error}</p>}
      {!loading && !error && (
        <>
          <MobileTimetable sessions={sessions} currentDate={currentDate} mode={mode} />
          {/* 모바일도 동일 표 정보 — 1.0 패리티 */}
          <div className="overflow-hidden rounded-[var(--mb-radius-md)] border border-[var(--mb-divider)] bg-[var(--mb-white)]">
            <div className="border-b border-[var(--mb-divider)] bg-[var(--mb-bg-10)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--mb-fg)]">클래스 목록</h3>
            </div>
            <SessionListTable
              sessions={
                mode === 'daily'
                  ? sessions.filter((s) => {
                      if (!s.scheduled_at && (s.status === 'ready' || s.status === 'in_progress')) {
                        return true;
                      }
                      if (!s.scheduled_at) return false;
                      const d = new Date(s.scheduled_at);
                      return (
                        d.getFullYear() === currentDate.getFullYear() &&
                        d.getMonth() === currentDate.getMonth() &&
                        d.getDate() === currentDate.getDate()
                      );
                    })
                  : sessions
              }
              emptyMessage="생성된 클래스가 없습니다."
            />
          </div>
        </>
      )}
    </div>
  );
}


interface Props {
  sessions: SessionDto[];
  loading: boolean;
  error: string | null;
}

export default function LegacyHostCalendarBlock({ sessions, loading, error }: Props) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const { viewMode, setViewMode, currentDate, setCurrentDate } = useSessionStore();

  const shiftDay = (direction: 1 | -1): void => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + direction);
    setCurrentDate(next);
  };
  const shiftWeek = (direction: 1 | -1): void => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + direction * 7);
    setCurrentDate(next);
  };
  const shiftMonth = (direction: 1 | -1): void => {
    const next = new Date(currentDate);
    next.setMonth(next.getMonth() + direction);
    setCurrentDate(next);
  };

  const navLabel =
    viewMode === 'daily' ? formatDay(currentDate)
      : viewMode === 'weekly' ? formatWeekRange(currentDate)
        : '';
  const instantSessions = sessions.filter((session) => (
    !session.scheduled_at && (session.status === 'ready' || session.status === 'in_progress')
  ));
  const instantSessionIds = new Set(instantSessions.map((session) => session.id));
  const listedSessions = sessions.filter((session) => !instantSessionIds.has(session.id));
  const onShift = (dir: 1 | -1): void => {
    if (viewMode === 'daily') shiftDay(dir);
    else if (viewMode === 'weekly') shiftWeek(dir);
  };

  return (
      <div className="mx-auto flex w-full max-w-6xl flex-col">
        {/* 즉시 클래스 — 1.0 평평한 표 */}
        {instantSessions.length > 0 && (
          <section className="mb-4 shrink-0 overflow-hidden rounded-[var(--mb-radius-md)] border border-[var(--mb-divider)] bg-[var(--mb-white)]">
            <div className="flex items-center justify-between border-b border-[var(--mb-divider)] bg-[var(--mb-bg-10)] px-4 py-3">
              <h2 className="text-sm font-bold text-[var(--mb-fg)]">즉시 클래스</h2>
              <span className="text-xs text-[var(--mb-fg-muted)]">{instantSessions.length}개</span>
            </div>
            <SessionListTable sessions={instantSessions} />
          </section>
        )}

        {/* 모바일: 월간 캘린더 + 일간/주간 + 선택 범위 표 */}
        <div className="min-h-0 flex-1 overflow-y-auto md:hidden">
          <MobileSection
            sessions={sessions}
            loading={loading}
            error={error}
            currentDate={currentDate}
            setSelectedDate={setSelectedDate}
            shiftMonth={shiftMonth}
            shiftDay={shiftDay}
            shiftWeek={shiftWeek}
          />
        </div>

        {/* 데스크톱: 좌측 캘린더 / 우측 표·타임라인 (태블릿은 1열로 쌓아 가로 오버플로를 막는다) */}
        <div className="hidden min-h-0 flex-1 gap-6 md:grid md:grid-cols-1 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto">
            <MonthCalendar
              sessions={sessions}
              currentDate={currentDate}
              selectedDate={selectedDate}
              onSelectDate={(d) => {
                setSelectedDate(d);
                setViewMode('daily');
              }}
              onShiftMonth={shiftMonth}
            />
            <div className="overflow-x-auto rounded-[var(--mb-radius-md)] border border-[var(--mb-divider)] bg-[var(--mb-white)]">
              <div className="flex items-center justify-between border-b border-[var(--mb-divider)] bg-[var(--mb-bg-10)] px-4 py-3">
                <h3 className="text-sm font-semibold text-[var(--mb-fg)]">
                  {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일 세션
                </h3>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    viewMode === 'list'
                      ? 'bg-[var(--mb-primary)] text-white'
                      : 'bg-[var(--mb-bg-10)] text-[var(--mb-fg)] hover:bg-[#E6E7EE]'
                  }`}
                >
                  전체 목록
                </button>
              </div>
              {(() => {
                const daySessions = sessions
                  .filter((s) => {
                    if (!s.scheduled_at) return false;
                    const d = new Date(s.scheduled_at);
                    return (
                      d.getFullYear() === selectedDate.getFullYear() &&
                      d.getMonth() === selectedDate.getMonth() &&
                      d.getDate() === selectedDate.getDate()
                    );
                  })
                  .sort(
                    (a, b) =>
                      new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime(),
                  );
                return (
                  <SessionListTable
                    sessions={daySessions}
                    emptyMessage="예정된 세션이 없습니다"
                  />
                );
              })()}
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto">
            {viewMode === 'list' ? (
              <div className="overflow-x-auto rounded-[var(--mb-radius-md)] border border-[var(--mb-divider)] bg-[var(--mb-white)]">
                <div className="border-b border-[var(--mb-divider)] bg-[var(--mb-bg-10)] px-4 py-3">
                  <h3 className="text-sm font-semibold text-[var(--mb-fg)]">전체 클래스 목록</h3>
                </div>
                {loading && (
                  <p className="py-8 text-center text-[var(--mb-fg-muted)]">불러오는 중...</p>
                )}
                {error && <p className="px-4 py-4 text-[var(--mb-danger-deep)]">{error}</p>}
                {!loading && !error && (
                  <SessionListTable
                    sessions={listedSessions}
                    emptyMessage="그 밖의 세션이 없습니다."
                  />
                )}
              </div>
            ) : (
              <>
                <div className="mb-3 flex shrink-0 items-center justify-between">
                  <div className="inline-flex rounded-full bg-[var(--mb-bg-10)] p-1">
                    {(['daily', 'weekly'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setViewMode(m)}
                        className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                          viewMode === m
                            ? 'bg-[var(--mb-primary)] font-bold text-white'
                            : 'font-medium text-[var(--mb-fg)]'
                        }`}
                      >
                        {m === 'daily' ? '일간' : '주간'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onShift(-1)}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--mb-bg-10)] text-[var(--mb-fg)] hover:bg-[#E6E7EE]"
                      aria-label="이전"
                    >
                      ‹
                    </button>
                    <span className="min-w-[140px] text-center font-mono text-sm text-[var(--mb-fg)]">
                      {navLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => onShift(1)}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--mb-bg-10)] text-[var(--mb-fg)] hover:bg-[#E6E7EE]"
                      aria-label="다음"
                    >
                      ›
                    </button>
                  </div>
                </div>

                {loading && <p className="text-[var(--mb-fg-muted)]">불러오는 중...</p>}
                {error && <p className="text-[var(--mb-danger-deep)]">{error}</p>}

                {!loading && !error && viewMode === 'weekly' && (
                  <CalendarView sessions={sessions} currentDate={currentDate} mode="weekly" />
                )}
                {!loading && !error && viewMode === 'daily' && (
                  <CalendarView sessions={sessions} currentDate={currentDate} mode="daily" />
                )}
              </>
            )}
          </div>
        </div>
    </div>
  );
}
