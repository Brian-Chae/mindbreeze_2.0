// 내담자 세션 캘린더 + 목록 페이지
// 월간 캘린더 뷰 + 선택일 세션 리스트 + 세션 신청 + 일간/주간/월간 뷰 모드

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { listSessions, type SessionDto } from '../../lib/api/session';
import { listChatRooms, sendChatMessage, type ChatRoom } from '../../lib/api/chat';
import { useAuthStore } from '../../stores/authStore';
import { MonthCalendar } from '../../components/session/MonthCalendar';
import { SessionCard } from '../../components/session/SessionCard';
import { CalendarView } from '../../components/session/CalendarView';

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const COUNSELOR_COLORS = ['#5F0080', '#3B82F6', '#10B981', '#F59E0B', '#EF4444'];

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const startOfWeek = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
};

function formatMonth(date: Date): string {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

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

const TABS: { mode: 'daily' | 'weekly' | 'monthly'; label: string }[] = [
  { mode: 'daily', label: '일간' },
  { mode: 'weekly', label: '주간' },
  { mode: 'monthly', label: '월간' },
];

export default function ClientSessionListPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const counselors = user?.counselors ?? [];

  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'monthly'>('monthly');

  // 세션 신청 관련 상태
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 세션 데이터 로딩
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listSessions()
      .then((res) => {
        if (cancelled) return;
        setSessions(res.sessions);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // 상담사 ID → 색상 매핑
  const counselorColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    counselors.forEach((c, i) => {
      map[c.id] = COUNSELOR_COLORS[i % COUNSELOR_COLORS.length];
    });
    return map;
  }, [counselors]);

  // 상담사 ID → 이름 매핑
  const counselorNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    counselors.forEach((c) => {
      map[c.id] = c.name;
    });
    return map;
  }, [counselors]);

  // 특정 날짜의 세션 목록
  const sessionsOnDay = (day: Date): SessionDto[] =>
    sessions
      .filter((s) => sameDay(new Date(s.scheduled_at), day))
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

  // 세션 신청 모달 열기 + 채팅방 목록 로딩
  const handleOpenRequest = async (): Promise<void> => {
    setShowRequestModal(true);
    try {
      const res = await listChatRooms();
      const directRooms = res.rooms.filter((r) => r.room_type === 'direct');
      setRooms(directRooms);
    } catch {
      setRooms([]);
    }
  };

  // 세션 신청 전송
  const handleSendRequest = async (roomId: string): Promise<void> => {
    setRequesting(true);
    try {
      await sendChatMessage(roomId, {
        content: '세션 신청합니다',
        type: 'system',
        event_type: 'session_request',
      });
      setToast('세션 신청이 완료되었습니다');
      setShowRequestModal(false);
      setTimeout(() => setToast(null), 3000);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '세션 신청에 실패했습니다';
      setToast(message);
      setTimeout(() => setToast(null), 3000);
    } finally {
      setRequesting(false);
    }
  };

  // 선택일 표시 포맷
  const selectedDateLabel = (() => {
    const d = selectedDate;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${WEEKDAY[d.getDay()]})`;
  })();

  // 네비게이션 라벨
  const navLabel =
    viewMode === 'daily' ? formatDay(currentDate)
    : viewMode === 'weekly' ? formatWeekRange(currentDate)
    : formatMonth(currentDate);

  const onShift = (dir: 1 | -1): void => {
    if (viewMode === 'daily') shiftDay(dir);
    else if (viewMode === 'weekly') shiftWeek(dir);
    else shiftMonth(dir);
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
    <div className="px-4 md:px-8 py-4 md:py-6">
      {/* 토스트 */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#1F1F1F] text-white text-sm px-5 py-2.5 rounded-full shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* 세션 신청하기 버튼 */}
      <div className="py-3">
        <button
          type="button"
          onClick={() => void handleOpenRequest()}
          className="w-full rounded-xl bg-[#5F0080] text-white text-sm font-semibold py-3 active:scale-[0.98] transition-transform"
        >
          세션 신청하기
        </button>
      </div>

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

      {/* ===== 데스크톱: 일간/주간/월간 탭 + 캘린더 뷰 ===== */}
      <div className="hidden md:block">
        {/* 탭 바 + 네비게이션 */}
        <div className="flex items-center justify-between mb-4">
          <div className="inline-flex rounded-full bg-[#F2F3F8] p-1">
            {TABS.map((t) => (
              <button
                key={t.mode}
                type="button"
                onClick={() => setViewMode(t.mode)}
                className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
                  viewMode === t.mode
                    ? 'bg-[#5F0080] text-white font-bold'
                    : 'text-[#1F1F1F] font-medium'
                }`}
              >
                {t.label}
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
            <span className="text-sm font-mono text-[#1F1F1F] min-w-[180px] text-center">
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

        {/* 로딩 / 에러 */}
        {loading && <p className="text-[#6F6F6F]">불러오는 중...</p>}
        {error && <p className="text-[#B3261E]">{error}</p>}

        {/* 일간 뷰 */}
        {!loading && !error && viewMode === 'daily' && (
          <CalendarView sessions={sessions} currentDate={currentDate} mode="daily" />
        )}

        {/* 주간 뷰 */}
        {!loading && !error && viewMode === 'weekly' && (
          <CalendarView sessions={sessions} currentDate={currentDate} mode="weekly" />
        )}

        {/* 월간 뷰: MonthCalendar + 선택일 세션 리스트 */}
        {!loading && !error && viewMode === 'monthly' && (
          <div className="space-y-4">
            <MonthCalendar
              sessions={sessions}
              currentDate={currentDate}
              selectedDate={selectedDate}
              onSelectDate={handleCalendarSelect}
              onShiftMonth={shiftMonth}
            />
            <div>
              <h2 className="text-sm font-semibold text-[#1F1F1F] mb-2">
                {selectedDateLabel}
              </h2>
              {renderSessionList()}
            </div>
          </div>
        )}
      </div>

      {/* 세션 신청 모달 */}
      {showRequestModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowRequestModal(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 border border-[#EFEFEF]">
            <h2 className="text-lg font-bold text-[#1F1F1F] mb-2">세션 신청하기</h2>
            <p className="text-sm text-[#6F6F6F] mb-4">
              상담사에게 세션 신청 메시지를 보냅니다.
            </p>

            {rooms.length === 0 ? (
              <p className="text-sm text-[#6F6F6F] py-4 text-center">
                연결된 상담사 채팅방이 없습니다.
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {rooms.map((room) => {
                  const counselor = counselors.find(
                    (c) => c.name === (room.peer_name || room.name),
                  );
                  const counselorId = counselor?.id;
                  const color = counselorId
                    ? counselorColorMap[counselorId]
                    : COUNSELOR_COLORS[0];

                  return (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => void handleSendRequest(room.id)}
                      disabled={requesting}
                      className="w-full text-left flex items-center gap-3 p-3 rounded-xl hover:bg-[#F5EDFC] transition-colors disabled:opacity-50"
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-sm font-medium text-[#1F1F1F]">
                        {room.peer_name || room.name || '채팅방'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowRequestModal(false)}
              className="w-full mt-4 rounded-xl bg-[#F2F3F8] text-[#1F1F1F] text-sm font-medium py-2.5 active:scale-[0.98] transition-transform"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
