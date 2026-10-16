// 측정 스크립트 자가 검증: 더미 픽스처(__selftest*)로 PASS/FAIL 판정이 올바른지 확인한다.
//  - 균형 규칙을 지킨 화면(__selftest, __selftest_host)은 위반 0
//  - 일부러 어긴 화면(__selftest_skew, __selftest_host_skew)은 해당 규칙이 FAIL
//  - fit 은 정상 화면 PASS + 위반(11px 글자·작은 버튼·호흡 문구·코랄)을 주입하면 FAIL
// 사용: node e2e/class-player/selftest.mjs [--base=URL]   (--base 가 없으면 vite 개발 서버를 직접 띄운다)
import path from 'node:path';
import {
  HERE, VIEWPORTS, fitConfig, formatReport, launchBrowser, measureFit, openCase, parseArgs, runDockReach, runMeasure, writeReport,
} from './lib.mjs';

const args = parseArgs(process.argv);
const frontendRoot = path.resolve(HERE, '..', '..');

let server = null;
let base = args.base;
if (!base) {
  const { createServer } = await import('vite');
  server = await createServer({
    root: frontendRoot,
    configFile: path.join(frontendRoot, 'vite.config.ts'),
    server: { host: '127.0.0.1', port: 5290, strictPort: false },
    logLevel: 'error',
    clearScreen: false,
  });
  await server.listen();
  base = server.resolvedUrls.local[0].replace(/\/$/, '');
}

const browser = await launchBrowser();
const results = [];
const expect = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const failedRules = (rows) => [...new Set(rows.filter((r) => !r.pass).map((r) => r.rule))].sort();
const job = (id, variant = '', query = '') => ({ id, variant, query });
const allRows = [];

try {
  // 1) 균형 규칙을 지킨 화면은 위반 0 (시트 열림 변형 포함)
  for (const role of ['member', 'host']) {
    const okId = role === 'member' ? '__selftest' : '__selftest_host';
    const rows = await runMeasure({ browser, base, role, mode: 'symmetry', jobs: [job(okId), job(okId, 'sheet', 'sheet=status')] });
    allRows.push(...rows.map((r) => ({ ...r, id: `${role}:${r.id}` })));
    const fails = rows.filter((r) => !r.pass);
    expect(`${role} 정상 화면은 대칭 위반 0 (${rows.length}건 검사)`, rows.length > 0 && fails.length === 0, fails.slice(0, 3).map((r) => `${r.id}@${r.vp} ${r.rule} ${r.val}`).join(' | '));
  }

  // 2) 의도적으로 어긴 화면은 FAIL
  const memberSkew = await runMeasure({ browser, base, role: 'member', mode: 'symmetry', jobs: [job('__selftest_skew')] });
  allRows.push(...memberSkew.map((r) => ({ ...r, id: `member:${r.id}` })));
  const memberRules = failedRules(memberSkew);
  expect('member 비대칭 화면은 S1(링 중심축)·S6(미디어 줄 균등) FAIL', memberRules.includes('S1') && memberRules.includes('S6'), `실제 FAIL 규칙: ${memberRules.join(',') || '없음'}`);
  const memberSkewByVp = VIEWPORTS.map(([w, h]) => memberSkew.some((r) => r.vp === `${w}x${h}` && !r.pass));
  expect('member 비대칭 화면은 4개 뷰포트 모두에서 FAIL', memberSkewByVp.every(Boolean), memberSkewByVp.join(','));

  const hostSkew = await runMeasure({ browser, base, role: 'host', mode: 'symmetry', jobs: [job('__selftest_host_skew')] });
  allRows.push(...hostSkew.map((r) => ({ ...r, id: `host:${r.id}` })));
  const hostRules = failedRules(hostSkew);
  expect('host 비대칭 화면은 CS1/CS2(그리드 중앙)·CS3(헤드 비율) FAIL', (hostRules.includes('CS1') || hostRules.includes('CS2')) && hostRules.includes('CS3'), `실제 FAIL 규칙: ${hostRules.join(',') || '없음'}`);

  // 3) fit: 정상 화면 PASS
  for (const role of ['member', 'host']) {
    const okId = role === 'member' ? '__selftest' : '__selftest_host';
    const rows = await runMeasure({ browser, base, role, mode: 'fit', jobs: [job(okId)] });
    const reach = await runDockReach({ browser, base, role, ids: [okId] });
    allRows.push(...[...rows, ...reach].map((r) => ({ ...r, id: `${role}:${r.id}` })));
    const fails = [...rows, ...reach].filter((r) => !r.pass);
    expect(`${role} 정상 화면은 공통 합격 기준 위반 0 (${rows.length + reach.length}건 검사)`, rows.length > 0 && fails.length === 0, fails.slice(0, 3).map((r) => `${r.id}@${r.vp} ${r.rule} ${r.val}`).join(' | '));
  }

  // 4) fit 음성 대조: 위반 요소를 주입하면 해당 규칙이 FAIL 이어야 한다
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await openCase(page, base, 'member', '__selftest');
  await page.evaluate(() => {
    const host = document.querySelector('[data-pz="app"]');
    const bad = document.createElement('div');
    bad.style.cssText = 'position:absolute;left:8px;top:8px;z-index:9;color:#fff';
    bad.innerHTML = '<span style="font-size:11px">작은 글자</span><button type="button" style="width:20px;height:20px">x</button><p>천천히 호흡에 집중해 주세요</p><i style="display:block;width:30px;height:30px;background:rgb(232,180,160)"></i>';
    host.appendChild(bad);
    document.documentElement.style.minHeight = '3000px';
  });
  const injected = await page.evaluate(measureFit, { ...fitConfig('member', 'M06') });
  const injectedFails = failedRules(injected);
  expect('fit 은 주입한 위반(P1 스크롤·P2 11px·P3 터치·P5 호흡 문구·P9 코랄)을 모두 FAIL 로 잡는다', ['P1', 'P2', 'P3', 'P5', 'P9'].every((r) => injectedFails.includes(r)), `실제 FAIL 규칙: ${injectedFails.join(',') || '없음'}`);
  await ctx.close();

  writeReport(path.join(HERE, 'out', 'selftest.txt'), `${results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`).join('\n')}\n\n${formatReport({ title: '측정 스크립트 자가 검증 상세', role: 'member+host', rows: allRows })}`);
} finally {
  await browser.close();
  if (server) await server.close();
}

const bad = results.filter((r) => !r.ok);
console.log(`\n자가 검증 ${results.length - bad.length}/${results.length} 충족`);
if (bad.length) process.exitCode = 1;
