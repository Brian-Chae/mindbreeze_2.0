const {chromium}=require('../../frontend/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
const results=JSON.parse(fs.readFileSync(path.join(__dirname,'after-measurements.json')));
const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'baseline-measurements.json')));
for(const r of results){
 for(const box of [r.top,r.head,r.participants,r.signals,r.dock]){assert(box);assert(Math.abs(box.x-r.top.x)<1);assert(Math.abs(box.right-r.top.right)<1)}
 assert(Math.abs(r.self.width-r.self.height*16/9)<1);assert.equal(r.self.height,baseline.find(b=>b.width===r.width).self.height);
 assert.equal(r.overflow,0);assert.equal(r.errors.length,0);assert.equal(r.dockItems,4);assert.equal(r.gap,14);
 if(r.state==='hand-many')assert(r.toast.includes('지은 외 2명'));
 if(r.state==='quiet')assert(r.toast.includes('서연 · 잠시 쉴게요'));
 if(r.state==='status')assert(r.dialog.includes('자가 체크인 응답')&&r.dialog.includes('입장 전'));
}
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const extras=[];
for(const width of [320,390,768,1280,1440]){
 const page=await browser.newPage({viewport:{width,height:width<600?844:1000}});
 await page.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname==='127.0.0.1'&&!/^\/(api|socket.io)/.test(u.pathname)?r.continue():r.abort()});
 await page.goto('http://127.0.0.1:5236/design/class-player?role=host&case=C13&n=6&signalsDemo=none');await page.waitForFunction(()=>window.__ready===true);
 await page.locator('[data-pz="selfview"]').click();
 const expanded=await page.evaluate(()=>{const r=document.querySelector('[data-pz="selfview"]').getBoundingClientRect();return {width:r.width,height:r.height,overflow:document.documentElement.scrollWidth-innerWidth}});
 assert.equal(expanded.overflow,0);assert(Math.abs(expanded.width-expanded.height*16/9)<1);
 await page.locator('[data-pz="selfview"]').click();
 await page.getByRole('button',{name:'수업 상태'}).click();await page.locator('.hp-status-checkin summary').click();await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));assert((await page.locator('.hp-status-open').evaluate(e=>document.activeElement===e)));
 extras.push({width,expanded,focusReturn:true});await page.close();
}
await browser.close();fs.writeFileSync(path.join(__dirname,'browser-assertions.json'),JSON.stringify({states:results.length,allPassed:true,extras},null,2));console.log('Chrome 20状態 + 5폭 확대/포커스 검증 통과');
})();
