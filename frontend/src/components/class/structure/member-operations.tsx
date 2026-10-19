import { membershipLabels } from './member-class-views';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMyClassAttendance, useMyClassMembership } from '../../../hooks/use-class-structure';
import { membershipApi, type CredentialBundle, type MemberConsents, type MyMembership } from '../../../lib/api/class-operations';
import { useAuthStore } from '../../../stores/authStore';
import { operationButton, operationInput } from './class-operation-state';
import { useMembershipOperation, membershipError } from './membership-operation-state';
import { invalidateClassReads } from '../../../lib/class-structure/invalidation';
import { RESEARCH_NOTICE_VERSION, reportNoticeVersion } from '../../../lib/class/flow/member-prep';
import { saveEntry } from '../../../lib/api/class-flow';
import ClientReportViewer from '../../reports/ClientReportViewer';
import type { ReportDto } from '../../../lib/api/reports';
const attendanceLabels:Record<string,string>={expected:'참여 예정',attended:'참석',absent:'결석',excused:'사전 결석',withdrawn:'참여 취소'};
interface Props {classId:string;credential?:string;readCredential?:string;onCredentials?:(bundle:CredentialBundle|null)=>void;onActivityUnauthorized?:()=>void}
export function MemberOperations(props:Props){
 const user=useAuthStore(s=>s.user);
 return <MemberOperationsState key={`${props.classId}:${user?.id}:${user?.role}:${props.credential}`} {...props}/>;
}
function MemberOperationsState({classId,credential,readCredential,onCredentials,onActivityUnauthorized}:Props){
 const own=useMyClassMembership(classId,credential),attendance=useMyClassAttendance(classId,credential);
 const data=own.state.status==='success'?own.state.data:null;
 const sessions=attendance.state.status==='success'?attendance.state.data.sessions:[];
 const operation=useMembershipOperation(data?.revision);
 const [code,setCode]=useState(''),[source,setSource]=useState(''),[target,setTarget]=useState(''),[reason,setReason]=useState('');
 const [report,setReport]=useState<ReportDto|null>(null),[reportError,setReportError]=useState(''),[reportBusy,setReportBusy]=useState(false);
 const reportController=useRef<AbortController|null>(null);useEffect(()=>()=>reportController.current?.abort(),[]);
 useEffect(()=>{
  if(credential!==undefined&&credential!==readCredential&&(own.errorStatus===401||attendance.errorStatus===401))onActivityUnauthorized?.();
 },[credential,readCredential,own.errorStatus,attendance.errorStatus,onActivityUnauthorized]);
 const navigate=useNavigate();
 const reload=()=>{operation.reset();invalidateClassReads();own.retry();attendance.retry();};
 if(own.state.status==='loading')return <section className="mc-card" role="status">내 참여 정보를 불러오는 중이에요.</section>;
 if(!data)return <section className="mc-card"><p role="alert">내 참여 정보를 확인할 수 없어요. 자격과 연결을 확인해 주세요.</p><button className={operationButton} onClick={reload}>최신 내용 다시 불러오기</button></section>;
 const caps=data.capabilities;
 const transition=(action:string)=>void operation.run(`transition:${action}`,command=>membershipApi.transition(classId,data.member.id,{...command,action},credential)).then(result=>{if(result?.credential_bundle!==undefined)onCredentials?.(result.credential_bundle);});
 const entry=(sessionId:string)=>void operation.run(`entry:${sessionId}`,command=>membershipApi.guestEntry(classId,sessionId,command,credential!)).then(result=>{
   if(!result)return;
   saveEntry({sessionId:result.session_id,credential:result.entry_credential,participantId:result.participant_id,expiresAt:result.expires_at,isGuest:true});
   navigate(`/class/${encodeURIComponent(result.session_id)}/enter`);
 });
 const showReport=async(id:string)=>{if(reportBusy)return;setReportBusy(true);setReportError('');const controller=new AbortController();reportController.current?.abort();reportController.current=controller;
  try{const result=await membershipApi.report(id,readCredential??credential,controller.signal);if(!controller.signal.aborted)setReport(result);}catch(e){if(!controller.signal.aborted)setReportError(membershipError(e));}finally{if(!controller.signal.aborted)setReportBusy(false);}};
 return <section aria-label="내 클래스 참여 관리" className="mc-card space-y-5">
  <div className="mc-row"><h2>내 참여 정보</h2><span className="mc-chip">{membershipLabels[data.member.status]??data.member.status}{data.member.status==='waitlisted'&&data.member.waitlist_position!=null?` · ${data.member.waitlist_position}번`:''}</span></div>
  <p className="mc-muted">참석 {data.attendance_summary.attended} · 결석 {data.attendance_summary.absent} · 사전 결석 {data.attendance_summary.excused} · 보강 예약 {data.attendance_summary.makeup_reserved} · 보강 완료 {data.attendance_summary.makeup_completed}</p>
  <div className="flex flex-wrap gap-3">
   {caps.leave&&<button className={operationButton} disabled={operation.busy} onClick={()=>transition('leave')}>클래스 나가기</button>}
   {caps.cancel_waitlist&&<button className={operationButton} disabled={operation.busy} onClick={()=>transition('cancel_waitlist')}>대기 취소</button>}
   {caps.rejoin&&<>{credential!==undefined&&<label>현재 클래스 코드<input aria-label="재가입 클래스 코드" className={operationInput} value={code} onChange={e=>setCode(e.target.value)} inputMode="numeric" maxLength={4}/></label>}<button className={operationButton} disabled={operation.busy||(credential!==undefined&&!/^\d{4}$/.test(code))} onClick={()=>{if(credential===undefined)transition('rejoin');else void operation.run(`rejoin:${code}`,command=>membershipApi.guestRejoin(classId,{...command,code},readCredential??credential)).then(result=>{if(result?.credential_bundle)onCredentials?.(result.credential_bundle);});}}>재가입</button></>}
  </div>
  {attendance.state.status==='error'||attendance.state.status==='not_found'?<p role="alert">회차 참여 정보를 불러오지 못했어요.</p>:<ol className="mc-timeline">{sessions.map(s=><li key={s.id} className="rounded-xl border p-4 space-y-3"><div className="mc-row"><strong>{s.seq??'미정'}회차</strong><span className="mc-chip">{s.status==='cancelled'?'회차 취소':s.participation_scope==='before_join'?'참여 전':s.participation_scope==='outside_membership'?'참여 기간 외':s.attendance?attendanceLabels[s.attendance.attendance_status]??'상태 확인 필요':'참여 기록 없음'}{s.attendance?.attendance_kind==='makeup'?' · 보강':''}{s.makeup?` · 보강 ${s.makeup.status==='reserved'?'예약':s.makeup.status==='completed'?'완료':'취소'}`:''}</span></div>
   {s.scheduled_at&&<p className="mc-muted">{new Date(s.scheduled_at).toLocaleString('ko-KR')}</p>}
   <div className="flex flex-wrap gap-2">{(['excuse','undo_excuse'] as const).map(action=>s.capabilities[action]&&<button key={action} className={operationButton} disabled={operation.busy} onClick={()=>void operation.run(`${s.id}:${action}`,async (command,prepare)=>{const snapshot=await prepare(()=>membershipApi.participation(classId,s.id,credential));return membershipApi.changeAttendance(classId,s.id,data.member.id,{...command,action,expected_participation_version:snapshot.participation_version},credential);})}>{action==='excuse'?'사전 결석':'사전 결석 취소'}</button>)}
   {s.capabilities.cancel_makeup&&s.makeup?.status==='reserved'&&<button className={operationButton} disabled={operation.busy} onClick={()=>void operation.run(`cancel-makeup:${s.makeup!.id}`,command=>membershipApi.cancelMakeup(classId,s.makeup!.id,command,credential))}>보강 예약 취소</button>}
   {credential!==undefined&&s.capabilities.guest_entry&&<button className={operationButton} disabled={operation.busy} onClick={()=>entry(s.id)}>회차 입장</button>}
   {s.approved_report_ids.map(id=><button key={id} className={operationButton} disabled={reportBusy} onClick={()=>void showReport(id)}>승인 리포트 보기</button>)}</div>
  </li>)}</ol>}
  {caps.request_makeup&&<form className="space-y-3 border-t pt-4" onSubmit={e=>{e.preventDefault();void operation.run(`makeup:${source}:${target}`,command=>membershipApi.makeup(classId,{...command,member_id:data.member.id,source_session_id:source,target_session_id:target},credential));}}><h3>보강 예약</h3><p className="mc-muted">원래 결석은 유지돼요. 보강 참석은 별도로 기록돼요.</p><label className="block">결석한 원회차<select aria-label="보강 원회차" required className={operationInput} value={source} onChange={e=>setSource(e.target.value)}><option value="">선택해 주세요</option>{sessions.filter(s=>s.session_kind==='regular'&&['absent','excused'].includes(s.attendance?.attendance_status??'')&&s.status!=='cancelled').map(s=><option key={s.id} value={s.id}>{s.seq}회차</option>)}</select></label><label className="block">보강 대상 회차<select aria-label="보강 대상 회차" required className={operationInput} value={target} onChange={e=>setTarget(e.target.value)}><option value="">선택해 주세요</option>{sessions.filter(s=>['ready','scheduled'].includes(s.status)&&s.id!==source&&(!s.attendance||s.attendance.attendance_status==='withdrawn')).map(s=><option key={s.id} value={s.id}>{s.seq}회차</option>)}</select></label><button className={operationButton} disabled={operation.busy||!source||!target}>보강 예약하기</button></form>}
  <ConsentSettings data={data} disabled={operation.busy} onSave={values=>void operation.run(`consents:${JSON.stringify(values)}`,command=>membershipApi.consents(classId,{...command,...values},credential))}/>
  <div className="space-y-3 border-t pt-4"><h3>이 클래스의 연구 동의 명시 철회</h3><p className="mc-muted">기본값을 끄는 선택과 별개예요. 이 클래스의 과거·종료 회차에도 연구 철회를 요청해요.</p><label className="block">철회 사유<input aria-label="연구 철회 사유" className={operationInput} value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)}/></label><button className={operationButton} disabled={operation.busy||!reason.trim()} onClick={()=>void operation.run(`withdraw-research:${reason.trim()}`,command=>membershipApi.withdrawResearch(classId,{...command,reason:reason.trim()},readCredential??credential))}>이 클래스 연구 동의 철회</button></div>
  {operation.error&&<p role="alert">{operation.error}</p>}{operation.message&&<p role="status">{operation.message}</p>}{reportError&&<p role="alert">{reportError}</p>}<button className={operationButton} disabled={operation.busy} onClick={reload}>최신 내용 다시 불러오기</button>
  {report&&<section aria-label="승인된 본인 리포트"><ClientReportViewer report={report} onClose={()=>setReport(null)}/></section>}
 </section>;
}
function ConsentSettings({data,disabled,onSave}:{data:MyMembership;disabled:boolean;onSave:(value:Partial<MemberConsents>)=>void}){
 const [values,setValues]=useState(data.consents);
 const previousConsents=useRef(data.consents);
 useEffect(()=>{
  const previous=previousConsents.current;
  previousConsents.current=data.consents;
  // 재조회는 수정하지 않은 필드만 갱신하고 작성 중인 선택은 보존한다.
  setValues(current=>{
   const next={...data.consents};
   for(const key of ['report_included_default','research_consented','reminder_opt_in'] as const){
    if(current[key]!==previous[key])next[key]=current[key];
   }
   return next;
  });
 },[data.consents]);
 const changes:Partial<MemberConsents>={};for(const key of ['report_included_default','research_consented','reminder_opt_in'] as const)if(values[key]!==data.consents[key])changes[key]=values[key];
 if(changes.research_consented===true)changes.research_notice_version=RESEARCH_NOTICE_VERSION;
 if(changes.report_included_default===true)changes.notice_version=reportNoticeVersion('meditation');
 return <form className="space-y-3 border-t pt-4" onSubmit={e=>{e.preventDefault();onSave(changes);}}><h3>선택 동의 설정</h3><p className="mc-muted">선택하지 않아도 참여할 수 있어요. 기본값 변경은 미래 미입장 회차에만 반영돼요. 개별 회차 선택과 과거 기록은 유지돼요.</p><p className="mc-muted"><a className="underline" href="/privacy" target="_blank" rel="noreferrer">개인정보·연구 활용 고지 보기</a> · 연구 고지 {RESEARCH_NOTICE_VERSION}</p>{(['report_included_default','research_consented','reminder_opt_in'] as const).map((key,i)=><label key={key} className="flex items-start gap-2"><input type="checkbox" checked={values[key]} disabled={disabled||!data.capabilities.edit_consents} onChange={e=>setValues(v=>({...v,[key]:e.target.checked}))}/>{['[선택] 개인 리포트 반영','[선택] 연구 목적 활용 동의','[선택] 알림 수신'][i]}</label>)}{data.capabilities.edit_consents&&<button className={operationButton} disabled={disabled||Object.keys(changes).length===0}>동의 설정 저장</button>}</form>;
}
