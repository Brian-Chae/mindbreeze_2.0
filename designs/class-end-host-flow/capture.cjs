// 정적 시안 전용. 원본 저장소의 Playwright와 설치된 Chrome만 사용한다.
// 서버/API/로그인/.env를 사용하지 않으며 외부 HTTP 요청은 차단한다.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/node_modules/playwright');
const screens=['current-end','current-record','overview','participants','notes','waiting','failed','partial','report','counseling','biosignal-worn','biosignal-partial','biosignal-pending','biosignal-quality','biosignal-lost','biosignal-unworn','notes-skipped','auto-summary','auto-settings'];
const out=path.join(__dirname,'screenshots');
const url=pathToFileURL(path.join(__dirname,'index.html')).href;
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const results=[];const errors=[];const external=[];
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:width===390?844:1000},deviceScaleFactor:1,locale:'ko-KR'});
   await context.route(/^https?:/,route=>{external.push(route.request().url());return route.abort()});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   for(const screen of screens){
    await page.goto(url+'?screen='+screen+'#'+screen);if(['overview','biosignal-worn','biosignal-partial','biosignal-pending'].includes(screen)){await page.evaluate(()=>localStorage.setItem('sdd237-demo-prompt-seen','no'));await page.reload();}await page.locator('#app main').waitFor();assert.equal(await page.locator('#screen-select').inputValue(),screen);await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:path.join(out,`${screen}-${width}.png`),fullPage:true});
    const stats=await page.evaluate(()=>{
      const visible=e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return r.width>0&&r.height>0&&c.display!=='none'&&c.visibility!=='hidden'};
      const els=[...document.querySelectorAll('body *')].filter(visible);
      const texts=els.filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));
      const controls=els.filter(e=>e.matches('button,a[href],input,select,textarea,summary'));
      return {scrollWidth:document.documentElement.scrollWidth,minText:Math.min(...texts.map(e=>parseFloat(getComputedStyle(e).fontSize))),smallControls:controls.filter(e=>{const r=e.getBoundingClientRect();return r.height<44||r.width<44}).map(e=>e.textContent.trim().slice(0,40))};
    });
    assert(stats.scrollWidth<=width,`${screen}-${width} 가로 넘침`);assert(stats.minText>=13,`${screen}-${width} 13px 미만`);assert.equal(stats.smallControls.length,0,`${screen}-${width} 터치 영역`);
    results.push({screen,width,...stats});
   }
   // 6지표·결측·개인 추이와 펼침 표를 별도로 검증한다.
   await page.goto(url+'?check=bio#biosignal-worn');
   assert.equal(await page.locator('.bio-metric').count(),6);
   await page.locator('.bio-details summary').click();
   assert.equal(await page.locator('.bio-table tbody tr').count(),4);
   assert.equal(await page.locator('.bio-table tbody tr').first().locator('td').count(),7);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth)<=width);
   await page.screenshot({path:path.join(out,`biosignal-participants-${width}.png`),fullPage:true});
   await page.goto(url+'?check=quality#biosignal-quality');
   assert.equal(await page.locator('.bio-value').filter({hasText:'—'}).count(),3);
   assert.doesNotMatch(await page.locator('#biosignal-summary .inline-note').innerText(),/호흡수는 낮게/);
   for(const state of ['pending','unworn']){
    await page.goto(url+'?check=empty#biosignal-'+state);
    assert.equal(await page.locator('.bio-value').filter({hasText:'—'}).count(),6);
    assert.doesNotMatch(await page.locator('#biosignal-summary').innerText(),/24분|80%|호흡수는 낮게/);
   }
   await page.goto(url+'?check=solo#counseling');
   assert.equal(await page.locator('.bio-metric svg').count(),6);
   assert.equal(await page.locator('.bio-metric').filter({hasText:'이전 회차 대비'}).count(),6);
   // 합성 표와 격자를 독립 산식으로 대조한다. 측정자는 A/C, B 미착용, D 제외.
   await page.goto(url+'?check=arithmetic#biosignal-partial');
   await page.locator('.bio-details summary').click();
   const expectedMeans=[60,64,62,72,14,42], expectedDeltas=[6,8,4,-4,-2,6];
   for(let j=0;j<6;j++){
    const cards=page.locator('.bio-metric'), rows=page.locator('.bio-table tbody tr');
    const a=Number((await rows.nth(0).locator('td').nth(j).innerText()).match(/^-?\d+/)[0]);
    const c=Number((await rows.nth(2).locator('td').nth(j).innerText()).match(/^-?\d+/)[0]);
    assert.equal((a+c)/2,expectedMeans[j]);
    assert.equal(parseFloat(await cards.nth(j).locator('.bio-value').innerText()),expectedMeans[j]);
    assert.match(await cards.nth(j).innerText(),new RegExp(`${Math.min(a,c)}–${Math.max(a,c)}`));
    const halves=(await cards.nth(j).locator('dd').nth(2).innerText()).match(/-?\d+/g).map(Number);
    assert.equal(halves[1]-halves[0],expectedDeltas[j]);
    assert.equal(await rows.nth(1).locator('td').nth(j).innerText(),'—');
    assert.equal(await rows.nth(3).locator('td').nth(j).innerText(),'—');
   }
   assert.equal(24/30*100,80);
   // 한 번 안내 → 비워두기 → 재진입·새로고침 후 비노출.
   await page.goto(url+'?check=prompt#biosignal-worn');await page.evaluate(()=>localStorage.setItem('sdd237-demo-prompt-seen','no'));await page.reload();
   await page.locator('#skip-notes').click();assert.equal(await page.locator('#record-prompt').count(),0);
   await page.goto(url+'?check=prompt-again#biosignal-worn');await page.reload();assert.equal(await page.locator('#record-prompt').count(),0);assert.equal(await page.locator('#quiet-record').count(),1);
   await page.goto(url+'?check=policy#auto-summary');await page.locator('#hold-policy').click();assert.match(await page.locator('#hold-policy').innerText(),/보류됨/);
   await page.locator('[data-go="auto-settings"]').click();await page.locator('#save-policy').click();await page.getByRole('button',{name:'시안에서 전환 확인',exact:true}).click();assert.match(await page.locator('#dialog-body').innerText(),/실제 설정은 변경하지/);await page.getByRole('button',{name:'확인',exact:true}).click();
   // 새 측정 사례에서 결과로 이동해도 측정·분석 상태를 보존한다.
   await page.goto(url+'?check=worn#biosignal-worn');await page.locator('#biosignal-summary [data-go="participants"]').click();assert.match(await page.locator('[data-person="샘플 참여자 B"]').innerText(),/측정 완료/);
   await page.goto(url+'?check=pending#biosignal-pending');await page.locator('.hero [data-go="participants"]').click();assert.equal(await page.locator('[data-go^="report-"]').count(),0);
   // 참여자 검색과 필터가 실제로 행을 줄이는지 확인한다.
   await page.goto(url+'?check=participants#participants');await page.locator('#filter').selectOption('review');assert.equal(await page.locator('tbody tr:visible').count(),2);
   await page.locator('#search').fill('C');assert.equal(await page.locator('tbody tr:visible').count(),1);
   await page.locator('#search').fill('없는 이름');await page.locator('#no-results').waitFor({state:'visible'});
   // 미저장 이탈 → 계속 작성 → 저장 성공 → 탭 이동 후 복원.
   await page.goto(url+'?check=notes#notes');await page.locator('#notes').fill('샘플 검증 기록: 다음 회차 안내 시간을 확보한다.');
   await page.locator('.tabs [data-go="overview"]').click();await page.locator('dialog[open]').waitFor();await page.getByRole('button',{name:'계속 작성',exact:true}).click();
   assert.match(await page.locator('#notes').inputValue(),/샘플 검증 기록/);
   await page.locator('#simulate-save-error').click();assert.match(await page.locator('#save-state').innerText(),/저장 실패/);assert.match(await page.locator('#notes').inputValue(),/샘플 검증 기록/);
   await page.locator('#save-notes').click();await page.locator('#save-state').filter({hasText:'저장됨'}).waitFor();
   await page.screenshot({path:path.join(out,`notes-saved-${width}.png`),fullPage:true});
   await page.locator('.tabs [data-go="overview"]').click();await page.locator('.tabs [data-go="notes"]').click();assert.match(await page.locator('#notes').inputValue(),/샘플 검증 기록/);
   // 정책 예외 3개 및 실제 네트워크 요청 없이 복구 UI.
   for(const scenario of ['zero','noband','offline']){
    await page.goto(url+'?scenario='+scenario+'#overview');await page.locator('#scenario').selectOption(scenario);await page.screenshot({path:path.join(out,`overview-${scenario}-${width}.png`),fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth)<=width);
   }
   await page.locator('[data-reconnect]').click();assert.equal(await page.locator('#scenario').inputValue(),'normal');
   // 독립 리뷰 지적: B 상세의 대상·미측정·승인 상태, 부분 실패 맥락을 확인한다.
   await page.goto(url+'?check=person#participants');await page.locator('[data-go="report-1"]').click();
   assert.match(await page.locator('.eyebrow').first().innerText(),/참여자 B/);assert.match(await page.locator('#approve').innerText(),/승인됨/);assert.match(await page.locator('.readout').innerText(),/측정하지 않았습니다/);
   await page.goto(url+'?check=partial#partial');await page.locator('.card .actions [data-go="participants"]').click();assert.match(await page.locator('[data-person="샘플 참여자 C"]').innerText(),/생성 실패/);
   // 승인 확인은 시안 내 상태 변경만 한다.
   await page.goto(url+'?check=report#report');await page.locator('#comment').fill('수정한 공개 코멘트 샘플');await page.locator('#save-comment').click();await page.locator('#approve').click();await page.getByRole('button',{name:'시안에서 승인 확인',exact:true}).click();assert.match(await page.locator('#approve').innerText(),/승인됨/);assert.equal(await page.locator('#comment').inputValue(),'수정한 공개 코멘트 샘플');
   await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const report={chrome:browser.version(),viewports:[390,1440],screenshots:48,results,interactionChecks:['6지표·부분 결측·회차 추이','표/격자 평균·범위·전후 차이 독립 대조','결측 상태 서사·시간 미표시','한 번 안내·비워두기·재열기 비노출','자동 승인 보류·설정 확인','검색/필터','미저장 이탈 경고','저장 실패 입력 보존','저장 성공·탭 이동 복원','0명/미착용/연결 단절','승인 확인 시안 상태'],pageErrors:errors,externalRequests:external};
  fs.writeFileSync(path.join(__dirname,'validation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({screenshots:48,screens:results.length,checks:'PASS',pageErrors:errors.length,externalRequests:external.length}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
