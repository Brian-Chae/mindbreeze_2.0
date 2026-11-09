// 11/9 회원 홈(새 디자인) 전용 요약 숫자·이번 주 클래스·내 리포트·최근 대화·새 알림.
// 운영 공용 ClientHomePage 는 건드리지 않고, 같은 API(listSessions/listReports/listChatRooms/listNotifications)를 읽어 표현만 시안 규칙으로 그린다.
// 불러오는 중 / 실패 / 빈 상태를 구분하고, 오류를 0건으로 표시하지 않는다. 점수·종합점수는 만들지 않는다.
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listSessions, type SessionDto } from '../../lib/api/session';
import { listReports, type ReportDto } from '../../lib/api/reports';
import { adaptReportContent } from '../../lib/api/report';
import { listChatRooms, type ChatRoom } from '../../lib/api/chat';
import { listNotifications, markRead, type NotificationDto } from '../../lib/api/notifications';
import { pickHeroClass } from '../../lib/class/pick-hero-class';
import { isReportInReview } from '../../lib/report-review-copy';
import { resolveReportGenerationStatus } from '../../lib/api/report-status';
import { useNotificationStore } from '../../stores/notificationStore';
import { useAuthStore } from '../../stores/authStore';
import { InvitedSessionCard } from '../client/InvitedSessionCard';
import '../../styles/ui-v2-member-home.css';

type Counselor = { id: string; name: string; profile_image: string | null; org_name?: string | null };
type LoadState = 'loading' | 'error' | 'ready';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function weekStart(d: Date): Date {
  const s = startOfDay(d);
  const dow = s.getDay();
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() - (dow === 0 ? 6 : dow - 1));
}
function clock(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}.${d.getDate()}`;
}
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  return day < 7 ? `${day}일 전` : shortDate(iso);
}

/** 상태 제목 + 보조 문구로 구성된 요약 숫자 타일 하나. 링크 반복 문구는 쓰지 않는다. */
interface Tile { key: string; label: string; value: string; unit?: string; note: string; accent?: boolean; to: string }

function SummaryTiles({ tiles, onOpen }: { tiles: Tile[]; onOpen: (to: string) => void }) {
  return (
    <div className="mh-summary grid grid-cols-2 gap-3" data-testid="home-summary">
      {tiles.map((t) => (
        <button key={t.key} type="button" className="mh-tile" data-accent={t.accent ? '' : undefined} onClick={() => onOpen(t.to)}>
          <span className="mh-tile__label">{t.label}</span>
          <span className="mh-tile__value"><strong>{t.value}</strong>{t.unit && <em>{t.unit}</em>}</span>
          <span className="mh-tile__note">{t.note}</span>
        </button>
      ))}
    </div>
  );
}

/** nextAt/nextHref: 홈 상단 '다음 일정' 카드와 같은 출처(useMixedHome)의 다음 일정 — 있으면 타일도 이것을 쓴다. */
export function UiV2MemberHomePanels({ classSections, nextAt, nextHref }: { classSections?: ReactNode; nextAt?: string | null; nextHref?: string }) {
  const navigate = useNavigate();
  const userCounselors = useAuthStore((s) => s.user?.counselors);
  const counselors = useMemo<Counselor[]>(() => userCounselors ?? [], [userCounselors]);
  const sessionInvites = useNotificationStore((s) => s.sessionInvites);
  const removeSessionInvite = useNotificationStore((s) => s.removeSessionInvite);

  const [state, setState] = useState<LoadState>('loading');
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [reports, setReports] = useState<ReportDto[]>([]);
  const [chatRooms, setChatRooms] = useState<ChatRoom[] | null>(null);
  const [notifications, setNotifications] = useState<NotificationDto[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setState('loading');
      const [sess, rep, chat, noti] = await Promise.allSettled([
        listSessions(), listReports(), listChatRooms(), listNotifications(true, 5),
      ]);
      if (cancelled) return;
      // 세션·리포트가 핵심 데이터. 둘 중 하나라도 실패하면 0건이 아니라 '불러오지 못함'으로 보인다.
      if (sess.status === 'rejected' || rep.status === 'rejected') { setState('error'); return; }
      setSessions(sess.value.sessions);
      setReports(rep.value.reports);
      setChatRooms(chat.status === 'fulfilled' ? chat.value.rooms : null);
      setNotifications(noti.status === 'fulfilled' ? noti.value.notifications : null);
      setState('ready');
    }
    void load();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const hostName = useCallback((s: SessionDto): string | undefined => counselors.find((c) => c.id === s.host_id)?.name, [counselors]);

  const now = new Date();
  const hero = useMemo(() => pickHeroClass(sessions), [sessions]);
  const weekFrom = weekStart(now);
  const weekFromMs = weekFrom.getTime();
  const weekTo = new Date(weekFromMs + 6 * DAY_MS);
  const weekRange = `${weekFrom.getMonth() + 1}.${weekFrom.getDate()}–${weekTo.getMonth() + 1}.${weekTo.getDate()}`;
  const weekSessions = useMemo(() => sessions
    .filter((s) => s.scheduled_at && s.status !== 'cancelled' && weekStart(new Date(s.scheduled_at)).getTime() === weekFromMs)
    .sort((a, b) => new Date(a.scheduled_at as string).getTime() - new Date(b.scheduled_at as string).getTime()),
  [sessions, weekFromMs]);
  const clientReports = useMemo(() => reports
    .filter((r) => r.type === 'client')
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()), [reports]);
  const newReportCount = clientReports.filter((r) => !r.is_read && !isReportInReview(r)).length;
  // '함께한 N회' = 이 회원의 세션 목록에서 상태가 completed 인 회차 수(서버가 내려준 값 그대로 계산).
  const pastCount = sessions.filter((s) => s.status === 'completed').length;
  const seqBySession = useMemo(() => new Map(sessions.map((s) => [s.id, s.seq ?? null])), [sessions]);
  const recentChats = useMemo(() => [...(chatRooms ?? [])]
    .sort((a, b) => (b.last_message_at ? new Date(b.last_message_at).getTime() : 0) - (a.last_message_at ? new Date(a.last_message_at).getTime() : 0))
    .slice(0, 3), [chatRooms]);
  const recentNotifications = useMemo(() => [...(notifications ?? [])]
    .filter((n) => !n.is_read)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3), [notifications]);

  // 초대된 클래스(조건부) — 운영과 같은 로직
  const invitedIds = useMemo(() => new Set(sessionInvites.map((i) => i.sessionId)), [sessionInvites]);
  const invitedSessions = useMemo(() => sessions.filter((s) => invitedIds.has(s.id) && s.status !== 'completed' && s.status !== 'cancelled'), [sessions, invitedIds]);
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  const refetched = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pending = sessionInvites.filter((inv) => !sessionsRef.current.some((s) => s.id === inv.sessionId) && !refetched.current.has(inv.sessionId));
    if (pending.length === 0) return;
    pending.forEach((inv) => refetched.current.add(inv.sessionId));
    let cancelled = false;
    listSessions().then((res) => { if (!cancelled) setSessions(res.sessions); })
      .catch(() => { pending.forEach((inv) => refetched.current.delete(inv.sessionId)); });
    return () => { cancelled = true; };
  }, [sessionInvites]);
  const confirmInvite = useCallback((sessionId: string) => {
    const invite = sessionInvites.find((i) => i.sessionId === sessionId);
    if (invite?.notificationId) void markRead(invite.notificationId).catch(() => { /* 조용히 실패 */ });
    removeSessionInvite(sessionId);
    navigate(`/app/sessions/${sessionId}`);
  }, [sessionInvites, removeSessionInvite, navigate]);

  if (state === 'loading') {
    return <div className="mh-legacy">{classSections}<div className="mh-legacy-state mh-state" role="status" aria-busy="true"><p>홈을 불러오고 있어요</p></div></div>;
  }
  if (state === 'error') {
    return <div className="mh-legacy">{classSections}<div className="mh-legacy-state mh-state" role="alert"><p>홈 정보를 불러오지 못했어요</p><button type="button" className="mh-btn" onClick={() => setReloadKey((k) => k + 1)}>다시 시도</button></div></div>;
  }

  let nextValue = '일정 없음';
  let nextNote = '예정된 클래스가 아직 없어요';
  if (nextAt) {
    const days = Math.round((startOfDay(new Date(nextAt)).getTime() - startOfDay(now).getTime()) / DAY_MS);
    nextValue = days > 0 ? `D-${days}` : days === 0 ? '오늘' : '지금';
    nextNote = `${shortDate(nextAt)} ${clock(nextAt)} 시작`;
  } else if (hero) {
    if (!hero.scheduled_at) { nextValue = '지금'; nextNote = '바로 입장할 수 있어요'; }
    else {
      const days = Math.round((startOfDay(new Date(hero.scheduled_at)).getTime() - startOfDay(now).getTime()) / DAY_MS);
      nextValue = days > 0 ? `D-${days}` : days === 0 ? '오늘' : '지금';
      nextNote = `${shortDate(hero.scheduled_at)} ${clock(hero.scheduled_at)} 시작`;
    }
  }
  const tiles: Tile[] = [
    { key: 'next', label: '다음 클래스', value: nextValue, note: nextNote, accent: !!(nextAt || hero), to: nextAt && nextHref ? nextHref : hero ? `/app/sessions/${hero.id}` : '/app/classes' },
    newReportCount > 0
      ? { key: 'report', label: '새 리포트', value: String(newReportCount), unit: '개', note: `${newReportCount}개 아직 읽지 않은 기록`, accent: true, to: '/app/reports' }
      : { key: 'report', label: '새 리포트', value: '없음', note: '아직 읽지 않은 기록이 없어요', to: '/app/reports' },
    weekSessions.length > 0
      ? { key: 'week', label: '이번 주', value: String(weekSessions.length), unit: '회', note: `이번 주 ${weekSessions.length}회 ${weekRange}`, to: '/app/classes' }
      : { key: 'week', label: '이번 주', value: '일정 없음', note: `이번 주 ${weekRange}`, to: '/app/classes' },
    pastCount > 0
      ? { key: 'past', label: '함께한 클래스', value: String(pastCount), unit: '회', note: '지난 회차 기준', to: '/app/reports' }
      : { key: 'past', label: '함께한 클래스', value: '아직 없음', note: '함께한 회차가 쌓이면 보여요', to: '/app/reports' },
  ];

  return (
    <div className="mh-legacy sh-scope">
      <SummaryTiles tiles={tiles} onOpen={(to) => navigate(to)} />
      {classSections}
      <div className="mh-main flex min-w-0 flex-col gap-6">
        {invitedSessions.length > 0 && (
          <section aria-label="초대된 클래스">
            <div className="mh-head"><h2>초대된 클래스</h2><span className="mh-count">{invitedSessions.length}건</span></div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {invitedSessions.map((s) => <InvitedSessionCard key={s.id} session={s} counselorName={hostName(s)} onConfirm={() => confirmInvite(s.id)} />)}
            </div>
          </section>
        )}

        <section aria-label="이번 주 클래스" data-testid="home-week">
          <div className="mh-head"><h2>이번 주 클래스</h2><span className="mh-count">{weekRange}</span></div>
          {weekSessions.length > 0 ? (
            <ul className="mh-list">
              {weekSessions.slice(0, 5).map((s) => {
                const d = new Date(s.scheduled_at as string);
                const host = hostName(s);
                return (
                  <li key={s.id}>
                    <Link className="mh-week-row" to={`/app/sessions/${s.id}`}>
                      <span className="mh-date" aria-hidden="true"><b>{d.getDate()}</b><small>{WEEKDAYS[d.getDay()]}</small></span>
                      <span className="mh-row-text"><strong>{s.title || '제목 없는 클래스'}</strong><small>{clock(s.scheduled_at as string)}{host ? ` · ${host} 코치` : ''}</small></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mh-plain">이번 주 예정된 클래스가 없어요. <Link to="/app/classes">클래스 보기</Link></p>
          )}
        </section>

        <section aria-label="내 리포트" data-testid="home-reports">
          <div className="mh-head"><h2>내 리포트</h2><Link className="mh-more" to="/app/reports">전체 보기</Link></div>
          {clientReports.length > 0 ? (
            <ul className="mh-list">
              {clientReports.slice(0, 3).map((r) => {
                const inReview = isReportInReview(r);
                const isNew = !r.is_read && !inReview;
                const processing = resolveReportGenerationStatus(r.generation_status) === 'processing';
                const seq = seqBySession.get(r.session_id);
                const headline = inReview ? null : adaptReportContent(r.content, 'client').headline?.trim() || null;
                const meta = [shortDate(r.created_at), seq != null ? `${seq}회차` : null].filter(Boolean).join(' · ');
                const body = (
                  <>
                    <span className="mh-row-text">
                      <small>{meta}{r.session_title && headline ? ` · ${r.session_title}` : ''}</small>
                      <strong className={headline ? 'mh-quote' : undefined}>{headline ?? (r.session_title || '리포트')}</strong>
                    </span>
                    <span className="mh-badges">
                      {isNew && <span className="mh-badge mh-badge--new">새 리포트</span>}
                      {inReview && <span className="mh-badge">코치 확인 중</span>}
                      {processing && !inReview && <span className="mh-badge">생성 중</span>}
                    </span>
                  </>
                );
                // 확인 중이거나 아직 id 가 없는 기록은 읽기 행동을 노출하지 않는다.
                return <li key={r.id ?? r.session_id}>{inReview || !r.id
                  ? <div className="mh-report-row" aria-disabled="true">{body}</div>
                  : <Link className="mh-report-row" to={`/app/reports?report=${r.id}`}>{body}</Link>}</li>;
              })}
            </ul>
          ) : (
            <p className="mh-plain">아직 받은 리포트가 없어요. 클래스가 끝나면 이곳에 기록이 도착해요.</p>
          )}
        </section>
      </div>

      <div className="mh-rail flex min-w-0 flex-col gap-6 lg:gap-5">
        <section className="home-rail-card" aria-label="최근 대화" data-testid="home-chats">
          <div className="mh-head"><h2>최근 대화</h2><Link className="mh-more" to="/app/chat">전체</Link></div>
          {chatRooms === null ? <p className="mh-plain" role="alert">대화를 불러오지 못했어요</p>
            : recentChats.length > 0 ? (
              <ul className="mh-list">
                {recentChats.map((room) => {
                  const name = room.display_name || room.peer_name || '코치';
                  const unread = room.unread_count ?? 0;
                  return (
                    <li key={room.id}>
                      <button type="button" className="mh-msg-row" onClick={() => navigate(`/app/chat/${room.id}`)}>
                        <span className="mh-initial" aria-hidden="true">{name.charAt(0)}</span>
                        <span className="mh-row-text">
                          <strong>{name}</strong>
                          <span className="mh-preview">{room.last_message?.content || '아직 주고받은 메시지가 없어요'}</span>
                        </span>
                        <span className="mh-side"><small>{relativeTime(room.last_message_at)}</small>{unread > 0 && <span className="mh-unread"><i aria-hidden="true" />읽지 않음 {unread}</span>}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="mh-plain">담당 코치와 연결하면 이곳에서 대화할 수 있어요.</p>}
        </section>

        <section className="home-rail-card" aria-label="새 알림" data-testid="home-notifications">
          <div className="mh-head"><h2>새 알림</h2><Link className="mh-more" to="/app/notifications">전체</Link></div>
          {notifications === null ? <p className="mh-plain" role="alert">알림을 불러오지 못했어요</p>
            : recentNotifications.length > 0 ? (
              <ul className="mh-list">
                {recentNotifications.map((n) => (
                  <li key={n.id}>
                    <button type="button" className="mh-msg-row" onClick={() => navigate('/app/notifications')}>
                      <span className="mh-dot" aria-hidden="true" />
                      <span className="mh-row-text">
                        <strong>{n.title}</strong>
                        {n.body && <span className="mh-preview">{n.body}</span>}
                      </span>
                      <span className="mh-side"><small>{relativeTime(n.created_at)}</small><span className="mh-unread">읽지 않음</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="mh-plain">읽지 않은 알림이 없어요.</p>}
        </section>
      </div>
    </div>
  );
}
