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
  for(const sel of ['.topline','.titlebar','.stats','.tabs','.workspace','.filters','.section-head','.note-bottom','.record-header','.record-meta','.chart-grid','.metric-grid','.dialog-head','.dialog-body','.dialog-foot']){
   const host=document.querySelector(sel);if(!host)continue;const nodes=[...host.children].filter(visible);
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
await page.setViewportSize({width:1440,height:1000});
await page.goto(url+'?tab=detail');await snap('1440-measurement-detail');
checks.push({name:'측정 메타 기본 비공개',pass:(await page.locator('#measurement-demographics').innerText()).includes('비공개')});
await page.locator('#reveal-measurement-meta').click();checks.push({name:'측정 메타 개별 열람',pass:(await page.locator('#measurement-demographics').innerText()).includes('1990.01')});
await page.locator('#wave-zoom').selectOption('30');checks.push({name:'원파형 확대 범위 변경',pass:(await page.locator('#selection-label').innerText()).includes('표시 30초')});
await page.locator('#range-start').fill('120');await page.locator('#range-end').fill('130');await page.locator('#apply-range').click();checks.push({name:'원파형 구간 선택',pass:(await page.locator('#selection-label').innerText()).includes('120.0–130.0')});
await page.locator('#wave-next').click();checks.push({name:'원파형 시간 이동',pass:(await page.locator('#selection-label').innerText()).includes('132.0')});
for(const signal of ['ppg','acc']){await page.locator(`[data-signal="${signal}"]`).click();checks.push({name:signal+' 미저장 안내',pass:(await page.locator('#signal-body').innerText()).includes('서버에 저장되지')});await snap('1440-detail-'+signal)}
await page.goto(url+'?tab=measurements&modal=download');await snap('1440-download-dialog');
checks.push({name:'빈 사유·재인증 미선택 제출 차단',pass:await page.locator('#download-form').evaluate(f=>!f.checkValidity())});
await page.locator('#download-reason').fill('합성 데이터 원본 검증');await page.locator('#reauth').check();await page.locator('#download-format').selectOption('Parquet');await page.locator('#download-form button[type="submit"]').click();
checks.push({name:'Parquet 합성 작업 생성',pass:(await page.locator('#table').innerText()).includes('Parquet + bin')});await snap('1440-download-created');
await page.goto(url+'?tab=downloads');await snap('1440-download-jobs');checks.push({name:'만료 작업 다운로드 차단',pass:await page.getByRole('button',{name:'다운로드 불가',exact:true}).isDisabled()});
await page.goto(url+'?tab=audit');await snap('1440-download-audit');checks.push({name:'감사에 요청자·사유·차단 기록',pass:(await page.locator('#table').innerText()).includes('가상 관리자')&&(await page.locator('#table').innerText()).includes('차단')});
await page.goto(url+'?tab=measurements');await page.locator('#select-all').check();checks.push({name:'다중 선택 2건',pass:(await page.locator('.actionbar').innerText()).includes('2건 선택')});await page.locator('#download-selected').click();await snap('1440-download-bulk');
await page.locator('#download-purpose').selectOption('research');await page.locator('#download-reason').fill('합성 연구 분석');await page.locator('#reauth').check();await page.locator('#download-form button[type="submit"]').click();checks.push({name:'비회원 포함 연구 일괄 차단',pass:(await page.locator('#download-policy').innerText()).startsWith('차단')});await snap('1440-download-blocked');
await page.locator('#close-download').click();await page.locator('[data-open-record="M-303"]').click();checks.push({name:'밴드 미사용 원본 다운로드 차단',pass:await page.locator('#record-page [data-download]').isDisabled()});await snap('1440-detail-unworn');
const failed=results.filter(r=>r.pageOverflow>0||r.overlap.length||r.clipped.length);
const report={date:'2026-10-24',browser:await browser.version(),source:'합성 HTML file:// / 외부 요청 차단',results,checks,errors};
fs.writeFileSync(path.join(here,'capture-results.json'),JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({captures:results.length,failed,checks,errors},null,2));if(failed.length||errors.length||checks.some(c=>!c.pass))process.exitCode=1;
