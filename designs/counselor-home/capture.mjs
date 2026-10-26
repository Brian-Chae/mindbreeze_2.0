// 고정 데이터 HTML만 file://로 연다. 서비스 서버·API·DB에 연결하지 않는다.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const here=path.dirname(fileURLToPath(import.meta.url));
const local=path.resolve(here,'../../frontend/package.json');
const shared='/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/package.json';
let playwright;try{playwright=createRequire(local)('playwright')}catch{playwright=createRequire(shared)('playwright')}
const browser=await playwright.chromium.launch({channel:'chrome',headless:true});
const sizes=[[1440,1000],[1194,834],[834,1194],[390,844]];
const results=[];const errors=[];const interactions=[];
const base=pathToFileURL(path.join(here,'index.html')).href;
fs.mkdirSync(path.join(here,'screenshots'),{recursive:true});
for(const [width,height] of sizes){
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
 // 외부 요청이 발생하면 차단하고 기록한다.
 await context.route(/^https?:/,route=>{errors.push({external:route.request().url()});return route.abort()});
 const page=await context.newPage();page.on('pageerror',error=>errors.push({width,message:error.message}));page.on('requestfailed',request=>errors.push({width,failed:request.url(),error:request.failure()?.errorText}));
 for(const [view,cases] of [['current',['normal']],['proposed',['normal','empty','partial','missing','live','long']]]){
  for(const state of cases){
   await page.goto(`${base}?view=${view}&case=${state}`);await page.waitForFunction(()=>window.__ready);await page.evaluate(async()=>{await document.fonts.load('15px "Noto Sans KR"');await document.fonts.ready});
   await page.locator('.hero').evaluateAll(nodes=>Promise.all(nodes.map(node=>{const src=getComputedStyle(node,'::before').backgroundImage.match(/url\("?([^"\)]+)/)?.[1];if(!src)return Promise.resolve();return new Promise(resolve=>{const img=new Image();img.onload=resolve;img.onerror=resolve;img.src=src})})));
   const measure=await page.evaluate(()=>{
    const visible=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
    const label=el=>el.tagName.toLowerCase()+'.'+String(el.className).replaceAll(' ','.');
    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
    const overlaps=[];
    for(const host of document.querySelectorAll('.content,.work,.rail,.stats,.old-grid,.old-main,.old-rail,.head,.actions,.hero,.strip-tools,.review,.schedule-row,.message,.card-top,.sec-head,.toolbar')){
     const children=[...host.children].filter(visible);
     for(let a=0;a<children.length;a++)for(let b=a+1;b<children.length;b++){
      const ra=rect(children[a]),rb=rect(children[b]);const x=Math.min(ra.right,rb.right)-Math.max(ra.x,rb.x),y=Math.min(ra.bottom,rb.bottom)-Math.max(ra.y,rb.y);
      if(x>1&&y>1)overlaps.push({host:label(host),a:label(children[a]),b:label(children[b]),x,y});
     }
    }
    const smallTargets=[...document.querySelectorAll('button,a,select,summary')].filter(visible).filter(el=>!el.closest('.strip')||el.getBoundingClientRect().x<innerWidth).map(el=>({label:el.textContent.trim().slice(0,35),...rect(el)})).filter(r=>r.w<43.5||r.h<43.5);
    const smallText=[...document.querySelectorAll('body *')].filter(visible).filter(el=>[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim())).filter(el=>parseFloat(getComputedStyle(el).fontSize)<12).map(label);
    const outside=[...document.querySelectorAll('.content,.head,.hero,.stats,.work,.rail,.panel,.review,.toolbar,.old-grid,.old-cards')].filter(visible).map(el=>({label:label(el),...rect(el)})).filter(r=>r.x<-.5||r.right>innerWidth+.5);
    const fontLoaded=document.fonts.check('15px "Noto Sans KR"');
    return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,pageOverflow:document.documentElement.scrollWidth-innerWidth,overlaps,smallTargets,smallText,outside,fontLoaded,firstScheduleStatus:document.querySelector('.schedule-row .chip')?.textContent||null,sectionOrder:[...document.querySelector('#screen').children].map(el=>el.id||el.className),carousel:document.querySelector('.strip')?{client:document.querySelector('.strip').clientWidth,scroll:document.querySelector('.strip').scrollWidth}:null};
   });
   const file=`${view}-${state}-${width}x${height}.png`;await page.screenshot({path:path.join(here,'screenshots',file),fullPage:true});
   results.push({view,state,width,height,screenshot:`screenshots/${file}`,...measure});
  }
 }
 await page.goto(`${base}?view=proposed&case=normal`);await page.evaluate(async()=>{await document.fonts.load('15px "Noto Sans KR"');await document.fonts.ready});
 const track=page.locator('.strip');await page.locator('#next').click();await page.waitForTimeout(400);interactions.push({width,name:'캐러셀 다음',pass:await track.evaluate(el=>el.scrollLeft>0)});
 await page.locator('#prev').click();await page.waitForTimeout(400);interactions.push({width,name:'캐러셀 이전',pass:await track.evaluate(el=>el.scrollLeft<=2)});
 await page.locator('.code summary').click();interactions.push({width,name:'상담사 코드 펼침',pass:await page.locator('.code').evaluate(el=>el.open)});
 await page.locator('[data-demo="새 클래스 /classes/new"]').click();interactions.push({width,name:'새 클래스 목적지 안내',pass:await page.locator('#demo').evaluate(el=>el.open)});await page.locator('#demo button').click();
 await page.locator('#case').selectOption('partial');await page.locator('#retry').click();interactions.push({width,name:'클래스 부분 실패 재시도',pass:await page.locator('.class-card').count()===4});
 await page.locator('[data-view="current"]').click();interactions.push({width,name:'현재 구성 전환',pass:await page.locator('.old-grid').count()===1});
 await page.locator('[data-view="proposed"]').click();interactions.push({width,name:'제안 복귀',pass:await page.locator('.hero').count()===1});
 await context.close();
}
const failed=results.filter(r=>r.pageOverflow>0||r.overlaps.length||r.smallTargets.length||r.smallText.length||r.outside.length||!r.fontLoaded||(r.state==='live'&&r.firstScheduleStatus!=='진행 중'));
const report={browser:await browser.version(),engine:'Google Chrome headless / Playwright',source:'file:// · 고정 데이터 HTML; 현재 구성은 코드 기반 재구성',date:'2026-10-22',total:results.length,failed:failed.length,errors,interactions,results};
fs.writeFileSync(path.join(here,'fit-results.json'),JSON.stringify(report,null,2)+'\n');await browser.close();
console.log(JSON.stringify({browser:report.browser,total:results.length,failed:failed.map(r=>({view:r.view,state:r.state,width:r.width,overflow:r.pageOverflow,overlaps:r.overlaps,smallTargets:r.smallTargets,smallText:r.smallText,outside:r.outside,font:r.fontLoaded})),errors,interactionsFailed:interactions.filter(r=>!r.pass)},null,2));
if(failed.length||errors.length||interactions.some(r=>!r.pass))process.exitCode=1;
