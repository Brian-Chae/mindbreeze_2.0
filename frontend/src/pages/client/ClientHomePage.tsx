// 내담자 홈 화면 — 상담사 대시보드와 동일한 디자인 패턴
// 캘린더 + 오늘 세션 + 최근 활동 피드 + 최근 리포트

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { listSessions, type SessionDto } from '../../lib/api/session';
import {
  describeReminderOffsets,
  formatCountdown,
  pickUpcomingClass,
} from '../../lib/class/reminder';
import { listReports, type ReportDto } from '../../lib/api/reports';
import { resolveReportGenerationStatus } from '../../lib/api/report-status';
import { markRead } from '../../lib/api/notifications';
import { useNotificationStore } from '../../stores/notificationStore';
import { MonthCalendar } from '../../components/session/MonthCalendar';
import { SessionCard } from '../../components/session/SessionCard';
import { InvitedSessionCard } from '../../components/client/InvitedSessionCard';

type Counselor = { id: string; name: string; profile_image: string | null };

// ── 헬퍼 ──────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '방금 전';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}일 전`;
  return formatDate(iso);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface Activity {
  message: string;
  time: string;
  timestamp: number;
}

// ── 공통 카드/타이틀 스타일 (대시보드 디자인) ─────────────────

const CARD_CLS = 'bg-white border border-[#DDDEE7] rounded-2xl p-[22px]';
const CARD_TITLE_CLS = 'font-bold text-[17px] text-[#1F1F1F] tracking-tight';
const CARD_SUBTITLE_CLS = 'font-mono text-[11px] text-[#6F6F6F]';

// ── 컴포넌트 ──────────────────────────────────────────────────────

export default function ClientHomePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const counselors: Counselor[] = user?.counselors ?? [];
  const sessionInvites = useNotificationStore((s) => s.sessionInvites);
  const removeSessionInvite = useNotificationStore((s) => s.removeSessionInvite);

  // 데이터 / 필터 상태
  const [selectedCounselorId, setSelectedCounselorId] = useState<string>('all');
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [reports, setReports] = useState<ReportDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 캘린더 상태
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // 데이터 로딩
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [sessRes, repRes] = await Promise.all([listSessions(), listReports()]);
        if (cancelled) return;
        setSessions(sessRes.sessions);
        setReports(repRes.reports);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '데이터를 불러오지 못했습니다');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // 상담사별 필터링
  const filteredSessions = useMemo(() => {
    if (selectedCounselorId === 'all') return sessions;
    return sessions.filter((s) =>
      s.participants?.some((p) => p.user_id === selectedCounselorId),
    );
  }, [sessions, selectedCounselorId]);

  // 선택된 날짜의 세션
  const todaySessions = useMemo(() => {
    return filteredSessions
      .filter((s): s is SessionDto & { scheduled_at: string } => (
        Boolean(s.scheduled_at) && sameDay(new Date(s.scheduled_at as string), selectedDate)
      ))
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  }, [filteredSessions, selectedDate]);

  const instantSessions = useMemo(
    () => filteredSessions.filter((session) => (
      !session.scheduled_at && (session.status === 'ready' || session.status === 'open' || session.status === 'in_progress')
    )),
    [filteredSessions],
  );
  const readyInstantCount = instantSessions.filter((session) => session.status === 'ready').length;
  const inProgressInstantCount = instantSessions.filter((session) => session.status === 'in_progress').length;

  // SDD-097: 다가오는 클래스 — 아직 시작하지 않은 가장 임박한 예약 1건(사전 안내 카드용).
  const upcomingClass = useMemo(() => pickUpcomingClass(filteredSessions), [filteredSessions]);

  // SDD-095: 생성 진행 중인 리포트 — 홈 배지('리포트 생성 중')에 쓴다.
  const processingReportCount = useMemo(
    () =>
      reports.filter(
        (r) => resolveReportGenerationStatus(r.generation_status) === 'processing',
      ).length,
    [reports],
  );

  // 최근 리포트 (최대 4개)
  const recentReports = useMemo(() => {
    return [...reports]
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
      .slice(0, 4);
  }, [reports]);

  // 최근 활동 피드: 리포트 + 예정 세션 시간순 조합
  const activities = useMemo(() => {
    const items: Activity[] = [];

    for (const r of reports.slice(0, 5)) {
      const ts = new Date(r.created_at ?? 0).getTime();
      if (ts > 0) {
        items.push({
          message: `'${r.session_title || '리포트'}' 리포트가 발급되었습니다`,
          time: relativeTime(r.created_at),
          timestamp: ts,
        });
      }
    }

    const upcoming = filteredSessions
      .filter((s) => s.status === 'ready' || s.status === 'scheduled' || s.status === 'in_progress')
      .sort((a, b) => new Date(a.scheduled_at ?? a.created_at).getTime() - new Date(b.scheduled_at ?? b.created_at).getTime())
      .slice(0, 5);
    for (const s of upcoming) {
      const ts = new Date(s.created_at).getTime();
      const sessionTitle = s.title || '세션';
      const message = s.status === 'ready'
        ? `'${sessionTitle}' 클래스가 시작 대기 중입니다. 지금 참여할 수 있습니다`
        : s.status === 'in_progress'
          ? `'${sessionTitle}' 클래스가 진행 중입니다`
          : `'${sessionTitle}' 세션이 예정되었습니다 (${formatDate(s.scheduled_at)})`;
      items.push({
        message,
        time: relativeTime(s.created_at),
        timestamp: ts,
      });
    }

    items.sort((a, b) => b.timestamp - a.timestamp);
    return items.slice(0, 6);
  }, [reports, filteredSessions]);

  // 세션 호스트(상담사) 이름 찾기
  const getCounselorName = useCallback(
    (session: SessionDto): string | undefined => {
      if (!session.host_id) return undefined;
      return counselors.find((c) => c.id === session.host_id)?.name;
    },
    [counselors],
  );

  // ── 초대된 클래스 ──────────────────────────────────────────────
  const invitedSessionIds = useMemo(
    () => new Set(sessionInvites.map((i) => i.sessionId)),
    [sessionInvites],
  );
  const invitedSessions = useMemo(
    () =>
      sessions.filter(
        (s) =>
          invitedSessionIds.has(s.id) &&
          s.status !== 'completed' &&
          s.status !== 'cancelled',
      ),
    [sessions, invitedSessionIds],
  );

  // 초대 도착 시 목록에 아직 없는 세션을 반영 (listSessions 재조회)
  useEffect(() => {
    if (sessionInvites.length === 0) return;
    const missing = sessionInvites.some((inv) => !sessions.some((s) => s.id === inv.sessionId));
    if (!missing) return;
    let cancelled = false;
    listSessions()
      .then((res) => {
        if (!cancelled) setSessions(res.sessions);
      })
      .catch(() => { /* 조용히 실패 — 다음 초대/재조회에서 복구 */ });
    return () => { cancelled = true; };
  }, [sessionInvites, sessions]);

  const handleConfirmInvite = useCallback(
    (sessionId: string) => {
      const invite = sessionInvites.find((i) => i.sessionId === sessionId);
      if (invite?.notificationId) {
        void markRead(invite.notificationId).catch(() => { /* 조용히 실패 */ });
      }
      removeSessionInvite(sessionId);
      navigate(`/app/sessions/${sessionId}`);
    },
    [sessionInvites, removeSessionInvite, navigate],
  );

  // 캘린더 월 이동
  const handleShiftMonth = useCallback((direction: 1 | -1) => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + direction);
      return d;
    });
  }, []);

  const handleToday = useCallback(() => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  }, []);

  const isSelectedToday = sameDay(selectedDate, new Date());

  // ── 렌더 ──────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto">
      {/* 상담사 필터 (좌우 스크롤 pill) */}
      <div className="overflow-x-auto no-scrollbar mb-6">
        <div className="flex gap-2 min-w-max">
          <button
            type="button"
            className={`rounded-full px-4 py-2.5 min-h-[44px] text-sm font-medium transition-colors whitespace-nowrap ${
              selectedCounselorId === 'all'
                ? 'bg-[#5F0080] text-white'
                : 'bg-[#EFEFEF] text-[#1F1F1F]'
            }`}
            onClick={() => setSelectedCounselorId('all')}
          >
            전체
          </button>
          {counselors.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`rounded-full px-4 py-2.5 min-h-[44px] text-sm font-medium transition-colors whitespace-nowrap ${
                selectedCounselorId === c.id
                  ? 'bg-[#5F0080] text-white'
                  : 'bg-[#EFEFEF] text-[#1F1F1F]'
              }`}
              onClick={() => setSelectedCounselorId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-[#6F6F6F] text-sm">불러오는 중...</div>
      ) : error ? (
        <section
          className="bg-white border border-[#DDDEE7] rounded-2xl p-[22px] text-center"
          role="alert"
        >
          <p className="text-sm text-red-600 mb-4">{error}</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold bg-[#5F0080] text-white hover:bg-[#4B0066] transition-colors"
          >
            다시 시도
          </button>
        </section>
      ) : (
        <>
          {/* 초대된 클래스 — 신규 세션 초대를 강조해 확인 유도 */}
          {invitedSessions.length > 0 && (
            <section className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-[17px] text-[#1F1F1F] tracking-tight">초대된 클래스</h2>
                <span className="font-mono text-[11px] text-[#6F6F6F]">{invitedSessions.length}건</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {invitedSessions.map((s) => (
                  <InvitedSessionCard
                    key={s.id}
                    session={s}
                    counselorName={getCounselorName(s)}
                    onConfirm={() => handleConfirmInvite(s.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* SDD-097: 다가오는 클래스 — 참여코드·준비물·시작시간을 홈에서 놓치지 않게 */}
          {upcomingClass && (
            <section
              className="bg-[#F5EDFC] border border-[#DDD0EA] rounded-2xl p-[22px] mb-6"
              data-testid="upcoming-class-card"
            >
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 mb-3">
                <div className={CARD_TITLE_CLS}>다가오는 클래스</div>
                <div className={CARD_SUBTITLE_CLS}>
                  {formatCountdown(upcomingClass.scheduled_at)}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-[#1F1F1F] truncate">
                    {upcomingClass.title || '클래스'}
                  </p>
                  <p className="text-[13px] text-[#4A3B5F] mt-1">
                    {formatDate(upcomingClass.scheduled_at)}{' '}
                    {upcomingClass.scheduled_at
                      ? new Date(upcomingClass.scheduled_at).toLocaleTimeString('ko-KR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : ''}
                    {getCounselorName(upcomingClass) ? ` · ${getCounselorName(upcomingClass)}` : ''}
                  </p>
                  <ul className="mt-2 text-[12px] text-[#6F6F6F] space-y-0.5">
                    <li>· 조용한 공간과 헤드셋(마이크 포함)을 준비해 주세요</li>
                    <li>· Chrome/Edge 권장 (Safari·Firefox는 LINK BAND 미지원)</li>
                  </ul>
                  {upcomingClass.reminder_offsets && upcomingClass.reminder_offsets.length > 0 && (
                    <p
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#5F0080]"
                      data-testid="upcoming-reminder-info"
                    >
                      사전 안내 {describeReminderOffsets(upcomingClass.reminder_offsets)} 자동 발송
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-stretch sm:items-end gap-2 shrink-0">
                  {upcomingClass.access_code && (
                    <div className="rounded-xl bg-white border border-[#DDD0EA] px-3 py-2 text-center">
                      <div className="text-[10px] text-[#6F6F6F] mb-0.5">참여코드</div>
                      <div className="font-mono text-lg font-black tracking-[0.14em] text-[#5F0080]">
                        {upcomingClass.access_code}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => navigate(`/app/sessions/${upcomingClass.id}`)}
                    className="mb-btn text-sm"
                  >
                    클래스 확인
                  </button>
                </div>
              </div>
            </section>
          )}

          {instantSessions.length > 0 && (
            <section className={`${CARD_CLS} mb-6`}>
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 mb-3.5">
                <div className={CARD_TITLE_CLS}>즉시 클래스</div>
                <div className={CARD_SUBTITLE_CLS}>
                  시작 대기 {readyInstantCount}건 · 진행 중 {inProgressInstantCount}건
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {instantSessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    onClick={() => navigate(`/app/sessions/${session.id}`)}
                    counselorName={getCounselorName(session)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 캘린더 + 오늘 세션 (2열) */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6 mb-6">
            {/* 좌측: 캘린더 */}
            <MonthCalendar
              sessions={filteredSessions}
              currentDate={currentDate}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onShiftMonth={handleShiftMonth}
              onToday={handleToday}
            />

            {/* 우측: 오늘 세션 — 대시보드 TodaySessions 스타일 */}
            <div className={`${CARD_CLS} flex flex-col gap-3`}>
              <div className="flex justify-between items-baseline">
                <div className={CARD_TITLE_CLS}>
                  {isSelectedToday
                    ? `오늘의 세션 · ${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일`
                    : `${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일 세션`}
                </div>
                <div className={CARD_SUBTITLE_CLS}>
                  세션 {todaySessions.length}건
                </div>
              </div>
              {todaySessions.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {todaySessions.map((s) => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      counselorName={getCounselorName(s)}
                    />
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center">
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#9B9B9B"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mx-auto mb-3"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <p className="text-sm text-[#6F6F6F]">
                    {isSelectedToday
                      ? '오늘 예정된 세션이 없습니다'
                      : '예정된 세션이 없습니다'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* 최근 활동 피드 — 대시보드 RecentClients 스타일 */}
          {activities.length > 0 && (
            <div className="mb-6">
              <div className={CARD_CLS}>
                <div className="flex justify-between items-baseline mb-3.5">
                  <div className={CARD_TITLE_CLS}>최근 활동</div>
                </div>
                <div className="flex flex-col gap-3">
                  {activities.map((a, i) => (
                    <div key={i} className="flex gap-2.5">
                      <span className="w-2 h-2 rounded-full bg-[#5F0080] mt-1.5 shrink-0 ring-4 ring-[#5F0080]/15" />
                      <div className="flex-1">
                        <div className="text-[13px] text-[#1F1F1F] leading-tight">
                          {a.message}
                        </div>
                        <div className={CARD_SUBTITLE_CLS}>
                          {a.time}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 최근 리포트 — 대시보드 스타일 */}
          <div className="mb-6">
            <div className={CARD_CLS}>
              <div className="flex justify-between items-baseline mb-3.5">
                <div className={CARD_TITLE_CLS}>최근 리포트</div>
                {/* SDD-095: 리포트 생성 진행 배지 — 처리 중임을 조용히 알린다 */}
                {processingReportCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#F5EDFC] px-2.5 py-1 text-[11px] font-bold text-[#5F0080]"
                    data-testid="report-processing-badge"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-[#5F0080] animate-pulse" aria-hidden />
                    리포트 생성 중 {processingReportCount}건
                  </span>
                )}
              </div>
              {recentReports.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {recentReports.map((r) => {
                    const generation = resolveReportGenerationStatus(r.generation_status);
                    return (
                      <div
                        key={r.id}
                        className="bg-[#F8F4FC] rounded-xl p-4 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-[#1F1F1F] truncate">
                            {r.session_title || '리포트'}
                          </p>
                          <p className={CARD_SUBTITLE_CLS}>
                            {formatDate(r.created_at)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {generation === 'processing' && (
                            <span
                              className="text-[10px] font-bold text-[#8A6B1F] bg-[#FFF4DC] px-2 py-0.5 rounded-full"
                              data-testid="report-generation-badge"
                            >
                              생성 중
                            </span>
                          )}
                          {generation === 'partial' && (
                            <span className="text-[10px] font-bold text-[#6F6F6F] bg-[#F2F3F8] px-2 py-0.5 rounded-full">
                              일부 생성
                            </span>
                          )}
                          <span className="text-[10px] font-bold text-[#5F0080] bg-[#F5EDFC] px-2 py-0.5 rounded-full">
                            {r.type === 'counselor' ? '상담사용' : '내담자용'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-10 text-center">
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#9B9B9B"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mx-auto mb-3"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  <p className="text-sm text-[#6F6F6F]">아직 리포트가 없어요</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
