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
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/'))return route.fulfill({json:fixture(u.pathname,role)});if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();if(u.pathname.startsWith('/socket.io'))return route.fulfill({status:503,body:''});return route.continue();});
 await page.routeWebSocket(/socket\.io/,socket=>socket.close());
 await page.goto('http://127.0.0.1:5443'+(role==='client'?'/app':'/dashboard'));
 await page.locator(role==='client'?'.mh-summary':'.ch-tiles').waitFor();
 await page.locator('.mh-track .mc-card').first().waitFor();
 await page.evaluate(()=>document.fonts.ready);
 const metrics=await page.evaluate(()=>{
 const home=document.querySelector('.mh-home,.ch-home');
 const style=(el)=>{const c=getComputedStyle(el);return {...Object.fromEntries(['borderRadius','height','minHeight','padding','borderWidth','borderColor','boxShadow','gap'].map(k=>[k,c[k]])),rail:el.classList.contains('home-rail-card')};};
 const get=(s)=>{const el=home.querySelector(s);if(!el)throw Error('missing '+s);return style(el);};
 const all=(s)=>[...home.querySelectorAll(s)].map(style);
 const hero=home.querySelector('.sh-hero').getBoundingClientRect();
 const stats=home.querySelector('.mh-summary,.ch-tiles');
 const cards=[...home.querySelectorAll('.mh-track .mc-card')];
 return {tilesAll:all('.mh-summary>button,.ch-tiles>a'),classesAll:all('.mh-track .mc-card'),panelsAll:all('.mh-main>section,.mh-rail>section,.ch-panel'),structureAncestor:!!home.closest('.cs-structure'),shell:document.querySelector('[data-shell-variant]')?.getAttribute('data-shell-variant'),hero:get('.sh-hero'),chip:get('.sh-hchip'),button:get('.sh-hcta'),tile:get('.mh-summary>button,.ch-tiles>a'),classCard:get('.mh-track .mc-card'),panel:get('.mh-main>section,.ch-panel'),home:getComputedStyle(home).gap,tiles:getComputedStyle(stats).gap,classCount:cards.length,scrollWidth:document.documentElement.scrollWidth,heroWidth:hero.width,reviewGap:document.querySelector('.ch-review')?document.querySelector('.ch-review').getBoundingClientRect().top-hero.bottom:null};
 });
 const name=role==='client'?'member':'counselor';
 const filename='parity-'+width+'-'+name+'.png';
 await page.screenshot({path:path.join(out,filename),fullPage:true});
 shots.push(await page.screenshot());
 await page.locator('section[aria-label="내 클래스"]').scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(out,'parity-'+width+'-'+name+'-classes.png')});
 await page.locator(role==='client'?'.mh-main>section':'.ch-panel').first().scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(out,'parity-'+width+'-'+name+'-panels.png')});
 results.push({width,role,mode:built?'build':'dev',...metrics,errors});await page.close();
 }
 // 실제 두 라우트 캡처를 나란히 놓는다. 이미지에 적용되는 스타일 보정은 없다.
 const compare=await browser.newPage({viewport:{width:width*2,height:1000}});
 await compare.setContent('<body style="margin:0;display:flex">'+shots.map(b=>'<img style="width:'+width+'px" src="data:image/png;base64,'+b.toString('base64')+'">').join(''));
 await compare.screenshot({path:path.join(out,'parity-'+width+'.png')});await compare.close();
 }
 fs.writeFileSync(path.join(out,'parity.json'),JSON.stringify(results,null,2));
 const failures=[];
 for(const width of [390,1440]) {
 const [m,c]=results.filter(x=>x.width===width);
 for(const part of ['hero','chip','button','tile','classCard','panel'])for(const key of ['borderRadius','height','minHeight','padding','borderWidth','borderColor','boxShadow'])if(m[part][key]!==c[part][key])failures.push(`${width} ${part}.${key}: ${m[part][key]} != ${c[part][key]}`);
 for(const group of ['tilesAll','classesAll','panelsAll']){
 const expected=m[group].find((card)=>!card.rail)??m[group][0];
 const keys=group==='panelsAll'?['borderRadius','minHeight','padding','borderWidth','borderColor','boxShadow']:['borderRadius','height','padding','borderWidth','borderColor','boxShadow'];
 for(const x of [m,c])for(const [index,card] of x[group].entries())for(const key of keys){
   // PR #60: 레일 카드(.home-rail-card)는 내용 높이에 맞춘다 — 최소 높이 0을 따로 확인한다.
   if(group==='panelsAll'&&key==='minHeight'&&card.rail){if(card.minHeight!=='0px')failures.push(`${width} ${x.role} rail[${index}].minHeight: ${card.minHeight} != 0px`);continue;}
   if(card[key]!==expected[key])failures.push(`${width} ${x.role} ${group}[${index}].${key}: ${card[key]} != ${expected[key]}`);}
 }
 if(m.tilesAll.length!==4||c.tilesAll.length!==4)failures.push(width+' 상태카드 개수');
 if(m.heroWidth!==c.heroWidth)failures.push(width+' hero width '+m.heroWidth+' != '+c.heroWidth);
 if(m.home!==c.home||m.home!=='24px')failures.push(width+' section gap');
 if(c.structureAncestor)failures.push('상담사 .cs-structure 독립 조건 실패');
 if(c.reviewGap!==24)failures.push(width+' review gap '+c.reviewGap);
 for(const x of [m,c])if(x.classCount!==4||x.scrollWidth>width||x.errors.length)failures.push(width+' 카드/넘침/JS오류');
 }
 console.log(JSON.stringify({results,failures},null,2));
 if(failures.length)throw Error(failures.join('\n'));
 } finally {await browser.close();if(built)await new Promise((resolve,reject)=>server.httpServer.close(e=>e?reject(e):resolve()));else await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
