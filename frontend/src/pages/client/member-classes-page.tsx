import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveClassCode, joinClassCode, type ClassCodeResult } from '../../lib/api/class-code';
import { membershipApi } from '../../lib/api/class-operations';
import { membershipError, useMembershipOperation } from '../../components/class/structure/membership-operation-state';
import { operationButton, operationInput } from '../../components/class/structure/class-operation-state';
import { invalidateClassReads } from '../../lib/class-structure/invalidation';
import { CodeEntryButton } from '../../components/client/code-entry-button';
import { useAuthStore } from '../../stores/authStore';
import { useClassApply } from './use-class-apply';
import { useClientCounselors } from '../../hooks/use-client-counselors';
import { useClasses } from '../../hooks/use-class-structure';
import { adaptMemberClass } from '../../lib/class-structure/adapters';
import { StructureShell } from '../../components/class/structure/structure-shell';
import { ReadStateView } from '../../components/class/structure/read-state';
import { MemberClassCard, MemberClassStyles, memberValue } from '../../components/class/structure/member-class-views';

export function MemberClassesPage() {
  useClientCounselors();
  const { state, retry } = useClasses();
  const { openApply, overlay } = useClassApply();
  const items = state.status === 'success' ? state.data.classes.map(adaptMemberClass) : [];
  const memberships = new Map(state.status === 'success' ? state.data.classes.map(item => [item.id, item.membership]) : []);
  const status = (item: typeof items[number]) => memberships.get(item.id)?.status ?? memberValue(item.status);
  const groups = [
    { label: '참여 중', items: items.filter((item) => status(item) === 'active') },
    { label: '완료', items: items.filter((item) => status(item) === 'completed') },
    { label: '대기 중', items: items.filter(item => status(item) === 'waitlisted') },
    { label: '이탈', items: items.filter(item => ['left', 'removed'].includes(status(item) ?? '')) },
    { label: '기타 상태', items: items.filter(item => !['active', 'completed', 'waitlisted', 'left', 'removed'].includes(status(item) ?? '')) },
  ];
  return <StructureShell role="member" title="내 클래스" rightSlot={<><CodeEntryButton variant="secondary" /><button type="button" className="h-11 shrink-0 rounded-full bg-[#5F0080] px-4 text-sm font-semibold text-white" onClick={openApply}>클래스 신청하기</button></>}><MemberClassStyles /><div className="mc-stack">
    <ReadStateView status={state.status === 'success' && items.length === 0 ? 'empty' : state.status} backTo="/app/classes" onRetry={retry}>
      <p className="mc-muted">클래스 상태와 진행을 확인해 보세요. 진행은 개인 출석을 의미하지 않아요.</p>
      {groups.filter((group) => group.items.length > 0).map((group) => <section key={group.label} aria-label={group.label}><h2 className="mc-heading">{group.label}</h2><div className="mc-grid">{group.items.map((item) => <MemberClassCard key={item.id} model={item} membership={memberships.get(item.id)} />)}</div></section>)}
    </ReadStateView>
    <MemberCodeJoin />
  </div>{overlay}</StructureShell>;
}
export function MemberCodeJoin(){
 const user=useAuthStore(s=>s.user);
 return <MemberCodeJoinState key={`${user?.id}:${user?.role}`}/>;
}
function MemberCodeJoinState(){
 const [code,setCode]=useState(''),[resolved,setResolved]=useState<ClassCodeResult|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const controller=useRef<AbortController|null>(null),lock=useRef(false);
 const operation=useMembershipOperation(resolved?.revision);
 const navigate=useNavigate();
 useEffect(()=>()=>controller.current?.abort(),[]);
 const resolve=async()=>{if(lock.current)return;operation.reset();lock.current=true;setBusy(true);setError('');const request=new AbortController();controller.current?.abort();controller.current=request;
  try{const result=await resolveClassCode(code,request.signal);if(request.signal.aborted)return;if(!result){setError('클래스 코드를 확인해 주세요.');setResolved(null);}else setResolved(result);}
  catch(e){if(!request.signal.aborted)setError(membershipError(e));}finally{if(controller.current===request){lock.current=false;setBusy(false);}}};
 const saved=()=>{invalidateClassReads();if(resolved)navigate(`/app/classes/${encodeURIComponent(resolved.class_id)}`);};
 return <section className="mc-card space-y-3" aria-label="클래스 코드 가입"><h2>클래스 코드로 참여</h2><form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();void resolve();}}><label>클래스 코드<input aria-label="회원 클래스 코드" className={operationInput} inputMode="numeric" maxLength={4} required pattern="[0-9]{4}" value={code} onChange={e=>{controller.current?.abort();controller.current=null;lock.current=false;setBusy(false);setCode(e.target.value);setResolved(null);setError('');}}/></label><button className={operationButton} disabled={busy||operation.busy||!/^\d{4}$/.test(code)}>클래스 코드 확인</button></form>
 {resolved&&<div className="space-y-3"><p>{resolved.title??'클래스'}</p><p className="mc-muted">빈자리가 있으면 가입하고, 정원이 찼을 때는 직접 대기 신청을 선택해 주세요.</p><div className="flex flex-wrap gap-3"><button className={operationButton} disabled={busy||operation.busy} onClick={()=>void operation.run(`join:${resolved.class_id}:${code}`,()=>joinClassCode(resolved.class_id,code)).then(result=>{if(result)saved();})}>코드로 가입</button><button className={operationButton} disabled={busy||operation.busy||resolved.revision===undefined} onClick={()=>void operation.run(`waitlist:${resolved.class_id}:${code}`,command=>membershipApi.waitlist(resolved.class_id,{...command,code})).then(result=>{if(result)saved();})}>대기 신청</button><button className={operationButton} disabled={busy||operation.busy} onClick={()=>void resolve()}>코드 다시 확인</button></div>{resolved.revision===undefined&&<p role="alert">현재 변경 버전을 확인할 수 없어 대기 신청을 할 수 없어요. 코드를 다시 확인해 주세요.</p>}</div>}
 {(error||operation.error)&&<p role="alert">{error||operation.error}</p>}{operation.message&&<p role="status">{operation.message}</p>}</section>;
}
