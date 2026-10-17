// LEGACY(D-5② 에서 제거) — 회원 목록의 월간 캘린더·일간/주간 타임라인. SDD-209 SH3 까지는 새 카드 목록 아래에 그대로 둔다.
// 이 파일과 ClientSessionListPage 의 import·사용 한 줄을 지우는 커밋이 D-5② 이다(되돌리려면 그 커밋을 revert).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SessionDto } from '../../lib/api/session';
import { MonthCalendar } from '../../components/session/MonthCalendar';
import { SessionCard } from '../../components/session/SessionCard';
import { CalendarView } from '../../components/session/CalendarView';

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const startOfWeek = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
};

function formatDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} (${WEEKDAY[date.getDay()]})`;
}

function formatWeekRange(date: Date): string {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${start.getFullYear()}.${pad(start.getMonth() + 1)}.${pad(start.getDate())} – ${pad(end.getMonth() + 1)}.${pad(end.getDate())}`;
}


interface Props {
  sessions: SessionDto[];
  loading: boolean;
  error: string | null;
  counselorNameMap: Record<string, string>;
}

export default function LegacyCalendarBlock({ sessions, loading, error, counselorNameMap }: Props) {
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  // 특정 날짜의 세션 목록
  const sessionsOnDay = (day: Date): SessionDto[] =>
    sessions
      .filter((s): s is SessionDto & { scheduled_at: string } => (
        Boolean(s.scheduled_at) && sameDay(new Date(s.scheduled_at as string), day)
      ))
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  // 선택된 날짜의 세션
  const todaySessions = sessionsOnDay(selectedDate);

  // 날짜 이동
  const shiftDay = (dir: 1 | -1): void => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + dir);
      return next;
    });
  };
  const shiftWeek = (dir: 1 | -1): void => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + dir * 7);
      return next;
    });
  };
  const shiftMonth = (dir: 1 | -1): void => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      next.setMonth(next.getMonth() + dir);
      return next;
    });
  };

  // MonthCalendar에서 날짜 선택 시 selectedDate 동기화
  const handleCalendarSelect = (date: Date) => {
    setSelectedDate(date);
  };

  // 선택일 표시 포맷
  const selectedDateLabel = (() => {
    const d = selectedDate;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${WEEKDAY[d.getDay()]})`;
  })();

  const onShift = (dir: 1 | -1): void => {
    if (viewMode === 'daily') shiftDay(dir);
    else if (viewMode === 'weekly') shiftWeek(dir);
  };

  // --- 렌더링 헬퍼: 세션 리스트 (공통) ---
  const renderSessionList = () => {
    if (loading) {
      return (
        <div className="py-8 text-center text-sm text-[#6F6F6F]">
          불러오는 중...
        </div>
      );
    }
    if (error) {
      return (
        <div className="py-8 text-center text-sm text-red-500">{error}</div>
      );
    }
    if (todaySessions.length === 0) {
      return (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9B9B9B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <p className="text-sm font-medium text-[#1F1F1F] mb-1">아직 예정된 세션이 없어요</p>
          <p className="text-xs text-[#6F6F6F]">상담사가 세션을 등록하면 여기에 표시됩니다</p>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {todaySessions.map((s) => (
          <SessionCard
            key={s.id}
            session={s}
            onClick={() => navigate(`/app/sessions/${s.id}`)}
            counselorName={counselorNameMap[s.host_id] || undefined}
          />
        ))}
      </div>
    );
  };


  return (
    <>
      {/* ===== 모바일: MonthCalendar + 세션 리스트 ===== */}
      <div className="md:hidden space-y-4">
        <MonthCalendar
          sessions={sessions}
          currentDate={currentDate}
          selectedDate={selectedDate}
          onSelectDate={handleCalendarSelect}
          onShiftMonth={shiftMonth}
        />

        <h2 className="text-sm font-semibold text-[#1F1F1F] mb-2">
          {selectedDateLabel}
        </h2>
        {renderSessionList()}
      </div>

      {/* ===== 데스크톱: 좌측 캘린더+목록 / 우측 타임라인 (50:50) ===== */}
      <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-6 min-h-0">
        {/* 좌측: 캘린더 + 선택일 세션 목록 */}
        <div className="flex flex-col gap-3 min-h-0 overflow-y-auto">
          <MonthCalendar
            sessions={sessions}
            currentDate={currentDate}
            selectedDate={selectedDate}
            onSelectDate={(d) => { setSelectedDate(d); setViewMode('daily'); }}
            onShiftMonth={shiftMonth}
          />
          {/* 선택일 세션 리스트 */}
          <div className="bg-white border border-[#EFEFEF] rounded-[20px] p-4 space-y-2">
            <h3 className="text-sm font-semibold text-[#1F1F1F]">
              {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일 세션
            </h3>
            {(() => {
              const daySessions = sessions.filter((s) => {
                if (!s.scheduled_at) return false;
                const d = new Date(s.scheduled_at);
                return d.getFullYear() === selectedDate.getFullYear() && d.getMonth() === selectedDate.getMonth() && d.getDate() === selectedDate.getDate();
              }).sort((a, b) => new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime());
              if (daySessions.length === 0) return <p className="text-xs text-[#6F6F6F] py-4 text-center">예정된 세션이 없습니다</p>;
              return daySessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  onClick={() => navigate(`/app/sessions/${s.id}`)}
                  counselorName={counselorNameMap[s.host_id] || undefined}
                />
              ));
            })()}
          </div>
        </div>

        {/* 우측: 타임라인 (일간/주간 토글 + CalendarView) */}
        <div className="flex flex-col min-h-0 overflow-y-auto">
          <div className="flex items-center justify-between shrink-0 mb-3">
            <div className="inline-flex rounded-full bg-[#F2F3F8] p-1">
              {(['daily', 'weekly'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setViewMode(m)}
                  className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
                    viewMode === m ? 'bg-[#5F0080] text-white font-bold' : 'text-[#1F1F1F] font-medium'
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
                className="w-11 h-11 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#1F1F1F] flex items-center justify-center"
                aria-label="이전"
              >
                ‹
              </button>
              <span className="text-sm font-mono text-[#1F1F1F] min-w-[140px] text-center">
                {viewMode === 'daily' ? formatDay(currentDate) : viewMode === 'weekly' ? formatWeekRange(currentDate) : ''}
              </span>
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

          {loading && <p className="text-[#6F6F6F]">불러오는 중...</p>}
          {error && <p className="text-[#B3261E]">{error}</p>}

          {!loading && !error && viewMode === 'daily' && (
            <CalendarView sessions={sessions} currentDate={currentDate} mode="daily" />
          )}
          {!loading && !error && viewMode === 'weekly' && (
            <CalendarView sessions={sessions} currentDate={currentDate} mode="weekly" />
          )}
        </div>
      </div>

    </>
  );
}
