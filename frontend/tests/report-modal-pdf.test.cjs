// NODE_PATH에 Playwright 설치 경로를 지정하고 Vite(5175)를 실행한 뒤 node --test로 실행한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseUrl = process.env.REPORT_TEST_BASE_URL || 'http://localhost:5175';
for (const savedEmail of ['saved@example.com', null]) test(`하단 액션과 본문 전용 PDF (수신 주소: ${savedEmail ?? '없음'})`, async () => {
 const browser = await chromium.launch({ headless: true, channel: 'chrome' });
 try {
  // Chrome의 로컬 개발 서버 WebSocket 접근 권한을 테스트 컨텍스트에만 부여한다.
  const page = await browser.newPage({permissions:['local-network-access']});
  await page.addInitScript(() => { window.print = () => { window.__printed = true; }; });
  const report = { id:'pdf-test', session_id:'test', type:'counselor', participant_name:savedEmail ? '검증 참여자' : null, session_title:'몸과 마음의 기록', scheduled_at:'2026-09-16T09:00:00+09:00', report_email:savedEmail, status:'pending_review', sent_at:null, pdf_url:null, content:{summary:'검증용 상담 본문', eeg:{status:'valid', narrative:{journey:('명상을 시작하며 바쁘게 움직이던 생각을 잠시 내려놓고, 몸에 닿는 감각과 자연스러운 호흡을 차분히 느껴보았어요. 시간이 흐르면서 호흡과 심박의 리듬이 달라지고, 주의가 흩어졌다가 다시 돌아오는 순간도 있었어요. 지표의 변화만으로 오늘의 경험을 판단하기보다 스스로 느꼈던 편안함과 감각을 함께 떠올려 보세요. ').repeat(5) + '여정끝표식',body:'호흡이 서서히 느려지며 몸이 편안한 리듬을 찾아가는 흐름이 나타났어요. 심박수와 심박변이도의 변화를 함께 살펴보면서 오늘 몸에서 느꼈던 감각을 떠올려 보세요. 수치의 변화는 개인마다 다를 수 있으며, 편안함의 정도를 단정하지 않아요. 몸의 반응을 있는 그대로 바라보고 다음 명상에서도 자신만의 속도로 머물러 보세요.',mind:'주의가 다른 곳으로 향했다가 다시 돌아오는 과정에서 마음의 흐름도 조금씩 달라졌어요. 집중도와 이완도, 감정안정도는 오늘의 느낌과 함께 읽어 주세요. 지표가 오르거나 내렸다는 사실만으로 명상의 효과를 판단하지 않아요. 지금 이 순간의 감각을 알아차렸던 시간을 차분히 떠올려 보세요.',closing:'검증용 마무리'}, timeline:[0,600,1200].map((t,i)=>({t,respiratory_rate:18-i,heart_rate:75-i,sdnn:40+i,concentration:.4+i*.1,relaxation:.5+i*.1,stress:.5-i*.1}))}}};
  let approvals=0; let deliveries=0;
  await page.route('**/reports/pdf-test**', async route=>{
   if(route.request().url().endsWith('/pdf')) return route.fulfill({contentType:'application/pdf',body:'%PDF-1.7\nserver-pdf'});
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
  assert.equal(await page.locator('.metric-definition').count(),6);
  assert.equal(await page.locator('.change-interpretation').count(),6);
  assert.match(await page.locator('.narrative-report').innerText(),/심박변이\(심장 박동 간격의 변화\)/);
  for(const width of [1280,390,320]){
   await page.setViewportSize({width,height:800});
   assert.equal(await page.locator('.narrative-report').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
   await page.locator('.metric-definition').first().scrollIntoViewIfNeeded();
   await page.screenshot({path:`/tmp/sdd-068-definition-${width}.png`});
   await page.locator('.report-sample-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});
   await page.screenshot({path:`/tmp/sdd-066-modal-${width}.png`});
   const box=await page.getByRole('button',{name:'승인하기'}).boundingBox();
   assert.ok(box && box.y>=0 && box.y+box.height<=800 && box.x>=0 && box.x+box.width<=width);
  }
  assert.equal(await page.getByRole('button',{name:'PDF 다운로드'}).count(),0); // 승인 전 다운로드 미노출
  await page.getByRole('button',{name:'승인하기'}).click();
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(el=>el.textContent==='승인하기'));
  assert.equal(approvals,1);
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'PDF 다운로드'}).click();
  assert.equal((await downloadPromise).suggestedFilename(),'mind-breeze-report.pdf');
  assert.equal(await page.evaluate(()=>window.__printed),undefined);
  assert.equal(await page.locator('iframe[data-report-print]').count(),0);
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
