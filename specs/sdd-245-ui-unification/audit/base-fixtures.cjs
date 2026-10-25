// SDD-234 합성 읽기 fixture에서 복사. 기존 산출물은 실행하거나 변경하지 않는다.
const counselors = [{id:'sample-host',name:'샘플 상담사',profile_image:null}];
const userFor = role => ({id:'synthetic-'+role,email:role+'@example.test',name:role==='client'?'샘플 회원':'샘플 상담사',role,verified_tier:'verified',onboarding_completed:true,auth_provider:'google',counselors});
const cls = {id:'sample-class',title:'샘플 · 저녁 호흡 명상',status:'active',schedule_mode:'fixed',planned_session_count:4,area:'meditation',progress:{completed:1,total:4},session_count:4,next_session:{id:'sample-session',seq:2,scheduled_at:'2026-10-24T10:00:00+09:00',status:'scheduled',host:counselors[0]},has_open_session:false,location_type:'online',location_address:null,linkband_mode:'optional',record_audio:false,capacity:12,participant_mode:'group',default_duration_min:30,revision:1};
const session = {id:'sample-session',class_id:cls.id,class_title:cls.title,seq:2,area:'meditation',title:cls.title,type:'meditation',status:'scheduled',scheduled_at:cls.next_session.scheduled_at,participant_count:8,guest_count:0,pending_review_count:2,report_count:2,has_record:false,has_summary:false,access_code:null,participant_mode:'group',session_kind:'regular',host:counselors[0],host_state:'idle',duration_min:30};
const room = {id:'sample-room',session_id:null,room_type:'direct',host_id:'sample-host',name:'샘플 대화',peer_name:'샘플 상담사',peer_id:'sample-host',session_title:null,session_scheduled_at:null,participant_count:2,created_at:'2026-10-21T10:00:00Z',unread_count:1,last_message:{content:'편안한 호흡을 이어가 보세요.',created_at:'2026-10-21T10:00:00Z'}};
const reportFor = role => ({id:'sample-report',session_id:session.id,user_id:'synthetic-client',type:role==='client'?'client':'counselor',content:{headline:'샘플 명상 기록',summary:'호흡과 몸의 변화를 편안히 살펴보았습니다.',narrative:{journey:'호흡을 따라 긴장을 알아차린 시간이었어요.',body:'몸의 감각을 천천히 살펴보았어요.',mind:'생각이 떠오를 때 호흡으로 돌아왔어요.',closing:'다음에도 편안한 속도로 이어가 보세요.'},counselor_comment:'일상에서도 편안한 호흡을 이어가 보세요.',eeg:{status:'not_measured'}},pdf_url:null,sent_at:'2026-10-21T10:00:00Z',is_read:false,created_at:'2026-10-21T10:00:00Z',session_title:'샘플 명상 기록',counselor_name:'샘플 상담사',session_type:'meditation',scheduled_at:'2026-10-21T09:00:00Z',status:'published',generation_status:'ready',participant_name:'샘플 회원'});
function fixture(p, role) {
 if(p.endsWith('/devices/web-push/public-key'))return {public_key:null};
 if(p.endsWith('/auth/refresh'))return {access_token:'synthetic-token',token_type:'bearer'};
 if(p.endsWith('/auth/me'))return userFor(role);
 if(p.endsWith('/client/counselors'))return counselors;
 if(p.endsWith('/dashboard/counselor'))return {counselor_id:'sample-host',counselor_name:'샘플 상담사',org_id:null,org_name:'샘플 상담소',org_kind:'individual',total_classes:1,in_progress_classes:0,completed_classes:0,total_participants:8,pending_review_count:2,classes:[session]};
 if(p.endsWith('/classes'))return {classes:Array.from({length:4},(_,i)=>({...cls,id:i?`sample-class-${i}`:cls.id})),total:4};
 if(/\/classes\/[^/]+$/.test(p))return {...cls,host_view:role==='client'?null:{access_code:'0042',instructors:[{user_id:'sample-host',name:'샘플 상담사',role:'host',status:'active'}]},capabilities:{manage:role!=='client',invite:role!=='client',schedule:role!=='client'}};
 if(p.endsWith('/sessions'))return {sessions:[session],total:1};
 if(p.endsWith('/reports/auto-approve'))return {enabled:false};
 if(/\/reports\/sample-report$/.test(p))return reportFor(role);
 if(p.endsWith('/reports'))return {reports:[reportFor(role)],total:1,unread:1,pending_review:2};
 if(p.includes('/notifications'))return {notifications:[],total:0,unread:0};
 if(p.endsWith('/chat/rooms'))return {rooms:[room],total:1};
 if(p.endsWith('/messages'))return {messages:[{id:'sample-message',room_id:room.id,sender_id:'sample-host',sender_name:'샘플 상담사',type:'text',content:'오늘 수업에서 느낀 몸과 마음의 변화를 편안하게 나눠 주세요.\n짧은 호흡 연습도 도움이 될 수 있어요.',file_url:null,event_type:null,created_at:'2026-10-21T10:00:00Z',unread_count:0}],next_cursor:null};
 if(p.endsWith('/participants'))return {participants:[{user_id:'sample-host',name:'샘플 상담사',role:'counselor'},{user_id:'synthetic-client',name:'샘플 회원',role:'client'}]};
 if(p.endsWith('/chat/rooms/sample-room'))return room;
 if(p.endsWith('/video/url'))return {url:null};
 if(p.endsWith('/read'))return {};
 if(p.includes('/counseling'))return {relationships:[],total:0};
 return undefined;
}

module.exports={fixture,userFor,reportFor};
