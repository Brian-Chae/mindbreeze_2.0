import { apiClient } from './client';
export type ExportScope = 'participant'|'session'|'class'|'member'|'facilitator';
export type ExportInclude = 'eeg_raw'|'ppg_raw'|'acc_raw'|'features'|'indices';
export interface ExportRequest {scope:ExportScope;target_id:string;session_id?:string;participant_ids?:string[];range:{date_from?:string;date_to?:string;batch_index?:number;session_ids?:string[]};from_us?:string;to_us?:string;include:ExportInclude[];eeg_format:'csv'|'parquet';include_raw_bin:boolean;identity:'pseudonymized'|'identified';purpose:'operations'|'research';allow_partial:boolean;scope_org_id?:string}
export interface ExportPreview {preview_token:string;expires_at:string;request_hash:string;as_of:string;session_count:number;participant_count:number;exclusions:{reason:string;signal?:string|null;session_id?:string|null}[];estimated_bytes:number|null;estimated_part_count:number|null;exclusion_counts?:Record<string,number>;extra_range_notices:string[];policy_version:string;eligible:boolean;blocked_reason:string|null}
export interface ExportProof {proof:string;expires_at:string}
export interface ExportStatus {export_id:string;status:string;scope:string;purpose:string;identity:string;session_count:number;participant_count:number;completed_count:number;parts:{part_id:string;part_no:number;status:string;size_bytes:number|null}[];expected_part_count:number|null;warnings:string[];error_code:string|null;created_at:string;expires_at:string;policy_version:string}
export interface ExportAudit {event_id:string;actor_id:string;event:string;result:string;at:string;actor_role:string;org_id:string|null;job_id:string|null;purpose:string|null;identity:string|null;reason:string|null;part_no:number|null;session_count:number|null;size_bytes:number|null;policy_version:string|null}
export interface ExportLimits {member_facilitator_max_sessions?:number;reason_min_length?:number;reason_max_length?:number;provisional?:boolean;reauth_ttl_seconds?:number;reauth_required?:boolean;artifact_ttl_seconds?:number;url_ttl_seconds?:number}
export function validateExportRequest(request:ExportRequest,maxSessions=50):string|null {
 if(!request.include.length)return '신호 또는 데이터 항목을 하나 이상 선택하세요.';
 if(['member','facilitator'].includes(request.scope)&&new Set(request.range.session_ids).size>maxSessions)return `최대 ${maxSessions}회차입니다. 기간 또는 묶음을 다시 선택하세요.`;
 if(request.range.batch_index!==undefined&&(!Number.isInteger(request.range.batch_index)||request.range.batch_index<1))return '회차 묶음 번호는 1 이상의 정수여야 합니다.';
 if(request.scope==='facilitator'&&(!request.range.date_from||!request.range.date_to))return '코치 다운로드는 시작·종료 기간이 필수입니다.';
 if(request.range.date_from&&request.range.date_to&&request.range.date_from>request.range.date_to)return '기간의 시작일은 종료일보다 늦을 수 없습니다.';
 if((request.from_us===undefined)!==(request.to_us===undefined))return '측정 구간의 시작과 끝을 함께 지정하세요.';
 if(request.from_us!==undefined&&request.to_us!==undefined&&BigInt(request.from_us)>=BigInt(request.to_us))return '측정 구간의 끝은 시작보다 커야 합니다.';
 return null;
}
const path=(route:string,orgId?:string)=>`/data-center${route}${orgId?'?org_id='+encodeURIComponent(orgId):''}`;
export const exportApi={
 preview:(request:ExportRequest,orgId?:string)=>apiClient.post<ExportPreview>(path('/exports/preview',orgId),request),
 reauth:(request:{credential?:string;social_proof?:string;request_hash?:string;job_id?:string;scope_org_id?:string},orgId?:string)=>apiClient.post<ExportProof>(path('/export-reauth',orgId),request),
 create:(request:{preview_token:string;reason:string;reauth_proof?:string},idempotencyKey:string,orgId?:string)=>apiClient.post<ExportStatus>(path('/exports',orgId),request,{headers:{'Idempotency-Key':idempotencyKey}}),
 jobs:(orgId?:string,cursor?:string)=>apiClient.get<{items:ExportStatus[];next_cursor:string|null}>(path('/exports',orgId)+(cursor?(orgId?'&':'?')+'cursor='+encodeURIComponent(cursor):'')),
 job:(jobId:string,orgId?:string)=>apiClient.get<ExportStatus>(path(`/exports/${encodeURIComponent(jobId)}`,orgId)),
 download:(jobId:string,partId:string,proof:string|undefined,orgId?:string)=>apiClient.post<{url:string;expires_at:string;part_no:number;revocable:false}>(path(`/exports/${encodeURIComponent(jobId)}/download-url`,orgId),{part_id:partId,reauth_proof:proof}),
 audits:(orgId?:string,cursor?:string)=>apiClient.get<{items:ExportAudit[];next_cursor:string|null}>(path('/download-audits',orgId)+(cursor?(orgId?'&':'?')+'cursor='+encodeURIComponent(cursor):'')),
};
export type ExportClient=typeof exportApi;
export function exportError(error:unknown):{message:string;jobId?:string}{const value=error as {message?:string;status?:number;data?:{detail?:{code?:string;message?:string;export_id?:string}}};const detail=value.data?.detail;return {message:value.status===429?'진행 중 작업이 있습니다. 기존 작업을 확인하세요.':detail?.message||value.message||'요청에 실패했습니다. API 연결 상태를 확인하세요.',jobId:detail?.export_id};}
