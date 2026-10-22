// 합성 API + 실제 앱 라우트. 저장소 .env와 외부 서버를 사용하지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../frontend');
const deps = path.join(root, 'node_modules');
const { chromium } = require(path.join(deps, 'playwright'));
const arg = (key, fallback) => process.argv.find(x => x.startsWith(`--${key}=`))?.split('=').slice(1).join('=') || fallback;
const area = arg('area', 'all').toUpperCase();
const phase = arg('phase', 'audit');
if (!['ALL','A','B','C','D'].includes(area) || !/^[a-z0-9-]+$/i.test(phase)) throw Error('잘못된 area/phase');
const widths = arg('widths','390,768,1440').split(',').map(Number);
const out = path.join(__dirname, 'screens', phase);
if(fs.existsSync(out)&&fs.readdirSync(out).length&&!process.argv.includes('--overwrite'))throw Error('기존 측정 보존: 새 phase를 쓰거나 의도한 재측정에만 --overwrite 사용');
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
const screens = [
 ['A','member-home','client','/app','.mh-summary'],['A','host-home','counselor','/dashboard','.ch-tiles'],
 ['B','member-classes','client','/app/classes','.mc-card'],['B','host-classes','counselor','/classes','.cs-class-row'],
 ['B','member-class','client','/app/classes/sample-class','[role="tablist"]'],['B','host-class','counselor','/classes/sample-class','nav[aria-label="클래스 메뉴"]'],
 ['B','member-entry','client','/design/class-flow?screen=FM04&case=member','case'],
 ['B','host-entry','counselor','/design/class-flow?screen=FH05&case=ok','case'],
 ['B','member-lobby','client','/design/class-flow?screen=FM07&case=on-group-opt-member','case'],
 ['B','host-lobby','counselor','/design/class-flow?screen=FH06&case=g-on-3','case'],
 ['B','member-player','client','/design/class-player?role=member&case=M02','case'],['B','host-player','counselor','/design/class-player?role=host&case=C01','case'],
 ['C','member-reports','client','/app/reports','text=샘플 명상 기록'],['C','host-reports','counselor','/reports','text=샘플 명상 기록 >> visible=true'],
 ['C','member-report','client','/app/reports?report=sample-report','dialog[open] >> text=일상에서도 편안한 호흡을 이어가 보세요.'],['C','host-report','counselor','/reports/sample-report','text=샘플 명상 기록'],
 ['D','member-chats','client','/app/chat','text=편안한 호흡을 이어가 보세요.'],['D','host-chats','counselor','/chat','text=편안한 호흡을 이어가 보세요.'],
 ['D','member-chat','client','/app/chat/sample-room','textarea'],['D','host-chat','counselor','/chat/sample-room','textarea'],
].filter(s=>area==='ALL'||s[0]===area);
async function collect(page) {
 return page.evaluate(()=>{
  const visible = el => {const c=getComputedStyle(el),r=el.getBoundingClientRect();return c.display!=='none'&&c.visibility!=='hidden'&&Number(c.opacity)!==0&&r.width>0&&r.height>0&&!el.closest('[aria-hidden="true"], [inert]');};
  const selector = el => {const parts=[];while(el&&el!==document.body){const siblings=el.parentElement?[...el.parentElement.children].filter(x=>x.tagName===el.tagName):[];parts.unshift(el.tagName.toLowerCase()+`:nth-of-type(${siblings.indexOf(el)+1})`);el=el.parentElement;}return 'body > '+parts.join(' > ');};
  const base = el => {const c=getComputedStyle(el),r=el.getBoundingClientRect();return {selector:selector(el),class:typeof el.className==='string'?el.className:'',text:(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||'').trim().slice(0,160),fontSize:parseFloat(c.fontSize),lineHeight:c.lineHeight,fontWeight:c.fontWeight,fontFamily:c.fontFamily,width:r.width,height:r.height,x:r.x,y:r.y,padding:c.padding,margin:c.margin,gap:c.gap};};
  const scope=document.querySelector('dialog:modal')||document.body;
  const all=[...scope.querySelectorAll('*')].filter(visible);
  // 직접 텍스트 노드가 있는 요소만 세어 부모·자식 중복을 피한다. SVG text, 입력 placeholder 포함.
  const texts=all.filter(el=>[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())||el.matches('input[placeholder],textarea[placeholder]')).map(base);
  const touches=all.filter(el=>el.matches('button,a[href],input:not([type=hidden]),textarea,select,[role=button],[role=tab],summary')).map(base);
  const spacing=all.filter(el=>el.matches('section,article,main,header,nav,dialog')||/card|panel|stack|grid|section/.test(typeof el.className==='string'?el.className:'')).map(base);
  const histogram=key=>Object.fromEntries([...new Set(texts.map(x=>String(x[key])))].sort().map(k=>[k,texts.filter(x=>String(x[key])===k).length]));
  const small=texts.filter(x=>x.fontSize<=12), smallTouch=touches.filter(x=>x.height<44), narrowTouch=touches.filter(x=>x.width<44);
  const sectionGaps=all.filter(el=>el.matches('section,article')).flatMap(el=>{const next=el.nextElementSibling;if(!next||!visible(next))return [];const a=el.getBoundingClientRect(),b=next.getBoundingClientRect();return [{from:selector(el),to:selector(next),verticalGap:b.top-a.bottom}];});
  const irregular=spacing.filter(x=>[x.padding,x.gap,x.margin].some(v=>v.split(' ').some(n=>n.endsWith('px')&&parseFloat(n)>0&&parseFloat(n)%4!==0)));
  return {shell:document.querySelector('[data-shell-variant]')?.getAttribute('data-shell-variant')||'standalone-flow/player',scrollWidth:document.documentElement.scrollWidth,texts,touches,spacing,sectionGaps,distributions:{fontSize:histogram('fontSize'),lineHeight:histogram('lineHeight'),fontWeight:histogram('fontWeight')},summary:{textCount:texts.length,minFont:Math.min(...texts.map(x=>x.fontSize)),smallTextCount:small.length,smallTextRatio:texts.length?Number((small.length/texts.length*100).toFixed(1)):0,smallTouchCount:smallTouch.length,narrowTouchCount:narrowTouch.length},violations:{smallText:small,belowSecondary:texts.filter(x=>x.fontSize<13),smallTouch,narrowTouch,irregularSpacing:irregular}};
 });
}
(async()=>{
 process.chdir(root);fs.mkdirSync(out,{recursive:true});
 const {createServer}=await import(pathToFileURL(path.join(deps,'vite/dist/node/index.js')).href);
 const envDir=fs.mkdtempSync('/tmp/sdd234-env-');
 const server=await createServer({root,configFile:path.join(root,'vite.config.ts'),envDir,resolve:{alias:{'../design-system':path.resolve(root,'../design-system')}},server:{host:'127.0.0.1',port:5444,strictPort:true,open:false,proxy:{},hmr:false}});
 await server.listen();
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});
 const results=[];
 try{
 for(const width of widths)for(const [group,name,role,url,ready] of screens){
  const page=await browser.newPage({viewport:{width,height:844},deviceScaleFactor:1});
  const errors=[],unknown=[];page.on('pageerror',e=>{if(!errors.includes(e.message))errors.push(e.message)});
  await page.addInitScript(u=>localStorage.setItem('mb_user',JSON.stringify(u)),userFor(role));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/')){const data=fixture(u.pathname,role);if(data===undefined)unknown.push(u.pathname);return route.fulfill({status:data===undefined?404:200,json:data??{detail:'측정 fixture 미등록'}});}if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();if(u.pathname.startsWith('/socket.io'))return route.fulfill({status:503,body:''});return route.continue();});
  await page.routeWebSocket(/socket\.io/,socket=>socket.close());
  let failure=null;
  try{await page.goto('http://127.0.0.1:5444'+url);if(ready==='case'){await page.waitForFunction(()=>window.__ready===true,{},{timeout:15000});if(await page.getByText('케이스 미등록',{exact:true}).count())throw Error('케이스 미등록');}else await page.locator(ready).filter({visible:true}).first().waitFor({timeout:15000});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(250);}catch(e){failure=e.message;}
  const metrics=await collect(page);
  const file=`${group}-${name}-${width}`;
  fs.writeFileSync(path.join(out,file+'.json'),JSON.stringify({area:group,name,role,url,width,failure,errors,unknown,...metrics},null,2));
  await page.screenshot({path:path.join(out,file+'.png'),fullPage:true,timeout:15000});
  // 셸의 내부 스크롤도 끝까지 캡처한다. 화면 치수/스타일은 바꾸지 않는다.
  const scrollers=await page.locator('body *').evaluateAll(els=>els.filter(el=>el.clientHeight>100&&el.scrollHeight>el.clientHeight+50&&['auto','scroll'].includes(getComputedStyle(el).overflowY)).map(el=>{el.setAttribute('data-measure-scroll','true');return el.scrollHeight;}));
  for(let i=0;i<scrollers.length;i++){const el=page.locator('[data-measure-scroll]').nth(i);await el.evaluate(e=>e.scrollTop=e.scrollHeight);await page.screenshot({path:path.join(out,file+`-scroll-${i}.png`)});}
  const result={area:group,name,role,url,width,failure,errors,unknown:[...new Set(unknown)],...metrics};
  fs.writeFileSync(path.join(out,file+'.json'),JSON.stringify(result,null,2));results.push(result);
  console.log(JSON.stringify({name,width,failure,errors,unknown:result.unknown,...metrics.summary}));await page.close();
 }
 fs.writeFileSync(path.join(out,`summary-${area.toLowerCase()}.json`),JSON.stringify(results.map(({texts,touches,spacing,violations,...rest})=>rest),null,2));
 if(results.some(x=>x.failure||x.errors.length))process.exitCode=1;
 }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
