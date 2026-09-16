// NODE_PATH=/tmp/sdd046-browser/node_modules REPORT_TEST_BASE_URL=http://localhost:5175 node --test tests/report-server-pdf.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseUrl = process.env.REPORT_TEST_BASE_URL || 'http://localhost:5175';
const dependencyHash = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'../node_modules/.vite/deps/_metadata.json'),'utf8')).browserHash;
const report = { id:'pdf-test', session_id:'test', type:'client', session_title:'몸과 마음의 기록', status:'completed', pdf_url:null, content:{eeg:{status:'valid', narrative:{journey:'오늘의 여정',body:'몸의 변화',mind:'마음의 변화',closing:'오늘의 마무리'}}}};
for (const mode of ['detail', 'email']) test(`${mode}: 서버 파일 다운로드와 실패 복구`, async () => {
 const browser = await chromium.launch({headless:true, channel:'chrome'});
 try {
  const page = await browser.newPage({permissions:['local-network-access']});
  page.on('pageerror', error=>console.error(error.message));
  page.setDefaultTimeout(7000);
  await page.addInitScript(() => {
   localStorage.setItem('mb_access_token','access-test');
   window.print=()=>{window.__printed=true};
   window.__revoked=[];
   const original=URL.revokeObjectURL;
   URL.revokeObjectURL=url=>{window.__revoked.push(url);original(url)};
  });
  let pdfRequests=0; let failure=false;
  await page.route('**/api/v1/reports/**', async route => {
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/pdf')) {
    pdfRequests++;
    if(mode==='email') { assert.equal(url.searchParams.get('token'),'mail-token'); assert.equal(route.request().headers().authorization,undefined); }
    else assert.equal(route.request().headers().authorization,'Bearer access-test');
    await new Promise(resolve=>setTimeout(resolve,150));
    return route.fulfill(failure ? {status:403,json:{detail:'링크가 만료되었습니다.'}} : {contentType:'application/pdf',body:'%PDF-1.7\nserver-pdf'});
   }
   return route.fulfill({json:report});
  });
  await page.route('**/sdd-070-test*', route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="root"></div><script type="module">
   import '/@vite/client'; import RefreshRuntime from '/@react-refresh';
   RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
   const {useAuthStore}=await import('/src/stores/authStore.ts'); useAuthStore.setState({user:{role:'counselor'}});
   import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; import {BrowserRouter} from '/node_modules/.vite/deps/react-router-dom.js?v=${dependencyHash}'; import '/src/index.css';
   const {default:Component}=await import('${mode==='detail' ? '/src/components/reports/ReportDetailView.tsx' : '/src/pages/reports/ReportViewPage.tsx'}');
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(Component,{report:${JSON.stringify(report)}})));
   </script></body></html>`}));
  await page.goto(`${baseUrl}/sdd-070-test?token=mail-token`);
  const button=page.getByRole('button',{name:'PDF 다운로드'});
  await button.waitFor();
  for(const width of [1280,390]) {
   await page.setViewportSize({width,height:900});
   const downloadPromise=page.waitForEvent('download');
   await button.click();
   assert.equal(await page.getByRole('button',{name:'PDF 준비 중...'}).isDisabled(),true);
   const download=await downloadPromise;
   assert.match(download.suggestedFilename(),/\.pdf$/);
   assert.equal(await page.evaluate(()=>window.__printed),undefined);
   await button.waitFor();
  }
  assert.equal(pdfRequests,2);
  failure=true;
  await button.click();
  await page.getByRole('alert').filter({hasText:/만료/}).waitFor();
  assert.equal(await button.isEnabled(),true);
  await page.waitForFunction(()=>window.__revoked.length===2);
 } finally { await browser.close(); }
});
