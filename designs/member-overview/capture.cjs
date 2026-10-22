// 정적 시안만 검증하며 서비스·DB·환경파일에 접근하지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const playwrightPath = process.env.MB_PLAYWRIGHT_PATH || path.resolve(__dirname, '../../frontend/node_modules/playwright');
const {chromium} = require(playwrightPath);
(async()=>{
 const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const audit = {browser:await browser.version(),source:'가상 데이터 정적 HTML, file:// 로만 확인',screens:[],interactions:[]};
 try {
 for(const width of [1440,1194,390]){
  for(const view of ['table','cards','detail']){
   const page=await browser.newPage({viewport:{width,height:width===390?844:1000},deviceScaleFactor:1});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href+'#'+view);
   await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:path.join(__dirname,`${view}-${width}.png`),fullPage:true});
   const geometry=await page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};
    const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const regions=[...document.querySelectorAll('.intro,.filters,.listbar,#results,.detailheader,.privacy,.statstrip,.detailgrid,.footnote')].filter(visible).map(e=>({selector:e.className||e.id,...rect(e)}));
    const clipped=[...document.querySelectorAll('h1,h2,h3,p,button,label,.detailfacts,.changehead')].filter(visible).filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>({tag:e.tagName,text:e.textContent.slice(0,60)}));
    const tw=document.querySelector('.tablewrap');
    return {viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,pageOverflow:document.documentElement.scrollWidth>innerWidth,tableInternalScroll:tw?tw.scrollWidth>tw.clientWidth:false,regions,clipped,font:getComputedStyle(document.body).fontFamily,pretendardLoaded:document.fonts.check('15px "Pretendard Variable"')};
   });
   audit.screens.push({view,width,file:`${view}-${width}.png`,errors,...geometry});
   await page.close();
  }
 }
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href+'#table');
 const check=(name,passed)=>{audit.interactions.push({name,passed});if(!passed)throw Error(name)};
 await page.locator('#search').fill('윤가온');await page.locator('#searchform button').click();check('이름 검색 1명',await page.locator('tbody tr').count()===1);
 await page.locator('[data-mode="cards"]').click();check('카드 전환 후 검색 유지',await page.locator('.membercard').count()===1 && await page.locator('#search').inputValue()==='윤가온');
 await page.locator('#reset').click();check('초기화 6명',await page.locator('.membercard').count()===6);
 await page.locator('#online').selectOption('온라인');check('온라인 필터 2명',await page.locator('.membercard').count()===2);
 await page.locator('#group').selectOption('클래스');check('클래스 그룹',await page.locator('#results').innerText().then(t=>t.includes('아침 호흡 · 2명')));
 await page.locator('[data-id="1"]').first().click();check('회원 상세 이동',await page.locator('h1').innerText()==='윤가온');
 await page.locator('[data-type="상담"]').click();check('상담 타임라인 필터',await page.locator('.event:visible').count()===1);
 await page.locator('#period').selectOption('최근 7일');await page.locator('[data-type="밴드"]').click();check('기간 다음 유형 교집합',await page.locator('.event:visible').count()===0);await page.locator('#period').selectOption('최근 30일');check('유형 다음 기간 교집합',await page.locator('.event:visible').count()===1 && await page.locator('.timeline-day:visible').count()===1);
 await page.locator('.back').click();check('목록 복귀 필터 유지',await page.locator('#online').inputValue()==='온라인');
 await page.locator('#reset').click();await page.locator('#search').fill('없는이름');await page.locator('#searchform button').click();check('빈 검색 결과',await page.locator('.empty').count()===1);
 await page.close();
 } finally {fs.writeFileSync(path.join(__dirname,'layout-audit.json'),JSON.stringify(audit,null,2)+'\n');await browser.close();}
 const failures=audit.screens.filter(s=>s.pageOverflow||s.errors.length||s.clipped.length);
 console.log(JSON.stringify({screens:audit.screens.length,failures,interactions:audit.interactions},null,2));
 if(failures.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
