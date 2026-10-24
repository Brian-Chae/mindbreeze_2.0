// 합성 HTML만 file://로 열고 모든 네트워크 요청을 차단한다.
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const here=path.dirname(fileURLToPath(import.meta.url));
let playwright;
try{playwright=createRequire(path.resolve(here,'../../frontend/package.json'))('playwright')}
catch{playwright=createRequire('/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/package.json')('playwright')}
const browser=await playwright.chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[],results=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route(/^https?:/,r=>{errors.push('외부 요청: '+r.request().url());return r.abort()});
const url=pathToFileURL(path.join(here,'index.html')).href;
async function snap(name){
 await page.evaluate(()=>document.fonts.ready);
 const fit=await page.evaluate(()=>{
  const visible=e=>e.getClientRects().length&&getComputedStyle(e).display!=='none';
  const overlap=[];
  for(const sel of ['.topline','.titlebar','.stats','.tabs','.workspace','.filters','.section-head','.note-bottom']){
   const host=document.querySelector(sel),nodes=[...host.children].filter(visible);
   for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    const a=nodes[i].getBoundingClientRect(),b=nodes[j].getBoundingClientRect();
    if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlap.push(sel);
   }
  }
  const clipped=[...document.querySelectorAll('h1,h2,h3,button,input,select,.stat,.detail dd')].filter(visible).filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.textContent.slice(0,50));
  return {width:innerWidth,pageOverflow:document.documentElement.scrollWidth-innerWidth,overlap,clipped};
 });
 await page.screenshot({path:path.join(here,'captures',name+'.png'),fullPage:true});results.push({name,...fit});
}
for(const tab of ['overview','users','measurements','research','retention','standards']){await page.goto(url+'?tab='+tab);await snap('1440-'+tab)}
await page.goto(url+'?tab=research');await page.locator('[data-sub="consents"]').click();await snap('1440-research-consents');await page.locator('[data-sub="batches"]').click();await snap('1440-research-batches');
await page.goto(url+'?tab=retention');for(const sub of ['candidates','deletion']){await page.locator(`[data-sub="${sub}"]`).click();await snap('1440-retention-'+sub)}
await page.goto(url+'?tab=standards');await page.locator('[data-sub="baselines"]').click();await snap('1440-standards-baselines');
await page.goto(url+'?tab=users');await page.locator('#reveal').click();checks.push({name:'개별 개인정보 열람',pass:(await page.locator('#detail').innerText()).includes('010-0000-0000')});await snap('1440-users-revealed');
await page.locator('[data-select="U-1043"]').click();checks.push({name:'대상 변경 시 재마스킹',pass:(await page.locator('#detail').innerText()).includes('010-****-0000')});
await page.locator('#group').selectOption('group');checks.push({name:'기관별 그룹핑',pass:await page.locator('.group-row').count()===2});await snap('1440-users-grouped');
await page.locator('#status').selectOption('비회원');checks.push({name:'상태 필터',pass:await page.locator('tr[data-row]').count()===1});
await page.locator('#search').fill('검색결과없음');await snap('1440-empty');await page.locator('#reset').click();checks.push({name:'빈 상태 초기화',pass:await page.locator('tr[data-row]').count()===6});
await page.locator('#reveal').click();await page.locator('[data-tab="overview"]').click();await page.locator('[data-tab="users"]').click();checks.push({name:'탭 이동 시 재마스킹',pass:(await page.locator('#detail').innerText()).includes('010-****-0000')});
await page.setViewportSize({width:390,height:844});await page.goto(url+'?tab=users');await snap('390-users');
await page.locator('[data-select="U-1042"]').click();await snap('390-users-detail');checks.push({name:'모바일 상세 열기',pass:await page.locator('#detail').isVisible()});await page.locator('#reveal').click();await page.locator('#close-detail').click();checks.push({name:'모바일 닫기 시 원문 폐기',pass:!(await page.locator('#detail').innerText()).includes('010-0000-0000')});checks.push({name:'모바일 상세 닫기',pass:!await page.locator('#detail').isVisible()});
const failed=results.filter(r=>r.pageOverflow>0||r.overlap.length||r.clipped.length);
const report={date:'2026-10-24',browser:await browser.version(),source:'합성 HTML file:// / 외부 요청 차단',results,checks,errors};
fs.writeFileSync(path.join(here,'capture-results.json'),JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({captures:results.length,failed,checks,errors},null,2));if(failed.length||errors.length||checks.some(c=>!c.pass))process.exitCode=1;
