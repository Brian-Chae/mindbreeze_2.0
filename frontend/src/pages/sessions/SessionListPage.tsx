// 세션 목록 페이지 (목록 + 캘린더 토글 + 생성 모달) — UI Kit

import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { listSessions, createSession, type SessionDto, type SessionType, type CreateSessionPayload } from '../../lib/api/session';
import { SessionListTable } from '../../components/session/SessionListTable';
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
  const [maxParticipants, setMaxParticipants] = useState(10);
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarNavDate, setCalendarNavDate] = useState(new Date());
  const calendarRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const onlineTag = isOnline ? '[온라인]' : '[오프라인]';
      const combinedNotes = [onlineTag, notes].filter(Boolean).join(' ');
      const payload: CreateSessionPayload = {
        type,
        scheduled_at: new Date(scheduledAt).toISOString(),
        duration_min: durationMin,
        title: title || undefined,
        notes: combinedNotes || undefined,
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
    setIsOnline(true);
    onClose();
  };

  // 캘린더 팝오버 외부 클릭 시 닫기
  useEffect(() => {
    if (!showCalendar) return;
    const handler = (e: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCalendar]);

  // scheduledAt에서 날짜/시간 분리
  const dateValue = scheduledAt.slice(0, 10); // YYYY-MM-DD
  const timeValue = scheduledAt.slice(11, 16); // HH:MM
  const selectedDateObj = new Date(dateValue + 'T00:00:00');

  const handleDateSelect = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    setScheduledAt(`${yyyy}-${mm}-${dd}T${timeValue}`);
    setShowCalendar(false);
  };

  const [showTimePicker, setShowTimePicker] = useState(false);
  const timePickerRef = useRef<HTMLDivElement>(null);
  const hourScrollRef = useRef<HTMLDivElement>(null);
  const minuteScrollRef = useRef<HTMLDivElement>(null);

  // 시간 표시용 (오전/오후 + 12시간제)
  const timeHour24 = parseInt(timeValue.slice(0, 2), 10);
  const timeMinute = timeValue.slice(3, 5);
  const isPM = timeHour24 >= 12;
  const displayHour12 = timeHour24 === 0 ? 12 : timeHour24 > 12 ? timeHour24 - 12 : timeHour24;
  const timeLabel = `${isPM ? '오후' : '오전'} ${displayHour12}:${timeMinute}`;

  // 다이얼에서 시간 선택 시
  const handleTimeSelect = (hour12: number, minute: string, ampm: '오전' | '오후', keepOpen = false) => {
    let h24: number;
    if (ampm === '오전') {
      h24 = hour12 === 12 ? 0 : hour12;
    } else {
      h24 = hour12 === 12 ? 12 : hour12 + 12;
    }
    const hh = String(h24).padStart(2, '0');
    setScheduledAt(`${dateValue}T${hh}:${minute}`);
    if (!keepOpen) setShowTimePicker(false);
  };

  // 타임피커 외부 클릭 시 닫기
  useEffect(() => {
    if (!showTimePicker) return;
    const handler = (e: MouseEvent) => {
      if (timePickerRef.current && !timePickerRef.current.contains(e.target as Node)) {
        setShowTimePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTimePicker]);

  // 타임피커 열릴 때 선택된 항목으로 스크롤
  useEffect(() => {
    if (showTimePicker) {
      requestAnimationFrame(() => {
        // 시 다이얼 스크롤
        if (hourScrollRef.current) {
          const sel = hourScrollRef.current.querySelector('[data-selected="true"]');
          if (sel) sel.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
        // 분 다이얼 스크롤
        if (minuteScrollRef.current) {
          const sel = minuteScrollRef.current.querySelector('[data-selected="true"]');
          if (sel) sel.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      });
    }
  }, [showTimePicker]);

  // 모달 열릴 때 캘린더 내비게이션을 선택된 날짜로 초기화
  useEffect(() => {
    if (open) setCalendarNavDate(selectedDateObj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
            <label className={labelCls}>진행 방식</label>
            <div className="flex rounded-xl bg-[#F2F3F8] p-1">
              <button
                type="button"
                onClick={() => setIsOnline(true)}
                className={`flex-1 px-5 py-2 text-sm rounded-[10px] font-medium transition-colors ${
                  isOnline ? 'bg-[#5F0080] text-white' : 'text-[#1F1F1F] hover:bg-[#E6E7EE]'
                }`}
              >
                온라인
              </button>
              <button
                type="button"
                onClick={() => setIsOnline(false)}
                className={`flex-1 px-5 py-2 text-sm rounded-[10px] font-medium transition-colors ${
                  !isOnline ? 'bg-[#5F0080] text-white' : 'text-[#1F1F1F] hover:bg-[#E6E7EE]'
                }`}
              >
                오프라인
              </button>
            </div>
          </div>
          <div>
            <label className={labelCls}>일시</label>
            <div className="flex flex-col gap-2">
              {/* 날짜 선택 필드 (통합) */}
              <div className="relative flex-1" ref={calendarRef}>
                <button
                  type="button"
                  onClick={() => {
                    setCalendarNavDate(selectedDateObj);
                    setShowCalendar(!showCalendar);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 border border-[#DDDEE7] rounded-xl bg-white text-[#1F1F1F] text-sm hover:border-[#5F0080] hover:bg-[#FDFAFF] transition-colors focus:outline-none focus:ring-2 focus:ring-[#5F0080]/15 focus:border-[#5F0080]"
                >
                  <svg className="w-4 h-4 text-[#5F0080] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="flex-1 text-left font-medium">
                    {selectedDateObj.getFullYear()}년 {selectedDateObj.getMonth() + 1}월 {selectedDateObj.getDate()}일 ({WEEKDAY[selectedDateObj.getDay()]})
                  </span>
                  <svg className="w-3.5 h-3.5 text-[#6F6F6F] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showCalendar && (
                  <div className="absolute top-full left-0 mt-2 z-50 w-[320px] shadow-xl animate-in fade-in zoom-in-95 origin-top">
                    <MonthCalendar
                      sessions={[]}
                      currentDate={calendarNavDate}
                      selectedDate={selectedDateObj}
                      onSelectDate={handleDateSelect}
                      onShiftMonth={(dir) => {
                        const next = new Date(calendarNavDate);
                        next.setMonth(next.getMonth() + dir);
                        setCalendarNavDate(next);
                      }}
                      onToday={() => {
                        const now = new Date();
                        handleDateSelect(now);
                      }}
                    />
                  </div>
                )}
              </div>
              {/* 시간 다이얼 피커 */}
              <div className="relative flex-1" ref={timePickerRef}>
                <button
                  type="button"
                  onClick={() => setShowTimePicker(!showTimePicker)}
                  className="w-full flex items-center gap-1.5 pl-3.5 pr-2.5 py-2.5 border border-[#DDDEE7] rounded-xl bg-white text-[#1F1F1F] text-sm font-medium hover:border-[#5F0080] hover:bg-[#FDFAFF] transition-colors focus:outline-none focus:ring-2 focus:ring-[#5F0080]/15 focus:border-[#5F0080]"
                >
                  <svg className="w-4 h-4 text-[#5F0080] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="flex-1 text-left">{timeLabel}</span>
                  <svg className="w-3 h-3 text-[#6F6F6F] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showTimePicker && (
                  <div className="absolute top-full right-0 mt-2 z-50 w-[220px] bg-white rounded-[20px] border border-[#EFEFEF] shadow-xl p-4 animate-in fade-in zoom-in-95 origin-top">
                    {/* AM/PM 토글 */}
                    <div className="flex justify-center mb-4">
                      <div className="inline-flex rounded-full bg-[#F2F3F8] p-1">
                        {(['오전', '오후'] as const).map((ap) => {
                          const active = (ap === '오전' && !isPM) || (ap === '오후' && isPM);
                          return (
                          <button
                            key={ap}
                            type="button"
                            onClick={() => {
                              if (!active) {
                                handleTimeSelect(displayHour12, timeMinute, ap, true);
                              }
                            }}
                            className={`px-6 py-1.5 text-sm rounded-full transition-colors font-medium ${
                              active
                                ? 'bg-[#5F0080] text-white'
                                : 'text-[#1F1F1F] hover:bg-[#E6E7EE]'
                            }`}
                          >
                            {ap}
                          </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 시 / 분 다이얼 */}
                    <div className="flex gap-3">
                      {/* 시 다이얼 */}
                      <div className="flex-1">
                        <div className="text-center text-[10px] font-medium text-[#6F6F6F] pb-2">시</div>
                        <div ref={hourScrollRef} className="max-h-[200px] overflow-y-auto scrollbar-hide space-y-1">
                          {Array.from({ length: 12 }, (_, i) => {
                            const h = i + 1;
                            const selected = displayHour12 === h;
                            return (
                              <button
                                key={h}
                                type="button"
                                data-selected={selected}
                                onClick={() => handleTimeSelect(h, timeMinute, isPM ? '오후' : '오전', true)}
                                className={`w-full py-2.5 rounded-[10px] text-sm font-medium transition-colors ${
                                  selected
                                    ? 'bg-[#5F0080] text-white'
                                    : 'text-[#1F1F1F] hover:bg-[#F2F3F8]'
                                }`}
                              >
                                {h}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 구분선 */}
                      <div className="w-px bg-[#EFEFEF] shrink-0" />

                      {/* 분 다이얼 */}
                      <div className="flex-1">
                        <div className="text-center text-[10px] font-medium text-[#6F6F6F] pb-2">분</div>
                        <div ref={minuteScrollRef} className="max-h-[200px] overflow-y-auto scrollbar-hide space-y-1">
                          {['00', '10', '20', '30', '40', '50'].map((m) => {
                            const selected = timeMinute === m;
                            return (
                              <button
                                key={m}
                                type="button"
                                data-selected={selected}
                                onClick={() => handleTimeSelect(displayHour12, m, isPM ? '오후' : '오전', true)}
                                className={`w-full py-2.5 rounded-[10px] text-sm font-medium transition-colors ${
                                  selected
                                    ? 'bg-[#5F0080] text-white'
                                    : 'text-[#1F1F1F] hover:bg-[#F2F3F8]'
                                }`}
                              >
                                {m}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>소요 시간(분)</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                value={durationMin || ''}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '');
                  setDurationMin(v === '' ? 0 : Math.min(600, Math.max(1, Number(v))));
                }}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>최대 참여자 수</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                value={maxParticipants || ''}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '');
                  setMaxParticipants(v === '' ? 0 : Math.min(100, Math.max(1, Number(v))));
                }}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>제목</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="예: 1차 상담, 스트레스 관리 명상" />
          </div>
          <div>
            <label className={labelCls}>설명</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputCls} placeholder="세션에 대한 설명을 입력하세요" />
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

export default function SessionListPage() {
  const navigate = useNavigate();
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
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => setShowCreate(true)} className="mb-btn mb-btn--ghost">
        예약 만들기
      </button>
      <button type="button" onClick={() => navigate('/sessions/new')} className="mb-btn">
        + 즉시 클래스
      </button>
    </div>
  );

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
    <AppShell title="클래스 목록" sub="SESSIONS" rightSlot={rightSlot} noScroll>
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col bg-[var(--mb-white)]">
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

        {/* 데스크톱: 좌측 캘린더 / 우측 표·타임라인 */}
        <div className="hidden min-h-0 flex-1 gap-6 md:grid md:grid-cols-2">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
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
            <div className="overflow-hidden rounded-[var(--mb-radius-md)] border border-[var(--mb-divider)] bg-[var(--mb-white)]">
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

          <div className="flex min-h-0 flex-col overflow-y-auto">
            {viewMode === 'list' ? (
              <div className="overflow-hidden rounded-[var(--mb-radius-md)] border border-[var(--mb-divider)] bg-[var(--mb-white)]">
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
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--mb-bg-10)] text-[var(--mb-fg)] hover:bg-[#E6E7EE]"
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
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--mb-bg-10)] text-[var(--mb-fg)] hover:bg-[#E6E7EE]"
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

        <CreateSessionModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={refreshSessions}
        />
      </div>
    </AppShell>
  );
}
