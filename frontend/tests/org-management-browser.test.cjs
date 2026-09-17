// 실행 전 Vite 5175. NODE_PATH에는 Playwright 설치 경로를 지정한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { browserHash } = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '../node_modules/.vite/deps/_metadata.json'), 'utf8'));

test('기관 모달: 미저장 보호, 실패 유지, 충돌 재조회, 수정, 비활성화, 재활성화', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ permissions: ['local-network-access'], viewport: { width: 390, height: 844 } });
    let org = { id: 'org1', name: '테스트 기관', org_code: 'ORG001', phone: null, address: '서울', verified: false, verified_at: null, kind: 'institution', has_primary_admin: false, created_at: '2026-09-17', version: 1, deactivated_at: null, primary_admin: null, owner: null };
    let patchFail = 500;
    let patchCount = 0;
    const impact = { account_count: 2, active_link_count: 0, scheduled_session_count: 0, ongoing_session_count: 0, unknown_attribution_count: 0, preserved_session_count: 3, attribution_note: '계정과 기존 기록은 삭제하지 않습니다.', blockers: [], can_deactivate: true, version: 2 };
    await page.route('**/api/v1/admin/orgs/**', async route => {
      const request = route.request(); const url = request.url();
      if (url.endsWith('/counselors')) return route.fulfill({ json: [] });
      if (url.endsWith('/deactivation-impact')) return route.fulfill({ json: { ...impact, version: org.version } });
      if (request.method() === 'PATCH') {
        patchCount++;
        assert.equal(request.headers()['if-match'], `"${org.version}"`);
        if (patchFail) return route.fulfill({ status: patchFail, json: { detail: patchFail === 412 ? '기관 정보가 변경되었습니다.' : '저장 실패' } });
        org = { ...org, ...request.postDataJSON(), version: org.version + 1 };
      }
      if (url.endsWith('/deactivate')) {
        assert.equal(request.headers()['if-match'], `"${org.version}"`);
        assert.deepEqual(request.postDataJSON(), { reason: '운영 종료', confirmation_value: 'ORG001' });
        org = { ...org, deactivated_at: '2026-09-17', version: org.version + 1 };
      }
      if (url.endsWith('/reactivate')) org = { ...org, deactivated_at: null, version: org.version + 1 };
      return route.fulfill({ json: org });
    });
    await page.route('**/sdd-075-test', route => route.fulfill({ contentType: 'text/html', body: `<html><body><div id="root"></div><script type="module">
      import '/@vite/client'; import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
      const {default:Modal} = await import('/src/components/admin/org-detail-modal.tsx');
      import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; import '/src/index.css';
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Modal,{organization:${JSON.stringify(org)},onClose:()=>{window.closedModal=true;},onUpdated:()=>{window.updates=(window.updates||0)+1;}}));
    </script></body></html>` }));
    await page.goto('http://127.0.0.1:5175/sdd-075-test');
    await page.getByRole('button', { name: '정보 수정', exact: true }).click();
    await page.getByRole('textbox', { name: '기관명', exact: true }).fill('수정 기관');
    await page.getByRole('button', { name: '기관 상세 닫기' }).click();
    await page.getByRole('alertdialog').waitFor();
    await page.getByRole('button', { name: '계속 편집' }).click();
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '저장 실패' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '기관명', exact: true }).inputValue(), '수정 기관');
    patchFail = 412;
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('button', { name: '최신 정보 다시 불러오기' }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '최신 정보 다시 불러오기' }).click();
    await page.getByRole('button', { name: '정보 수정', exact: true }).click();
    await page.getByRole('textbox', { name: '기관명', exact: true }).fill('수정 기관');
    patchFail = 0;
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('heading', { name: '수정 기관', exact: true }).waitFor();
    assert.equal(patchCount, 3);
    await page.getByRole('button', { name: '기관 비활성화', exact: true }).click();
    await page.getByText('소속 계정 2명').waitFor();
    assert.equal(await page.getByRole('button', { name: '취소', exact: true }).evaluate(el => document.activeElement === el), true);
    const deactivate = page.getByRole('button', { name: '기관 운영 종료(비활성화)', exact: true });
    assert.equal(await deactivate.isDisabled(), true);
    await page.getByRole('textbox', { name: '기관 코드 입력' }).fill('ORG001');
    await page.getByRole('textbox', { name: '사유 (필수)', exact: true }).fill('운영 종료');
    await page.getByRole('checkbox').check();
    await deactivate.click();
    await page.getByRole('button', { name: '기관 재활성화', exact: true }).click();
    await page.getByRole('textbox', { name: '사유 (필수)', exact: true }).fill('운영 재개');
    await page.getByRole('button', { name: '재활성화 실행' }).click();
    await page.getByRole('button', { name: '정보 수정', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.updates), 3);
    assert.equal(await page.locator('dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  } finally { await browser.close(); }
});

test('목록 상태 필터와 저장 후 포커스 복귀', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ permissions: ['local-network-access'] });
    page.on('pageerror', error => console.error('브라우저 오류:', error.message));
    page.setDefaultTimeout(7000);
    let org = { id: 'org2', name: '목록 기관', org_code: 'ORG002', phone: null, address: null, verified: false, kind: 'institution', has_primary_admin: false, created_at: '2026-09-17', version: 1, deactivated_at: null, primary_admin: null, owner: null, verified_at: null };
    const filters = [];
    await page.route('**/api/v1/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.pathname.endsWith('/admin/orgs')) { filters.push(url.searchParams.get('status')); return route.fulfill({ json: url.searchParams.get('status') === 'active' ? [org] : [] }); }
      if (url.pathname.endsWith('/counselors')) return route.fulfill({ json: [] });
      if (url.pathname.endsWith('/admin/orgs/org2')) {
        if (request.method() === 'PATCH') org = { ...org, ...request.postDataJSON(), version: org.version + 1 };
        return route.fulfill({ json: org });
      }
      return route.fulfill({ json: { rooms: [], items: [], unread: 0 } });
    });
    await page.route('**/sdd-075-list-test', route => route.fulfill({ contentType: 'text/html', body: `<html><body><div id="root"></div><script type="module">
      import '/@vite/client'; import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
      const {default:Page} = await import('/src/pages/admin/OrgManagementPage.tsx');
      const {useAuthStore} = await import('/src/stores/authStore.ts'); useAuthStore.setState({user:{id:'admin',name:'관리자',role:'platform_admin'},isAuthenticated:true});
      import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import {BrowserRouter} from '/node_modules/.vite/deps/react-router-dom.js?v=${browserHash}'; import '/src/index.css';
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(Page)));
    </script></body></html>` }));
    await page.goto('http://127.0.0.1:5175/sdd-075-list-test');
    await page.getByRole('button', { name: '목록 기관', exact: true }).click();
    await page.getByRole('button', { name: '정보 수정', exact: true }).click();
    await page.locator('dialog').getByRole('textbox', { name: '기관명', exact: true }).fill('새 목록 기관');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('heading', { name: '새 목록 기관', exact: true }).waitFor();
    await page.getByRole('button', { name: '기관 상세 닫기' }).click();
    const opener = page.getByRole('button', { name: '새 목록 기관', exact: true });
    await opener.waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent === '새 목록 기관');
    await page.getByRole('combobox', { name: '기관 운영 상태' }).selectOption('inactive');
    await page.getByText('등록된 기관이 없습니다.').waitFor();
    assert.ok(filters.includes('inactive'));
    await page.getByRole('combobox', { name: '기관 운영 상태' }).selectOption('active');
    await opener.waitFor();
  } finally { await browser.close(); }
});
