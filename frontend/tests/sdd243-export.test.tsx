// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExportDialog } from '../src/components/data-center/export-dialog';
import { validateExportRequest, exportApi, exportError } from '../src/lib/api/data-center-export';
import preview from '../../specs/sdd-243-platform-data-center/contracts/fixtures/export-preview.json';
import status from '../../specs/sdd-243-platform-data-center/contracts/fixtures/export-status.json';
vi.mock('../src/lib/api/client',()=>({apiClient:{get:vi.fn(),post:vi.fn()}}));
import { apiClient } from '../src/lib/api/client';

const base = {scope:'member' as const,target_id:'member',include:['eeg_raw' as const],range:{session_ids:Array.from({length:50},(_,i)=>String(i))},identity:'pseudonymized' as const,purpose:'operations' as const,eeg_format:'csv' as const,include_raw_bin:false,allow_partial:false};
describe('SDD-243 다운로드',()=>{
 it('50회차는 허용하고 51회차는 조용히 자르지 않는다',()=>{expect(validateExportRequest(base)).toBeNull();expect(validateExportRequest({...base,range:{session_ids:[...base.range.session_ids,'51']}})).toContain('50');});
 it('빈 항목과 상담사 기간 누락을 거절한다',()=>{expect(validateExportRequest({...base,include:[]})).toContain('하나');expect(validateExportRequest({...base,scope:'facilitator'})).toContain('기간');});
 it('B01 경로와 기관 및 proof를 전달한다',async()=>{vi.mocked(apiClient.post).mockResolvedValue(status);await exportApi.create({preview_token:preview.preview_token,reason:'확인',reauth_proof:'proof'},'idempotency','org');expect(apiClient.post).toHaveBeenCalledWith('/data-center/exports?org_id=org',expect.objectContaining({reauth_proof:'proof'}),expect.objectContaining({headers:{'Idempotency-Key':'idempotency'}}));});
 it('클래스는 회차 상한을 적용하지 않는다',()=>{expect(validateExportRequest({...base,scope:'class',range:{session_ids:Array.from({length:80},(_,i)=>String(i))}})).toBeNull();});
 it('역전 기간과 편측 측정구간을 거절한다',()=>{expect(validateExportRequest({...base,range:{date_from:'2026-10-24',date_to:'2026-10-01'}})).toContain('기간');expect(validateExportRequest({...base,from_us:'0'})).toContain('구간');});
 it('기관 운영 전용과 가명 기본,5개 항목/bin 별도를 표시한다',()=>{
 const documentDescriptor=Object.getOwnPropertyDescriptor(globalThis,'document')!;
 Object.defineProperty(globalThis,'document',{value:undefined,configurable:true});
 let html='';try{html=renderToStaticMarkup(<ExportDialog target={{scope:'session',targetId:'session',label:'호흡 1회차'}} isOrgAdmin onClose={()=>{}}/>);}finally{Object.defineProperty(globalThis,'document',documentDescriptor);}
 expect(html).toContain('가명 ID'); expect(html).toContain('EEG'); expect(html).toContain('PPG');expect(html).toContain('ACC'); expect(html).toContain('원본 bin'); expect(html).not.toContain('value="research"');
 });
});

it('B01 재인증과 part 요청은 POST이고 proof만 URL 발급에 전달한다',async()=>{
 vi.mocked(apiClient.post).mockResolvedValue({proof:'proof',expires_at:'2099-01-01T00:00:00Z'});
 await exportApi.reauth({credential:'secret',job_id:'job',scope_org_id:'org'},'org');
 expect(apiClient.post).toHaveBeenLastCalledWith('/data-center/export-reauth?org_id=org',{credential:'secret',job_id:'job',scope_org_id:'org'});
 await exportApi.download('job','part','proof','org');
 expect(apiClient.post).toHaveBeenLastCalledWith('/data-center/exports/job/download-url?org_id=org',{part_id:'part',reauth_proof:'proof'});
});
it('범위를 바꿀 때 사용하는 기관 쿼리는 jobs와 감사에 공통 적용한다',async()=>{
 vi.mocked(apiClient.get).mockResolvedValue({items:[]});await exportApi.jobs('org');expect(apiClient.get).toHaveBeenLastCalledWith('/data-center/exports?org_id=org');await exportApi.audits('org');expect(apiClient.get).toHaveBeenLastCalledWith('/data-center/download-audits?org_id=org');
});

it('preview 제외 확인과 credential POST proof를 통과한 뒤 생성한다',async()=>{
 const host=document.createElement('div'); document.body.append(host); const root=createRoot(host);
 const client={...exportApi,preview:vi.fn().mockResolvedValue({...preview,expires_at:'2099-01-01T00:00:00Z'}),reauth:vi.fn().mockResolvedValue({proof:'server-proof',expires_at:'2099-01-01T00:00:00Z'}),create:vi.fn().mockResolvedValue(status)};
 await act(async()=>{root.render(<ExportDialog target={{scope:'session',targetId:'session',label:'1회차'}} client={client} onClose={()=>{}}/>);});
 const dialog=document.querySelector('[role=dialog]')!;
 expect(dialog.parentElement?.parentElement).toBe(document.body);
 expect(host.querySelector('[role=dialog]')).toBeNull();
 const button=(text:string)=>Array.from(dialog.querySelectorAll('button')).find(x=>x.textContent===text)!;
 const input=(element:HTMLInputElement|HTMLTextAreaElement,value:string)=>{const proto=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));};
 await act(async()=>{input(dialog.querySelector('textarea')!,'운영 확인');});
 await act(async()=>{button('범위 미리보기').click();});
 expect(button('다운로드 작업 생성').disabled).toBe(true);
 await act(async()=>{Array.from(dialog.querySelectorAll('input[type=checkbox]')).find(x=>x.parentElement?.textContent?.includes('제외 범위를'))!.dispatchEvent(new MouseEvent('click',{bubbles:true})); input(dialog.querySelector('input[type=password]')!,'credential');});
 await act(async()=>{button('재인증 요청').click();});
 expect(client.reauth).toHaveBeenCalledWith({credential:'credential',request_hash:preview.request_hash,scope_org_id:undefined},undefined);
 expect(button('다운로드 작업 생성').disabled).toBe(false);
 await act(async()=>{button('다운로드 작업 생성').click();});
 expect(client.create).toHaveBeenCalledWith({preview_token:preview.preview_token,reason:'운영 확인',reauth_proof:'server-proof'},expect.any(String),undefined);
 await act(async()=>root.unmount());host.remove();
});

it('429 기존 작업을 식별하고 만료 오류는 재요청 안내로 보존한다',()=>{
 expect(exportError({status:429,data:{detail:{code:'active_job_exists',export_id:'active'}}})).toEqual({message:'진행 중 작업이 있습니다. 기존 작업을 확인하세요.',jobId:'active'});
 expect(exportError({status:409,data:{detail:{code:'preview_expired',message:'미리보기 만료 · 다시 요청하세요.'}}}).message).toContain('만료');
});
it('측정 선택 구간과 선택 참여자를 preview에 손실 없이 전달한다',async()=>{
 vi.mocked(apiClient.post).mockResolvedValue(preview);
 const request={...base,scope:'session' as const,target_id:'session',participant_ids:['p1','p2'],from_us:'0',to_us:'10000000'};
 await exportApi.preview(request,'org');expect(apiClient.post).toHaveBeenLastCalledWith('/data-center/exports/preview?org_id=org',request);
});

it('재인증 도중 취소하면 늦은 proof로 part URL을 발급하지 않는다',async()=>{
 const {ExportJobs}=await import('../src/components/data-center/export-jobs');
 let resolveProof!:(value:{proof:string;expires_at:string})=>void;
 const client={...exportApi,jobs:vi.fn().mockResolvedValue({items:[{...status,expires_at:'2099-01-01T00:00:00Z'}],next_cursor:null}),reauth:vi.fn(()=>new Promise<{proof:string;expires_at:string}>(resolve=>{resolveProof=resolve;})),download:vi.fn()};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(x=>x.textContent===text)!;
 await act(async()=>root.render(<ExportJobs client={client}/>));
 await act(async()=>button('part1 링크 발급').click());
 await act(async()=>{const input=host.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'credential');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>button('재인증 후 링크 발급').click());
 await act(async()=>button('취소').click());
 await act(async()=>resolveProof({proof:'late',expires_at:'2099-01-01T00:00:00Z'}));
 expect(client.download).not.toHaveBeenCalled();
 await act(async()=>button('part1 링크 발급').click());
 expect(button('재인증 후 링크 발급').disabled).toBe(true);
 await act(async()=>root.unmount());host.remove();
});
it('작업 새로고침은 재인증 입력을 유지하고 cursor로 다음 작업을 조회한다',async()=>{
 const {ExportJobs}=await import('../src/components/data-center/export-jobs');
 const client={...exportApi,jobs:vi.fn().mockResolvedValue({items:[{...status,expires_at:'2099-01-01T00:00:00Z'}],next_cursor:'next'})};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(x=>x.textContent===text)!;
 await act(async()=>root.render(<ExportJobs client={client}/>));await act(async()=>button('part1 링크 발급').click());
 await act(async()=>{const input=host.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'credential');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>button('새로고침').click());expect(host.querySelector('input')!.value).toBe('credential');expect(button('재인증 후 링크 발급').disabled).toBe(false);
 await act(async()=>button('작업 더 보기').click());expect(client.jobs).toHaveBeenLastCalledWith(undefined,'next');
 await act(async()=>root.unmount());host.remove();
});
it('감사에는 요청자 식별과 다음 페이지 버튼을 표시한다',async()=>{
 const {ExportAudits}=await import('../src/components/data-center/export-audits');
 const client={...exportApi,audits:vi.fn().mockResolvedValue({items:[{event_id:'event',actor_id:'actor-1',event:'url_issued',result:'allowed',at:'2026-10-24',actor_role:'platform_admin',org_id:null,job_id:'job',purpose:'operations',identity:'pseudonymized',reason:'확인',part_no:1,session_count:1,size_bytes:10,policy_version:'policy'}],next_cursor:'next'})};
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>root.render(<ExportAudits client={client}/>));expect(host.textContent).toContain('actor-1');
 await act(async()=>Array.from(host.querySelectorAll('button')).find(x=>x.textContent==='감사 기록 더 보기')!.click());expect(client.audits).toHaveBeenLastCalledWith(undefined,'next');
 await act(async()=>root.unmount());host.remove();
});
