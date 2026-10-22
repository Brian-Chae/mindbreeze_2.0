// 원본 저장소의 Playwright를 재사용하며 의존성 설치·심링크는 만들지 않는다.
const { chromium } = require(process.env.CHECKIN_PLAYWRIGHT || '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/node_modules/playwright');
const fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
(async()=>{
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({deviceScaleFactor:1}); const root=__dirname; const data=[];
for(const v of ['A','B','C'])for(const [size,width,height] of [['mobile',390,844],['desktop',1440,900]])for(const q of ['arousal','emotion'])for(const selected of [false,true]){
 await page.setViewportSize({width,height});await page.goto(pathToFileURL(path.join(root,'index.html')).href+`?v=${v}&q=${q}&selected=${selected?'4':''}`);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(400);
 const id=`${v}-${size}-${q==='arousal'?'focus':'emotion'}-${selected?'selected':'unselected'}`;
 const result=await page.evaluate(()=>{
  const h=document.querySelector('h1'),hr=h.getBoundingClientRect();const rects=[];
  const walk=document.createTreeWalker(document.querySelector('.screen'),NodeFilter.SHOW_TEXT);
  while(walk.nextNode()){const n=walk.currentNode;if(!n.textContent.trim()||n.parentElement.closest('.design-label'))continue;const range=document.createRange();range.selectNodeContents(n);const cs=getComputedStyle(n.parentElement);for(const r of range.getClientRects())if(r.width&&r.height)rects.push({text:n.textContent.trim(),color:cs.color,x:r.x,y:r.y,width:r.width,height:r.height});}
  return {titleSize:parseFloat(getComputedStyle(h).fontSize),optionSizes:[...document.querySelectorAll('.option')].map(e=>parseFloat(getComputedStyle(e).fontSize)),targets:[...document.querySelectorAll('button')].map(e=>({text:e.textContent.trim(),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,rects,checked:document.querySelectorAll('[aria-checked=true]').length,nextDisabled:document.querySelector('.next').disabled,fonts:document.fonts.check('18px "Pretendard Variable"'),blur:[...document.querySelectorAll('*')].some(e=>getComputedStyle(e).backdropFilter!=='none'||getComputedStyle(e).filter.includes('blur'))};
 });
 if(result.overflow||result.blur||result.titleSize<(size==='mobile'?24:32)||result.optionSizes.some(s=>s<17)||result.targets.some(t=>t.height<48||t.width<48)||result.checked!==(selected?1:0)||result.nextDisabled===selected)throw Error(id+JSON.stringify(result));
 await page.screenshot({path:path.join(root,'screenshots',id+'.png')});
 await page.addStyleTag({content:'.screen *{color:transparent!important;text-shadow:none!important}'});await page.screenshot({path:'/tmp/checkin-'+id+'-background.png'});
 data.push({id,...result});
}
await page.setViewportSize({width:1440,height:1100});await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(700);await page.screenshot({path:path.join(root,'screenshots','comparison.png'),fullPage:true});
// 실제 클릭·키보드·건너뛰기 계약을 별도로 확인한다.
for(const v of ['A','B','C']){
 await page.goto(pathToFileURL(path.join(root,'index.html')).href+`?v=${v}`);await page.getByRole('radio',{name:'집중',exact:true}).click();await page.getByRole('button',{name:'다음',exact:true}).click();if(await page.locator('h1').innerText()!=='지금 몸은 얼마나 편안한가요?')throw Error('다음 이동');await page.getByRole('radio',{name:'편안',exact:true}).focus();await page.keyboard.press('ArrowRight');if(await page.locator('[aria-checked=true]').innerText()!=='매우 편안')throw Error('키보드');await page.getByRole('button',{name:'건너뛰기',exact:true}).click();const r=await page.evaluate(()=>window.prototypeResult);if(r.kind!=='skip'||r.draft.arousal!==4||r.draft.valence!==5||r.draft.emotion!==null)throw Error('건너뛰기');
}
fs.writeFileSync(path.join(root,'capture-metrics.json'),JSON.stringify({chrome:browser.version(),viewportChecks:data,interactionChecks:'A/B/C 선택·다음·방향키·전체 건너뛰기 통과'},null,2));await browser.close();
})();
