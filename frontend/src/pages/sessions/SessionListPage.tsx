// 세션 목록 페이지 (목록 + 캘린더 토글 + 생성 모달) — UI Kit

import { useEffect, useState, useCallback } from 'react';

import { listSessions, createSession, type SessionDto, type SessionType, type CreateSessionPayload } from '../../lib/api/session';
import { SessionCard } from '../../components/session/SessionCard';
import { CalendarView } from '../../components/session/CalendarView';
import { MonthCalendar } from '../../components/session/MonthCalendar';
import { MobileTimetable } from '../../components/session/MobileTimetable';
import { useSessionStore } from '../../stores/sessionStore';
import AppShell from '../../components/layout/AppShell';

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

const nowPlusOneHour = (): string => {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const inputCls =
  'w-full px-3.5 py-2.5 border border-[#DDDEE7] rounded-xl bg-white text-[#1F1F1F] text-sm focus:outline-none focus:ring-2 focus:ring-[#5F0080]/15 focus:border-[#5F0080]';
const labelCls = 'block text-sm font-medium text-[#1F1F1F] mb-1.5';

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-white rounded-[20px] shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 border border-[#EFEFEF]">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-[#1F1F1F]">새 세션 생성</h2>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#6F6F6F] hover:text-[#1F1F1F] hover:bg-[#F2F3F8] transition-colors"
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
          <label className="inline-flex items-center gap-2 text-sm text-[#1F1F1F]">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            시간 충돌 무시
          </label>
          {error && <p className="text-sm text-[#B3261E]">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={submitting} className="mb-btn">
              {submitting ? '생성 중...' : '생성'}
            </button>
            <button type="button" onClick={handleClose} className="mb-btn mb-btn--ghost">
              취소
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
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
            className="w-8 h-8 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#1F1F1F] flex items-center justify-center"
            aria-label="이전"
          >
            ‹
          </button>
          <span className="text-xs font-mono text-[#1F1F1F] min-w-[110px] text-center">{navLabel}</span>
          <button
            type="button"
            onClick={() => onShift(1)}
            className="w-8 h-8 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#1F1F1F] flex items-center justify-center"
            aria-label="다음"
          >
            ›
          </button>
        </div>
      </div>

      {loading && <p className="text-[#6F6F6F]">불러오는 중...</p>}
      {error && <p className="text-[#B3261E]">{error}</p>}
      {!loading && !error && (
        <MobileTimetable sessions={sessions} currentDate={currentDate} mode={mode} />
      )}
    </div>
  );
}

export default function SessionListPage() {
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
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

  const rightSlot = (
    <button type="button" onClick={() => setShowCreate(true)} className="mb-btn">
      + 새 세션
    </button>
  );

  const navLabel =
    viewMode === 'daily' ? formatDay(currentDate)
      : viewMode === 'weekly' ? formatWeekRange(currentDate)
        : '';
  const onShift = (dir: 1 | -1): void => {
    if (viewMode === 'daily') shiftDay(dir);
    else if (viewMode === 'weekly') shiftWeek(dir);
  };

  return (
    <AppShell title="세션 관리" sub="SESSIONS" rightSlot={rightSlot} noScroll>
      <div className="h-full flex flex-col min-h-0 max-w-6xl mx-auto w-full">
        {/* 모바일: 월간 캘린더 + 일간/주간 타임테이블 */}
        <div className="md:hidden flex-1 min-h-0 overflow-y-auto">
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

        {/* 데스크톱: 좌측 캘린더+목록 / 우측 타임라인 (50:50) */}
        <div className="hidden md:grid grid-cols-2 gap-6 min-h-0 flex-1">
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
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#1F1F1F]">
                  {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일 세션
                </h3>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-[#5F0080] text-white' : 'bg-[#F2F3F8] text-[#1F1F1F] hover:bg-[#E6E7EE]'}`}
                >
                  전체 목록
                </button>
              </div>
              {(() => {
                const daySessions = sessions.filter((s) => {
                  const d = new Date(s.scheduled_at);
                  return d.getFullYear() === selectedDate.getFullYear() && d.getMonth() === selectedDate.getMonth() && d.getDate() === selectedDate.getDate();
                }).sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
                if (daySessions.length === 0) return <p className="text-xs text-[#6F6F6F] py-4 text-center">예정된 세션이 없습니다</p>;
                return daySessions.map((s) => <SessionCard key={s.id} session={s} />);
              })()}
            </div>
          </div>

          {/* 우측: 타임라인 (일간/주간 토글 + CalendarView) */}
          <div className="flex flex-col min-h-0 overflow-y-auto">
            {viewMode === 'list' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {sessions.length === 0 ? (
                  <p className="text-[#6F6F6F] col-span-full text-center py-12">
                    등록된 세션이 없습니다.
                  </p>
                ) : (
                  sessions.map((s) => <SessionCard key={s.id} session={s} />)
                )}
              </div>
            ) : (
              <>
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
                      className="w-9 h-9 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#1F1F1F] flex items-center justify-center"
                      aria-label="이전"
                    >
                      ‹
                    </button>
                    <span className="text-sm font-mono text-[#1F1F1F] min-w-[140px] text-center">
                      {navLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => onShift(1)}
                      className="w-9 h-9 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#1F1F1F] flex items-center justify-center"
                      aria-label="다음"
                    >
                      ›
                    </button>
                  </div>
                </div>

                {loading && <p className="text-[#6F6F6F]">불러오는 중...</p>}
                {error && <p className="text-[#B3261E]">{error}</p>}

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

        <CreateSessionModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={refreshSessions}
        />
      </div>
    </AppShell>
  );
}
