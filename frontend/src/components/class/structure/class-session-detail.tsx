import { useEffect, useState } from 'react';
import { CalendarDays, Clock3, DoorOpen, FileText, RefreshCw, UserRound } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useClassDetail } from '../../../hooks/use-class-structure';
import { asClassId } from '../../../lib/class-structure/read-model';
import { useAuthStore } from '../../../stores/authStore';
import { getSession, type SessionDto } from '../../../lib/api/session';
import { StructureShell } from './structure-shell';
import { ReadStateView } from './read-state';
import { ClassHostRequests } from './class-host-requests';
import { ClassHostCorrection } from './class-host-correction';
import { ClassReportTab } from './class-report-tab';
import { ClassTeamReports } from './class-team-reports';
import { ClassTeamRecord } from './class-team-record';
import { ClassObserverView } from './class-observer-view';
import { ClassSessionCancel } from './class-session-cancel';
import { operationButton } from './class-operation-state';
import './class-operations.css';

const statuses: Record<string, string> = { ready: '준비', scheduled: '예정', open: '입장 중', in_progress: '진행 중', completed: '완료', cancelled: '취소' };
export function ClassSessionDetail({ classId, sessionId }: { classId: string; sessionId: string }) {
  const location = useLocation();
  const { state, retry } = useClassDetail(asClassId(classId));
  const user = useAuthStore(s => s.user);
  const detail = state.status === 'success' ? state.data.detail : null;
  const session = state.status === 'success' ? state.data.sessions.sessions.find(s => s.id === sessionId) : null;
  const isHost = Boolean(user?.role === 'counselor' && user?.id === session?.host?.id);
  const admin = user?.role === 'org_admin';
  const instructor = detail?.host_view?.instructors.find(i => i.user_id === user?.id && i.status === 'active');
  const [fullSession, setFullSession] = useState<SessionDto | null>(null);
  const [peopleError, setPeopleError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true; setFullSession(null); setPeopleError(''); setCopied(false);
    if (isHost) void getSession(sessionId).then(s => { if (active) setFullSession(s); }).catch(() => { if (active) setPeopleError('참여자 목록을 불러오지 못했어요.'); });
    return () => { active = false; };
  }, [sessionId, isHost, session?.status]);
  const manager = detail?.capabilities?.schedule === true;
  // 현재 클래스 설정으로 추정하지 않고 표시 중인 회차에 저장된 값만 사용한다.
  const snapshot = isHost ? fullSession?.id === sessionId ? fullSession : null : session;
  const recordAudio = snapshot && 'record_audio' in snapshot && typeof snapshot.record_audio === 'boolean' ? snapshot.record_audio : null;
  const linkbandMode = snapshot && 'linkband_mode' in snapshot ? snapshot.linkband_mode : null;
  const recordingLabel = recordAudio === null ? '음성 녹음 미확인' : recordAudio ? '음성 녹음' : '음성 녹음 안 함';
  const bandLabel = linkbandMode === 'optional' ? 'LINK BAND 선택' : linkbandMode === 'none' ? 'LINK BAND 사용 안 함' : linkbandMode === 'required' ? 'LINK BAND 필수' : 'LINK BAND 미확인';
  const guide = session?.host_state === 'needs_reassign' ? ['진행 지도사 재배정이 필요해요', '주강사·센터 관리자가 진행자를 다시 배정하면 회차를 열 수 있어요.']
    : session?.host_state === 'pending_ack' ? ['새 지도사의 수락을 기다리고 있어요', '수락한 뒤에 새 진행 지도사가 회차를 열 수 있어요.']
    : session?.status === 'cancelled' ? ['이 회차는 취소됐어요', '회차 번호는 그대로 유지해요. 필요한 경우 편성에서 보강을 추가할 수 있어요.']
    : session?.status === 'completed' ? ['회차가 완료됐어요', '제공된 기록과 리포트는 아래에서 확인해요.']
    : ['open', 'in_progress'].includes(session?.status ?? '') ? ['진행 화면에서 이어가세요', '진행 지도사가 입장과 수업 진행을 관리해요.']
    : [isHost ? '진행 화면에서 회차를 준비해요' : `${session?.host?.name ?? '진행 지도사'} 지도사가 진행해요`, '회차 열기와 시작은 배정된 진행 지도사가 맡아요.'];
  return <StructureShell role="host" title={detail && session ? `${detail.title ?? '명상 클래스'} · ${session.seq ?? '미확인'}회차` : '회차 상세'} rightSlot={<Link to={`/classes/${classId}`} className={operationButton}>클래스 개요</Link>}>
    <ReadStateView status={state.status === 'success' && !session ? 'not_found' : state.status} onRetry={retry} backTo={`/classes/${classId}`}>
      {detail && session && <div className="co-session-page">
        <section className="co-session-hero" style={{ backgroundImage: 'url(/images/background8.webp)' }} aria-label="회차 진행 상태">
          <div className="co-hero-main">
            <div><span className="co-status"><CalendarDays size={16} aria-hidden="true"/>{statuses[session.status] ?? '상태 미확인'}</span></div>
            <h1>{session.seq ?? '번호 미확인'}회차{session.session_kind === 'makeup' && ' · 보강'}</h1>
            <p className="co-when"><CalendarDays size={20} aria-hidden="true"/>{session.scheduled_at ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long', timeStyle: 'short' }).format(new Date(session.scheduled_at)) : '일정 미확인'} · {session.duration_min ?? '시간 미확인'}분</p>
            <div className="co-next" role={session.host_state === 'needs_reassign' ? 'alert' : undefined}><Clock3 size={24} aria-hidden="true"/><div><strong>{guide[0]}</strong><p>{guide[1]}</p></div></div>
          </div>
          <div className="co-hero-actions">
            {isHost && session.host_state === 'assigned' && ['ready', 'scheduled', 'open', 'in_progress'].includes(session.status) && <Link className="co-primary" to={`/sessions/${sessionId}/player`}><DoorOpen size={20} aria-hidden="true"/>진행 화면으로</Link>}
            {isHost && session.status === 'completed' && <Link className="co-primary" to={`/sessions/${sessionId}/record`}><FileText size={20} aria-hidden="true"/>기록과 리포트</Link>}
            {manager && session.host_state === 'needs_reassign' && <Link className="co-primary" to={`/classes/${classId}/schedule`}>진행 지도사 정하기</Link>}
            {manager && session.status === 'cancelled' && <Link className="co-primary" to={`/classes/${classId}/schedule`}>보강 회차 추가</Link>}
          </div>
        </section>
        <div className="co-grid">
          <section className="co-card"><h2>참여자{isHost && fullSession ? ` · ${fullSession.participants.length}명` : ''}</h2>
            {isHost ? fullSession ? fullSession.participants.length ? <ul className="co-people">{fullSession.participants.map((p, index) => {
              const name = p.user_name ?? p.guest_name ?? '이름 미확인';
              return <li key={p.participant_id ?? p.user_id ?? index}><span className="co-avatar" aria-hidden="true">{name.slice(0, 1)}</span><div><strong>{name}</strong>{p.is_waitlisted && <small>대기</small>}</div></li>;
            })}</ul> : <p className="co-note">등록된 참여자가 없어요.</p> : <p>참여자 목록을 불러오는 중이에요.</p> : <p className="co-note">회차의 참여자 상세는 진행 지도사가 확인해요.</p>}
            {detail.capabilities?.invite && <Link className={operationButton} to={`/classes/${classId}?tab=members`}>클래스 멤버 관리</Link>}
            {peopleError && <p role="alert">{peopleError}</p>}
          </section>
          <div className="co-stack">
            <section className="co-card co-info"><h2 className="sr-only">참여 안내</h2><dl>
              {detail.host_view?.access_code && <div><dt>클래스 코드</dt><dd><strong className="co-code">{detail.host_view.access_code}</strong><button className={operationButton} onClick={() => void navigator.clipboard.writeText(detail.host_view!.access_code!).then(() => setCopied(true)).catch(() => setPeopleError('코드를 복사하지 못했어요. 직접 선택해 주세요.'))}>{copied ? '복사했어요' : '코드 복사'}</button></dd></div>}
              <div><dt>진행 지도사</dt><dd><UserRound size={18} aria-hidden="true"/>{session.host_state === 'needs_reassign' ? '재배정 필요' : session.host_state === 'pending_ack' ? '수락 대기' : session.host?.name ?? '이름 미확인'}</dd></div>
              <div><dt>장소</dt><dd>{session.location_type === 'offline' ? session.location_address ?? '장소 미확인' : session.location_type === 'online' ? '온라인' : '방식 미확인'}</dd></div>
              <div><dt>기록</dt><dd>{recordingLabel} · {bandLabel}</dd></div>
            </dl><div className="co-info-actions"><Link className={operationButton} to={`/classes/${classId}/${manager ? 'schedule' : 'sessions'}`}>{manager ? '일정·장소 편집' : '회차 목록'}</Link><ClassSessionCancel detail={detail} session={session} admin={admin} onSaved={retry}/></div></section>
            <section className="co-card"><h2>기록</h2><p className="co-note">{session.status === 'completed' ? '역할에 따라 제공되는 기록과 리포트를 확인해요.' : session.status === 'cancelled' ? '취소된 회차예요. 다른 회차의 기록은 클래스에서 확인해요.' : '회차가 끝난 뒤에 기록과 리포트가 만들어져요. 녹음 동의는 멤버가 시작 전에 선택해요.'}</p>{isHost && session.status === 'completed' && <Link className={operationButton} to={`/sessions/${sessionId}/record`}>기록 보기</Link>}</section>
          </div>
        </div>
        {detail.capabilities?.host_request === true && <ClassHostRequests teamCandidates={detail.host_view?.instructors.filter(i => i.status === 'active').map(i => ({ id: i.user_id, name: i.name }))} instructorIds={detail.host_view?.instructors.filter(i => i.status === 'active').map(i => i.user_id)} requestId={new URLSearchParams(location.search).get('requestId')} classId={classId} sessionId={sessionId} revision={detail.revision} stateVersion={session.state_version} status={session.status} hostId={session.host?.id ?? null} manager={manager} onSaved={retry}/>}
        {!admin && !isHost && instructor && ['lead', 'assistant'].includes(instructor.role) && ['open', 'in_progress'].includes(session.status) && <ClassObserverView key={sessionId} classId={classId} sessionId={sessionId}/>}
        {manager && session.status === 'completed' && <ClassHostCorrection classId={classId} sessionId={sessionId} revision={detail.revision} stateVersion={session.state_version} instructors={detail.host_view?.instructors.filter(i => i.status === 'active') ?? []} onSaved={retry}/>}
        {!isHost && (admin || instructor) && session.status === 'completed' && <ClassReportTab key={`reports:${classId}`} classId={classId} sessions={state.status === 'success' ? state.data.sessions.sessions : []}/>}
        {/* SDD-219: 리포트 본문 열람(회차 단위)은 기존 화면을 유지한다. 관리 화면(클래스 단위)과 함께 노출 */}
        {!isHost && (admin || instructor) && session.status === 'completed' && <ClassTeamReports key={`reports:${sessionId}`} classId={classId} sessionId={sessionId}/>}
        {!admin && !isHost && instructor && session.status === 'completed' && <ClassTeamRecord key={sessionId} sessionId={sessionId}/>}
        <div className="co-refresh"><button className={operationButton} onClick={retry}><RefreshCw size={16} aria-hidden="true"/>상태 새로고침</button><Link className={operationButton} to={`/classes/${classId}/sessions`}>회차 목록</Link></div>
        {admin && <p className="co-note">센터 관리자는 편성과 재배정을 대행할 수 있어요. 수업 진행·기록 수정·리포트 승인은 진행 지도사가 맡아요.</p>}
      </div>}
    </ReadStateView>
  </StructureShell>;
}
