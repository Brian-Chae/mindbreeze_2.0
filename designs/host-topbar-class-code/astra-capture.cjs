const {chromium}=require('../../frontend/node_modules/playwright');
const fs=require('fs');
const path=require('path');
(async()=>{
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1282,height:750},deviceScaleFactor:2});
const base='file://'+path.resolve(__dirname,'astra-three-directions.html');
await page.goto(base+'?view=mobile');await page.screenshot({path:path.join(__dirname,'astra-mobile-comparison.png'),fullPage:true});
await page.setViewportSize({width:1504,height:1120});await page.goto(base+'?view=desktop');await page.screenshot({path:path.join(__dirname,'astra-desktop-comparison.png'),fullPage:true});
const results=[];
for(const width of [320,390,1440])for(const variant of ['a','b','c']){
 await page.setViewportSize({width,height:300});await page.goto(base+'?view='+ (width<700?'mobile':'desktop')+'&variant='+variant);
 for(const long of [false,true]){
 if(long)await page.evaluate(()=>document.querySelectorAll('.title').forEach(t=>t.textContent='마음챙김 명상수업 · 10월 22일 오후 3:05'));
 const check=await page.locator('.variant.selected').evaluate(el=>{
  const rect=s=>{const r=el.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
  const title=rect('.title'),code=rect('.code'),time=rect('.time'),stats=rect('.stats'),end=rect('.end');
  return {scroll:document.documentElement.scrollWidth,viewport:innerWidth,title,code,time,stats,end,pass:title.right<=code.left&&time.right<=stats.left&&code.right<=end.left&&title.top<time.top&&code.top<stats.top};
 });results.push({width,variant,long,...check});
 if(!long)await page.screenshot({path:path.join(__dirname,`astra-${variant}-${width}.png`)});
 }
}
await page.goto(base+'?view=mobile&variant=c');await page.locator('.variant.selected .code').click();const dialogOpened=await page.locator('dialog').evaluate(el=>el.open);await page.locator('#close-dialog').click();const dialogClosed=await page.locator('dialog').evaluate(el=>!el.open);
fs.writeFileSync(path.join(__dirname,'astra-verification.json'),JSON.stringify({results,dialogOpened,dialogClosed},null,2));
console.log(JSON.stringify({count:results.length,failures:results.filter(r=>!r.pass||r.scroll>r.viewport),dialogOpened,dialogClosed}));await browser.close();
})();
