const {chromium}=require('../../frontend/node_modules/playwright');
const fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
for(const width of [1440,390,320]){
const page=await browser.newPage({viewport:{width,height:900}});
// 로컬 앱 정적 자원만 허용해 서버·DB 요청을 차단한다.
await page.route('**/*',r=>{const u=new URL(r.request().url());return u.origin==='http://127.0.0.1:5187'&&!u.pathname.startsWith('/api')&&!u.pathname.startsWith('/socket.io')?r.continue():r.abort();});
await page.goto('http://127.0.0.1:5187/join');await page.locator('.fm-codebox input').first().waitFor();await page.evaluate(()=>document.fonts.ready);
const states=[];
for(const digits of ['', '27', '2784']){
for(let i=0;i<4;i++)await page.locator('.fm-codebox input').nth(i).fill(digits[i]||'');
states.push(await page.evaluate(()=>({digits:[...document.querySelectorAll('.fm-codebox input')].map(x=>x.value).join(''),scrollWidth:document.documentElement.scrollWidth,gap:getComputedStyle(document.querySelector('.fm-codebox')).gap,cells:[...document.querySelectorAll('.fm-codebox > span')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e.querySelector('input'));return {width:r.width,height:r.height,fontSize:s.fontSize,fontWeight:s.fontWeight,active:e.dataset.active==='true',left:r.left,right:r.right};})})));
}
if(states.some(s=>s.scrollWidth>width||s.cells.some(c=>c.left<0||c.right>width||Math.abs(c.width/c.height-60/68)>.002||c.fontSize!=='36px'||c.fontWeight!=='800')))throw Error(JSON.stringify(states));
if(width!==320)await page.screenshot({path:`${__dirname}/app-${width}.png`,fullPage:true});results.push({width,states});await page.close();}
fs.writeFileSync(`${__dirname}/app-measurements.json`,JSON.stringify({browser:await browser.version(),results},null,2));console.log(JSON.stringify(results.map(r=>({width:r.width,states:r.states.map(s=>({digits:s.digits,gap:s.gap,cell:s.cells[0],scrollWidth:s.scrollWidth}))})),null,2));await browser.close();})();
