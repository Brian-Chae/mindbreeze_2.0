// SDD-245 실측 전용 합성 읽기 응답. 제품 코드·실제 API·개인정보를 사용하지 않는다.
// 호출자는 GET만 허용하고 인증 refresh만 별도로 mock해야 한다. 미등록은 undefined → 404.
const now = '2026-10-25T00:00:00Z';
const host = {id:'sample-host',name:'샘플 상담사',email:'counselor@example.invalid',role:'counselor',status:'active',phone:null,counselor_code:'SAMPLE',org_id:'sample-org',org_name:'샘플 기관',specialties:['명상'],qualifications:[],careers:[],version:1,profile_image:null,bio:null,gender:null,birth_date:null,postal_code:null,address_line1:null,address_line2:null,affiliation_type:'institution',years_of_experience:null};
const org = {id:'sample-org',name:'샘플 기관',org_code:'SAMPLE',kind:'institution',phone:null,address:null,verified:true,verified_at:now,created_at:now,has_primary_admin:true,version:1,deactivated_at:null,ceo_name:'샘플 관리자',biz_number:'합성 자료',primary_admin:{...host,id:'sample-org-admin',role:'org_admin',email:'orgadmin@example.invalid'},owner:null};
const client = {id:'sample-client',name:'샘플 회원',email:'client@example.invalid',role:'client',concerns:['스트레스'],interests:['명상'],phone:null,gender:null,birth_date:null,bio:null,profile_image:null,profile_image_url:null,memo:'합성 감사용 메모',memo_editable:true,phone_masked:null,age:null,member_type:'member',last_session_at:now,classes:[{id:'sample-class',title:'샘플 명상'}],counselors:[{id:host.id,name:host.name}],last_activity_at:now,last_activity_source:'session'};
const session = {id:'sample-session',class_id:'sample-class',class_title:'샘플 명상',seq:2,area:'meditation',title:'샘플 명상 회차',type:'meditation',custom_type_name:null,status:'completed',host_id:'synthetic-counselor',scheduled_at:now,access_code:null,started_at:'2026-10-24T00:00:00Z',ended_at:'2026-10-24T00:30:00Z',duration_min:30,notes:null,max_participants:12,location_type:'offline',location_address:null,participant_mode:'group',linkband_mode:'optional',webrtc_room_id:null,sfu_enabled:false,record_audio:false,record_video:false,created_at:now,participants:[],waitlist_count:0,chat_enabled:false,chat_room_id:null,reminder_offsets:[],has_record:true,record_status:'completed',has_summary:true,report_count:0,pending_review_count:0,participant_count:0,guest_count:0};
const relationship = {id:'sample-relationship',status:'active',area:'counseling',counselor:{id:host.id,name:host.name},client_display:client.name,modality_default:'clinical',session_count:1,next_session:null,latest_session:{...session,type:'clinical',record_status:'completed',report_status:'ready'},sessions:[{...session,type:'clinical',record_status:'completed',report_status:'ready'}]};
const review = {target_type:'credential',id:'sample-review',document_type:'license',status:'pending',submitter_name:host.name,submitter_email:host.email,risk_score:0,ai_verdict:null,file_name:'합성-자격증.pdf',created_at:now,s3_key:null,audits:[]};
const application = {id:'sample-application',application_type:'organization',organization_name:org.name,contact_name:'샘플 담당자',email:'application@example.invalid',phone:null,status:'submitted',notify_status:'pending',created_at:now,inquiry:'합성 UI 감사 자료',specialties:null,review_note:null,reviewed_at:null,organization_id:null,user_id:null,notified_at:null};
const reportSession = {id:session.id,class_name:session.class_title,class_id:session.class_id,seq:2,ended_at:session.ended_at,started_at:session.started_at,duration_min:30,domain:'meditation'};
const generation = {id:null,generation_status:'none',state:'none',narrative_pending:false};
const emptyScope = {attended:0,measured:0,included:0,duration_min:30,bucket_min:5};
function extraFixture(path, role) {
 const p=path.replace(/^\/api\/v\d+/, '').split('?')[0];
 if(p==='/notifications/preferences')return {email:{},in_app:{},push:{}};
 if(/^\/sessions\/[^/]+\/research-consent\/summary$/.test(p))return {consented:0,total:0};
 if(/^\/sessions\/[^/]+\/report-choice\/summary$/.test(p))return {included:0,excluded:0,total:0};
 if(/^\/sessions\/[^/]+\/invite\/email$/.test(p))return {session_id:session.id,invites:[],summary:{}};
 if(p==='/normalization/models/active')return {active:null};
 if(p==='/normalization/models'||p==='/normalization/baselines')return {items:[]};
 if(p==='/classes/instructor-candidates')return {instructors:[{...host,id:'synthetic-counselor'}]};
 if(p==='/classes/member-candidates')return {members:[{id:client.id,name:client.name,masked_email:client.email}],has_more:false};
 if(/^\/classes\/[^/]+\/sessions\/[^/]+\/participation$/.test(p))return {session_id:session.id,participation_version:1,generated_at:now,presence_ttl_seconds:60,participants:[]};
 if(/^\/sessions\/[^/]+\/live-metrics$/.test(p))return {metrics:[],participants:[]};
 if(/^\/sessions\/[^/]+\/report-status$/.test(p))return {session_id:session.id,generation_status:'ready',stage:'done',progress:100,reason:null,report_status:'ready',steps:[],updated_at:now};
 if(p==='/agent/unread-count'||p==='/agent/counselor/unread-count')return {unread:0};
 if(p==='/agent/consent')return {agreed:false,version:'audit-v1'};
 if(p==='/agent/checkin-prefs')return {available:true,paused:true};
 if(p==='/agent/messages'||p==='/agent/counselor/messages')return {items:[],has_more:false};
 if(p==='/agent/counselor/checkin/clients')return {items:[{client_id:client.id,client_name:client.name,enabled:false,last_checkin_at:null,open_risk_count:0}]};
 if(/^\/agent\/counselor\/clients\/[^/]+\/(profile|checkins)$/.test(p)||p==='/agent/counselor/risk-signals'||p==='/agent/counselor/relay-events')return {items:[]};
 if(p==='/agent/counselor/settings')return {morning_enabled:false,morning_time:'09:00',evening_enabled:false,evening_time:'18:00',skip_no_session_days:true};
 if(p.startsWith('/data-center/')) {
  const files={'/data-center/contexts':'context','/data-center/summary':'summary','/data-center/classes':'class-list','/data-center/subjects':'subjects','/data-center/download-audits':'download-audits'};
  const name=files[p];
  if(name){
   const data=JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../../sdd-243-platform-data-center/contracts/fixtures',name+'.json'),'utf8'));
   // 앞선 SDD의 합성 계약 fixture를 현재 역할의 read-only 화면에 맞춘다.
   if(name==='context'){data.role=role;data.actor_id='synthetic-'+role;data.capabilities.can_reveal_contact=false;if(role==='platform_admin'){data.capabilities.tabs=['overview','subjects','classes','consents','retention','standard','jobs','audits'];data.capabilities.can_view_platform_audits=true;}}
   return JSON.parse(JSON.stringify(data).replace(/@[a-zA-Z0-9.-]+\.[a-zA-Z]+/g,'@example.invalid'));
  }
 }
 if(p==='/reports/view')return require('./base-fixtures.cjs').reportFor('client');
 if(p==='/dashboard/org') return {org_id:org.id,org_name:org.name,org_code:org.org_code,total_counselors:1,total_classes:1,total_participants:1,completed_classes:1,in_progress_classes:0,counselors:[{...host,class_count:1,participant_count:1,completed_count:1}],classes:[session]};
 if(p==='/admin/orgs') return [org];
 if(/^\/admin\/orgs\/[^/]+\/counselors$/.test(p))return [{...host,is_primary_admin:false,is_owner:false}];
 if(/^\/admin\/orgs\/[^/]+$/.test(p)) return org;
 if(p==='/admin/users') return {items:[{...client,suspended:false,created_at:now,primary_counselor:host}],total:1,page:1,size:20};
 if(p==='/admin/counselors') return {items:[host],total:1};
 if(/^\/(admin|org\/[^/]+)\/counselors\/[^/]+\/profile$/.test(p))return host;
 if(p==='/admin/reviews') return {items:[review],total:1,page:1,size:20};
 if(/^\/admin\/reviews\/(credentials|org-documents)\/[^/]+$/.test(p))return review;
 if(p==='/admin/signup-applications') return {items:[application],total:1,page:1,size:20};
 if(/^\/admin\/signup-applications\/[^/]+$/.test(p))return application;
 if(p==='/clients')return {clients:[client],total:1,page:1,class_options:client.classes,counselor_options:client.counselors};
 if(/^\/clients\/[^/]+\/activity$/.test(p))return {items:[],next_cursor:null,ai_included:false};
 if(/^\/clients\/[^/]+\/reports$/.test(p))return {reports:[],changes:[]};
 if(/^\/clients\/[^/]+$/.test(p))return client;
 if(p==='/auth/clients/me/profile')return client;
 if(p==='/auth/counselors/me/profile')return host;
 if(p==='/org/search')return [org];
 if(p==='/org/requests')return [];
 if(/^\/org\/[^/]+\/counselors$/.test(p))return [host];
 if(/^\/org\/[^/]+\/counselors\/[^/]+\/activity$/.test(p))return {sessions:[session],reports:[]};
 if(/^\/org\/[^/]+$/.test(p))return org;
 if(p==='/credentials')return {credentials:[],verified_tier:'verified',missing:[]};
 if(p==='/onboarding/me')return {current_step:1,step_data:{},completed:false};
 if(/^\/o\/[^/]+$/.test(p))return {org_id:org.id,org_name:org.name,org_code:org.org_code,intro:'합성 기관 소개',counselors:[host],classes:[]};
 if(/^\/invite\/[^/]+$/.test(p))return {counselor_name:host.name,counselor_code:host.counselor_code,organization:org.name};
 if(p==='/counseling')return {relationships:[relationship],total:1};
 if(/^\/counseling\/[^/]+$/.test(p))return relationship;
 if(p==='/sessions/templates')return {sessions:[],total:0};
 if(/^\/sessions\/[^/]+$/.test(p))return session;
 if(/^\/sessions\/[^/]+\/record$/.test(p))return {session_id:session.id,status:'completed',transcript:'합성 감사 자료입니다.',ai_summary:{summary:'편안한 호흡을 연습했습니다.',key_points:[],action_items:[]},counselor_notes:'합성 기록',markers:[],is_edited:false,edit_history:[],video_status:'not_recorded'};
 if(/^\/sessions\/[^/]+\/transcript$/.test(p))return {session_id:session.id,status:'completed',segments:[{speaker:'counselor',text:'편안하게 호흡하세요.',start:0,end:5}],raw_text:'편안하게 호흡하세요.'};
 if(/^\/sessions\/[^/]+\/class-summary$/.test(p))return {session:reportSession,headcount:{attended:0,measured:0,report_targets:0,excluded:0},report:generation,class_report:{available:false,status:'zero',flags:[],scope:emptyScope,headline:null,chips:{body:[],mind:[]}},approval:{auto_approve:{enabled:false,grace_minutes:0},counts:{generating:0,pending_review:0,approved:0,error:0,no_data_manual:0},participants_total:0},note_prompt:{eligible:false,has_note:false,seen:true,dismissed:true,user_enabled:false},next_session:null,capabilities:{can_edit_narrative:false,can_write_note:false,can_approve:false},fetched_at:now};
 if(/^\/sessions\/[^/]+\/class-report$/.test(p))return {session:reportSession,report:generation,block:null,participants:[],capabilities:{can_edit_narrative:false},fetched_at:now};
 if(p==='/users/me/consents')return Object.fromEntries(['tos','privacy','sensitive','eeg','research'].map(key=>[key,{agreed:['tos','privacy','sensitive'].includes(key),version:'audit-v1',agreed_at:now,withdrawn_at:null}]));
 if(p==='/users/me/session-note-prompt')return {enabled:false};
 if(/^\/classes\/[^/]+\/members$/.test(p))return {members:[{id:'sample-member',user_id:client.id,name:client.name,status:'active'}]};
 if(/^\/classes\/[^/]+\/instructors$/.test(p))return {instructors:[{user_id:host.id,role:'lead',status:'active',scope_session_id:null}]};
 if(/^\/classes\/[^/]+\/me\/attendance$/.test(p))return {sessions:[],total:0};
 if(/^\/classes\/[^/]+\/me\/membership$/.test(p))return {class_id:'sample-class',revision:1,member:{id:'sample-member',user_id:client.id,name:client.name,status:'active'},capabilities:{},consents:{report_included_default:false,research_consented:false,research_notice_version:null,reminder_opt_in:false,notice_version:null},attendance_summary:{attended:0,absent:0,excused:0,makeup_reserved:0,makeup_completed:0}};
 return undefined;
}
module.exports={extraFixture};
