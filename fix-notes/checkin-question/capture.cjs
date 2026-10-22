// 실행: frontend에서 node ../fix-notes/checkin-question/serve.mjs, 별도 터미널에서 이 파일 실행.
// 실제 앱 라우트의 설문 픽스처만 React 상태로 감싸 선택 전후를 검증한다. API 요청은 차단한다.
const {chromium}=require('/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({deviceScaleFactor:1});
await page.route('**/*',route=>{
 const url=new URL(route.request().url());
 if((url.hostname==='127.0.0.1' && !url.pathname.startsWith('/api')) || ['cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname) || url.protocol==='data:')return route.continue();
 return route.abort();
});
const metrics=[];
for(const [size,width,height] of [['mobile',390,844],['desktop',1440,900]]){
 await page.setViewportSize({width,height});
 for(const version of ['before','after'])for(const [q,screen,key] of [['focus','FM06b','on-group-opt-member-q1'],['emotion','FM06b','on-group-opt-member-q3'],['code','FM04','default'],['notice','FM06a','on-group-opt-member']]){
  const port=version==='before'?5187:5188;
  await page.goto(`http://127.0.0.1:${port}/design/class-flow?screen=${screen}&case=${key}`);
  await page.waitForFunction(()=>window.__ready===true);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);
  for(const selected of (screen==='FM06b'?[false,true]:[false])){
   if(selected)await page.getByRole('radio').nth(3).click();
   const id=`${version}-${size}-${q}-${selected?'selected':'unselected'}`;
   const result=await page.evaluate(()=>{
    const root=document.querySelector('.pz-root');
    const nodes=[...root.querySelectorAll('*')];
    const geometry=nodes.filter(e=>!e.closest('.pz-backdrop')).map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {tag:e.tagName,cls:e.className,x:r.x,y:r.y,width:r.width,height:r.height,font:s.fontSize,color:s.color,background:s.backgroundColor,border:s.borderColor,opacity:s.opacity};});
    const rects=[]; const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    while(walk.nextNode()) {const n=walk.currentNode;if(!n.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(n);const s=getComputedStyle(n.parentElement);for(const r of range.getClientRects())if(r.width&&r.height)rects.push({text:n.textContent.trim(),color:s.color,x:r.x,y:r.y,width:r.width,height:r.height});}
    return {geometry,rects,titleSize:getComputedStyle(root.querySelector('h1')).fontSize,optionSizes:[...root.querySelectorAll('.fm-opt')].map(e=>getComputedStyle(e).fontSize),optionHeights:[...root.querySelectorAll('.fm-opt')].map(e=>e.getBoundingClientRect().height),checked:root.querySelectorAll('[aria-checked=true]').length,nextDisabled:root.querySelector('.fl-btn[data-kind=primary]')?.disabled,blur:nodes.some(e=>getComputedStyle(e).filter.includes('blur')||getComputedStyle(e).backdropFilter!=='none'),fontReady:document.fonts.check('18px "Pretendard Variable"'),overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight};
   });
   if(version==='after'&&screen==='FM06b'){
    if(result.titleSize!==(size==='mobile'?'28px':'40px')||result.optionSizes.some(s=>s!=='18px')||result.optionHeights.some(h=>h<58)||result.checked!==(selected?1:0)||result.nextDisabled===selected||result.blur||result.overflow)throw Error(id+JSON.stringify(result));
   }
   await page.screenshot({path:path.join(__dirname,id+'.png')});
   await page.addStyleTag({content:'.pz-root *{color:transparent!important;text-shadow:none!important}'});
   await page.screenshot({path:'/tmp/checkin-'+id+'-background.png'});
   await page.evaluate(()=>document.querySelector('head style:last-child')?.remove());
   metrics.push({id,...result});
  }
 }
}
// 별도 실제 키보드 선택: 초기 단일 tab stop, 방향키 순환, 원래 값 4 카드 선택.
await page.goto('http://127.0.0.1:5188/design/class-flow?screen=FM06b&case=on-group-opt-member-q1');await page.waitForFunction(()=>window.__ready===true);
await page.getByRole('radio').first().focus();await page.keyboard.press('End');if(await page.locator('[role=radio][aria-checked=true]').innerText()!=='매우 집중')throw Error('End');await page.keyboard.press('ArrowRight');if(await page.locator('[role=radio][aria-checked=true]').innerText()!=='매우 산만')throw Error('순환');await page.keyboard.press('ArrowUp');await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');if(await page.locator('[role=radio][aria-checked=true]').innerText()!=='산만')throw Error('방향키');
const regression=[];for(const size of ['mobile','desktop'])for(const q of ['code','notice']){const before=metrics.find(r=>r.id===`before-${size}-${q}-unselected`),after=metrics.find(r=>r.id===`after-${size}-${q}-unselected`);const identical=JSON.stringify(before.geometry)===JSON.stringify(after.geometry);regression.push({size,screen:q,identical});if(!identical)throw Error('다른 단계 회귀 '+size+q);}
fs.writeFileSync(path.join(__dirname,'capture-metrics.json'),JSON.stringify({chrome:browser.version(),viewportChecks:metrics,regression,keyboard:'방향키·Home·End·포커스 실제 Chrome 통과'},null,2));await browser.close();
})();
