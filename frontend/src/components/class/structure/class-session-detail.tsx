import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useClassDetail } from '../../../hooks/use-class-structure';
import { asClassId } from '../../../lib/class-structure/read-model';
import { useAuthStore } from '../../../stores/authStore';
import { getSession, type SessionDto } from '../../../lib/api/session';
import { StructureShell } from './structure-shell';
import { ReadStateView } from './read-state';
import { ClassHostRequests } from './class-host-requests';
import { ClassTeamRecord } from './class-team-record';
import { ClassObserverView } from './class-observer-view';
import { operationButton } from './class-operation-state';
const statuses:Record<string,string>={ready:'준비',scheduled:'예정',open:'입장 중',in_progress:'진행 중',completed:'완료',cancelled:'취소'};
export function ClassSessionDetail({classId,sessionId}:{classId:string;sessionId:string}) {
 const location=useLocation();
 const {state,retry}=useClassDetail(asClassId(classId));const user=useAuthStore(s=>s.user);
 const detail=state.status==='success'?state.data.detail:null;const session=state.status==='success'?state.data.sessions.sessions.find(s=>s.id===sessionId):null;
 const isHost=Boolean(user?.role==='counselor'&&user?.id===session?.host?.id);const admin=user?.role==='org_admin';
 const instructor=detail?.host_view?.instructors.find(i=>i.user_id===user?.id&&i.status==='active');
 const [fullSession,setFullSession]=useState<SessionDto|null>(null);const [peopleError,setPeopleError]=useState('');const [copied,setCopied]=useState(false);
 useEffect(()=>{let active=true;setFullSession(null);if(isHost)void getSession(sessionId).then(s=>{if(active){setFullSession(s);setPeopleError('');}}).catch(()=>{if(active)setPeopleError('참여자 목록을 불러오지 못했어요.');});return()=>{active=false;};},[sessionId,isHost,session?.status]);

 const manager=detail?.capabilities?.schedule===true;
 return <StructureShell role="host" title="회차 상세" rightSlot={<Link to={`/classes/${classId}/sessions`} className={operationButton}>편성으로 이동</Link>}><ReadStateView status={state.status==='success'&&!session?'not_found':state.status} onRetry={retry} backTo={`/classes/${classId}`}>{detail&&session&&<div className="mx-auto max-w-5xl space-y-6 pb-8"><section className="rounded-3xl bg-[#f1e8df] p-7 md:p-9"><Link to={`/classes/${classId}`} className="text-sm text-[#786b60]">{detail.title??'명상 클래스'}</Link><div className="mt-4 flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-semibold">{session.seq??'번호 미확인'}회차 {session.session_kind==='makeup'&&'· 보강'}</h1><span className="rounded-full bg-white/80 px-4 py-2 text-sm">{statuses[session.status]??'상태 미확인'}</span></div><p className="mt-4">{session.scheduled_at?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'long',timeStyle:'short'}).format(new Date(session.scheduled_at)):'일정 미확인'} · {session.duration_min??'시간 미확인'}분</p><p className="mt-2">진행 지도사 · {session.host_state==='needs_reassign'?'재배정이 필요해요':session.host_state==='pending_ack'?'새 지도사 수락 대기':session.host?.name??'이름 미확인'}</p>{session.host_state==='needs_reassign'&&<p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3">지도사 계정 또는 소속이 변경됐어요. 주강사·센터 관리자가 진행자를 다시 배정해 주세요.</p>}
 <div className="mt-6 flex flex-wrap gap-3"><button className={operationButton} onClick={retry}>상태 새로고침</button>{isHost&&session.host_state==='assigned'&&['ready','scheduled','open','in_progress'].includes(session.status)&&<Link className={`${operationButton} bg-purple-800 text-white`} to={`/sessions/${sessionId}/player`}>진행 화면으로</Link>}{isHost&&session.status==='completed'&&<Link className={operationButton} to={`/sessions/${sessionId}/record`}>기록과 리포트</Link>}<Link className={operationButton} to={`/classes/${classId}/sessions`}>{manager?'일정·장소·취소 편성':'회차 목록'}</Link></div></section>
 <div className="grid gap-6 md:grid-cols-2"><section className="space-y-3 rounded-2xl border border-[#e5dfd6] bg-white p-6"><h2 className="font-semibold">참여 안내</h2><p>{session.location_type==='offline'?'오프라인':'온라인'} · {session.location_address??(session.location_type==='online'?'온라인 참여':'장소 미확인')}</p>{detail.host_view?.access_code&&<><p className="text-sm text-gray-500">클래스 입장 코드</p><p className="font-mono text-3xl tracking-widest">{detail.host_view.access_code}</p><button className={operationButton} onClick={()=>void navigator.clipboard.writeText(detail.host_view!.access_code!).then(()=>setCopied(true)).catch(()=>setPeopleError('코드를 복사하지 못했어요. 직접 선택해 주세요.'))}>{copied?'복사했어요':'코드 복사'}</button></>}</section><section className="space-y-3 rounded-2xl border border-[#e5dfd6] bg-white p-6"><h2 className="font-semibold">참여자</h2>{isHost?fullSession?<ul className="divide-y">{fullSession.participants.map((p,index)=><li key={p.participant_id??p.user_id??index} className="py-2">{p.user_name??p.guest_name??'이름 미확인'}{p.is_waitlisted?' · 대기':''}</li>)}</ul>:<p>참여자 목록을 불러오는 중이에요.</p>:<p className="text-sm text-gray-500">회차의 참여자 상세는 진행 지도사가 확인해요.</p>}{detail.capabilities?.invite&&<Link className={operationButton} to={`/classes/${classId}?tab=members`}>클래스 멤버 관리</Link>}{peopleError&&<p role="alert">{peopleError}</p>}</section></div>
 {(manager||instructor)&&<ClassHostRequests instructorIds={detail.host_view?.instructors.filter(i=>i.status==='active').map(i=>i.user_id)} requestId={new URLSearchParams(location.search).get('requestId')} classId={classId} sessionId={sessionId} revision={detail.revision} stateVersion={session.state_version} status={session.status} hostId={session.host?.id??null} manager={manager} onSaved={retry}/>}
 {!admin&&!isHost&&instructor&&['lead','assistant'].includes(instructor.role)&&['open','in_progress'].includes(session.status)&&<ClassObserverView key={sessionId} classId={classId} sessionId={sessionId}/>}
 {!admin&&!isHost&&instructor&&session.status==='completed'&&<ClassTeamRecord key={sessionId} sessionId={sessionId}/>}
 {admin&&<p className="text-sm text-gray-500">센터 관리자는 편성과 재배정을 대행할 수 있어요. 수업 진행·기록 수정·리포트 승인은 진행 지도사가 맡아요.</p>}</div>}</ReadStateView></StructureShell>;
}
