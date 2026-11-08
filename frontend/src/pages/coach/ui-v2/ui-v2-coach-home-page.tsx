// SDD-320 F-0 — 코치 홈(시안 home.html 1440 구성). 데이터는 기존 DashboardPage 와 같은 API·모델 함수를 쓰고 표현만 새로 만든다.
// 즉석 시작·새 클래스·데이터 현황·루시·코치 코드·프로필 안내 등 기존 기능 진입점은 시안의 카드/링크로 옮겨 모두 유지한다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { UiV2CoachCodeCard } from '../../../components/ui-v2/ui-v2-coach-code-card';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '../../../components/layout/AppShell';
import OrgRemovedNoticeDialog from '../../../components/org/OrgRemovedNoticeDialog';
import { AiOnly } from '../../../components/routing/ai-gate';
import { getCounselorDashboard, type ClassSummary, type CounselorDashboardResponse } from '../../../lib/api/dashboard';
import { listChatRooms, type ChatRoom } from '../../../lib/api/chat';
import { listNotifications, type NotificationDto } from '../../../lib/api/notifications';
import { listReports, type ReportDto } from '../../../lib/api/reports';
import { resolveReportStatus } from '../../../lib/api/report-status';
import { dashboardSessionArea, dashboardSessionPath } from '../../../lib/class-structure/dashboard-navigation';
import { pickHeroSession, pickScheduleRows } from '../../../lib/dashboard/counselor-home-model';
import { REVIEW_TILE_TARGET, liveTileHint, liveTileTarget } from '../../../lib/dashboard/home-links';
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

export function timeRange(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
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
  const [reports, setReports] = useState<ReportDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const fetchDashboard = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [res, chatRes, notifRes, reportRes] = await Promise.all([
        getCounselorDashboard(),
        listChatRooms().catch(() => ({ rooms: [] as ChatRoom[] })),
        listNotifications(true, 5).catch(() => ({ notifications: [] as NotificationDto[], total: 0, unread: 0 })),
        listReports({ page: 1, limit: 20 }).catch(() => ({ reports: [] as ReportDto[], total: 0 })),
      ]);
      setData(res); setChatRooms(chatRes.rooms); setNotifications(notifRes.notifications); setReports(reportRes.reports);
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
  const upcoming = useMemo(() => pickScheduleRows(rows, new Date()), [rows]);
  const hero = useMemo(() => (data ? pickHeroSession(rows, new Date()) : null), [data, rows]);
  const nextRows = upcoming.filter((c) => !live.some((l) => l.id === c.id) && c.id !== hero?.session.id).slice(0, 3);
  const recentReports = useMemo(() => reports.filter((r) => r.type === 'counselor' || r.type === 'client').slice(0, 2), [reports]);
  const recentChats = useMemo(() => [...chatRooms].sort((a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime()).slice(0, 3), [chatRooms]);
  const unreadNotifs = useMemo(() => notifications.filter((n) => !n.is_read).slice(0, 3), [notifications]);

  const displayName = (data?.counselor_name ?? user?.name ?? '코치').replace(/\s*\([^)]*\)\s*$/, '') || '코치';
  const showBanner = !bannerDismissed && user?.role === 'counselor' && !user.onboarding_completed;
  const heroSession: ClassSummary | null = hero?.session ?? null;
  const totalMembers = data ? (data.total_members ?? data.total_participants) : 0;

  return (
    <AppShell title="오늘의 흐름을 준비해요">
      <div className="ui-v2 u2f u2f-home">
        <OrgRemovedNoticeDialog />
        <UiV2CoachCodeCard />
        <p className="u2f-lead">{displayName}님, 함께할 시간을 살펴보세요.</p>
        {error && <div className="u2-alert" role="alert"><p>{error}</p><button type="button" className="u2-secondary u2-gap" onClick={() => void fetchDashboard()}>다시 시도</button></div>}
        {showBanner && <div className="u2-card u2f-banner">
          <div><h3>프로필을 완성해 보세요</h3><p className="u2-muted">자격·경력은 원할 때 설정에서 입력할 수 있어요.</p></div>
          <div className="u2f-actions"><button type="button" className="u2-primary" onClick={() => navigate('/onboarding/counselor')}>프로필 완성하기</button><button type="button" className="u2-secondary" onClick={() => setBannerDismissed(true)}>닫기</button></div>
        </div>}
        {loading ? <p className="u2-empty">불러오는 중...</p> : data ? (
          <div className="u2f-cols">
            <div className="u2f-main">
              <section className="u2-card u2-hero u2-hero--nature" data-testid="counselor-home-hero" aria-label="오늘 회차" style={{ backgroundImage: `${NATURE_HERO_GRADIENT},url(${heroBackdrop(heroSession?.id ?? 'home')})` }}>
                {heroSession ? <>
                  <span className="u2-eyebrow">{hero?.live ? '진행 중' : '다음 회차'} · {timeRange(heroSession.scheduled_at)}</span>
                  <div className="u2-num">{timeRange(heroSession.scheduled_at) || '--:--'} <small style={{ color: '#fff' }}>{shortDay(heroSession.scheduled_at)}</small></div>
                  <h2>{heroSession.title?.trim() || '이름 없는 회차'}{heroSession.seq != null ? ` · ${heroSession.seq}회차` : ''}</h2>
                  <p className="u2-muted">참여 {heroSession.participant_count}명</p>
                  <Link className="u2-primary" to={dashboardSessionPath(heroSession)}>{hero?.live ? '입장 현황' : '회차 상세 보기'}<span aria-hidden="true" style={{ marginLeft: 'auto' }}>↗</span></Link>
                </> : <>
                  <h2 className="u2-gap">예정된 회차가 없어요</h2>
                  <p className="u2-muted">클래스를 바로 열어 회원과 함께 시작할 수 있어요.</p>
                  <Link className="u2-primary" to="/classes/now">지금 바로 시작</Link>
                </>}
              </section>

              <section aria-label="열린 회차"><div className="u2-section-head"><h2>열린 회차</h2></div>
                {live.length > 0 ? live.map((c) => <article key={c.id} className="u2-card"><h3>{c.title || '제목 없음'}</h3><p className="u2-muted">{timeRange(c.scheduled_at)} · 대기실 열림 · 참여 {c.participant_count}명</p><Link className="u2-primary u2f-btn" to={live.length === 1 ? liveTileTarget(live) : dashboardSessionPath(c)}>{live.length === 1 ? '입장 현황' : '회차 보기'}</Link></article>)
                  : <p className="u2-empty">열려 있는 회차가 없어요 · <Link className="u2-textlink" to={liveTileTarget(live)}>{liveTileHint(0).replace(/\s*→$/, '')}</Link></p>}
              </section>

              <section aria-label="다음 일정"><div className="u2-section-head u2-row"><h2>다음 일정</h2><span className="u2-muted" style={{ fontSize: 12 }}>오늘 {today.length}건</span></div>
                {nextRows.length > 0 ? nextRows.map((c) => <article key={c.id} className="u2-card"><h3>{shortDay(c.scheduled_at)} · {timeRange(c.scheduled_at)}</h3><p className="u2-muted">{c.title || '제목 없음'}{c.seq != null ? ` · ${c.seq}회차` : ''}</p><Link className="u2-primary u2f-btn" to={dashboardSessionPath(c)}>클래스 보기</Link></article>)
                  : <p className="u2-empty">예정된 일정이 없어요</p>}
                <Link className="u2-textlink" to="/classes">내 클래스 전체 보기 ›</Link>
              </section>
            </div>

            <div className="u2f-rail">
              <article className="u2-card"><h3>지금 함께 시작할까요?</h3><p className="u2-muted">일정 없이 새로운 회차를 준비할 수 있어요.</p>
                <div className="u2f-actions"><Link className="u2-primary" to="/classes/now">즉석 시작</Link><Link className="u2-secondary" to="/classes/new" data-header-action="primary">+ 새 클래스</Link></div>
              </article>
              <section aria-label="검토할 기록"><div className="u2-section-head"><h2>검토할 기록 · {pendingReview}</h2></div>
                <article className="u2-card"><h3>리포트 검토 대기 {pendingReview}건</h3><p className="u2-muted">기록이 끝난 회차의 리포트를 확인하고 승인해요.</p><Link className="u2-primary u2f-btn" to={REVIEW_TILE_TARGET}>검토하기</Link></article>
              </section>
              <section aria-label="최근 리포트"><div className="u2-section-head u2-row"><h2>최근 리포트</h2><Link className="u2-textlink" to="/reports">전체 ›</Link></div>
                {recentReports.length > 0 ? recentReports.map((r) => { const approved = resolveReportStatus(r) === 'completed'; return <Link key={r.id ?? r.session_id} className="u2-card" to={r.id ? `/reports?report=${r.id}` : '/reports'}><h3>{r.session_title || '리포트'}</h3><p className="u2-muted">{shortDay(r.created_at)} · {approved ? '승인됨' : '검토 필요'}</p></Link>; })
                  : <p className="u2-empty">아직 리포트가 없어요</p>}
              </section>
              <section aria-label="새 알림"><div className="u2-section-head u2-row"><h2>알림</h2><Link className="u2-textlink" to="/notifications">전체 ›</Link></div>
                {unreadNotifs.length > 0 ? unreadNotifs.map((n) => <Link key={n.id} className="u2-card" to="/notifications"><h3>{n.title}</h3>{n.body && <p className="u2-muted">{n.body}</p>}<small>{relative(n.created_at)}</small></Link>) : <p className="u2-empty">새로운 알림이 없어요</p>}
              </section>
              <section aria-label="최근 대화"><div className="u2-section-head u2-row"><h2>최근 대화</h2><Link className="u2-textlink" to="/chat">전체 ›</Link></div>
                {recentChats.length > 0 ? recentChats.map((room) => <Link key={room.id} className="u2-listrow" to={`/chat/${room.id}`}><div className="u2-body"><h3>{room.display_name || room.peer_name || '내담자'}{(room.unread_count ?? 0) > 0 ? ` · ${room.unread_count}` : ''}</h3><p>{room.last_message?.content || '새로운 대화가 없어요'}</p></div><small>{relative(room.last_message_at ?? null)}</small></Link>) : <p className="u2-empty">대화가 없어요</p>}
              </section>
            </div>

            <section className="u2f-wide" aria-label="회원과 이어가는 이야기"><div className="u2-section-head"><h2>회원과 이어가는 이야기</h2></div>
              <div className="u2-card">
                <h3>회원 관리 · {totalMembers.toLocaleString('ko-KR')}명</h3><p className="u2-muted">클래스별 참여 기록과 코치 메모를 살펴요.</p>
                <div className="u2f-actions">
                  <Link className="u2-secondary" to="/clients">회원 목록</Link>
                  {isCounselingEnabled() && <Link className="u2-secondary" to="/counseling">개인상담</Link>}
                  <Link className="u2-secondary" to="/upload-status" data-upload-status-shortcut>데이터 현황</Link>
                  <AiOnly><Link className="u2-secondary" to="/chat/lucy">루시 (AI) 브리핑</Link></AiOnly>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
