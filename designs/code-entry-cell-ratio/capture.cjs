const { chromium } = require('../../frontend/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
 const browser = await chromium.launch({channel:'chrome',headless:true});
 const results=[];
 for (const width of [1440,390,320]) {
  const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
  await page.goto('file://'+path.join(__dirname,'index.html'));
  await page.evaluate(()=>document.fonts.ready);
  const data=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,variants:[...document.querySelectorAll('.option')].map(o=>{const c=o.querySelector('.cell'),r=c.getBoundingClientRect(),card=o.querySelector('.card').getBoundingClientRect();return {id:o.dataset.id,width:r.width,height:r.height,ratio:r.width/r.height,font:getComputedStyle(o.querySelector('.digit')).fontSize,cardWidth:card.width,contained:[...o.querySelectorAll('.cell')].every(c=>{const r=c.getBoundingClientRect();return r.left>=card.left&&r.right<=card.right})}})}));
  if(data.scrollWidth>width||data.variants.some(v=>!v.contained))throw Error(JSON.stringify(data));
  if(width!==320) await page.screenshot({path:path.join(__dirname,`chrome-${width}.png`),fullPage:true});
  results.push(data);await page.close();
 }
 fs.writeFileSync(path.join(__dirname,'measurements.json'),JSON.stringify({browser:await browser.version(),results},null,2));
 console.log(JSON.stringify(results,null,2));await browser.close();
})();
