const {chromium}=require('../../frontend/node_modules/playwright');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const stage=process.argv[2]||'baseline', results=[];
for(const width of [390,768,1280,1440]){
 const page=await browser.newPage({viewport:{width,height:width===390?844:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname==='127.0.0.1'&&!/^\/(api|socket.io)/.test(u.pathname)?r.continue():r.abort()});
 for(const state of stage==='baseline'?['none']:['none','hand-one','hand-many','quiet','status']){
 await page.goto(`http://127.0.0.1:5236/design/class-player?role=host&case=C13&n=6&signalsDemo=${state}${state==='status'?'&sheet=alerts':''}`);
 await page.waitForFunction(()=>window.__ready===true);await page.waitForTimeout(400);
 if(state==='status') await page.locator('.hp-status-checkin summary').click();
 const metrics=await page.evaluate(()=>{
 const rect=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
 const signals=rect('.hp-signalbar'),dock=rect('.pz-dock');
 return {gap:signals&&dock?dock.y-signals.bottom:null,toast:document.querySelector('.hp-signal-toast-slot')?.textContent,self:rect('[data-pz="selfview"]'),head:rect('.hp-head'),top:rect('.hp-topbar'),participants:rect('.hp-gridwrap'),signals:rect('.hp-signalbar'),dock:rect('.pz-dock'),overflow:document.documentElement.scrollWidth-innerWidth,dockItems:document.querySelectorAll('[data-pz="dk"]').length,dialog:document.querySelector('[role="dialog"]')?.textContent,dialogs:document.querySelectorAll('[role="dialog"]').length};
 });
 await page.screenshot({path:path.join(__dirname,`${stage}-${state}-${width}.png`)});results.push({width,state,...metrics,errors:[...errors]});
 }
 await page.close();
}
fs.writeFileSync(path.join(__dirname,`${stage}-measurements.json`),JSON.stringify(results,null,2));await browser.close();console.log(JSON.stringify(results));
})();
