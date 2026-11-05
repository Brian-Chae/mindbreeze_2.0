// 합성 API + 실제 앱 라우트. 저장소 .env와 외부 서버를 사용하지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../frontend');
const deps = path.join(root, 'node_modules');
const { chromium } = require(path.join(deps, 'playwright'));
const arg = (key, fallback) => process.argv.find(x => x.startsWith(`--${key}=`))?.split('=').slice(1).join('=') || fallback;







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
const phase = arg('phase','after'); const widths=[360,390,768,1280]; const out=path.join(__dirname,'evidence');
const targets=[['home','/app','.sh-hero'],['classes','/app/classes','.mc-stack']];
(async()=>{
 process.chdir(root);
 const {createServer}=await import(pathToFileURL(path.join(deps,'vite/dist/node/index.js')).href);
 const envDir=fs.mkdtempSync(process.env.TMPDIR+'/sdd310-env-');
 const server=await createServer({root,configFile:path.join(root,'vite.config.ts'),envDir,resolve:{alias:{'../design-system':path.resolve(root,'../design-system')}},server:{host:'127.0.0.1',port:5445,strictPort:true,open:false,proxy:{},hmr:false}});
 await server.listen();
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});
 const rows=[];
 try{ for(const width of widths)for(const [name,url,ready] of targets){
  const page=await browser.newPage({viewport:{width,height:740},deviceScaleFactor:1});
  await page.addInitScript(u=>localStorage.setItem('mb_user',JSON.stringify(u)),userFor('client'));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/')){const data=fixture(u.pathname,'client');return route.fulfill({status:data===undefined?404:200,json:data??{detail:'x'}});}if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();return route.continue();});
  await page.routeWebSocket(/socket\.io/,s=>s.close());
  await page.goto('http://127.0.0.1:5445'+url);
  await page.locator(ready).filter({visible:true}).first().waitFor({timeout:20000});
  await page.evaluate(()=>document.fonts.ready); await page.waitForTimeout(400);
  const m=await page.evaluate(()=>{
   const all=[...document.querySelectorAll('[data-testid="enter-with-code"]')];
   const vis=all.filter(e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();return c.display!=='none'&&r.width>0&&r.height>0});
   const info=e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return {place:e.dataset.codeEntry||'old',inHeaderActions:!!e.closest('.mb-page-header-actions'),top:Math.round(r.top),h:Math.round(r.height*10)/10,w:Math.round(r.width),position:c.position,radius:c.borderRadius}};
   const hero=document.querySelector('.sh-hcta'); const hr=hero?.getBoundingClientRect();
   const hdr=[...document.querySelectorAll('.mb-page-header-actions')].filter(e=>e.getBoundingClientRect().height>0).map(e=>Math.round(e.getBoundingClientRect().height));
   return {total:all.length,visible:vis.map(info),heroCta:hr?{h:Math.round(hr.height*10)/10,w:Math.round(hr.width)}:null,visibleHeaderActionsHeights:hdr,scrollW:document.documentElement.scrollWidth};
  });
  rows.push({phase,name,width,...m});
  await page.screenshot({path:path.join(out,`${phase}-${name}-${width}.png`),fullPage:false});
  await page.close();
 }}finally{await browser.close();await server.close();}
 fs.writeFileSync(path.join(out,`${phase}.json`),JSON.stringify(rows,null,1));
 for(const r of rows)console.log(JSON.stringify(r));
})().catch(e=>{console.error(e);process.exitCode=1;});
