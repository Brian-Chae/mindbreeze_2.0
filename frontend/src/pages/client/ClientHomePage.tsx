// 내담자 홈 — 행동 중심 재설계 (SDD-187) + 클래스 사전 흐름(SDD-209 FM01)
// 데스크톱 2컬럼: 좌측(다음 클래스 히어로 → 초대 → 이번 주 클래스 → 코드로 입장하기 → 내 리포트) / 우측(요약 타일 → 담당 상담사 → 대화 → 알림)

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { listSessions, type SessionDto } from '../../lib/api/session';
import { pickHeroClass } from '../../lib/class/pick-hero-class';
import { deriveHeroAction } from '../../lib/class/enter-action';
import { useEnterClass } from '../../hooks/useEnterClass';
import { memberChipKey } from '../../lib/class/class-labels';
import { ClassHero, ClassHeroEmpty } from '../../components/class/flow/shell/ClassHero';
import { ClassRow } from '../../components/class/flow/shell/ClassRow';
import { EnterByCodeLink } from '../../components/class/flow/shell/MemberHomeView';
import { heroBackdrop, toClassRowData, toHeroData } from '../../components/class/flow/shell/shell-data';
import '../../components/class/flow/shell/shell-kit.css';
import { listReports, type ReportDto } from '../../lib/api/reports';
import { resolveReportGenerationStatus } from '../../lib/api/report-status';
import { isReportInReview, REPORT_IN_REVIEW_BADGE } from '../../lib/report-review-copy';
import { markRead, listNotifications, type NotificationDto } from '../../lib/api/notifications';
import { listChatRooms, type ChatRoom } from '../../lib/api/chat';
import { useNotificationStore } from '../../stores/notificationStore';
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

function sameWeek(a: Date, b: Date): boolean {
  const startOfWeek = (d: Date) => {
    const copy = new Date(d);
    const day = copy.getDay(); // 0=일
    const diff = copy.getDate() - day + (day === 0 ? -6 : 1); // 월요일 시작
    copy.setDate(diff);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };
  return startOfWeek(a).getTime() === startOfWeek(b).getTime();
}

// ── 공통 스타일 ──────────────────────────────────────────────────

const SECTION_TITLE_CLS = 'font-extrabold text-[18px] text-[#1F1F1F] tracking-[-0.01em]';
const SECTION_HEAD_CLS = 'flex items-center justify-between mb-4';
const LINK_CLS = 'text-[13px] font-bold text-[#5F0080] hover:underline shrink-0';
const CARD_CLS = 'rounded-2xl border border-[#E8E3EC] bg-white shadow-sm';

// ── 요약 타일 ────────────────────────────────────────────────────

function SummaryTiles({
  dDay,
  newReportCount,
  weekClassCount,
  completedCount,
  onOpenNext,
  onOpenReports,
  onOpenClasses,
}: {
  dDay: string;
  newReportCount: number;
  weekClassCount: number;
  completedCount: number;
  onOpenNext: () => void;
  onOpenReports: () => void;
  onOpenClasses: () => void;
}) {
  const tiles = [
    { label: '다음 클래스까지', value: dDay, action: '클래스 보기', onClick: onOpenNext, purple: true },
    { label: '새 리포트', value: String(newReportCount), action: '바로 확인', onClick: onOpenReports, purple: true },
    { label: '이번 주 클래스', value: String(weekClassCount), action: '목록 보기', onClick: onOpenClasses },
    { label: '완료 클래스', value: String(completedCount), action: '리포트 보기', onClick: onOpenReports },
  ];

  return (
    <div className="mh-summary grid grid-cols-2 gap-3">
      {tiles.map((t) => (
        <button
          key={t.label}
          type="button"
          onClick={t.onClick}
          className="rounded-2xl border border-[#E8E3EC] bg-white p-4 text-left shadow-sm transition-all hover:border-[#DDD0EA] hover:shadow-md hover:-translate-y-0.5"
        >
          <div className="text-[12px] font-semibold text-[#6F6F6F]">{t.label}</div>
          <div className={`mt-2 text-[30px] font-extrabold tracking-tight ${t.purple ? 'text-[#5F0080]' : 'text-[#1F1F1F]'}`}>
            {t.value}
          </div>
          <div className="mt-1 flex items-center gap-1 text-[12px] font-bold text-[#5F0080]">
            {t.action} <ChevronRight size={14} aria-hidden="true" />
          </div>
        </button>
      ))}
    </div>
  );
}

// ── 메인 ──────────────────────────────────────────────────────────

export default function ClientHomePage({ hideHero = false }: { hideHero?: boolean } = {}) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const counselors: Counselor[] = useMemo(() => user?.counselors ?? [], [user?.counselors]);
  const sessionInvites = useNotificationStore((s) => s.sessionInvites);
  const removeSessionInvite = useNotificationStore((s) => s.removeSessionInvite);

  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [reports, setReports] = useState<ReportDto[]>([]);
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 데이터 로딩
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [sessRes, repRes, chatRes, notifRes] = await Promise.all([
          listSessions(),
          listReports(),
          listChatRooms().catch(() => ({ rooms: [] as ChatRoom[] })),
          listNotifications(true, 5).catch(() => ({ notifications: [] as NotificationDto[], total: 0, unread: 0 })),
        ]);
        if (cancelled) return;
        setSessions(sessRes.sessions);
        setReports(repRes.reports);
        setChatRooms(chatRes.rooms);
        setNotifications(notifRes.notifications);
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

  // ── 파생 데이터 ────────────────────────────────────────────────

  // 다음 클래스: 진행 중 > 입장 가능 > 가장 임박한 예약 > 일정 없는 준비 (ready 는 열린 것이 아니다)
  const heroSession = useMemo(() => pickHeroClass(sessions), [sessions]);
  const heroData = useMemo(() => (heroSession ? toHeroData(heroSession) : null), [heroSession]);
  const heroAction = useMemo(
    () => deriveHeroAction(heroSession ? memberChipKey(heroSession.status, heroSession.scheduled_at) : 'scheduled'),
    [heroSession],
  );

  // 내담자용 리포트만
  const clientReports = useMemo(
    () =>
      reports
        .filter((r) => r.type === 'client')
        .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
        .slice(0, 3),
    [reports],
  );

  // 이번 주 클래스 (예약, 시간순)
  const weekSessions = useMemo(() => {
    const now = new Date();
    return sessions
      .filter((s) => s.scheduled_at && sameWeek(new Date(s.scheduled_at), now) && s.status !== 'cancelled')
      .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
      .slice(0, 5);
  }, [sessions]);

  // 요약 타일 데이터
  const dDay = useMemo(() => {
    if (!heroSession) return '-';
    if (!heroSession.scheduled_at) return '지금';
    const diff = new Date(heroSession.scheduled_at).getTime() - Date.now();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days > 0 ? `D-${days}` : days === 0 ? '오늘' : '지금';
  }, [heroSession]);

  const newReportCount = useMemo(
    () => reports.filter((r) => r.type === 'client' && !r.is_read && !isReportInReview(r)).length,
    [reports],
  );

  const weekClassCount = useMemo(() => weekSessions.length, [weekSessions]);

  const completedCount = useMemo(
    () => sessions.filter((s) => s.status === 'completed').length,
    [sessions],
  );

  const primaryCounselor = counselors[0];

  // 최근 대화 (최신순)
  const recentChats = useMemo(() => {
    return [...chatRooms]
      .sort((a, b) => {
        const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return bt - at;
      })
      .slice(0, 3);
  }, [chatRooms]);

  // 최근 알림 (최신순)
  // 새 알림 = 아직 읽지 않은 알림만 노출 (읽은 알림은 제외해 안읽음 포인터 혼선 방지)
  const recentNotifications = useMemo(() => {
    return [...notifications]
      .filter((n) => !n.is_read)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 3);
  }, [notifications]);

  const getCounselorName = useCallback(
    (session: SessionDto): string | undefined => {
      if (!session.host_id) return undefined;
      return counselors.find((c) => c.id === session.host_id)?.name;
    },
    [counselors],
  );

  // ── 초대된 클래스 (기존 로직 보존) ─────────────────────────────
  const invitedSessionIds = useMemo(
    () => new Set(sessionInvites.map((i) => i.sessionId)),
    [sessionInvites],
  );
  const invitedSessions = useMemo(
    () =>
      sessions.filter(
        (s) =>
          invitedSessionIds.has(s.id) && s.status !== 'completed' && s.status !== 'cancelled',
      ),
    [sessions, invitedSessionIds],
  );

  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  const refetchedInviteIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (sessionInvites.length === 0) return;
    const pending = sessionInvites.filter(
      (inv) =>
        !sessionsRef.current.some((s) => s.id === inv.sessionId) &&
        !refetchedInviteIdsRef.current.has(inv.sessionId),
    );
    if (pending.length === 0) return;
    pending.forEach((inv) => refetchedInviteIdsRef.current.add(inv.sessionId));
    let cancelled = false;
    listSessions()
      .then((res) => {
        if (!cancelled) setSessions(res.sessions);
      })
      .catch(() => {
        pending.forEach((inv) => refetchedInviteIdsRef.current.delete(inv.sessionId));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionInvites]);

  const handleConfirmInvite = useCallback(
    (sessionId: string) => {
      const invite = sessionInvites.find((i) => i.sessionId === sessionId);
      if (invite?.notificationId) {
        void markRead(invite.notificationId).catch(() => {
          /* 조용히 실패 */
        });
      }
      removeSessionInvite(sessionId);
      navigate(`/app/sessions/${sessionId}`);
    },
    [sessionInvites, removeSessionInvite, navigate],
  );

  // 히어로 CTA: 입장 가능이면 초대된 회원 편의 입장(POST /sessions/{id}/enter), 아니면 상세.
  // 입장이 거절되면 상세로 보내 사유와 코드 입장 안내를 보여준다.
  const { enter, enteringId } = useEnterClass();
  const openHeroClass = useCallback(() => {
    if (!heroSession) return;
    if (heroAction.kind === 'enter') {
      void enter(heroSession.id).then((ok) => {
        if (!ok) navigate(`/app/sessions/${heroSession.id}`);
      });
      return;
    }
    navigate(`/app/sessions/${heroSession.id}`);
  }, [heroSession, heroAction, enter, navigate]);
  const openHeroDetail = useCallback(() => {
    if (heroSession) navigate(`/app/sessions/${heroSession.id}`);
  }, [heroSession, navigate]);

  const openChat = useCallback(
    (roomId: string) => navigate(`/app/chat/${roomId}`),
    [navigate],
  );

  // ── 렌더 ────────────────────────────────────────────────────────

  if (loading) {
    return <div className="mh-legacy-state py-12 text-center text-[#6F6F6F] text-sm">불러오는 중...</div>;
  }

  if (error) {
    return (
      <section className="mh-legacy-state bg-white border border-[#E8E3EC] rounded-2xl p-6 text-center" role="alert">
        <p className="text-sm text-red-600 mb-4">{error}</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold bg-[#5F0080] text-white hover:bg-[#4B0066] transition-colors"
        >
          다시 시도
        </button>
      </section>
    );
  }

  const summaryTiles = (
    <SummaryTiles
      dDay={dDay}
      newReportCount={newReportCount}
      weekClassCount={weekClassCount}
      completedCount={completedCount}
      onOpenNext={openHeroDetail}
      onOpenReports={() => navigate('/app/reports')}
      onOpenClasses={() => navigate('/app/classes')}
    />
  );

  return (
    <div className={`${hideHero ? 'mh-legacy' : ''} sh-scope mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]`}>
      {/* ── 좌측 컬럼 ── */}
      <div className="mh-main flex min-w-0 flex-col gap-6">
        {/* 다음 클래스 히어로 (항상 표시) — 참여코드 값·복사 UI 는 두지 않는다 */}
        {hideHero ? null : heroData ? (
          <ClassHero data={heroData} action={heroAction} onAction={openHeroClass} busy={enteringId !== null} />
        ) : (
          <ClassHeroEmpty backdropSrc={heroBackdrop('empty')} onApply={() => navigate('/app/sessions', { state: { openApply: true } })} />
        )}

        {/* 초대된 클래스 (조건부) */}
        {invitedSessions.length > 0 && (
          <section>
            <div className={SECTION_HEAD_CLS}>
              <h2 className={SECTION_TITLE_CLS}>초대된 클래스</h2>
              <span className="font-mono text-[12px] text-[#6F6F6F]">{invitedSessions.length}건</span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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

        {/* 이번 주 클래스 */}
        <section className="flex flex-col gap-2">
          <div className={SECTION_HEAD_CLS}>
            <h2 className={SECTION_TITLE_CLS}>이번 주 클래스</h2>
            <span className="text-[13px] text-[#6F6F6F]">{weekSessions.length}개</span>
          </div>
          {weekSessions.length > 0 ? (
            weekSessions.map((s) => (
              <ClassRow key={s.id} data={toClassRowData({ ...s, host_name: getCounselorName(s) ?? null })} onOpen={(id) => navigate(`/app/sessions/${id}`)} />
            ))
          ) : (
            <div className="rounded-2xl border border-[#DDD0EA] bg-[#FBF8FD] p-6 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#F5EDFC] text-[#5F0080]">
                <CalendarDays size={20} aria-hidden="true" />
              </div>
              <p className="text-[15px] font-bold text-[#1F1F1F]">이번 주 예정된 클래스가 없어요</p>
              <p className="mt-1 text-[13px] text-[#6F6F6F]">상담사에게 클래스를 신청해 보세요.</p>
              <button
                type="button"
                onClick={() => navigate('/app/classes', { state: { openApply: true } })}
                className="mt-4 rounded-lg border border-[#DDD0EA] bg-white px-4 py-2 text-[13px] font-bold text-[#5F0080] min-h-[44px] hover:bg-[#F5EDFC] transition-colors"
              >
                클래스 신청하기
              </button>
            </div>
          )}
          <EnterByCodeLink onClick={() => navigate('/join')} />
        </section>

        {/* 내 리포트 */}
        <section>
          <div className={SECTION_HEAD_CLS}>
            <h2 className={SECTION_TITLE_CLS}>내 리포트</h2>
            <button type="button" onClick={() => navigate('/app/reports')} className={LINK_CLS}>
              전체 보기 <ChevronRight size={14} aria-hidden="true" className="inline" />
            </button>
          </div>
          {clientReports.length > 0 ? (
            <div className="flex flex-col gap-3">
              {clientReports.map((r) => {
                const generation = resolveReportGenerationStatus(r.generation_status);
                const inReview = isReportInReview(r);
                const isNew = !r.is_read && !inReview;
                return (
                  <button
                    key={r.id ?? r.session_id}
                    type="button"
                    onClick={() => r.id && navigate(`/app/reports?report=${r.id}`)}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-[#E8E3EC] bg-[#FBF8FD] p-4 text-left transition-all hover:border-[#DDD0EA] hover:bg-[#F5EDFC]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isNew && (
                          <span className="shrink-0 rounded-full bg-[#5F0080] px-2 py-0.5 text-[12px] font-bold text-white">
                            NEW
                          </span>
                        )}
                        <span className="truncate text-[15px] font-bold text-[#1F1F1F]">
                          {r.session_title || '리포트'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[12px] text-[#6F6F6F]">
                        {formatDate(r.created_at)} · 몸·마음 변화 리포트
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {inReview && (
                        <span className="inline-flex items-center rounded-full bg-[#F5EDFC] px-2 py-0.5 text-[12px] font-bold text-[#5F0080]">
                          {REPORT_IN_REVIEW_BADGE}
                        </span>
                      )}
                      {generation === 'processing' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#F5EDFC] px-2 py-0.5 text-[12px] font-bold text-[#5F0080]">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                          생성 중
                        </span>
                      )}
                      <ChevronRight size={16} aria-hidden="true" className="text-[#767676]" />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#E8E3EC] py-10 text-center text-sm text-[#6F6F6F]">
              아직 리포트가 없어요
            </div>
          )}
        </section>
      </div>

      {hideHero && summaryTiles}

      {/* ── 우측 레일 ── */}
      <div className="mh-rail flex min-w-0 flex-col gap-6 lg:gap-5">
        {/* 요약 타일 */}
        {!hideHero && summaryTiles}

        {/* 담당 상담사 */}
        {primaryCounselor && (
          <section className={`${CARD_CLS} p-5`}>
            <div className={SECTION_HEAD_CLS}>
              <h2 className={SECTION_TITLE_CLS}>담당 상담사</h2>
              <button type="button" onClick={() => navigate('/app/chat')} className={LINK_CLS}>
                상담 신청 <ChevronRight size={14} aria-hidden="true" className="inline" />
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5F0080] to-[#8A4FB8] text-[13px] font-bold text-white">
                {primaryCounselor.name?.charAt(0) ?? '상'}
              </div>
              <div className="min-w-0">
                <div className="text-[15px] font-bold text-[#1F1F1F]">{primaryCounselor.name}</div>
                <div className="text-[13px] text-[#6F6F6F]">임상·최면심리상담 전문</div>
              </div>
            </div>
          </section>
        )}

        {/* 최근 대화 */}
        <section className={`${CARD_CLS} p-5`}>
          <div className={SECTION_HEAD_CLS}>
            <h2 className={SECTION_TITLE_CLS}>최근 대화</h2>
            <button type="button" onClick={() => navigate('/app/chat')} className={LINK_CLS}>
              전체 <ChevronRight size={14} aria-hidden="true" className="inline" />
            </button>
          </div>
          {recentChats.length > 0 ? (
            <div>
              {recentChats.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => openChat(room.id)}
                  className="flex w-full items-start gap-3 border-b border-[#F0ECF2] py-3 text-left last:border-0"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5F0080] to-[#8A4FB8] text-[13px] font-bold text-white">
                    {(room.display_name || room.peer_name || '상').charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-bold text-[#1F1F1F]">
                        {room.display_name || room.peer_name || '상담사'}
                      </span>
                      {(room.unread_count ?? 0) > 0 && (
                        <span className="rounded-full bg-[#5F0080] px-1.5 text-[12px] font-extrabold text-white">
                          {room.unread_count}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-[#6F6F6F]">
                      {room.last_message?.content || '새로운 대화가 없습니다'}
                    </div>
                  </div>
                  <span className="shrink-0 text-[12px] text-[#767676]">
                    {relativeTime(room.last_message_at ?? null)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-[#6F6F6F]">대화가 없습니다</div>
          )}
        </section>

        {/* 새 알림 */}
        <section className={`${CARD_CLS} flex flex-1 flex-col p-5`}>
          <div className={SECTION_HEAD_CLS}>
            <h2 className={SECTION_TITLE_CLS}>새 알림</h2>
            <button type="button" onClick={() => navigate('/app/notifications')} className={LINK_CLS}>
              전체 <ChevronRight size={14} aria-hidden="true" className="inline" />
            </button>
          </div>
          {recentNotifications.length > 0 ? (
            <div className="flex flex-1 flex-col">
              {recentNotifications.map((n) => (
                <div key={n.id} className="flex items-start gap-3 border-b border-[#F0ECF2] py-3 last:border-0">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#5F0080]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-[#1F1F1F]">{n.title}</div>
                    {n.body && <div className="truncate text-[12px] text-[#6F6F6F]">{n.body}</div>}
                    <div className="text-[12px] text-[#767676]">{relativeTime(n.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center py-8 text-center text-sm text-[#6F6F6F]">
              새로운 알림이 없습니다
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
