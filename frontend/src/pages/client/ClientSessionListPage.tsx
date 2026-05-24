// 내담자 세션 캘린더 + 목록 페이지
// 월간 캘린더 뷰 + 선택일 세션 리스트 + 세션 신청

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { listSessions, type SessionDto } from '../../lib/api/session';
import { listChatRooms, sendChatMessage, type ChatRoom } from '../../lib/api/chat';
import { useAuthStore } from '../../stores/authStore';

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const COUNSELOR_COLORS = ['#5F0080', '#3B82F6', '#10B981', '#F59E0B', '#EF4444'];

/** 같은 날짜인지 비교 */
const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** 세션 상태 한글 라벨 */
function statusLabel(status: string): string {
  switch (status) {
    case 'scheduled': return '예정';
    case 'in_progress': return '진행중';
    case 'completed': return '종료';
    case 'cancelled': return '취소';
    default: return status;
  }
}

/** 상태별 뱃지 클래스 */
function statusBadgeClass(status: string): string {
  switch (status) {
    case 'scheduled': return 'bg-[#F5EDFC] text-[#5F0080]';
    case 'in_progress': return 'bg-[#E6F8F3] text-[#1F8A5B]';
    case 'completed': return 'bg-[#F2F3F8] text-[#6F6F6F]';
    case 'cancelled': return 'bg-[#FDECEC] text-[#B3261E]';
    default: return 'bg-[#F2F3F8] text-[#6F6F6F]';
  }
}

/** 날짜/시간 포맷 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatMonth(date: Date): string {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

export default function ClientSessionListPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const counselors = user?.counselors ?? [];

  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

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

  // 현재 월의 캘린더 셀 생성
  const calendarCells = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startDay = firstOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: (Date | null)[] = [];
    // 이전 달 padding
    for (let i = 0; i < startDay; i++) {
      cells.push(null);
    }
    // 현재 달 날짜
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(year, month, d));
    }
    // 7열 맞추기
    while (cells.length % 7 !== 0) {
      cells.push(null);
    }
    return cells;
  }, [currentMonth]);

  // 특정 날짜의 세션 목록
  const sessionsOnDay = (day: Date): SessionDto[] =>
    sessions
      .filter((s) => sameDay(new Date(s.scheduled_at), day))
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  // 선택된 날짜의 세션
  const todaySessions = sessionsOnDay(selectedDate);

  // 과거 세션 여부
  const isPast = (s: SessionDto): boolean => {
    const now = new Date();
    const sessionEnd = new Date(s.scheduled_at);
    sessionEnd.setMinutes(sessionEnd.getMinutes() + s.duration_min);
    return sessionEnd < now;
  };

  // 월 이동
  const shiftMonth = (dir: 1 | -1): void => {
    setCurrentMonth((prev) => {
      const next = new Date(prev);
      next.setMonth(next.getMonth() + dir);
      return next;
    });
  };

  // 세션 신청 모달 열기 + 채팅방 목록 로딩
  const handleOpenRequest = async (): Promise<void> => {
    setShowRequestModal(true);
    try {
      const res = await listChatRooms();
      // direct 타입의 상담사 채팅방만 필터링
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

  const today = new Date();

  return (
    <div className="pb-4">
      {/* 토스트 */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#1F1F1F] text-white text-sm px-5 py-2.5 rounded-full shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* 세션 신청하기 버튼 */}
      <div className="px-4 py-3">
        <button
          type="button"
          onClick={() => void handleOpenRequest()}
          className="w-full rounded-xl bg-[#5F0080] text-white text-sm font-semibold py-3 active:scale-[0.98] transition-transform"
        >
          세션 신청하기
        </button>
      </div>

      {/* 월간 캘린더 */}
      <div className="px-4">
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {/* 월 네비게이션 */}
          <div className="flex items-center justify-between px-4 py-3">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="w-8 h-8 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#1F1F1F] flex items-center justify-center"
              aria-label="이전 달"
            >
              ‹
            </button>
            <span className="text-sm font-bold text-[#1F1F1F]">
              {formatMonth(currentMonth)}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="w-8 h-8 rounded-full bg-[#F2F3F8] hover:bg-[#E6E7EE] text-[#1F1F1F] flex items-center justify-center"
              aria-label="다음 달"
            >
              ›
            </button>
          </div>

          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 border-t border-[#EFEFEF]">
            {WEEKDAY.map((label, i) => (
              <div
                key={label}
                className={`text-center py-2 text-[11px] font-bold ${
                  i === 0 ? 'text-[#B3261E]' : i === 6 ? 'text-[#1F4FB3]' : 'text-[#1F1F1F]'
                }`}
              >
                {label}
              </div>
            ))}
          </div>

          {/* 날짜 셀 */}
          <div className="grid grid-cols-7">
            {calendarCells.map((d, idx) => {
              if (!d) {
                return <div key={`empty-${idx}`} className="aspect-square" />;
              }

              const isToday = sameDay(d, today);
              const isSelected = sameDay(d, selectedDate);
              const items = sessionsOnDay(d);
              const hasSessions = items.length > 0;

              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => setSelectedDate(d)}
                  className={`aspect-square flex flex-col items-center justify-center gap-1 transition-colors hover:bg-[#FAFAFA] ${
                    isSelected
                      ? 'bg-[#F5EDFC]'
                      : isToday
                        ? 'bg-[#FAFAFA]'
                        : ''
                  }`}
                >
                  {/* 날짜 숫자 */}
                  <span
                    className={`text-xs w-7 h-7 flex items-center justify-center rounded-full ${
                      isToday
                        ? 'bg-[#5F0080] text-white font-bold ring-2 ring-[#5F0080] ring-offset-1'
                        : isSelected
                          ? 'text-[#5F0080] font-bold'
                          : d.getDay() === 0
                            ? 'text-[#B3261E]'
                            : d.getDay() === 6
                              ? 'text-[#1F4FB3]'
                              : 'text-[#1F1F1F]'
                    }`}
                  >
                    {d.getDate()}
                  </span>

                  {/* 세션 도트 표시 */}
                  {hasSessions && (
                    <div className="flex gap-0.5">
                      {items.slice(0, 3).map((s) => {
                        const color = counselorColorMap[s.host_id] || '#6F6F6F';
                        return (
                          <span
                            key={s.id}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                        );
                      })}
                      {items.length > 3 && (
                        <span className="text-[8px] text-[#6F6F6F] leading-none">
                          +{items.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 선택일 세션 리스트 */}
      <div className="px-4 mt-4">
        <h2 className="text-sm font-semibold text-[#1F1F1F] mb-2">
          {selectedDateLabel}
        </h2>

        {loading ? (
          <div className="py-8 text-center text-sm text-[#6F6F6F]">
            불러오는 중...
          </div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-red-500">{error}</div>
        ) : todaySessions.length === 0 ? (
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
        ) : (
          <div className="space-y-2">
            {todaySessions.map((s) => {
              const past = isPast(s);
              const color = counselorColorMap[s.host_id] || '#6F6F6F';
              const counselorName = counselorNameMap[s.host_id] || '상담사';

              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => navigate(`/app/sessions/${s.id}`)}
                  className={`w-full text-left bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 active:scale-[0.99] transition-transform ${
                    past ? 'opacity-50' : ''
                  }`}
                >
                  {/* 상담사 색상 dot */}
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />

                  {/* 세션 정보 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[#1F1F1F] truncate">
                        {s.title || '제목 없음'}
                      </span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${statusBadgeClass(s.status)}`}>
                        {statusLabel(s.status)}
                      </span>
                    </div>
                    <p className="text-xs text-[#6F6F6F] mt-0.5">
                      {counselorName} · {formatTime(s.scheduled_at)} · {s.duration_min}분
                    </p>
                  </div>

                  {/* 화살표 */}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="shrink-0 text-[#C0C0C0]"
                  >
                    <path
                      d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              );
            })}
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
                  const counselor = counselors.find((c) => c.name === room.name);
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
                        {room.name || '채팅방'}
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
