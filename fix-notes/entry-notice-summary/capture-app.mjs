// 실제 앱 라우트와 CSS를 사용한다. 합성 입장 자격/API만 제공하며 외부 통신을 차단한다.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const dir=path.dirname(fileURLToPath(import.meta.url));
const frontend=path.resolve(dir,'../../frontend');
process.chdir(frontend);
const require=createRequire(path.join(frontend,'package.json'));
const {chromium}=require('playwright');
const {createServer}=await import('node:http');
const dist=path.join(frontend,'dist');
const server=createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1:5198').pathname);
 const target=path.join(dist,pathname);const file=target.startsWith(dist)&&fs.existsSync(target)&&fs.statSync(target).isFile()?target:path.join(dist,'index.html');
 const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png'};
 res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(5198,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const sid='a1111111-1111-4111-8111-111111111111',pid='b1111111-1111-4111-8111-111111111111';
const results=[];
try{
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:900},serviceWorkers:'block'});
  const page=await context.newPage();page.setDefaultTimeout(10000);const writes=[],errors=[],blocked=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.routeWebSocket(/.*/,ws=>ws.close());
  await page.addInitScript(({sid,pid})=>{
   sessionStorage.setItem('mb_entry_'+sid,JSON.stringify({sessionId:sid,credential:'mock-notice-entry',expiresAt:null,participantId:pid,isGuest:false,eegCollectionConsented:true,classInfo:{sessionType:'meditation',title:'마음챙김 명상 · 4회차',hostName:'시연 상담사',scheduledAt:null,startedAt:null,durationMin:50,locationType:'online',locationAddress:null,participantMode:'group',linkbandMode:'optional',maxParticipants:10,recordAudio:true,recordVideo:true}}));
   // 기존 자연 배경의 무작위 선택만 고정하여 캡처를 재현한다.
   Math.random=()=>0.21;
  },{sid,pid});
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.pathname.startsWith('/api/')){
    if(u.pathname.endsWith('/entry-state'))return route.fulfill({json:{session_id:sid,status:'open',guest_state:'waiting',in_progress:false,ended:false,participant_id:pid,is_waitlisted:false,report_included:false,started_at:null,ended_at:null,chat_enabled:false,band_connected:false}});
    if(u.pathname.endsWith('/report-choice')||u.pathname.endsWith('/research-consent')){const data=req.postDataJSON();writes.push({path:u.pathname,body:data});return route.fulfill({json:{participant_id:pid,report_included:data.report_included??false,consented:data.consented??false,changed:true}});}
    if(u.pathname.includes('/auth/refresh'))return route.fulfill({status:401,json:{detail:'mock unauthenticated'}});
    return route.fulfill({status:200,json:{items:[],data:[]}});
   }
   if(u.origin!=='http://127.0.0.1:5198'){blocked.push(u.origin);return route.abort();}
   if(u.pathname.startsWith('/socket.io'))return route.abort();
   return route.continue();
  });
  await page.goto(`http://127.0.0.1:5198/class/${sid}/enter`,{waitUntil:'domcontentloaded',timeout:60000});
  
  await page.getByRole('button',{name:'입장하기',exact:true}).click();
  await page.getByRole('heading',{name:'시작 전에 확인해 주세요',exact:true}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(300);
  const metrics=await page.evaluate(()=>{
   const body=document.querySelector('.fl-body'),cta=document.querySelector('[data-pz="flow-cta"]'),r=cta.getBoundingClientRect();
   const texts=[...document.querySelectorAll('.fl-col *, .fl-foot *')].filter(e=>e.getBoundingClientRect().width&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));
   return {viewport:[innerWidth,innerHeight],page:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],bodyHeight:body.clientHeight,bodyScroll:body.scrollHeight,ctaBottom:r.bottom,smallTexts:texts.filter(e=>parseFloat(getComputedStyle(e).fontSize)<13).map(e=>({text:e.textContent,size:getComputedStyle(e).fontSize})),smallTargets:[...document.querySelectorAll('button,a')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&(r.width<44||r.height<44)}).map(e=>e.textContent),radioStates:[...document.querySelectorAll('[role="radio"]')].map(e=>e.getAttribute('aria-checked')),research:document.querySelector('[role="checkbox"]').getAttribute('aria-checked'),coreFontSizes:[...document.querySelectorAll('.notice-conditions,.notice-research-copy,.notice-tiles strong')].map(e=>parseFloat(getComputedStyle(e).fontSize)),blurred:[...document.querySelectorAll('.pz-root,.pz-root *')].filter(e=>getComputedStyle(e).backdropFilter!=='none'||getComputedStyle(e).filter.includes('blur(')).map(e=>e.className)};
  });
  fs.mkdirSync(path.join(dir,'screenshots'),{recursive:true});
  await page.screenshot({path:path.join(dir,`screenshots/default-${width}.png`)});
  if(process.env.NOTICE_CAPTURE_ONLY==='1'){results.push({width,metrics,errors,blocked});await context.close();continue;}
  console.log('기본 화면 실측',JSON.stringify(metrics));
  assert.equal(metrics.bodyScroll,metrics.bodyHeight,'본문 스크롤 없음');assert(metrics.ctaBottom<=metrics.viewport[1]);assert.deepEqual(metrics.smallTexts,[]);assert.deepEqual(metrics.smallTargets,[]);assert.deepEqual(metrics.radioStates,['false','false']);assert.equal(metrics.research,'false');assert(metrics.coreFontSizes.every(n=>n>=15));assert.deepEqual(metrics.blurred,[]);
  const sheetResults=[];
  for(const [key,label] of [['record','기록 안내 자세히 보기'],['report','리포트 반영 자세히 보기'],['research','연구 데이터 활용 자세히 보기']]){
   const opener=page.getByRole('button',{name:label,exact:true});await opener.click();const dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.evaluate(async e=>{await Promise.all(e.getAnimations().map(a=>a.finished))});
   assert(await dialog.locator('.notice-detail').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));
   await page.screenshot({path:path.join(dir,`screenshots/${key}-${width}.png`)});
   const sheet=await dialog.evaluate(e=>({mode:e.dataset.mode,rect:{left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,bottom:e.getBoundingClientRect().bottom},text:e.textContent}));
   console.log('시트 실측',key,sheet.rect);assert.equal(sheet.mode,'bottom');assert(sheet.rect.bottom<= (width===390?844:900));
   if(key==='research')assert(sheet.text.includes('비식별 처리해도 다른 정보와 결합하면 본인을 알아볼 가능성이 완전히 없지는 않아요'));
   if(key==='report')assert(sheet.text.includes('이미 보낸 리포트는 되돌릴 수 없어요'));
   await page.keyboard.press('Escape');assert.equal(await opener.evaluate(e=>document.activeElement===e),true);sheetResults.push({key,...sheet});
  }
  assert.deepEqual(writes,[],'시트 확인만으로 제출하지 않음');
  await page.getByRole('checkbox').click();await page.waitForTimeout(80);await page.getByRole('checkbox').click();await page.waitForTimeout(80);
  await page.getByRole('button',{name:'확인하고 계속하기',exact:true}).click();await page.waitForTimeout(150);
  assert.deepEqual(writes.filter(w=>w.path.endsWith('/research-consent')).map(w=>w.body),[{consented:true,notice_version:'r5-1',participant_id:pid},{consented:false,notice_version:'r5-1',participant_id:pid}]);
  assert.deepEqual(writes.find(w=>w.path.endsWith('/report-choice'))?.body,{participant_id:pid,report_included:false,notice_acknowledged:true,notice_version:'class-team-v1'});
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'입장하기',exact:true}).click();await page.getByRole('radio',{name:'반영해요',exact:true}).click();await page.getByRole('button',{name:'확인하고 계속하기',exact:true}).click();await page.waitForTimeout(150);assert.equal(writes.filter(w=>w.path.endsWith('/report-choice')).at(-1).body.report_included,true);
  assert.deepEqual(errors,[]);results.push({width,metrics,sheets:sheetResults,writes,errors,blocked});await context.close();
 }
 fs.writeFileSync(path.join(dir,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(r=>({width:r.width,metrics:r.metrics,errors:r.errors})),null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
