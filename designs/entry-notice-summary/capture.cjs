// 로컬 파일만 읽고 지정 Chrome으로 시안을 검증·촬영한다.
const {chromium}=require('../../frontend/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=__dirname,url='file://'+path.join(root,'index.html');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const results=[];
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:900},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:/,r=>r.abort());
  for(const view of ['a','b']){
   await page.goto(url+'?view='+view);await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.locator('#consent').isChecked(),false);
   const metrics=await page.evaluate(()=>({height:innerHeight,scrollHeight:document.documentElement.scrollHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,ctaBottom:document.querySelector('#continue').getBoundingClientRect().bottom,privacyBottom:document.querySelector('.privacy').getBoundingClientRect().bottom,smallTargets:[...document.querySelectorAll('button,a,label.check')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.width<44||r.height<44)}).map(e=>e.textContent),copySize:getComputedStyle(document.querySelector('.research-copy')).fontSize,conditionSize:getComputedStyle(document.querySelector('.conditions')).fontSize}));
   assert(metrics.ctaBottom<=metrics.height);assert(metrics.privacyBottom<=metrics.height);assert.equal(metrics.width,metrics.scrollWidth);assert.equal(metrics.scrollHeight,metrics.height);assert.deepEqual(metrics.smallTargets,[]);
   await page.screenshot({path:path.join(root,`screenshots/${view}-${width}.png`)});
   for(const sheet of ['record','report','research']){
    const opener=page.locator(`button[data-sheet="${sheet}"]`);await opener.click();await page.screenshot({path:path.join(root,`screenshots/${view}-${sheet}-${width}.png`)});
    assert.equal(await page.locator('.sheetbody').evaluate(e=>getComputedStyle(e).fontSize),'16px');
    if(sheet==='research'){const texts=await page.evaluate(()=>COPY.research);for(const t of texts)assert((await page.locator('.sheetbody').innerText()).includes(t));}
    if(sheet==='record'){const texts=await page.evaluate(()=>COPY.access.concat(COPY.retention));for(const t of texts)assert((await page.locator('.sheetbody').innerText()).includes(t));}
    await page.keyboard.press('Escape');assert.equal(await opener.evaluate(e=>e===document.activeElement),true);
   }
   await page.locator('[data-choice="included"]').click();assert.equal(await page.locator('[data-choice="included"]').getAttribute('aria-checked'),'true');
   await page.locator('#consent').check();await page.locator('[data-sheet="research"]').click();await page.locator('#read').click();assert.equal(await page.locator('#consent').isChecked(),true);
   await page.locator('#consent').uncheck();assert.equal(await page.locator('#continue').isEnabled(),true);
   results.push({view,width,...metrics,errors});
  }
  await page.goto('file://'+path.join(root,'current.html'));await page.locator('.fm-ft').first().waitFor();await page.screenshot({path:path.join(root,`screenshots/current-${width}.png`)});
  await page.close();
 }
 const page=await browser.newPage({viewport:{width:1440,height:1340},deviceScaleFactor:1});await page.route(/^https?:/,r=>r.abort());await page.goto(url);await page.waitForTimeout(300);await page.screenshot({path:path.join(root,'screenshots/comparison-1440.png')});
 await page.locator('.desktop-comparison').screenshot({path:path.join(root,'screenshots/desktop-comparison.png')});
 fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
