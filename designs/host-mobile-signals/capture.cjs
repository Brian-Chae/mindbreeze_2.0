// 설치된 Chrome으로 로컬 파일만 열어 시안과 조작을 검증한다.
const { chromium } = require('../../frontend/node_modules/playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage();const results=[];const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(/^https?:/,route=>route.abort());
 const base=pathToFileURL(path.join(__dirname,'index.html')).href;
 for(const width of [390,1440])for(const variant of ['current','a','b'])for(const state of ['none','hand','signals','toast','sheet','quiet','speaking']){
  await page.setViewportSize({width,height:width===390?844:1000});
  await page.goto(`${base}?capture=1&variant=${variant}&state=${state}`);
  await page.waitForTimeout(80);
  const metrics=await page.evaluate(()=>{
   const shown=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'};
   const visibleButtons=[...document.querySelectorAll('.screen button')].filter(shown);
   return {overflow:document.documentElement.scrollWidth>innerWidth,smallTargets:visibleButtons.filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44}).map(e=>e.textContent.trim()),smallFonts:[...document.querySelectorAll('.screen *')].filter(shown).filter(e=>parseFloat(getComputedStyle(e).fontSize)<13).map(e=>e.tagName),blur:[...document.querySelectorAll('*')].some(e=>getComputedStyle(e).backdropFilter!=='none')};
  });
  if(metrics.overflow||metrics.smallTargets.length||metrics.smallFonts.length||metrics.blur)throw Error(JSON.stringify({width,variant,state,...metrics}));
  await page.screenshot({path:path.join(__dirname,'screenshots',`${variant}-${state}-${width}.png`)});
  results.push({width,variant,state,...metrics});
 }
 await page.setViewportSize({width:390,height:844});
 await page.goto(`${base}?capture=1&variant=a&state=hand`);
 await page.locator('#signalbar [data-open="hands"]').click();
 await page.getByRole('button',{name:'발언권 주기',exact:true}).click();
 if(!await page.locator('#sheet-body').getByText('발언권 있음',{exact:true}).isVisible())throw Error('발언권 상태 갱신 실패');
 await page.getByRole('button',{name:'발언권 회수',exact:true}).click();
 if(!await page.getByText('손든 회원이 없어요.',{exact:true}).isVisible())throw Error('회수 후 빈 상태 실패');
 await page.keyboard.press('Escape');
 if(await page.evaluate(()=>document.activeElement?.dataset.open)!=='hands')throw Error('조치 후 포커스 복귀 실패');
 await page.goto(`${base}?capture=1&variant=a&state=hand`);
 await page.locator('#signalbar [data-open="hands"]').click();await page.getByRole('button',{name:'손 내리기',exact:true}).click();
 if(!await page.getByText('손든 회원이 없어요.',{exact:true}).isVisible())throw Error('손 내리기 실패');
 await page.goto(`${base}?capture=1&variant=a&state=toast`);await page.locator('.toast .message').click();
 const text=await page.locator('#sheet').innerText();if(text.includes('회원 A')||!text.includes('조금 어려워요'))throw Error('익명 집계 검증 실패');
 await page.goto(`${base}?capture=1&variant=b&state=none`);await page.getByRole('button',{name:'더보기',exact:true}).click();await page.locator('#sheet [data-open="checkin"]').click();
 if(await page.locator('#sheet-title').innerText()!=='체크인 요약')throw Error('B안 더보기 경로 실패');
 await page.keyboard.press('Escape');
 if(await page.evaluate(()=>document.activeElement?.dataset.open)!=='more')throw Error('시트 전환 후 포커스 복귀 실패');
 await page.setViewportSize({width:1440,height:1000});
 await page.goto(`${base}?capture=1&variant=b&state=signals`);
 if(!await page.locator('#dock').getByText('지표 기준',{exact:true}).isVisible()||await page.locator('#desktop-signals').innerText())throw Error('데스크톱 기존 도크 및 단일 칩 줄 유지 실패');
 if(errors.length)throw Error(errors.join('\n'));
 fs.writeFileSync(path.join(__dirname,'validation.json'),JSON.stringify({browser:'Google Chrome headless',executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',scope:'독립 HTML 시안, 서버 연결 없음',screens:results,interactions:['A 손들기→발언권 부여→회수','A 손 내리기','토스트→이름 없는 신호 집계','B 더보기→체크인','Escape 닫기 및 조치/시트 전환 후 포커스 복귀','1440px 기존 도크 및 단일 칩 줄 유지'],errors},null,2)+'\n');
 await browser.close();console.log(`화면 ${results.length}개 및 조작 검증 통과`);
})().catch(e=>{console.error(e);process.exitCode=1});
