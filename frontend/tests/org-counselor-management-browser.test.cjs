// Vite 5175와 NODE_PATH에 설치된 Playwright를 사용한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

test('상담사 보호 대상, 확인 사유, 실패 유지, 역할 변경과 소속 해제', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ permissions: ['local-network-access'], viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    const org = { id: 'org1', name: '테스트 기관', org_code: 'ORG001', phone: null, address: null, verified: false, kind: 'institution', has_primary_admin: true, created_at: '2026-09-17', version: 1, deactivated_at: null, primary_admin: null, owner: null, verified_at: null };
    let members = [
      { id: 'primary', name: '주 담당', role: 'org_admin', status: 'active', is_primary_admin: true },
      { id: 'owner', name: '기관 소유', role: 'counselor', status: 'active', is_owner: true },
      { id: 'target', name: '대상 상담사', role: 'counselor', status: 'active' },
    ].map(m => ({ email: `${m.id}@test.com`, counselor_code: null, is_primary_admin: false, is_owner: false, ...m }));
    let fail = true;
    let calls = 0;
    let releaseRequest;
    const firstRequest = new Promise(resolve => { releaseRequest = resolve; });
    await page.route('**/api/v1/admin/orgs/**', async route => {
      const req = route.request();
      if (req.method() === 'PATCH' || req.method() === 'DELETE') {
        calls++;
        assert.equal(req.postDataJSON().reason, '운영 조정');
        if (calls === 1) await firstRequest;
        if (fail) return route.fulfill({ status: 409, json: { detail: '활성 업무를 먼저 정리해주세요' } });
        if (req.method() === 'PATCH') {
          members = members.map(m => m.id === 'target' ? { ...m, role: 'org_admin' } : m);
          return route.fulfill({ json: members[2] });
        }
        members = members.filter(m => m.id !== 'target');
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ json: req.url().endsWith('/counselors') ? members : org });
    });
    await page.route('**/sdd-076-test', route => route.fulfill({ contentType: 'text/html', body: `<html><body><div id="root"></div><script type="module">
      import '/@vite/client'; import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
      const {default:Modal} = await import('/src/components/admin/org-detail-modal.tsx');
      import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; import '/src/index.css';
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Modal,{organization:${JSON.stringify(org)},onClose:()=>{window.closedModal=true;},onUpdated:()=>{window.updates=(window.updates||0)+1;}}));
    </script></body></html>` }));
    await page.goto('http://127.0.0.1:5175/sdd-076-test');
    await page.getByRole('tab', { name: /상담사/ }).click();
    const primary = page.getByRole('row').filter({ hasText: '주 담당' });
    assert.equal(await primary.getByRole('button', { name: '역할 변경', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('row').filter({ hasText: '기관 소유' }).getByRole('button', { name: '소속 해제', exact: true }).isDisabled(), true);
    let target = page.getByRole('row').filter({ hasText: '대상 상담사' });
    await target.getByRole('button', { name: '역할 변경', exact: true }).click();
    const submit = page.getByRole('button', { name: '역할 변경 실행', exact: true });
    assert.equal(await submit.isDisabled(), true);
    await page.getByRole('textbox', { name: '상담사 변경 사유 (필수)' }).fill('운영 조정');
    await submit.click();
    await page.locator('button[aria-label="기관 상세 닫기"]:disabled').waitFor();
    assert.equal(await page.getByRole('button', { name: '기관 상세 닫기' }).isDisabled(), true);
    releaseRequest();
    await page.getByRole('alert').filter({ hasText: '활성 업무' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '상담사 변경 사유 (필수)' }).inputValue(), '운영 조정');
    fail = false;
    await submit.click();
    await page.getByRole('row').filter({ hasText: '대상 상담사' }).getByText('기관 관리자', { exact: true }).waitFor();
    await target.getByRole('button', { name: '소속 해제', exact: true }).click();
    await page.getByText('계정과 과거 상담 기록은 삭제되지 않습니다.', { exact: false }).waitFor();
    await page.getByRole('textbox', { name: '상담사 변경 사유 (필수)' }).fill('운영 조정');
    await page.getByRole('button', { name: '소속 해제 실행', exact: true }).click();
    await page.getByRole('tab', { name: '상담사 (2)' }).waitFor();
    assert.equal(await target.count(), 0);
    assert.equal(calls, 3);
    assert.equal(await page.evaluate(() => window.updates), 2);
    assert.equal(await page.locator('dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  } finally { await browser.close(); }
});
