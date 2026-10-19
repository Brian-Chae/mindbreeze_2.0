import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import type { MemberCommand } from '../../../lib/api/class-operations';
import { useAuthStore } from '../../../stores/authStore';
import { invalidateClassReads } from '../../../lib/class-structure/invalidation';
export function membershipError(error:unknown):string {
  if(error instanceof ApiError){
    const code=(error.data as {detail?:{code?:string}}|null)?.detail?.code;
    const messages:Record<string,string>={class_capacity:'정원이 찼어요. 대기 신청을 선택해 주세요.',session_capacity:'회차 정원이 찼어요. 다른 회차를 선택해 주세요.',waitlist_precedes:'먼저 신청한 대기자가 있어요.',waitlist_not_required:'현재 빈자리가 있어요. 일반 가입을 선택해 주세요.',member_transition_invalid:'현재 상태에서는 이 작업을 할 수 없어요.',guest_merge_record_conflict:'양쪽의 실제 기록이 겹쳐 병합할 수 없어요.',guest_merge_preview_stale:'병합 대상이 바뀌었어요. 미리보기를 다시 확인해 주세요.',makeup_already_reserved:'이미 유효한 보강 예약이 있어요.',makeup_source_in_use:'연결된 보강 예약을 먼저 취소해 주세요. 완료된 보강의 원결석은 변경할 수 없어요.',target_participant_exists:'이미 참여하는 회차예요. 다른 보강 회차를 선택해 주세요.',recovery_unavailable:'복구를 발급할 수 없어요. 본인과 현재 상태를 확인해 주세요.'};
    if(code&&messages[code])return messages[code];
    if(error.status===409)return '다른 변경이 있어요. 최신 내용을 다시 불러온 뒤 시도해 주세요.';
    if(error.status===403)return '이 작업을 수행할 권한이 없어요. 현재 참여 상태를 확인해 주세요.';
    if(error.status===401)return '비회원 자격이 만료되거나 회수됐어요. 강사에게 본인 확인 후 복구를 요청해 주세요.';
    if(error.status===404)return '대상을 찾을 수 없거나 접근할 수 없어요.';
    if(error.status===422)return '필수 입력과 변경 사유를 확인해 주세요.';
  }
  return '통신에 실패했어요. 연결을 확인한 뒤 같은 작업을 다시 시도해 주세요.';
}
interface PendingOperation {
 signature:string;
 command:MemberCommand;
 preparation?:Promise<unknown>;
}
type PrepareOnce = <P>(load:()=>Promise<P>)=>Promise<P>;
export function useMembershipOperation(revision:number|undefined,onSaved?:()=>void){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const alive=useRef(true),lock=useRef(false),pending=useRef<PendingOperation|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 // 사용자 재조회는 미확정 요청을 버리고 새로운 명령을 시작한다.
 const reset=()=>{if(!lock.current)pending.current=null;};
 const run=async<T>(signature:string,action:(command:MemberCommand,prepare:PrepareOnce)=>Promise<T>,reason?:string):Promise<T|undefined>=>{
  if(lock.current)return;
  if(revision===undefined){setError('최신 버전을 확인할 수 없어요. 최신 내용을 다시 불러와 주세요.');return;}
  const identity=JSON.stringify([useAuthStore.getState().isAuthenticated,useAuthStore.getState().user?.id,useAuthStore.getState().user?.role]);
  const current=()=>alive.current&&JSON.stringify([useAuthStore.getState().isAuthenticated,useAuthStore.getState().user?.id,useAuthStore.getState().user?.role])===identity;
  const normalizedReason=reason?.trim();
  const sig=JSON.stringify([signature,normalizedReason]);
  if(pending.current?.signature!==sig)pending.current={signature:sig,command:{operation_key:crypto.randomUUID(),expected_revision:revision,...(normalizedReason?{reason:normalizedReason}:{})}};
  const operation=pending.current;
  // 참여 버전 등 쓰기 전에 읽은 값도 최초 요청과 함께 메모리에 고정한다.
  const prepare:PrepareOnce=<P,>(load:()=>Promise<P>):Promise<P>=>{
    if(!operation.preparation)operation.preparation=load().catch(e=>{operation.preparation=undefined;throw e;});
    return operation.preparation as Promise<P>;
  };
  lock.current=true;setBusy(true);setError('');setMessage('');
  try{const result=await action(operation.command,prepare);if(!current())return;pending.current=null;setMessage('저장했어요.');invalidateClassReads();onSaved?.();return result;}
  catch(e){if(current())setError(membershipError(e));return;}
  finally{lock.current=false;if(current())setBusy(false);}
 };
 return {busy,error,message,run,reset,setError};
}
