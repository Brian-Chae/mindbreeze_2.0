const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replace(/import\.meta\.env/g, '({})'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename);
const values = new Map();
global.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
const { useAuthStore } = require('../src/stores/authStore.ts');
const response = role => ({ user: { id: 'u1', role, onboarding_completed: false }, access_token: 'access', refresh_token: 'refresh' });

for (const method of ['email', 'google']) {
  test(`${method}: 역할이 다르면 기존 인증 상태와 저장소를 변경하지 않는다`, async () => {
    values.clear();
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
    global.fetch = async () => ({ ok: true, status: 200, json: async () => response('client') });
    const state = useAuthStore.getState();
    await assert.rejects(() => method === 'email' ? state.login('x@test.com', 'pw', 'counselor') : state.loginGoogle('google', undefined, 'counselor'), /선택한 로그인 유형/);
    assert.equal(values.size, 0);
    assert.equal(useAuthStore.getState().isAuthenticated, false);
  });
}
test('일치한 역할은 요청으로 전달하고 인증을 저장한다', async () => {
  let payload;
  global.fetch = async (_url, options) => { payload = JSON.parse(options.body); return { ok: true, status: 200, json: async () => response('org_admin') }; };
  await useAuthStore.getState().login('x@test.com', 'pw', 'org_admin');
  assert.equal(payload.role, 'org_admin');
  assert.equal(values.get('mb_access_token'), 'access');
  assert.equal(useAuthStore.getState().user.role, 'org_admin');
});
test('공통 이동은 온보딩과 관리자 next 경계를 지킨다', () => {
  const { resolvePostLoginPath } = require('../src/lib/auth-routing.ts');
  for (const [role, done, want] of [['client', false, '/onboarding/client'], ['client', true, '/app'], ['counselor', false, '/onboarding/counselor'], ['counselor', true, '/dashboard'], ['org_admin', false, '/dashboard/org'], ['admin', true, '/']]) {
    assert.equal(resolvePostLoginPath({ role, onboarding_completed: done }, null), want);
  }
  for (const next of ['/administrator', '//evil.com/admin', '/admin/../app', '/admin/../../evil', 'https://evil.com/admin', '/admin/\\evil', '/admin/%2e%2e/app']) {
    assert.equal(resolvePostLoginPath({ role: 'platform_admin' }, next), '/admin/orgs');
  }
  assert.equal(resolvePostLoginPath({ role: 'platform_admin' }, '/admin/orgs?q=1'), '/admin/orgs?q=1');
});

test('사용자가 없는 인증 응답은 저장하지 않는다', async () => {
  values.clear();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'access', refresh_token: 'refresh' }) });
  await assert.rejects(() => useAuthStore.getState().login('x@test.com', 'pw', 'client'), /로그인 응답/);
  assert.equal(values.size, 0);
  assert.equal(useAuthStore.getState().isAuthenticated, false);
});
