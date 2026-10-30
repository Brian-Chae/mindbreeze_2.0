import { chromium } from '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base=new URL('./',import.meta.url);
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1320,height:1120},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(new URL('mockup.html',base).href);await page.evaluate(()=>document.fonts.ready);
await page.screenshot({path:fileURLToPath(new URL('mockup.png',base)),fullPage:true});
const results=[];
for(const board of ['a','b','c']){
 await page.setViewportSize({width:390,height:844});await page.goto(new URL('mockup.html?board='+board,base).href);
 results.push(await page.evaluate(()=>({board:document.body.dataset.board,viewport:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,phoneWidth:document.querySelector('#'+document.body.dataset.board+' .phone').getBoundingClientRect().width,minimumButtonHeight:Math.min(...[...document.querySelectorAll('#'+document.body.dataset.board+' button')].map(x=>x.getBoundingClientRect().height)),font:getComputedStyle(document.body).fontFamily})));
 await page.screenshot({path:fileURLToPath(new URL('board-'+board+'-390.png',base))});
}
await page.goto(new URL('mockup.html',base).href);await page.locator('#submit').click();const interaction=await page.locator('#added').count()===1;
await writeFile(new URL('qa.json',base),JSON.stringify({kind:'static-mockup-only',browser:await browser.version(),results,errors,localInteractionAddsRow:interaction,realApiTested:false,realDeviceTested:false},null,2));
await browser.close();if(errors.length||results.some(x=>x.overflow!==0||x.minimumButtonHeight<44)||!interaction)process.exitCode=1;
