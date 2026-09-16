// NODE_PATH에 Playwright 설치 경로를 지정하고 Vite(5175)를 실행한 뒤 node --test로 실행한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
for (const savedEmail of ['saved@example.com', null]) test(`하단 액션과 본문 전용 PDF (수신 주소: ${savedEmail ?? '없음'})`, async () => {
 const browser = await chromium.launch({ headless: true, channel: 'chrome' });
 try {
  const page = await browser.newPage();
  await page.addInitScript(() => { window.print = () => { window.__printed = true; }; });
  const report = { id:'pdf-test', session_id:'test', type:'counselor', report_email:savedEmail, status:'pending_review', sent_at:null, pdf_url:null, content:{summary:'검증용 상담 본문', eeg:{status:'valid', narrative:{journey:'검증용 여정',closing:'검증용 마무리'}, timeline:[0,600,1200].map((t,i)=>({t,respiratory_rate:18-i,heart_rate:75-i,sdnn:40+i,concentration:.4+i*.1,relaxation:.5+i*.1,stress:.5-i*.1}))}}};
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
  await page.goto('http://localhost:5175/sdd-066-test');
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
  await page.getByRole('button',{name:'PDF 생성'}).click();
  const iframe=page.locator('iframe[title="리포트 인쇄"]');
  await iframe.waitFor({state:'attached'});
  const frame=await(await iframe.elementHandle()).contentFrame();
  await frame.waitForFunction(()=>document.body.innerText.includes('검증용 마무리'));
  await frame.waitForFunction(()=>window.__printed === true);
  assert.equal(await frame.locator('[data-section]').count(),5);
  assert.equal(await frame.locator('button,input,dialog').count(),0);
  assert.ok(await frame.locator('svg polyline').count()>=6);
  const printPage=await browser.newPage();
  await printPage.goto('http://localhost:5175/');
  await printPage.setContent(await frame.content());
  await printPage.evaluate(()=>document.fonts.ready);
  const pdf=await printPage.pdf({format:'A4',printBackground:true,path:'/tmp/sdd-066-report.pdf'});
  assert.ok(pdf.length>10000);
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>=2);
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
