// 원본 저장소의 Playwright를 직접 참조한다. 설치·심링크·환경변수 로딩 없음.
const { chromium } = require('/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
(async () => {
 const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const results=[];const base=pathToFileURL(path.join(__dirname,'index.html')).href;
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:1000},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('file:')?r.continue():r.abort());
  for(const variant of ['current','A','B']) for(const state of variant==='current'?['none']:['none','hand-one','hand-many','quiet-one','quiet-many','status']){
   await page.goto(`${base}?variant=${variant}&state=${state}`);await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:path.join(__dirname,'screenshots',`${variant}-${state}-${width}.png`)});
   const metrics=await page.evaluate(()=>{
    const rect=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();
    const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0};
    const buttons=[...document.querySelectorAll('button')].filter(visible);
    const badTouch=buttons.filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44}).map(e=>e.textContent);
    const textElements=[...document.querySelectorAll('.screen *, .sheet *')].filter(e=>visible(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));
    const minFont=Math.min(...textElements.map(e=>parseFloat(getComputedStyle(e).fontSize)));
    const primary=[...document.querySelectorAll('.tile b,.signals b,.toast-main b,.sheet p:not(.secondary)')].filter(visible);
    const minPrimary=Math.min(...primary.map(e=>parseFloat(getComputedStyle(e).fontSize)));
    return {minFont:Number.isFinite(minFont)?minFont:null,minPrimary:Number.isFinite(minPrimary)?minPrimary:null,overflow:document.documentElement.scrollWidth>innerWidth,badTouch,blur:[...document.querySelectorAll('*')].some(e=>{const s=getComputedStyle(e);return s.backdropFilter!=='none'||s.filter.includes('blur(')}),top:rect('.top'),head:rect('.head'),grid:rect('.participants'),signals:rect('.signals'),dock:rect('.dock'),toast:rect('.toast'),errors:[]};
   });
   if((metrics.minFont!==null&&metrics.minFont<13)||(metrics.minPrimary!==null&&metrics.minPrimary<15)||metrics.overflow||metrics.blur||metrics.badTouch.length||errors.length)throw new Error(JSON.stringify({variant,state,width,...metrics,errors}));
   if(variant!=='current'){
    for(const key of ['head','grid','signals','dock'])if(Math.abs(metrics[key].x-metrics.top.x)>1||Math.abs(metrics[key].width-metrics.top.width)>1)throw new Error(`정렬 불일치 ${variant}/${key}`);
    await page.locator('.participants').evaluate(e=>e.scrollTop=e.scrollHeight);
    const lastBottom=await page.locator('.tile').last().evaluate(e=>e.getBoundingClientRect().bottom);
    if(lastBottom>metrics.signals.top+1)throw new Error('마지막 타일 도달 불가');
    if(metrics.grid.bottom>metrics.signals.top+1)throw new Error('참가자 영역 가림');
    if(Math.abs(metrics.dock.top-metrics.signals.bottom-8)>1)throw new Error('신호 줄 위치 오류');
   }
   results.push({variant,state,width,...metrics,errors:[...errors]});
  }
  for(const variant of ['A','B']){
   await page.goto(`${base}?variant=${variant}`);
   if(variant==='B'){ await page.getByRole('button',{name:'지표 기준 열기'}).click(); await page.getByRole('dialog',{name:'지표 기준',exact:true}).waitFor(); await page.keyboard.press('Escape'); }
   await page.getByRole('button',{name:'수업 상태',exact:true}).click();
   await page.getByText('체크인 응답 보기').click();
   await page.getByText('지은 · 차분해요').waitFor({state:'visible'});
   await page.keyboard.press('Escape');
   if(await page.locator('.sheet').count())throw new Error('Escape 닫힘 실패');
   if(!await page.locator('.status').evaluate(e=>e===document.activeElement))throw new Error('포커스 복귀 실패');
   await page.goto(`${base}?variant=${variant}&state=quiet-many`);
   await page.locator('.toast-main').click();
   await page.getByRole('dialog',{name:'조용한 신호'}).waitFor();
   await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'신호 알림 닫기'}).click();
   if(await page.locator('.toast').count())throw new Error('토스트 닫기 실패');
  }
  await page.goto(base);await page.screenshot({path:path.join(__dirname,'screenshots',`overview-${width}.png`),fullPage:true});
  await page.close();
 }
 fs.writeFileSync(path.join(__dirname,'validation.json'),JSON.stringify({browser:'Google Chrome',executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',scope:'독립 HTML 시안; 제품 런타임·서버 이벤트 검증 아님',checks:['26개 화면','가로 넘침','블러','버튼 44px','컬럼 좌우 정렬','참가자 영역과 신호 줄 분리','신호 줄과 도크 간격 8px','체크인 상세 펼치기','Escape·포커스 복귀','토스트 시트 진입·닫기'],results},null,2)+'\n');
 await browser.close();console.log(`검증 완료: ${results.length}개 화면`);
})().catch(e=>{console.error(e);process.exit(1)});
