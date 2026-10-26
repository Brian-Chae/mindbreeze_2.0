import { BirthYearMonthWheel } from '../../components/forms/birth-year-month-wheel';
import { birthToIso } from '../../lib/class/flow/member-entry';
import { ApiError } from '../../lib/api/client';
import { useAuthStore } from '../../stores/authStore';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { membershipApi, type CredentialBundle, type GuestJoinInput } from '../../lib/api/class-operations';
import { MemberOperations } from '../../components/class/structure/member-operations';
import { MemberClassStyles } from '../../components/class/structure/member-class-views';
import { operationButton, operationInput } from '../../components/class/structure/class-operation-state';
import { membershipError } from '../../components/class/structure/membership-operation-state';
import { CLASS_TEAM_NOTICE_VERSION } from '../../lib/class/flow/member-prep';
import '../../components/class/structure/structure-shell.css';
// 장기 guest 자격과 원문 입력은 메모리에만 보관한다. URL·operation·로그에 남기지 않는다.
export function GuestClassMembershipPage(){const {classId=''}=useParams();const user=useAuthStore(s=>s.user);return <GuestClassMembership key={`${classId}:${user?.id}:${user?.role}`} classId={classId}/>;}
function GuestClassMembership({classId}:{classId:string}){
 const [bundle,setBundle]=useState<CredentialBundle|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [code,setCode]=useState(''),[name,setName]=useState(''),[gender,setGender]=useState(''),[birth,setBirth]=useState(''),[email,setEmail]=useState('');
 const [report,setReport]=useState(false),[reminder,setReminder]=useState(false),[waitlist,setWaitlist]=useState(false),[exchange,setExchange]=useState('');
 const lock=useRef(false),alive=useRef(true),joinOperation=useRef<{signature:string;key:string}|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const run=async(action:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');try{await action();}catch(e){if(alive.current)setError(membershipError(e));}finally{lock.current=false;if(alive.current)setBusy(false);}};
 const resetJoinChoices=()=>{setReport(false);setReminder(false);setWaitlist(false);joinOperation.current=null;};
 const accept=(next:CredentialBundle|null)=>{if(!alive.current)return;setBundle(next);resetJoinChoices();setCode('');setName('');setBirth('');setEmail('');setGender('');setExchange('');if(!next)setMessage('자격 응답을 받지 못했어요. 강사에게 본인 확인 후 단회 복구를 요청해 주세요.');};
 const join=()=>void run(async()=>{const yearMonth=birthToIso(birth);if(!yearMonth){setError('생년월을 다시 확인해 주세요');return;}const values:Omit<GuestJoinInput,'operation_key'>={code,guest_name:name.trim(),gender,birth_year_month:yearMonth,report_email:email.trim(),report_included:report,notice_version:CLASS_TEAM_NOTICE_VERSION,research_consented:false,reminder_opt_in:reminder,join_mode:waitlist?'waitlist':'active'};const signature=JSON.stringify(values);if(joinOperation.current?.signature!==signature)joinOperation.current={signature,key:crypto.randomUUID()};const result=await membershipApi.guestJoin(classId,{...values,operation_key:joinOperation.current.key});if(!alive.current)return;joinOperation.current=null;accept(result.credential_bundle);});
 const credential=bundle?.activity_credential??bundle?.read_credential;
 const switchToReadCredential=()=>{if(!alive.current)return;setBundle(current=>current&&current.activity_credential===credential?{...current,activity_credential:null}:current);};
 const withCredentialFallback=async<T,>(action:(token:string)=>Promise<T>):Promise<T>=>{
   try{return await action(credential!);}
   catch(e){
    if(!(e instanceof ApiError)||e.status!==401||!bundle?.activity_credential||credential!==bundle.activity_credential||bundle.read_credential===credential||!alive.current)throw e;
    switchToReadCredential();
    return action(bundle.read_credential);
   }
 };
 return <main className="cs-structure min-h-screen bg-[#faf8fc] p-4 sm:p-8"><MemberClassStyles/><div className="mc-stack"><section className="mc-card"><h1 className="text-2xl font-semibold">비회원 클래스 참여</h1><p className="mc-muted">자격은 이 화면의 메모리에만 보관해요. 새로고침·기기 상실 후에는 강사에게 본인 확인을 거쳐 복구 코드를 받으세요.</p><a className="mc-link" href="/privacy" target="_blank" rel="noreferrer">개인정보·연구 활용 고지</a></section>
 {credential&&bundle?<><MemberOperations classId={classId} credential={credential} readCredential={bundle.read_credential} onCredentials={accept} onActivityUnauthorized={switchToReadCredential}/><section className="mc-card space-y-3"><p className="mc-muted">자격 만료: {new Date(bundle.expires_at).toLocaleString('ko-KR')}</p><div className="flex flex-wrap gap-3"><button className={operationButton} disabled={busy} onClick={()=>void run(async()=>{const result=await withCredentialFallback(token=>membershipApi.guestRefresh(classId,token));accept(result.credential_bundle);})}>비회원 자격 갱신</button><button className={operationButton} disabled={busy} onClick={()=>void run(async()=>{await withCredentialFallback(token=>membershipApi.guestLogout(classId,token));if(alive.current){resetJoinChoices();setBundle(null);setMessage('로그아웃했어요. 모든 이전 비회원 자격이 회수됐어요.');}})}>비회원 로그아웃</button></div></section></>:<>
 <form className="mc-card space-y-4" onSubmit={e=>{e.preventDefault();join();}}><h2>새 비회원 가입</h2><label className="block">클래스 코드<input aria-label="클래스 코드" className={operationInput} required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={code} onChange={e=>setCode(e.target.value)}/></label><label className="block">이름<input aria-label="이름" className={operationInput} required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><p className="mc-muted">실명이 아니어도 됩니다(별명·반 번호 가능)</p><label className="block">성별<select aria-label="성별" className={operationInput} required value={gender} onChange={e=>setGender(e.target.value)}><option value="">선택해 주세요</option><option value="male">남성</option><option value="female">여성</option><option value="other">기타</option></select></label><div><p>생년월</p><BirthYearMonthWheel id="guest-birth" value={birth} onChange={setBirth}/></div><label className="block">이메일<input aria-label="이메일" className={operationInput} type="email" required maxLength={320} value={email} onChange={e=>setEmail(e.target.value)}/></label>
 <fieldset className="space-y-3"><legend>선택 동의</legend><p className="mc-muted">모두 선택사항이며 미선택 상태로도 참여할 수 있어요.</p><label className="flex gap-2"><input type="checkbox" checked={report} onChange={e=>setReport(e.target.checked)}/>[선택] 개인 리포트 반영</label><label className="flex gap-2"><input type="checkbox" checked={reminder} onChange={e=>setReminder(e.target.checked)}/>[선택] 알림 수신</label></fieldset><label className="flex gap-2"><input type="checkbox" checked={waitlist} onChange={e=>setWaitlist(e.target.checked)}/>정원이 찼다면 대기 신청</label><button className={operationButton} disabled={busy}>{waitlist?'비회원 대기 신청':'비회원 가입'}</button></form>
 <form className="mc-card space-y-3" onSubmit={e=>{e.preventDefault();void run(async()=>{const result=await membershipApi.guestExchange(classId,exchange.trim());accept(result.credential_bundle);});}}><h2>기기 상실·자격 복구</h2><p className="mc-muted">강사가 본인을 확인한 뒤 발급한 복구 코드만 사용할 수 있어요. 10분 이내 한 번만 교환할 수 있어요. 이름·이메일·공개 클래스 코드로 기존 기록을 가져오지 않아요.</p><label className="block">단회 복구 코드<input aria-label="단회 복구 코드" className={operationInput} type="password" autoComplete="off" value={exchange} onChange={e=>setExchange(e.target.value)}/></label><button className={operationButton} disabled={busy||exchange.trim().length<32}>자격 복구하기</button></form>
 </>}{error&&<p role="alert" className="mc-card">{error}</p>}{message&&<p role="status" className="mc-card">{message}</p>}</div></main>;
}
