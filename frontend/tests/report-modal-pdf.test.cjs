// NODE_PATH에 Playwright 설치 경로를 지정하고 Vite(5175)를 실행한 뒤 node --test로 실행한다.
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const pdfText = path => execFileSync('python3', ['-c', 'import fitz,sys; print("".join(p.get_text() for p in fitz.open(sys.argv[1])))', path], {encoding:'utf8'}).replace(/\s/g, '');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseUrl = process.env.REPORT_TEST_BASE_URL || 'http://localhost:5175';
for (const savedEmail of ['saved@example.com', null]) test(`하단 액션과 본문 전용 PDF (수신 주소: ${savedEmail ?? '없음'})`, async () => {
 const browser = await chromium.launch({ headless: true, channel: 'chrome' });
 try {
  const page = await browser.newPage();
  await page.addInitScript(() => { window.print = () => { window.__printed = true; }; });
  const report = { id:'pdf-test', session_id:'test', type:'counselor', participant_name:savedEmail ? '검증 참여자' : null, session_title:'몸과 마음의 기록', scheduled_at:'2026-09-16T09:00:00+09:00', report_email:savedEmail, status:'pending_review', sent_at:null, pdf_url:null, content:{summary:'검증용 상담 본문', eeg:{status:'valid', narrative:{journey:'검증용 여정',body:'호흡이 서서히 느려지며 몸이 편안한 리듬을 찾아가는 흐름이 나타났어요. 심박수와 심박변이도의 변화를 함께 살펴보면서 오늘 몸에서 느꼈던 감각을 떠올려 보세요. 수치의 변화는 개인마다 다를 수 있으며, 편안함의 정도를 단정하지 않아요. 몸의 반응을 있는 그대로 바라보고 다음 명상에서도 자신만의 속도로 머물러 보세요.',mind:'주의가 다른 곳으로 향했다가 다시 돌아오는 과정에서 마음의 흐름도 조금씩 달라졌어요. 집중도와 이완도, 감정안정도는 오늘의 느낌과 함께 읽어 주세요. 지표가 오르거나 내렸다는 사실만으로 명상의 효과를 판단하지 않아요. 지금 이 순간의 감각을 알아차렸던 시간을 차분히 떠올려 보세요.',closing:'검증용 마무리'}, timeline:[0,600,1200].map((t,i)=>({t,respiratory_rate:18-i,heart_rate:75-i,sdnn:40+i,concentration:.4+i*.1,relaxation:.5+i*.1,stress:.5-i*.1}))}}};
  let approvals=0; let deliveries=0;
  await page.route('**/reports/pdf-test**', async route=>{
   if(route.request().url().endsWith('/resend-email')) { deliveries++; assert.equal(route.request().postDataJSON().email,'new@example.com'); }
   else if(route.request().method()==='POST'){approvals++; report.status='completed'; report.sent_at='2026-09-16';}
   await route.fulfill({json:report});
  });
  await page.route('**/sdd-066-test', route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script type="module">
   import '/@vite/client'; import RefreshRuntime from '/@react-refresh';
   RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
   const {useAuthStore} = await import('/src/stores/authStore.ts');
   useAuthStore.setState({user:{role:'counselor'}});
   const {ReportDetailModal} = await import('/src/pages/reports/ReportDetailModal.tsx');
   import React from '/node_modules/.vite/deps/react.js';
   import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
   import '/src/index.css'; import '/src/mb-tokens.css';
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(ReportDetailModal,{reportId:'pdf-test',onClose:()=>{}}));
   </script></body></html>`}));
  await page.goto(`${baseUrl}/sdd-066-test`);
  await page.getByRole('button',{name:'승인하기'}).waitFor();
  assert.equal(await page.getByRole('button',{name:/닫기/}).count(),1);
  assert.equal(await page.getByRole('button',{name:'승인하기'}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(95, 0, 128)');
  assert.equal(await page.getByRole('textbox',{name:'발송 이메일'}).count(),0);
  for(const width of [1280,390,320]){
   await page.setViewportSize({width,height:800});
   await page.locator('.report-sample-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});
   await page.screenshot({path:`/tmp/sdd-066-modal-${width}.png`});
   const box=await page.getByRole('button',{name:'승인하기'}).boundingBox();
   assert.ok(box && box.y>=0 && box.y+box.height<=800 && box.x>=0 && box.x+box.width<=width);
  }
  await page.locator('[data-testid="eeg-section"]').evaluate(el => { el.open = true; });
  await page.getByRole('button',{name:'PDF 생성'}).click();
  const iframe=page.locator('iframe[title="리포트 인쇄"]');
  await iframe.waitFor({state:'attached'});
  const frame=await(await iframe.elementHandle()).contentFrame();
  await frame.waitForFunction(()=>document.body.innerText.includes('검증용 마무리'));
  await frame.waitForFunction(()=>window.__printed === true);
  assert.equal(await frame.locator('[data-testid="eeg-section"]').count(),0);
  assert.equal(await page.locator('[data-testid="eeg-section"]').evaluate(el => el.open),true);
  assert.equal(await frame.locator('details[open]').count(),0);
  assert.equal(await frame.locator('[data-section]').count(),5);
  assert.equal(await frame.locator('button,input,dialog').count(),0);
  assert.ok(await frame.locator('svg polyline').count()>=6); // 화면용 서사 DOM은 유지한다.
  const printPage=await browser.newPage();
  // 앱 React 루트 없이 인쇄 iframe의 독립 문서를 재현한다.
  await printPage.goto('about:blank');
  await printPage.setContent(await frame.content());
  await printPage.evaluate(()=>document.fonts.ready);
  await printPage.emulateMedia({media:'print'});
  assert.equal(await printPage.locator('.narrative-report .cover').evaluate(el=>getComputedStyle(el).display),'block');
  assert.equal(await printPage.locator('.report-print-cover').evaluate(el=>getComputedStyle(el).display),'none');
  for(const section of ['journey','body','mind','closing']) {
   assert.equal(await printPage.locator(`[data-section="${section}"]`).evaluate(el=>getComputedStyle(el).breakBefore),section === 'journey' ? 'auto' : 'page');
  }
  assert.equal(await printPage.locator('.metric:visible').count(),6);
  assert.equal(await printPage.locator('svg:visible').count() > 6,true);
  assert.equal(await printPage.locator('.report-summary-card:visible').count(),1);
  const expectedText = await printPage.locator('.narrative-report p, .narrative-report h1, .narrative-report h2, .narrative-report h3, .report-summary-card p').evaluateAll(nodes => nodes.filter(node => !node.closest('details,aside,header')).map(node => node.textContent.replace(/\s/g, '')));
  const pdf=await printPage.pdf({preferCSSPageSize:true,printBackground:true,path:'/tmp/sdd-067-report.pdf'});
  assert.ok(pdf.length>10000);
  const pages = JSON.parse(execFileSync('python3', ['-c', 'import fitz,json; print(json.dumps([p.get_text() for p in fitz.open("/tmp/sdd-067-report.pdf")]))'], {encoding:'utf8'}));
  for (const [index, heading] of ['02 · 종합 여정','03 · 몸의 변화','04 · 마음의 변화','05 · 마무리'].entries()) assert.ok(pages[index].replace(/\s/g, '').includes(heading.replace(/\s/g, '')), `페이지 ${index+1}: ${heading}`);
  for (const [index, text] of pages.entries()) {
   const compact = text.replace(/\s/g, '');
   assert.ok(compact.includes('MINDBREEZE·몸과마음의기록'), '페이지 머리글');
   assert.ok(compact.includes(`${index + 1}/${pages.length}`), '페이지 번호');
  }
  for (const section of ['body', 'mind']) {
   const index = section === 'body' ? 1 : 2;
   const content = await printPage.locator(`[data-section="${section}"]`).innerText();
   assert.ok(pages[index].replace(/\s/g, '').includes(content.replace(/\s/g, '')), `${section} 전체 원문이 한 페이지`);
  }
  const extracted = pdfText('/tmp/sdd-067-report.pdf');
  for (const text of expectedText) assert.ok(extracted.includes(text), `PDF 원문 누락: ${text}`);
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,4);
  if (savedEmail) {
   await printPage.locator('[data-section="body"] .section-head').evaluate(el => {
    const paragraph = document.querySelector('.journey-quote');
    document.querySelector('.closing-message').textContent = '마무리 문장 '.repeat(100) + '마무리끝표식';
    paragraph.textContent = '긴 서사 문장도 페이지를 넘어 자연스럽게 이어집니다. '.repeat(160) + '긴본문끝표식';

   });
   const longPdf = await printPage.pdf({preferCSSPageSize:true,printBackground:true,path:'/tmp/sdd-067-long-report.pdf'});
   const longText = pdfText('/tmp/sdd-067-long-report.pdf');
   assert.ok(longText.includes('긴본문끝표식'));
   assert.ok(longText.includes('마무리끝표식'));
   assert.ok((longPdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length > 2);
  }
  await printPage.locator('.narrative-report').evaluate(el=>el.remove());
  assert.equal(await printPage.locator('.report-summary-card:visible').count(),1);
  assert.match(await printPage.locator('.report-summary-card:visible').innerText(),/검증용 상담 본문/);
  const fallbackPdf=await printPage.pdf({preferCSSPageSize:true,printBackground:true,path:'/tmp/sdd-067-no-eeg-report.pdf'});
  assert.equal((fallbackPdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,1);
  await page.getByRole('button',{name:'승인하기'}).click();
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(el=>el.textContent==='승인하기'));
  assert.equal(approvals,1);
  assert.equal(deliveries,0);
  const email=page.getByRole('textbox',{name:'발송 이메일'});
  await email.waitFor();
  assert.equal(await email.inputValue(),savedEmail ?? '');
  await email.fill('new@example.com');
  await page.getByRole('button',{name:'발송',exact:true}).click();
  await page.getByRole('status').filter({hasText:'메일을 발송했습니다'}).waitFor();
  assert.equal(deliveries,1);
 }finally{await browser.close();}
});
