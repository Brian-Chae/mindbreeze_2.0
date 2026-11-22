// SDD-320 F-0 — 코치 홈(시안 home.html 1440 구성). 데이터는 기존 DashboardPage 와 같은 API·모델 함수를 쓰고 표현만 새로 만든다.
// 즉석 시작·새 클래스·루시·코치 코드·프로필 안내 등 기존 기능 진입점은 시안의 카드/링크로 옮겨 모두 유지한다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { UiV2CoachCalendar, dayKey, kstDay, type CalendarJump } from '../../../components/ui-v2/ui-v2-coach-calendar';
import { UiV2CoachCodeCard } from '../../../components/ui-v2/ui-v2-coach-code-card';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '../../../components/layout/AppShell';
import { ClassCreateAction } from '../../../components/class/structure/class-create-action';
import OrgRemovedNoticeDialog from '../../../components/org/OrgRemovedNoticeDialog';
import { AiOnly } from '../../../components/routing/ai-gate';
import { getCounselorDashboard, type ClassSummary, type CounselorDashboardResponse } from '../../../lib/api/dashboard';
import { listChatRooms, type ChatRoom } from '../../../lib/api/chat';
import { listNotifications, type NotificationDto } from '../../../lib/api/notifications';
import { dashboardSessionArea, dashboardSessionPath } from '../../../lib/class-structure/dashboard-navigation';
import { HOME_CLASS_LIMIT, homeEntryAction, pickHeroSession, sortHomeClasses } from '../../../lib/dashboard/counselor-home-model';
import { UiV2CoachClassList } from '../../../components/ui-v2/ui-v2-coach-class-list';
import { nextSessionOf } from '../../../lib/dashboard/coach-calendar-link';
import { MemberClassStyles } from '../../../components/class/structure/member-class-views';
import { useClasses } from '../../../hooks/use-class-structure';
import { HOME_ACTIVE_CLASS_PARAMS } from '../../../lib/class-structure/home-params';
import { adaptHostClass } from '../../../lib/class-structure/adapters';
import '../../../components/class/structure/structure-shell.css';
import '../../../components/client/home/member-home-layout.css';
import '../../../components/client/home/home-card-parity.css';
import { PARTICIPANTS_TILE_TARGET, REVIEW_TILE_TARGET, TODAY_TILE_TARGET, liveTileHint, liveTileTarget } from '../../../lib/dashboard/home-links';
import { liveClasses as pickLiveClasses, pendingReviewTotal, todayRemaining } from '../../../lib/dashboard/home-stats';
import { isCounselingEnabled } from '../../../lib/feature-flags';
import { heroBackdrop } from '../../../components/class/flow/shell/shell-data';
import { NATURE_HERO_GRADIENT } from '../../../components/ui-v2/nature-hero';
import { useAuthStore } from '../../../stores/authStore';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-brand.css';
import '../../../styles/ui-v2-coach-pc.css';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');

// eslint-disable-next-line react-refresh/only-export-components -- 순수 함수, 시험에서 직접 검증
export function timeRange(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// eslint-disable-next-line react-refresh/only-export-components -- 순수 함수, 시험에서 직접 검증
export function shortDay(iso: string | null): string {
  if (!iso) return '일정 미정';
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${WEEKDAYS[d.getDay()]}`;
}
function relative(iso: string | null): string {
  if (!iso) return '';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  return day < 7 ? `${day}일 전` : new Date(iso).toLocaleDateString('ko-KR');
}

export function UiV2CoachHomePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<CounselorDashboardResponse | null>(null);
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // 달력 ↔ 내 클래스 연동 상태
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [jump, setJump] = useState<CalendarJump | null>(null);
  const [hoverClass, setHoverClass] = useState<string | null>(null);
  const [hoverIds, setHoverIds] = useState<ReadonlySet<string>>(new Set());
  const [onDateIds, setOnDateIds] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const fetchDashboard = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [res, chatRes, notifRes] = await Promise.all([
        getCounselorDashboard(),
        listChatRooms().catch(() => ({ rooms: [] as ChatRoom[] })),
        listNotifications(true, 5).catch(() => ({ notifications: [] as NotificationDto[], total: 0, unread: 0 })),
      ]);
      setData(res); setChatRooms(chatRes.rooms); setNotifications(notifRes.notifications);
    } catch (err) {
      setError(err instanceof Error ? err.message : '대시보드를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void fetchDashboard(); }, [fetchDashboard]);

  const rows = useMemo(() => (data?.classes ?? []).filter((c) => isCounselingEnabled() || dashboardSessionArea(c) !== '상담'), [data]);
  const live = useMemo(() => pickLiveClasses(rows), [rows]);
  const pendingReview = useMemo(() => pendingReviewTotal(rows), [rows]);
  const today = useMemo(() => todayRemaining(rows, new Date()), [rows]);
  const hero = useMemo(() => (data ? pickHeroSession(rows, new Date()) : null), [data, rows]);
  // 11/9 대표 지시: 홈 구조를 운영 웹과 같게 — 히어로 → 검토 배너 → 숫자 타일 4 → 내 클래스 → 일정 | 대화·알림
  const classesRead = useClasses(HOME_ACTIVE_CLASS_PARAMS);
  const homeClasses = useMemo(() => (classesRead.state.status === 'success' ? sortHomeClasses(classesRead.state.data.classes.map(adaptHostClass)).slice(0, HOME_CLASS_LIMIT) : []), [classesRead.state]);
  const totalClassCount = classesRead.state.status === 'success' ? classesRead.state.data.classes.length : 0;
  const recentChats = useMemo(() => [...chatRooms].sort((a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime()).slice(0, 3), [chatRooms]);
  const unreadNotifs = useMemo(() => notifications.filter((n) => !n.is_read).slice(0, 3), [notifications]);

  const keyOf = useCallback((iso: string): string | null => { const k = kstDay(iso); return k ? dayKey(k) : null; }, []);
  const selectClass = useCallback((id: string): void => {
    if (classFilter === id) { setClassFilter(null); setNotice(null); return; } // 재클릭: 필터만 해제, 날짜 유지
    setClassFilter(id);
    const todayKey = dayKey(kstDay(new Date())!);
    const next = nextSessionOf(rows, id, todayKey, keyOf);
    const key = next ? keyOf(next.scheduled_at!) : null;
    if (key) { setJump((j) => ({ key, nonce: (j?.nonce ?? 0) + 1 })); setNotice(null); } else setNotice('다음 일정이 없어 현재 달을 유지해요');
  }, [classFilter, rows, keyOf]);

  const showBanner = !bannerDismissed && user?.role === 'counselor' && !user.onboarding_completed;
  const heroSession: ClassSummary | null = hero?.session ?? null;
  const heroEntry = heroSession ? homeEntryAction(heroSession, user?.role) : ({ kind: 'none' } as const);
  const totalMembers = data ? (data.total_members ?? data.total_participants) : 0;

  return (
    <AppShell title="오늘의 흐름을 준비해요" rightSlot={<ClassCreateAction />}>
      <div className="ui-v2 u2f u2f-home">
        <OrgRemovedNoticeDialog />
        <UiV2CoachCodeCard />
        {error && <div className="u2-alert" role="alert"><p>{error}</p><button type="button" className="u2-secondary u2-gap" onClick={() => void fetchDashboard()}>다시 시도</button></div>}
        {showBanner && <div className="u2-card u2f-banner">
          <div><h3>프로필을 완성해 보세요</h3><p className="u2-muted">자격·경력은 원할 때 설정에서 입력할 수 있어요.</p></div>
          <div className="u2f-actions"><button type="button" className="u2-primary" onClick={() => navigate('/onboarding/counselor')}>프로필 완성하기</button><button type="button" className="u2-secondary" onClick={() => setBannerDismissed(true)}>닫기</button></div>
        </div>}
        {loading ? <p className="u2-empty">불러오는 중...</p> : data ? (
          <div className="u2f-home-ops">
            <MemberClassStyles />
            <section className="u2-card u2-hero u2-hero--nature u2f-home-hero" data-testid="counselor-home-hero" aria-label="오늘 회차" style={{ backgroundImage: `${NATURE_HERO_GRADIENT},url(${heroBackdrop(heroSession?.id ?? 'home')})` }}>
              {heroSession ? <>
                <span className="u2-eyebrow">{hero?.live ? '진행 중' : '다음 회차'} · {shortDay(heroSession.scheduled_at)}</span>
                <h2>{heroSession.title?.trim() || '이름 없는 회차'}{heroSession.seq != null ? ` · ${heroSession.seq}회차` : ''}</h2>
                <p className="u2f-hero-meta"><b>{timeRange(heroSession.scheduled_at) || '--:--'}</b> · 참여 {heroSession.participant_count}명</p>
                {heroEntry.kind === 'note' && <p className="u2-muted" data-testid="home-entry-note">{heroEntry.text}</p>}
                {heroEntry.kind === 'enter' || heroEntry.kind === 'observe' ? <>
                  <Link className="u2-primary" data-testid="home-entry-cta" to={heroEntry.to}>{heroEntry.label}<span aria-hidden="true" style={{ marginLeft: 'auto' }}>↗</span></Link>
                  <Link className="u2-textlink" to={dashboardSessionPath(heroSession)}>회차 상세 보기 ›</Link>
                </> : <Link className="u2-primary" to={dashboardSessionPath(heroSession)}>{hero?.live ? '입장 현황' : '회차 상세 보기'}<span aria-hidden="true" style={{ marginLeft: 'auto' }}>↗</span></Link>}
              </> : <>
                <h2 className="u2-gap">예정된 회차가 없어요</h2>
                <p className="u2-muted">클래스를 바로 열어 회원과 함께 시작할 수 있어요.</p>
                <Link className="u2-primary" to="/classes/now">지금 바로 시작</Link>
              </>}
            </section>

            {pendingReview > 0 && <div className="u2-card u2f-review u2f-review--action" role="status">
              <div><h3>리포트 검토 대기 {pendingReview}건</h3><p className="u2-muted">기록이 끝난 회차의 리포트를 읽고 승인하면 회원에게 전달돼요.</p></div>
              <Link className="u2-primary" to={REVIEW_TILE_TARGET}>지금 검토하기</Link>
            </div>}

            <div className="u2f-tiles">
              <Link className="u2-card u2f-tile" to={liveTileTarget(live)}><span>진행 중 회차</span><b style={{ color: '#1F8A5B' }}>{live.length}<em>개</em></b><i>지금 열려 있는 회차</i><small>{liveTileHint(live.length)}</small></Link>
              <Link className="u2-card u2f-tile" to={REVIEW_TILE_TARGET}><span>검토 대기 리포트</span><b style={{ color: 'var(--u2-accent)' }}>{pendingReview}<em>건</em></b><i>승인 전 회원용 리포트</i><small>리포트 검토 →</small></Link>
              <Link className="u2-card u2f-tile" to={TODAY_TILE_TARGET}><span>오늘 예정 회차</span><b>{today.length}<em>개</em></b><i>오늘 남은 회차</i><small>일정 보기 →</small></Link>
              <Link className="u2-card u2f-tile" to={PARTICIPANTS_TILE_TARGET /* /clients */}><span>총 회원</span><b>{totalMembers.toLocaleString('ko-KR')}<em>명</em></b><i>연결된 회원 수</i><small>회원 관리 →</small></Link>
            </div>

            <div className="u2f-cols u2f-cols--cal" data-testid="coach-home-cal-row">
              <section className="u2-card u2f-cal-card" aria-label="오늘 · 다가오는 일정">
                <div className="u2-section-head u2-row"><h2>오늘 · 다가오는 일정</h2><span className="u2-muted" style={{ fontSize: 12 }}>오늘 {today.length}건</span></div>
                <UiV2CoachCalendar sessions={rows} classFilter={classFilter} hoverClassId={hoverClass} jump={jump}
                  emptyAction={<Link className="u2-textlink" to="/classes/now">지금 바로 시작 ›</Link>}
                  onDateClick={() => { setClassFilter(null); setNotice(null); }}
                  onToday={() => { setClassFilter(null); setNotice(null); }}
                  onSelectedClasses={(ids) => setOnDateIds((prev) => (prev.size === ids.length && ids.every((i) => prev.has(i)) ? prev : new Set(ids)))}
                  onHoverClasses={(ids) => setHoverIds(new Set(ids ?? []))} />
              </section>
              <UiV2CoachClassList classes={homeClasses} totalCount={totalClassCount} loading={classesRead.state.status === 'loading'}
                selectedId={classFilter} onDateIds={onDateIds} hoverIds={hoverIds} notice={notice} createTo="/classes/new"
                onSelect={selectClass} onHover={(id) => setHoverClass(id)} />
            </div>

            <div className="u2f-cols u2f-cols--lower">
              <section className="u2-card" aria-label="최근 대화"><div className="u2-section-head u2-row"><h2>최근 대화</h2><Link className="u2-textlink" to="/chat">전체 ›</Link></div>
                {recentChats.length > 0 ? recentChats.map((room) => <Link key={room.id} className="u2-listrow u2f-home-chat" to={`/chat/${room.id}`}><span className="u2f-home-avatar" aria-hidden="true">{(room.display_name || room.peer_name || '내담자').trim().charAt(0)}</span><div className="u2-body"><h3>{room.display_name || room.peer_name || '내담자'}{(room.unread_count ?? 0) > 0 ? ` · ${room.unread_count}` : ''}</h3><p>{room.last_message?.content || '새로운 대화가 없어요'}</p></div><small>{relative(room.last_message_at ?? null)}</small></Link>) : <p className="u2-empty">대화가 없어요</p>}
              </section>
              <section className="u2-card" aria-label="새 알림"><div className="u2-section-head u2-row"><h2>새 알림</h2><Link className="u2-textlink" to="/notifications">전체 ›</Link></div>
                {unreadNotifs.length > 0 ? unreadNotifs.map((n) => <Link key={n.id} className="u2-listrow" to="/notifications"><div className="u2-body"><h3>{n.title}</h3>{n.body && <p>{n.body}</p>}</div><small>{relative(n.created_at)}</small></Link>) : <p className="u2-empty">새로운 알림이 없어요</p>}
              </section>
            </div>
            <AiOnly><div className="u2-card u2f-home-shortcuts"><Link className="u2-secondary" to="/chat/lucy">루시 (AI) 브리핑</Link></div></AiOnly>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
