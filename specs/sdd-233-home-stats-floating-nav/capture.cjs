// 합성 데이터만 사용하는 제품 화면 Chrome 검증. 외부 요청과 실제 API는 차단한다.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../frontend');
process.chdir(root);
const deps = path.resolve(root, 'node_modules');
const { chromium } = require(path.join(deps, 'playwright'));
const out = path.join(__dirname, 'screens');
fs.mkdirSync(out, { recursive: true });
const userFor = (role) => ({ id: 'synthetic-'+role, email: role+'@example.test', name: role === 'client' ? '샘플 회원' : '샘플 상담사', role, verified_tier: 'verified', onboarding_completed: true, auth_provider: 'google', counselors: [] });
const cls = { id:'sample-class', title:'샘플 · 저녁 호흡 명상', status:'active', schedule_mode:'fixed', planned_session_count:4, area:'meditation', progress:{completed:1,total:4}, session_count:4, next_session:{id:'sample-session',seq:2,scheduled_at:'2026-10-24T10:00:00+09:00',status:'scheduled',host:{id:'sample-host',name:'샘플 상담사'}},has_open_session:false };
const session = { id:'sample-session',class_id:cls.id,class_title:cls.title,seq:2,area:'meditation',title:cls.title,type:'meditation',status:'scheduled',scheduled_at:'2026-10-24T10:00:00+09:00',participant_count:8,guest_count:0,pending_review_count:2,report_count:2,has_record:false,has_summary:false,access_code:null,participant_mode:'open' };
function fixture(p, role) {
 if(p.endsWith('/auth/refresh')) return {access_token:'synthetic-token',token_type:'bearer'};
 if(p.endsWith('/auth/me')) return userFor(role);
 if(p.endsWith('/client/counselors')) return [];
 if(p.endsWith('/dashboard/counselor')) return {counselor_id:'sample-host',counselor_name:'샘플 상담사',org_id:null,org_name:'샘플 상담소',org_kind:'individual',total_classes:1,in_progress_classes:0,completed_classes:0,total_participants:8,pending_review_count:2,classes:[session]};
 if(p.endsWith('/classes')) return {classes:Array.from({length:6},(_,i)=>({...cls,id:'sample-class-'+i,title:cls.title+' '+(i+1)})),total:6};
 if(p.endsWith('/sessions')) return {sessions:[session],total:1};
 if(p.includes('/reports')) return {reports:[{id:'sample-report',type:'client',is_read:false,status:'published',title:'샘플 명상 기록',created_at:'2026-10-22T09:00:00Z'}],total:1,unread:1,pending_review:2};
 if(p.includes('/notifications')) return {notifications:[],total:0,unread:0};
 if(p.includes('/chat')) return {rooms:[],total:0};
 if(p.includes('/counseling')) return {relationships:[],total:0};
 return {};
}
(async()=>{
 const {createServer}=await import(pathToFileURL(path.join(deps,'vite/dist/node/index.js')).href);
 // 빈 임시 envDir로 저장소 .env를 로드하지 않는다.
 const envDir=fs.mkdtempSync('/tmp/sdd233-env-');
 const server=await createServer({root,configFile:path.join(root,'vite.config.ts'),envDir,resolve:{alias:{'../design-system':path.resolve(root,'../design-system')}},server:{host:'127.0.0.1',port:5443,strictPort:true,open:false}});
 await server.listen();
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const results=[];
 try {
 for(const role of ['client','counselor']) for(const width of [390,430,1440]) {
  const page=await browser.newPage({viewport:{width,height:width===1440?1000:844},deviceScaleFactor:1});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(u=>localStorage.setItem('mb_user',JSON.stringify(u)),userFor(role));
  await page.route('**/*',async route=>{const u=new URL(route.request().url()); if(!['127.0.0.1','localhost'].includes(u.hostname)) return route.abort(); if(u.pathname.startsWith('/api/'))return route.fulfill({json:fixture(u.pathname,role)}); if(u.pathname.startsWith('/socket.io'))return route.fulfill({status:503,body:''});return route.continue();});
  await page.routeWebSocket(/socket\.io/,socket=>socket.close());
  await page.goto('http://127.0.0.1:5443'+(role==='client'?'/app':'/dashboard'));
  await page.locator(role==='client'?'.mh-summary':'.ch-tiles').waitFor();
  await page.waitForTimeout(500);
  const prefix=(role==='client'?'member':'counselor')+'-'+width;
  await page.screenshot({path:path.join(out,prefix+'.png')});
  const classSection=page.locator('section[aria-label="내 클래스"]');
  const cardCount=await classSection.locator('.mc-card').count();
  if(cardCount!==4 || !(await classSection.textContent()).includes('전체 보기 (6)')) throw Error(prefix+' 클래스 4개/총수 계약 실패');
  const info=await page.evaluate(()=>{const stats=document.querySelector('.mh-summary,.ch-tiles'),classes=document.querySelector('section[aria-label="내 클래스"]'),nav=document.querySelector('nav[aria-label="하단 메뉴"]');return {scrollWidth:document.documentElement.scrollWidth,stats:stats?.getBoundingClientRect().toJSON(),classes:classes?.getBoundingClientRect().toJSON(),columns:getComputedStyle(stats).gridTemplateColumns,nav:nav?{display:getComputedStyle(nav).display,color:getComputedStyle(nav).backgroundColor,rect:nav.getBoundingClientRect().toJSON(),labels:[...nav.querySelectorAll('a,button')].map(x=>x.textContent)}:null};});
  if(width<768){
   const nav=page.locator('nav[aria-label="하단 메뉴"]');
   await nav.screenshot({path:path.join(out,prefix+'-nav.png')});
   await page.evaluate(()=>{for(const e of document.querySelectorAll('*')) if(e.scrollHeight>e.clientHeight+10&&['auto','scroll'].includes(getComputedStyle(e).overflowY))e.scrollTop=e.scrollHeight;});
   await page.screenshot({path:path.join(out,prefix+'-end.png')});
   info.end=await page.evaluate(()=>{const nav=document.querySelector('nav[aria-label="하단 메뉴"]'),scrollers=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+10&&['auto','scroll'].includes(getComputedStyle(e).overflowY));return {navTop:nav.getBoundingClientRect().top,scrollers:scrollers.map(e=>({className:e.className,paddingBottom:getComputedStyle(e).paddingBottom,scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,lastBottom:e.lastElementChild?.getBoundingClientRect().bottom}))};});
  }
  if(width<768){
   // Chrome의 env 값은 0이므로 34px 홈 인디케이터를 동일 수식으로 모의한다.
   await page.addStyleTag({content:'.floating-bottom-nav{bottom:46px!important}'});
   await page.evaluate(()=>{for(const e of document.querySelectorAll('*'))if(['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+10)e.style.paddingBottom='134px';});
   await page.evaluate(()=>{for(const e of document.querySelectorAll('*'))if(e.scrollHeight>e.clientHeight+10&&['auto','scroll'].includes(getComputedStyle(e).overflowY))e.scrollTop=e.scrollHeight;});
   await page.screenshot({path:path.join(out,prefix+'-safe34-end.png')});
   info.safe34=await page.evaluate(()=>{const bar=document.querySelector('nav[aria-label="하단 메뉴"]').getBoundingClientRect();const scroll=[...document.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+10&&['auto','scroll'].includes(getComputedStyle(e).overflowY));return {barBottom:bar.bottom,barTop:bar.top,lastBottom:scroll.lastElementChild.getBoundingClientRect().bottom,paddingBottom:getComputedStyle(scroll).paddingBottom};});
   if(info.safe34.lastBottom>info.safe34.barTop)throw Error(prefix+' safe34 가림');
  }
  if(width<768 && info.end.scrollers.some(x=>x.lastBottom>info.end.navTop))throw Error(prefix+' 마지막 콘텐츠 가림');
  if(width>=768 && info.nav.display!=='none')throw Error('데스크톱 메뉴 노출');
  results.push({role,width,cardCount,...info,errors}); await page.close();
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
 if(results.some(x=>x.errors.length||x.scrollWidth>x.width))throw Error('화면 오류/가로 넘침: results.json 확인');
 console.log(JSON.stringify(results,null,2));
 } finally {await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
