// SDD-307 감독 검증: 실제 컴포넌트, 합성 회원 및 Chromium 가상 카메라. 서버 호출 없음.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('../../frontend/node_modules/playwright');
const base = process.env.SDD307_URL || 'http://127.0.0.1:5317';
const out = process.env.SDD307_OUTPUT || __dirname;
const sizes = [[390,667],[390,844],[768,1024],[1024,768],[1280,720],[1280,900]];
(async () => {
  const browser = await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const context = await browser.newContext({permissions:['camera','microphone','clipboard-read','clipboard-write']});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const measurements = [];
  for (const [width,height] of sizes) for (const scenario of ['online','offline','ready','empty']) {
    await page.setViewportSize({width,height});
    await page.goto(`${base}/design/class-flow?screen=FH06&case=g-on-12&v6=${scenario}`);
    await page.waitForSelector('[data-floating-start]');
    await page.evaluate(() => document.fonts.ready);
    if (scenario !== 'offline') await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    const result = await page.evaluate(() => {
      const list = document.querySelector('.table-wrap');
      const footer = document.querySelector('[data-floating-start]');
      const initial = footer.getBoundingClientRect().top;
      window.scrollTo(0, 99999);
      list.scrollTop = 99999;
      return {width:innerWidth,height:innerHeight,overflowX:document.documentElement.scrollWidth-innerWidth,pageScroll:scrollY,listScroll:list.scrollTop,listHeight:list.clientHeight,rows:document.querySelectorAll('[data-member-row]').length,footerTop:footer.getBoundingClientRect().top,footerStable:footer.getBoundingClientRect().top===initial,recordGap:footer.getBoundingClientRect().top-document.querySelector('.recording').getBoundingClientRect().bottom,video:!!document.querySelector('video')?.srcObject};
    });
    assert.equal(result.overflowX,0);
    assert.equal(result.footerStable,true);
    assert.ok(result.recordGap >= 0, `기록 안내 가림: ${JSON.stringify(result)}`);
    if (width >= 700) { assert.equal(result.pageScroll,0); assert.ok(result.listScroll>0); assert.equal(result.rows,40); }
    else { assert.ok(result.pageScroll>0); assert.equal(result.listScroll,0); assert.equal(result.rows,8); }
    assert.equal(result.video,scenario!=='offline');
    await page.evaluate(() => {window.scrollTo(0,0);document.querySelector('.table-wrap').scrollTop=0;});
    await page.screenshot({path:path.join(out,`307-product-${scenario}-${width}x${height}.png`),fullPage:true});
    measurements.push({scenario,...result});
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${base}/design/class-flow?screen=FH06&case=g-on-12&v6=online`);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.getByRole('button',{name:'클래스 시작 →',exact:true}).click();
  await page.getByRole('button',{name:'취소',exact:true}).click();
  await page.waitForTimeout(2200);
  assert.equal(await page.locator('[data-start-count]').getAttribute('data-start-count'),'0');
  for (const label of ['크게 보기','회원 초대','도구','기록 안내','코드 보기','링크 공유 ↗']) {
    await page.getByRole('button',{name:'클래스 시작 →',exact:true}).click();
    await page.getByRole('button',{name:label,exact:true}).click();
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('[data-start-count]').getAttribute('data-start-count'),'0',`${label} 진입 시 시작 취소`);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button',{name:'클래스 시작 →',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('[data-start-count]')?.dataset.startCount==='1');
  assert.equal(await page.locator('[data-start-audio]').getAttribute('data-start-audio'),'record');
  await page.getByRole('button',{name:'기기 설정',exact:true}).click();
  await page.getByRole('button',{name:'카메라 끄기',exact:true}).click();
  await page.waitForFunction(() => !document.querySelector('video')?.srcObject);
  await page.getByRole('button',{name:'카메라 켜기',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'회원 초대',exact:true}).click();
  await page.getByRole('button',{name:'기존 회원 선택',exact:true}).click();
  assert.ok((await page.getByRole('dialog').innerText()).includes('하니스는 발송하지'));
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'크게 보기',exact:true}).click();
  assert.ok((await page.getByRole('dialog').innerText()).includes('4729'));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[role=dialog]').count(),0);
  await page.getByRole('button',{name:'8명 더 보기',exact:false}).click();
  assert.equal(await page.locator('[data-member-row]').count(),16);
  assert.deepEqual(errors,[]);
  const report={verifiedAt:new Date().toISOString(),environment:'Chromium 가상 미디어·합성 회원·실제 HostPrepContainer',measurements,interactions:['2초 취소 후 시작 0회','6개 메뉴 진입 시 시작 취소','시작 1회 및 record','카메라 off/on 실제 트랙','회원 초대 연결','코드 확대 및 Escape','모바일 8명 더 보기'],pageErrors:errors};
  fs.writeFileSync(path.join(__dirname,'browser-results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({scenarios:measurements.length,interactions:report.interactions,pageErrors:errors}));
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
