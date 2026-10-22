// 상담사 클래스 대시보드 — SDD-232: 회원 홈 흐름으로 정리
// 위계: 사진 히어로 → 리포트 검토 배너 → 업무 타일 4 → 내 클래스 캐러셀 → (하단) 일정·지난 회차·상담사 코드 | 최근 대화·새 알림

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import OrgRemovedNoticeDialog from '../components/org/OrgRemovedNoticeDialog';
import { StatusBadge } from '../components/session/StatusBadge';
import { CounselorHomeHero } from '../components/dashboard/counselor-home-hero';
import { MemberClassStrip } from '../components/client/home/member-class-strip';
import { MemberClassStyles } from '../components/class/structure/member-class-views';
import { ReadStateView } from '../components/class/structure/read-state';
import { useClasses } from '../hooks/use-class-structure';
import { adaptHostClass } from '../lib/class-structure/adapters';
import { classPath } from '../lib/class-structure/navigation';
import {
  HOME_CLASS_LIMIT,
  pickHeroSession,
  pickPastRows,
  pickScheduleRows,
  sortHomeClasses,
} from '../lib/dashboard/counselor-home-model';
import '../components/class/structure/structure-shell.css';
import '../components/client/home/member-home-layout.css';
import '../components/dashboard/counselor-home.css';
import '../components/client/home/home-card-parity.css';
import {
  getCounselorDashboard,
  type ClassSummary,
  type CounselorDashboardResponse,
} from '../lib/api/dashboard';
import { listChatRooms, type ChatRoom } from '../lib/api/chat';
import { listNotifications, type NotificationDto } from '../lib/api/notifications';
import { dashboardSessionArea, dashboardSessionPath } from '../lib/class-structure/dashboard-navigation';
import { isCounselingEnabled } from '../lib/feature-flags';
import { useAuthStore } from '../stores/authStore';
import { AiOnly } from '../components/routing/ai-gate';
import { ClickableCard, CardAction } from '../components/dashboard/clickable-card';
import { NotificationRow } from '../components/dashboard/notification-row';
import { StatTile } from '../components/dashboard/stat-tile';
import {
  PARTICIPANTS_TILE_TARGET,
  REVIEW_TILE_TARGET,
  TODAY_TILE_TARGET,
  liveTileHint,
  liveTileTarget,
} from '../lib/dashboard/home-links';
import { liveClasses as pickLiveClasses, pendingReviewTotal, todayRemaining } from '../lib/dashboard/home-stats';

function formatTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  return formatDateTime(iso);
}

function AccessCodeCell({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (): Promise<void> => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 클립보드 실패 시 무시 */
    }
  };
  if (!code) return <span className="text-[#C2C3CE]">-</span>;
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono font-bold tracking-widest text-[#5F0080]">{code}</span>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="relative z-10 px-3 py-2 min-h-[40px] rounded-lg bg-[#F5EDFC] text-[#5F0080] text-[13px] font-semibold hover:bg-[#EBDEF7] transition-colors"
      >
        {copied ? '복사됨' : '복사'}
      </button>
    </div>
  );
}

/** 일정·지난 회차 행. 회차 상세로 이동하고, 입장 코드 복사·참여/게스트 수·기록 보기를 보조 작업으로 유지한다. */
function SessionRow({ cls, showTime }: { cls: ClassSummary; showTime: boolean }) {
  const isToday = cls.scheduled_at ? new Date(cls.scheduled_at).toDateString() === new Date().toDateString() : false;
  const showRecordLink = cls.has_record || cls.has_summary;
  const area = dashboardSessionArea(cls);
  return (
    <ClickableCard
      to={dashboardSessionPath(cls)}
      label={cls.title || '제목 없음'}
      className="ch-row flex items-center gap-3 border-b border-[#F0ECF2] py-4 last:border-0 hover:bg-[#FAF7FC]"
    >
      <div className="w-[76px] shrink-0">
        <div className="text-[15px] font-extrabold text-[#1F1F1F]">{showTime ? formatTime(cls.scheduled_at) : ''}</div>
        <div className="text-[12px] font-semibold text-[#767676]">
          {cls.scheduled_at ? `${new Date(cls.scheduled_at).getMonth() + 1}/${new Date(cls.scheduled_at).getDate()}` : ''}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-bold text-[#1F1F1F]">{cls.title || '제목 없음'}</div>
        <div className="text-[12px] text-[#6F6F6F]">
          {area && <span className="mr-2 inline-flex rounded-full bg-[#F0EAF6] px-2 py-0.5 text-[12px] font-semibold text-[#665185]" aria-label="일정 영역">{area}</span>}
          참여 {cls.participant_count}명{cls.guest_count > 0 && ` · 게스트 ${cls.guest_count}`}
          {isToday ? ' · 오늘' : ''}
        </div>
        {(cls.access_code || showRecordLink) && (
          <CardAction className="mt-1 flex flex-wrap items-center gap-3">
            {cls.access_code && <AccessCodeCell code={cls.access_code} />}
            {showRecordLink && (
              <Link to={`/sessions/${cls.id}/record`} className="inline-flex min-h-[44px] items-center text-[13px] font-bold text-[#5F0080] hover:underline">
                기록 보기 →
              </Link>
            )}
          </CardAction>
        )}
      </div>
      <StatusBadge status={cls.status} />
    </ClickableCard>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<CounselorDashboardResponse | null>(null);
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileBannerDismissed, setProfileBannerDismissed] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);

  const fetchDashboard = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [res, chatRes, notifRes] = await Promise.all([
        getCounselorDashboard(),
        listChatRooms().catch(() => ({ rooms: [] as ChatRoom[] })),
        listNotifications(true, 5).catch(() => ({ notifications: [] as NotificationDto[], total: 0, unread: 0 })),
      ]);
      setData(res);
      setChatRooms(chatRes.rooms);
      setNotifications(notifRes.notifications);
    } catch (err) {
      setError(err instanceof Error ? err.message : '대시보드를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  // ── 파생 데이터 ────────────────────────────────────────────────
  // SDD-219: 상담 비공개 시 상담 영역 행(area=counseling)은 목록·카드에서 제외한다.
  const visibleClasses = useMemo(
    () => (data?.classes ?? []).filter((c) => isCounselingEnabled() || dashboardSessionArea(c) !== '상담'),
    [data],
  );
  const liveClasses = useMemo(() => pickLiveClasses(visibleClasses), [visibleClasses]);
  // 검토 대기 = 승인 게이트(pending_review)에 있는 리포트 수 (백엔드 집계).
  // 클래스 완료 여부·기록 존재 여부와 무관하게 실제 검토중 리포트 수와 일치해야 한다.
  // SDD-221: 화면에 보이는(상담 제외) 행 기준으로 합산해 목록과 일치시킨다.
  const pendingReviewCount = useMemo(() => pendingReviewTotal(visibleClasses), [visibleClasses]);
  const todaySessions = useMemo(() => todayRemaining(visibleClasses, new Date()), [visibleClasses]);

  const upcomingSessions = useMemo(() => pickScheduleRows(visibleClasses, new Date()), [visibleClasses]);
  const hero = useMemo(() => (data ? pickHeroSession(visibleClasses, new Date()) : null), [data, visibleClasses]);
  const pastClasses = useMemo(() => pickPastRows(visibleClasses), [visibleClasses]);

  // 내 클래스 = 부모 클래스 1장(GET /classes). 실패해도 대시보드 나머지 영역은 유지한다.
  const classesRead = useClasses();
  const homeClasses = useMemo(
    () => (classesRead.state.status === 'success'
      ? sortHomeClasses(classesRead.state.data.classes.map(adaptHostClass)).slice(0, HOME_CLASS_LIMIT)
      : []),
    [classesRead.state],
  );
  const totalClassCount = classesRead.state.status === 'success' ? classesRead.state.data.classes.length : 0;

  const recentChats = useMemo(() => {
    return [...chatRooms]
      .sort((a, b) => {
        const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return bt - at;
      })
      .slice(0, 3);
  }, [chatRooms]);

  const recentNotifications = useMemo(() => {
    return [...notifications]
      .filter((n) => !n.is_read)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 3);
  }, [notifications]);

  // 인사말은 이름만 간단히 보여 준다(역할 표기 '(상담사)' 등은 뺀다).
  const displayName = (data?.counselor_name ?? user?.name ?? '상담사').replace(/\s*\([^)]*\)\s*$/, '') || '상담사';
  const orgLabel =
    data?.org_kind === 'individual'
      ? '내 개인 상담소'
      : data?.org_name
        ? data.org_name
        : 'MY CLASSES';
  const counselorCode = user?.counselor_code ?? null;
  const showProfileBanner =
    !profileBannerDismissed && user?.role === 'counselor' && !user.onboarding_completed;

  const handleCopyCounselorCode = async (): Promise<void> => {
    if (!counselorCode) return;
    try {
      await navigator.clipboard.writeText(counselorCode);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      /* 클립보드 실패 시 무시 */
    }
  };

  const handleNotificationRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((x) => (x.id === id ? { ...x, is_read: true } : x)));
  }, []);

  return (
    <AppShell
      title={`안녕하세요, ${displayName}님`}
      sub={orgLabel}
      rightSlot={
        <div className="ch-header-actions flex flex-wrap items-center gap-2">
          <Link
            to="/classes/now"
            className="h-11 inline-flex items-center px-4 rounded-full border border-[#DDD0EA] bg-white text-[#5F0080] font-semibold text-sm hover:bg-[#F5EDFC] transition-colors"
          >
            지금 바로 시작
          </Link>
          <Link
            to="/classes/new"
            className="h-11 inline-flex items-center px-[18px] rounded-full bg-[#5F0080] text-white font-semibold text-sm hover:bg-[#4B0066] transition-colors"
          >
            + 새 클래스
          </Link>
        </div>
      }
    >
      <OrgRemovedNoticeDialog />
      {/* SDD-220: AI 비공개면 루시 브리핑 CTA 를 mount 하지 않는다 */}
      <AiOnly>
        <Link to="/chat/lucy" className="mb-4 flex items-center justify-between rounded-2xl bg-[#F5EDFC] p-4 text-[#5F0080]">
          <span><strong>루시 (AI) 브리핑</strong><span className="ml-3 text-sm">오늘 일정과 내담자 피드백 확인</span></span><span aria-hidden="true">→</span>
        </Link>
      </AiOnly>

      {error && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl bg-[#FDECEC] p-3 text-sm text-[#B3261E] sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void fetchDashboard()}
            className="shrink-0 self-start rounded-lg border border-[#B3261E]/40 bg-white px-3 py-1.5 text-[13px] font-semibold text-[#B3261E] transition-colors hover:bg-[#F9D9D9] sm:self-auto"
          >
            다시 시도
          </button>
        </div>
      )}

      {showProfileBanner && (
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#DDD0EA] bg-[#F5EDFC] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[15px] font-bold text-[#5F0080]">프로필을 완성해보세요</p>
            <p className="mt-1 text-[13px] text-[#6F6F6F]">
              자격증명·경력 등은 원하실 때 설정에서 입력하실 수 있습니다.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/onboarding/counselor')}
              className="h-9 rounded-xl bg-[#5F0080] px-4 text-[13px] font-semibold text-white hover:bg-[#4B0066] transition-colors"
            >
              프로필 완성하기
            </button>
            <button
              type="button"
              onClick={() => setProfileBannerDismissed(true)}
              className="h-9 rounded-xl border border-[#C9B0E8] bg-white px-4 text-[13px] font-semibold text-[#6F6F6F] hover:bg-[#EFE3FA] transition-colors"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-[#6F6F6F] text-sm">불러오는 중...</div>
      ) : data ? (
        <div className="ch-home">
          <MemberClassStyles />
          {/* 히어로: 홈에서 열기·시작은 하지 않고 회차 상세로 보낸다 */}
          <CounselorHomeHero
            session={hero?.session ?? null}
            live={hero?.live ?? false}
            detailPath={hero ? dashboardSessionPath(hero.session) : '/classes'}
          />

          {pendingReviewCount > 0 && (
            <div className="ch-review">
              <div>
                <p className="text-[15px] font-bold text-[#1F1F1F]">리포트 검토 대기 {pendingReviewCount}건</p>
                <p className="mt-1 text-[13px] text-[#6F6F6F]">기록이 완료된 회차의 리포트를 검토해주세요.</p>
              </div>
              <Link to={REVIEW_TILE_TARGET}>리포트 검토</Link>
            </div>
          )}

          <div className="ch-tiles">
            <StatTile
              label="진행 중 회차"
              value={liveClasses.length}
              to={liveTileTarget(liveClasses)}
              hint={liveTileHint(liveClasses.length)}
              valueClassName="text-[#1F8A5B]"
            />
            <StatTile
              label="검토 대기 리포트"
              value={pendingReviewCount}
              to={REVIEW_TILE_TARGET}
              hint="리포트 검토 →"
              valueClassName="text-[#5F0080]"
            />
            <StatTile label="오늘 예정 회차" value={todaySessions.length} to={TODAY_TILE_TARGET} hint="일정 보기 →" />
            <StatTile
              label="총 참여자"
              value={`${data.total_participants.toLocaleString('ko-KR')}명`}
              to={PARTICIPANTS_TILE_TARGET}
              hint="회원 관리 →"
            />
          </div>

          {/* 내 클래스 캐러셀 */}
          <section aria-label="내 클래스">
            <div className="ch-heading">
              <h2>내 클래스</h2>
              <Link to="/classes">전체 보기{totalClassCount > HOME_CLASS_LIMIT ? ` (${totalClassCount})` : ''}</Link>
            </div>
            <ReadStateView
              status={classesRead.state.status === 'success' && homeClasses.length === 0 ? 'empty' : classesRead.state.status}
              backTo="/classes"
              onRetry={classesRead.retry}
            >
              <MemberClassStrip classes={homeClasses} hrefFor={(model) => classPath('host', model.id)} />
            </ReadStateView>
            {classesRead.state.status === 'success' && homeClasses.length === 0 && (
              <div className="mt-3">
                <Link
                  to="/classes/new"
                  className="inline-flex h-11 px-5 items-center rounded-xl bg-[#F5EDFC] text-[#5F0080] font-semibold text-sm hover:bg-[#EBDEF7] transition-colors"
                >
                  클래스 만들기
                </Link>
              </div>
            )}
          </section>

          {/* 하단 업무 영역 */}
          <div className="ch-work">
            <div className="ch-main">
              <section className="ch-panel" aria-label="오늘 · 다가오는 일정">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2>오늘 · 다가오는 일정</h2>
                  <span className="font-mono text-[12px] text-[#6F6F6F]">오늘 {todaySessions.length}건</span>
                </div>
                {upcomingSessions.length > 0 ? (
                  <div>
                    {upcomingSessions.map((cls) => (
                      <SessionRow key={cls.id} cls={cls} showTime />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-[#E8E3EC] py-10 text-center text-sm text-[#6F6F6F]">
                    예정된 일정이 없습니다
                  </div>
                )}
                {pastClasses.length > 0 && (
                  <details className="ch-past mt-3">
                    <summary>지난 회차 {pastClasses.length}건</summary>
                    <div>
                      {pastClasses.map((cls) => (
                        <SessionRow key={cls.id} cls={cls} showTime={false} />
                      ))}
                    </div>
                  </details>
                )}
              </section>

              {/* 상담사 코드 (접이식) */}
              {counselorCode && (
                <section className="ch-panel">
                  <button
                    type="button"
                    onClick={() => setCodeOpen((v) => !v)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <div>
                      <div className="text-[12px] font-semibold text-[#6F6F6F]">내 상담사 코드</div>
                      <div className="mt-0.5 font-mono text-[15px] font-extrabold tracking-[0.14em] text-[#5F0080]">
                        {codeOpen ? counselorCode : counselorCode.slice(0, 2) + '••••'}
                      </div>
                    </div>
                    <span className="text-[#6F6F6F]">{codeOpen ? '▲' : '▼'}</span>
                  </button>
                  {codeOpen && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCopyCounselorCode()}
                        className="rounded-lg border border-[#C9B0E8] bg-white px-4 py-2 min-h-[44px] text-sm font-bold text-[#5F0080] hover:bg-[#EFE3FA] transition-colors"
                      >
                        {codeCopied ? '복사됨' : '복사'}
                      </button>
                      <p className="text-[12px] text-[#6F6F6F]">내담자에게 이 코드를 공유하면 상담 관계가 연결됩니다.</p>
                    </div>
                  )}
                </section>
              )}
            </div>

            <div className="ch-rail">
              {/* 최근 대화 */}
              <section className="ch-panel home-rail-card" aria-label="최근 대화">
                <div className="mb-3 flex items-center justify-between">
                  <h2>최근 대화</h2>
                  <Link to="/chat" className="home-rail-link inline-flex min-h-[44px] items-center text-[15px] font-bold text-[#5F0080] hover:underline">
                    전체<ChevronRight size={14} aria-hidden="true" />
                  </Link>
                </div>
                {recentChats.length > 0 ? (
                  <div>
                    {recentChats.map((room) => (
                      <Link
                        key={room.id}
                        to={`/chat/${room.id}`}
                        className="flex min-h-[56px] w-full items-start gap-3 border-b border-[#F0ECF2] py-3.5 text-left last:border-0 hover:bg-[#FAF7FC] transition-colors"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5F0080] to-[#8A4FB8] text-[12px] font-bold text-white">
                          {(room.display_name || room.peer_name || '내').charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[16px] font-semibold text-[#1F1F1F]">
                              {room.display_name || room.peer_name || '내담자'}
                            </span>
                            {(room.unread_count ?? 0) > 0 && (
                              <span className="rounded-full bg-[#5F0080] px-1.5 text-[12px] font-extrabold text-white">
                                {room.unread_count}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[15px] text-[#6F6F6F]">
                            {room.last_message?.content || '새로운 대화가 없습니다'}
                          </div>
                        </div>
                        <span className="shrink-0 text-[13px] text-[#767676]">{relativeTime(room.last_message_at ?? null)}</span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="py-1 text-left text-[15px] text-[#6F6F6F]">
                    대화가 없습니다
                  </div>
                )}
              </section>

              {/* 새 알림 */}
              <section className="ch-panel home-rail-card" aria-label="새 알림">
                <div className="mb-3 flex items-center justify-between">
                  <h2>새 알림</h2>
                  <Link to="/notifications" className="home-rail-link inline-flex min-h-[44px] items-center text-[15px] font-bold text-[#5F0080] hover:underline">
                    전체<ChevronRight size={14} aria-hidden="true" />
                  </Link>
                </div>
                {recentNotifications.length > 0 ? (
                  <div>
                    {recentNotifications.map((n) => (
                      <NotificationRow
                        key={n.id}
                        notification={n}
                        role={user?.role}
                        timeLabel={relativeTime(n.created_at)}
                        onRead={handleNotificationRead}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="py-1 text-left text-[15px] text-[#6F6F6F]">
                    새로운 알림이 없습니다
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
