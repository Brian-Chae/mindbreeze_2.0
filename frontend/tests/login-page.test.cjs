const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8').replace(/import\.meta\.env/g, '({})'),
  { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } },
).outputText, filename);
const load = Module._load;
Module._load = function(id, ...args) { if (id === '@react-oauth/google') return { useGoogleLogin: () => () => {} }; return load.call(this, id, ...args); };
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { MemoryRouter } = require('react-router-dom');
const LoginPage = require('../src/pages/LoginPage.tsx').default;
const render = url => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [url] }, React.createElement(LoginPage)));
test('기본 회원 탭은 Google을 이메일보다 먼저 보여 준다', () => {
  const html = render('/login');
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.match(html, /Google로 회원 로그인/);
  assert.ok(html.indexOf('Google로 회원 로그인') < html.indexOf('type="email"'));
  assert.match(html, /register\?role=client/);
});
test('상담사는 이메일 우선, 기관은 Google과 가입이 없다', () => {
  const counselor = render('/login?role=counselor');
  assert.ok(counselor.indexOf('type="email"') < counselor.indexOf('Google로 상담사 로그인'));
  assert.match(counselor, /register\?role=counselor/);
  const org = render('/login?role=org_admin');
  assert.match(org, /기관 관리자 로그인/);
  assert.doesNotMatch(org, /Google|href="\/register/);
});
test('관리자 모드는 공개 탭과 이메일을 숨긴다', () => {
  const html = render('/login?role=platform_admin');
  assert.match(html, /플랫폼 관리자 로그인/);
  assert.match(html, /Google Workspace/);
  assert.match(html, /일반 로그인으로 돌아가기/);
  assert.doesNotMatch(html, /role="tab"|type="email"/);
});
test('알 수 없는 role은 회원 화면이다', () => assert.match(render('/login?role=unknown'), /Google로 회원 로그인/));
