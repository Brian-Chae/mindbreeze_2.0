// 먼저 frontend에서 vite preview --host 127.0.0.1 --port 5236 실행. 외부 네트워크는 차단한다.
import { chromium, webkit } from '../../../frontend/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const phase=process.argv[2]||'before';
const out=fileURLToPath(new URL('../screens/', import.meta.url));
const result=[];
for(const [engine,type] of Object.entries({chromium,webkit})) {
 const browser=await type.launch(engine==='chromium'?{channel:'chrome'}:{});
 for(const [width,height] of [[390,844],[844,390],[1440,900]]) {
  for(const screen of ['login','home','class']) {
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
   await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   await context.addInitScript(({screen,driver})=>{localStorage.setItem('sdd236-screen',screen);(0,eval)(driver);},{screen,driver:fs.readFileSync(new URL('./offline-driver.js', import.meta.url),'utf8')});
   const page=await context.newPage();
   await page.goto('http://127.0.0.1:5236/'+(screen==='home'?'app':screen==='class'?'design/class-player?role=member&case=M01':'login'));
   await page.waitForTimeout(1500);
   const metrics=await page.evaluate(()=>window.sdd236Measure());
   if(metrics.root.y!==0 || metrics.root.width!==width || metrics.root.height!==height) throw new Error(`루트 geometry 불일치: ${engine}/${screen}/${width}`);
   await page.screenshot({path:`${out}/${phase}-web-${engine}-${screen}-${width}.png`});
   result.push({engine,width,height,screen,metrics});
   await context.close();
  }
 }
 await browser.close();
}
fs.writeFileSync(`${out}/${phase}-web-metrics.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(result.map(({engine,width,screen,metrics:m})=>({engine,width,screen,path:m.path,root:m.root,buttons:m.buttons.length}))));
