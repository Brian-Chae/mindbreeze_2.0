// SDD-318 — 홈(D안). 데이터는 기존 읽기 훅/API 를 그대로 쓰고 표현만 새로 만든다.
import { heroBackdrop } from '../../../components/class/flow/shell/shell-data';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UiV2ClientShell } from '../../../components/ui-v2/ui-v2-client-shell';
import { UiV2ArcRing } from '../../../components/ui-v2/ui-v2-arc-ring';
import { CodeEntryButton } from '../../../components/client/code-entry-button';
import { CounselorSection } from '../../../components/client/counselor-section';
import { InvitedSessionCard } from '../../../components/client/InvitedSessionCard';
import { memberDate, memberValue } from '../../../components/class/structure/member-class-views';
import { useClientCounselors } from '../../../hooks/use-client-counselors';
import { useMixedHome } from '../../../hooks/use-class-structure';
import { adaptMixedHome } from '../../../lib/class-structure/adapters';
import { counselingPath } from '../../../lib/class-structure/navigation';
import type { RelationshipId } from '../../../lib/class-structure/read-model';
import { displayField } from '../../../lib/class-structure/read-model';
import { listSessions, type SessionDto } from '../../../lib/api/session';
import { listReports, type ReportDto } from '../../../lib/api/reports';
import { listNotifications, markRead, type NotificationDto } from '../../../lib/api/notifications';
import { listChatRooms, type ChatRoom } from '../../../lib/api/chat';
import { isCounselingEnabled } from '../../../lib/feature-flags';
import { isReportInReview, REPORT_IN_REVIEW_BADGE } from '../../../lib/report-review-copy';
import { useAuthStore } from '../../../stores/authStore';
import { useNotificationStore } from '../../../stores/notificationStore';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');

function parts(iso: string | undefined) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return { d, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, day: pad(d.getDate()), month: `${d.getMonth() + 1}월`, weekday: WEEKDAYS[d.getDay()] };
}

function relative(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  return day < 7 ? `${day}일 전` : new Date(iso).toLocaleDateString('ko-KR');
}

export function UiV2HomePage() {
  useClientCounselors();
  const navigate = useNavigate();
  const read = useMixedHome();
  const model = adaptMixedHome(read.classes, read.counseling);
  const name = useAuthStore((s) => s.user?.name);
  const counselors = useAuthStore((s) => s.user?.counselors);
  const sessionInvites = useNotificationStore((s) => s.sessionInvites);
  const removeSessionInvite = useNotificationStore((s) => s.removeSessionInvite);
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [reports, setReports] = useState<ReportDto[]>([]);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [extraError, setExtraError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listSessions().then((r) => r.sessions).catch(() => null),
      listReports().then((r) => r.reports).catch(() => null),
      listNotifications(true, 5).then((r) => r.notifications).catch(() => [] as NotificationDto[]),
      listChatRooms().then((r) => r.rooms).catch(() => [] as ChatRoom[]),
    ]).then(([s, r, n, c]) => {
      if (cancelled) return;
      if (s === null || r === null) setExtraError(true);
      setSessions(s ?? []); setReports(r ?? []); setNotifications(n); setRooms(c);
    });
    return () => { cancelled = true; };
  }, []);

  const next = memberValue(model.next);
  const nextTime = parts(next?.scheduledAt);
  const nextSeq = next ? memberValue(next.seq) : undefined;
  const isOpen = next?.open === true;
  const upcoming = model.upcoming.slice(0, 4);
  const clientReports = useMemo(() => reports.filter((r) => r.type === 'client')
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()).slice(0, 2), [reports]);
  const invited = useMemo(() => {
    const ids = new Set(sessionInvites.map((i) => i.sessionId));
    return sessions.filter((s) => ids.has(s.id) && s.status !== 'completed' && s.status !== 'cancelled');
  }, [sessions, sessionInvites]);
  const unreadNotifications = notifications.filter((n) => !n.is_read).slice(0, 3);
  const recentRooms = useMemo(() => [...rooms].sort((a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime()).slice(0, 3), [rooms]);
  const confirmInvite = useCallback((sessionId: string) => {
    const invite = sessionInvites.find((i) => i.sessionId === sessionId);
    if (invite?.notificationId) void markRead(invite.notificationId).catch(() => { /* 조용히 실패 */ });
    removeSessionInvite(sessionId);
    navigate(`/app/sessions/${sessionId}`);
  }, [sessionInvites, removeSessionInvite, navigate]);
  const counselorName = (s: SessionDto) => counselors?.find((c) => c.id === s.host_id)?.name;
  const classes = model.classes.status === 'success' ? model.classes.data.classes : [];
  const counseling = model.counseling.status === 'success' ? model.counseling.data.relationships : [];
  const loading = read.classes.status === 'loading';
  const heroHref = next ? (isOpen ? `/class/${encodeURIComponent(next.sessionId)}/enter` : next.area === 'meditation' ? `/app/classes/${encodeURIComponent(next.parentId)}` : counselingPath('member', next.parentId as RelationshipId)) : '/app/classes';

  return (
    <UiV2ClientShell title="나에게 돌아오는 시간" subtitle={`${name ?? '내담자'}님, 오늘의 클래스와 기록을 만나보세요.`}>
      <section className="u2-card u2-hero u2-hero--nature" data-testid="class-hero" aria-label="다음 일정" style={{ backgroundImage: `linear-gradient(160deg,rgba(37,16,56,.35),rgba(37,16,56,.72) 55%,rgba(37,16,56,.92)),url(${heroBackdrop(next?.parentId ?? 'home')})` }}>
        <UiV2ArcRing variant="hero" />
        <span className="u2-eyebrow">{isOpen ? '지금 입장 가능' : '다음 클래스'}</span>
        {next && nextTime ? <>
          <div className="u2-num">{nextTime.time}</div>
          <small>{nextTime.month} {Number(nextTime.day)}일 {nextTime.weekday}요일</small>
          <h2>{memberValue(next.title) ?? '클래스'}</h2>
          <p className="u2-muted">{nextSeq != null ? `${nextSeq}회차 · ` : ''}{next.area === 'meditation' ? '지도사' : '코치'} {memberValue(next.hostName) ?? '확인 중'}</p>
          <Link className="u2-primary" to={heroHref}>{isOpen ? '입장하기' : '클래스 보기'}<span aria-hidden="true" style={{ marginLeft: 'auto' }}>↗</span></Link>
        </> : <>
          <h2 className="u2-gap">{loading ? '일정을 확인하고 있어요' : model.nextIsComplete ? '예정된 일정이 없어요' : '확인된 예정 일정이 없어요'}</h2>
          <Link className="u2-primary" to="/app/classes">내 클래스 보기</Link>
        </>}
      </section>
      <div className="u2-gap"><CodeEntryButton placement="inline" /></div>

      {invited.length > 0 && <section aria-label="초대된 클래스">
        <div className="u2-section-head u2-row"><h2>초대된 클래스</h2><small>{invited.length}건</small></div>
        {invited.map((s) => <div key={s.id} style={{ marginBottom: 12 }}><InvitedSessionCard session={s} counselorName={counselorName(s)} onConfirm={() => confirmInvite(s.id)} /></div>)}
      </section>}

      <div className="u2-section-head u2-row"><h2>이번 주 클래스</h2><Link className="u2-textlink" to="/app/classes">전체 보기 ›</Link></div>
      {(next ? [{ ...next, key: next.sessionId }, ...upcoming.map((u) => ({ ...u, key: u.sessionId }))] : upcoming.map((u) => ({ ...u, key: u.sessionId }))).slice(0, 4).map((item) => {
        const t = parts(item.scheduledAt);
        return <Link key={item.key} className="u2-listrow" to={item.area === 'meditation' ? `/app/classes/${encodeURIComponent(item.parentId)}` : counselingPath('member', item.parentId as RelationshipId)}>
          <div className="u2-date">{t?.day ?? '--'}<small>{t?.month ?? ''}</small></div>
          <div className="u2-body"><h3>{memberValue(item.title) ?? '클래스'}</h3><p>{t?.time ?? memberDate(displayField(item.scheduledAt)) ?? ''}{memberValue(item.seq) != null ? ` · ${memberValue(item.seq)}회차` : ''}</p></div>
          <span className="u2-chev" aria-hidden="true">›</span>
        </Link>;
      })}
      {!next && upcoming.length === 0 && <p className="u2-empty">이번 주 예정된 클래스가 없어요. 코치에게 클래스를 신청해 보세요.</p>}
      {classes.length > 0 && <p className="u2-footnote">참여 중인 클래스 {classes.length}개</p>}

      <div className="u2-section-head u2-row"><h2>최근 리포트</h2><Link className="u2-textlink" to="/app/reports">전체 보기 ›</Link></div>
      {clientReports.length > 0 ? clientReports.map((r) => {
        const inReview = isReportInReview(r);
        const unread = !r.is_read && !inReview;
        return <Link key={r.id ?? r.session_id} className="u2-card" to={r.id ? `/app/reports?report=${r.id}` : '/app/reports'}>
          <span className="u2-chip">{inReview ? REPORT_IN_REVIEW_BADGE : unread ? '안 읽음' : '읽음'}</span>
          <h2 style={{ marginTop: 12, fontSize: 21 }}>{(!inReview && typeof r.content?.headline === 'string' && r.content.headline.trim()) || r.session_title || '리포트'}</h2>
          <p className="u2-muted" style={{ fontSize: 13 }}>{[(!inReview && r.session_title) || '', r.counselor_name ? `지도사 ${r.counselor_name}` : '', r.created_at ? new Date(r.created_at).toLocaleDateString('ko-KR') : ''].filter(Boolean).join(' · ')}</p>
          {!inReview && typeof r.content?.summary === 'string' && r.content.summary.trim() && <p className="u2-muted" style={{ fontSize: 14, lineHeight: 1.75 }}>{r.content.summary}</p>}
        </Link>;
      }) : <p className="u2-empty">아직 리포트가 없어요</p>}

      {isCounselingEnabled() && <>
        <div className="u2-section-head u2-row"><h2>내 상담</h2><Link className="u2-textlink" to="/app/counseling">전체 보기 ›</Link></div>
        {counseling.map((item) => <Link key={item.id} className="u2-card" to={counselingPath('member', item.id)}><h3>상담 일정</h3><p className="u2-muted">코치 · {memberValue(item.counselorName) ?? '확인 중'}</p></Link>)}
      </>}

      <div className="u2-section-head"><h2>새 알림</h2></div>
      {unreadNotifications.length > 0 ? unreadNotifications.map((n) => <Link key={n.id} className="u2-card" to="/app/notifications"><h3>{n.title}</h3>{n.body && <p className="u2-muted">{n.body}</p>}<small>{relative(n.created_at)}</small>{n.type === 'report' && <span className="u2-textlink" aria-hidden="true">리포트 확인 ›</span>}</Link>) : <p className="u2-empty">새로운 알림이 없어요</p>}
      <div className="u2-card u2-coachcard"><CounselorSection /></div>
      <div className="u2-section-head u2-row"><h2>최근 대화</h2><Link className="u2-textlink" to="/app/chat">전체 ›</Link></div>
      {recentRooms.length > 0 ? recentRooms.map((room) => <Link key={room.id} className="u2-listrow" to={`/app/chat/${room.id}`}>
        <div className="u2-body"><h3>{room.display_name || room.peer_name || '코치'}{(room.unread_count ?? 0) > 0 ? ` · ${room.unread_count}` : ''}</h3><p>{room.last_message?.content || '새로운 대화가 없어요'}</p></div><small>{relative(room.last_message_at ?? null)}</small>
      </Link>) : <p className="u2-empty">새로운 대화가 없어요</p>}
      {(extraError || read.classes.status === 'error') && <div className="u2-alert" role="alert"><p>일부 정보를 불러오지 못했어요.</p><button type="button" className="u2-secondary u2-gap" onClick={read.retry}>다시 시도</button></div>}
    </UiV2ClientShell>
  );
}
