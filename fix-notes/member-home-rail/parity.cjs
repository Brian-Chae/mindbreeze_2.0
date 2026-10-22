// 합성 데이터만 사용하는 제품 화면 Chrome 검증. 외부 요청과 실제 API는 차단한다.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = process.env.HOME_RAIL_ROOT || path.resolve(__dirname, '../../frontend');
process.chdir(root);
const deps = path.resolve(root, 'node_modules');
const { chromium } = require(path.join(deps, 'playwright'));
const empty = process.argv.includes('--empty');
const phase = process.argv.includes('--before') ? 'before' : 'after';
const out = path.join(__dirname, phase + (empty ? '-empty' : ''));
fs.mkdirSync(out, { recursive: true });
const userFor = (role) => ({ id: 'synthetic-'+role, email: role+'@example.test', name: role === 'client' ? '샘플 회원' : '샘플 상담사', role, verified_tier: 'verified', onboarding_completed: true, auth_provider: 'google', counselors: [{id:'sample-host',name:'샘플 상담사',profile_image:null}] });
const cls = { id:'sample-class', title:'샘플 · 저녁 호흡 명상', status:'active', schedule_mode:'fixed', planned_session_count:4, area:'meditation', progress:{completed:1,total:4}, session_count:4, next_session:{id:'sample-session',seq:2,scheduled_at:'2026-10-24T10:00:00+09:00',status:'scheduled',host:{id:'sample-host',name:'샘플 상담사'}},has_open_session:false };
const session = { id:'sample-session',class_id:cls.id,class_title:cls.title,seq:2,area:'meditation',title:cls.title,type:'meditation',status:'scheduled',scheduled_at:'2026-10-24T10:00:00+09:00',participant_count:8,guest_count:0,pending_review_count:2,report_count:2,has_record:false,has_summary:false,access_code:null,participant_mode:'open' };
function fixture(p, role) {
 if(p.endsWith('/auth/refresh')) return {access_token:'synthetic-token',token_type:'bearer'};
 if(p.endsWith('/auth/me')) return userFor(role);
 if(p.endsWith('/client/counselors')) return [{id:'sample-host',name:'샘플 상담사',profile_image:null}];
 if(p.endsWith('/dashboard/counselor')) return {counselor_id:'sample-host',counselor_name:'샘플 상담사',org_id:null,org_name:'샘플 상담소',org_kind:'individual',total_classes:1,in_progress_classes:0,completed_classes:0,total_participants:8,pending_review_count:2,classes:[session]};
 if(p.endsWith('/classes')) return {classes:Array.from({length:6},(_,i)=>({...cls,id:'sample-class-'+i,title:cls.title+' '+(i+1)})),total:6};
 if(p.endsWith('/sessions')) return {sessions:[session],total:1};
 if(p.includes('/reports')) return {reports:[{id:'sample-report',type:'client',is_read:false,status:'published',title:'샘플 명상 기록',created_at:'2026-10-22T09:00:00Z'}],total:1,unread:1,pending_review:2};
 if(p.includes('/notifications')) return {notifications:Array.from({length:4},(_,i)=>({id:'n'+i,type:'system',title:'명상 기록이 도착했습니다',body:'오늘의 변화와 다음 수업 안내를 확인해 보세요.',created_at:'2026-10-22T09:00:00Z',is_read:false,extra:null})),total:4,unread:4};
 if(p.includes('/chat')) return {rooms:[{id:'sample-room',display_name:'샘플 상담사',peer_name:'샘플 상담사',unread_count:2,last_message:{content:'다음 시간에도 편안하게 이야기 나눠요.'},last_message_at:'2026-10-22T09:00:00Z'}],total:1};
 if(p.includes('/counseling')) return {relationships:[],total:0};
 return {};
}
(async()=>{
 const {createServer,preview}=await import(pathToFileURL(path.join(deps,'vite/dist/node/index.js')).href);
 // 빈 임시 envDir로 저장소 .env를 로드하지 않는다.
 const envDir=fs.mkdtempSync('/tmp/sdd233-env-');
 const built=process.argv.includes('--built');
 const config={root,configFile:path.join(root,'vite.config.ts'),envDir,resolve:{alias:{'../design-system':path.resolve(root,'../design-system')}},server:{host:'127.0.0.1',port:5443,strictPort:true,open:false},preview:{host:'127.0.0.1',port:5443,strictPort:true,open:false}};
 const server=built?await preview(config):await createServer(config);
 if(!built)await server.listen();
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const results=[];
 try {
 for(const width of [390,1440]) {
 const shots=[];
 for(const role of ['client','counselor']) {
 const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1});
 page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(u=>localStorage.setItem('mb_user',JSON.stringify(u)),userFor(role));
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/'))return route.fulfill({json:empty && /\/(chat|notifications)/.test(u.pathname) ? {rooms:[],notifications:[],total:0,unread:0} : fixture(u.pathname,role)});if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();if(u.pathname.startsWith('/socket.io'))return route.fulfill({status:503,body:''});return route.continue();});
 await page.routeWebSocket(/socket\.io/,socket=>socket.close());
 await page.goto('http://127.0.0.1:5443'+(role==='client'?'/app':'/dashboard'));
 await page.locator(role==='client'?'.mh-summary':'.ch-tiles').waitFor();
 await page.locator('.mh-track .mc-card').first().waitFor();
 await page.evaluate(()=>document.fonts.ready);
 const metrics=await page.evaluate(()=>{
 const rail=document.querySelector('.mh-rail,.ch-rail');
 const style=el=>{const c=getComputedStyle(el);return {text:el.textContent.trim(),fontSize:c.fontSize,fontWeight:c.fontWeight,height:el.getBoundingClientRect().height,minHeight:c.minHeight,borderRadius:c.borderRadius,padding:c.padding};};
 return {panels:[...rail.querySelectorAll(':scope > section')].map(style), rows:[...rail.querySelectorAll('button,a')].map(style),avatars:[...rail.querySelectorAll('.rounded-full')].filter(el=>el.classList.contains('h-10')||el.classList.contains('h-8')).map(style),text:[...rail.querySelectorAll('h2,span,div')].filter(el=>el.childElementCount===0).map(style),scrollWidth:document.documentElement.scrollWidth};
 });
 const name=role==='client'?'member':'counselor';
 const filename='parity-'+width+'-'+name+'.png';
 await page.screenshot({path:path.join(out,filename),fullPage:true});
 shots.push(await page.screenshot());
 await page.locator('section[aria-label="내 클래스"]').scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(out,'parity-'+width+'-'+name+'-classes.png')});
 await page.locator('.mh-rail,.ch-rail').scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(out,'parity-'+width+'-'+name+'-panels.png')});
 for(const [i, panel] of (await page.locator('.mh-rail>section,.ch-rail>section').all()).entries()) await panel.screenshot({path:path.join(out,width+'-'+name+'-card-'+i+'.png')});
 results.push({width,role,mode:built?'build':'dev',...metrics,errors});await page.close();
 }
 }
 fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify(results,null,2));
 if(phase==='after') for(const x of results){
 if(x.panels.some(p=>p.minHeight!=='0px')) throw Error('레일 최소 높이 제거 실패');
 if(x.avatars.some(a=>a.height!==40)) throw Error('아바타 40px 실패');
 if(x.text.filter(t=>t.text==='샘플 상담사'||t.text==='명상 기록이 도착했습니다').some(t=>t.fontSize!=='16px'||t.fontWeight!=='600')) throw Error('이름/알림 글자 규격 실패');
 if(x.rows.some(r=>r.height<44)) throw Error('터치 영역 44px 미만');
 if(x.rows.filter(r=>r.text.includes('다음 시간에도')||r.text.includes('명상 기록이 도착')).some(r=>r.height<56)) throw Error('행 터치 영역 56px 미만');
 if(x.text.filter(t=>t.text==='오늘의 변화와 다음 수업 안내를 확인해 보세요.').some(t=>t.fontSize!=='15px')) throw Error('본문 15px 실패');
 if(!empty && x.rows.filter(r=>r.text.includes('명상 기록이 도착')).length!==3) throw Error('알림 최대 3개 실패');
 }
 if(results.some(x=>x.scrollWidth>x.width||x.errors.length))throw Error('화면 넘침 또는 JS 오류');
 console.log(results.map(x=>({width:x.width,role:x.role,panels:x.panels,errors:x.errors})));
 } finally {await browser.close();if(built)await new Promise((resolve,reject)=>server.httpServer.close(e=>e?reject(e):resolve()));else await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
