const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replace(/import\.meta\.env/g, '({})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename);
global.localStorage = { getItem: () => 'token' };
const api = require('../src/lib/api/admin.ts');
test('기관 수정과 비활성화는 조회 버전을 If-Match로 보내고 상태 필터를 전달한다', async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, ...options });
    return { ok: true, status: 200, json: async () => ({ version: 4 }) };
  };
  await api.patchAdminOrganization('org1', { name: '새 기관', phone: null }, 3);
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].headers['If-Match'], '"3"');
  assert.deepEqual(JSON.parse(calls[0].body), { name: '새 기관', phone: null });
  await api.deactivateAdminOrganization('org1', { reason: '종료', confirmation_value: 'ORG001' }, 4);
  assert.equal(calls[1].headers['If-Match'], '"4"');
  await api.listAdminOrganizations('inactive');
  assert.ok(calls[2].url.endsWith('/admin/orgs?status=inactive'));
});

test('상담사 변경은 관리자 전용 경로로 역할과 사유를 보내고 DELETE 204를 처리한다', async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, ...options });
    return { ok: true, status: options.method === 'DELETE' ? 204 : 200, json: async () => ({ role: 'org_admin' }) };
  };
  await api.patchAdminOrganizationCounselor('org1', 'user1', { role: 'org_admin', reason: '역할 조정' });
  assert.ok(calls[0].url.endsWith('/admin/orgs/org1/counselors/user1'));
  assert.equal(calls[0].method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].body), { role: 'org_admin', reason: '역할 조정' });
  assert.equal(await api.removeAdminOrganizationCounselor('org1', 'user1', '소속 종료'), undefined);
  assert.equal(calls[1].method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[1].body), { reason: '소속 종료' });
});
