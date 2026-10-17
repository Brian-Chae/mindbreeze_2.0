// 측정 스크립트 자가 검증(사전 흐름판): 더미 픽스처(__selftest:*)로 PASS/FAIL 판정이 올바른지 확인한다.
//  - 규칙을 지킨 화면은 4개 뷰포트 + 보조 뷰포트에서 위반 0
//  - 위반을 DOM/소스에 주입하면 해당 규칙이 FAIL (FR1~FR6, 균형 FS1·FS3·FS7·FS9, 공통 P1·P2·P3·PC·P9·P13)
// 사용: node e2e/class-flow/selftest.mjs [--base=URL]   (--base 가 없으면 vite 개발 서버를 직접 띄운다)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FRONTEND_ROOT, HERE, VIEWPORTS, copyConfig, fitConfig, formatReport, launchBrowser, measureCtaCover, measureFit, measureFlowCopy, measureFlowState,
  measureCtaReach, measureFlowSteps, measureFlowSymmetry, measureSheetNesting, openCase, parseArgs, readExpected, readFlowCta, sourceRows, writeReport,
} from './lib.mjs';
import { compareCtas, runFit, stepRows } from './fit.mjs';

const args = parseArgs(process.argv);
let server = null;
let base = args.base;
if (!base) {
  const { createServer } = await import('vite');
  server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, 'vite.config.ts'),
    server: { host: '127.0.0.1', port: 5291, strictPort: false },
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
const allRows = [];

/** 케이스를 열고 injectFn 으로 DOM 을 바꾼 뒤 evalFn(들)로 측정한다 */
async function injected({ ref, query = '', viewport = [390, 844], inject, measure }) {
  const ctx = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try {
    await openCase(page, base, ref, query);
    const expected = await readExpected(page, ref, query);
    if (inject) await page.evaluate(inject);
    await page.waitForTimeout(100);
    return await measure(page, expected);
  } finally {
    await ctx.close();
  }
}
const asRows = (id, rows) => rows.map((r) => ({ id, vp: 'inject', ...r }));

try {
  // 1) 규칙을 지킨 화면은 위반 0 (4뷰포트 + 보조 뷰포트 CTA 도달성, 시트 열림 변형 포함)
  const cleanRefs = ['__selftest:wizard', '__selftest:av-video', '__selftest:av-bar', '__selftest:electrodes-bad', '__selftest:electrodes-good'];
  const clean = await runFit({ browser, base, refs: cleanRefs });
  allRows.push(...clean);
  const cleanFails = clean.filter((r) => !r.pass);
  expect(`정상 화면 ${cleanRefs.length}종은 4뷰포트 + 보조 뷰포트에서 위반 0 (${clean.length}건 검사)`, clean.length > 0 && cleanFails.length === 0, cleanFails.slice(0, 3).map((r) => `${r.id}@${r.vp} ${r.rule} ${r.val}`).join(' | '));
  const seenRules = [...new Set(clean.map((r) => r.rule))].sort();
  expect('정상 화면 검사에 FR2·FR3·FR4·FR5·FR6·FS1·FS3·FS7·FS9 가 모두 포함', ['FR2', 'FR3', 'FR4', 'FR5', 'FR6', 'FS1', 'FS3', 'FS7', 'FS9'].every((r) => seenRules.includes(r)), `검사된 규칙: ${seenRules.join(',')}`);

  const sheetRows = [];
  for (const [w, h] of VIEWPORTS) {
    const rows = await injected({
      ref: '__selftest:wizard', query: 'sheet=1', viewport: [w, h],
      measure: async (page, exp) => [
        ...(await page.evaluate(measureFit, fitConfig('__selftest:wizard'))), ...(await page.evaluate(measureSheetNesting)),
        ...(await page.evaluate(measureCtaCover)), ...(await page.evaluate(measureFlowSteps, exp.steps)),
      ],
    });
    sheetRows.push(...rows.map((r) => ({ id: '__selftest:wizard?sheet=1', vp: `${w}x${h}`, ...r })));
  }
  allRows.push(...sheetRows);
  const sheetFails = sheetRows.filter((r) => !r.pass && !['P13'].includes(r.rule));
  // 시트가 열리면 바텀 시트가 본문 컬럼 위로 올라오므로 P13(겹침) 은 시트 변형에서 제외하고 나머지를 본다
  expect('시트 열림 변형: 시트 내 중첩 스크롤(FR3) 0 · 시트가 CTA 를 덮어도 푸터 inert(FR6) · 공통 기준 위반 0', sheetFails.length === 0, sheetFails.slice(0, 3).map((r) => `${r.vp} ${r.rule} ${r.val}`).join(' | '));
  const fr6Open = sheetRows.filter((r) => r.rule === 'FR6');
  expect('시트 열림 변형 4뷰포트 FR6 측정값이 있다', fr6Open.length === VIEWPORTS.length, fr6Open.map((r) => r.val).join(' / '));

  // 2) FR1: 단계가 바뀌어도 CTA 가 같은 자리 / 본문이 CTA 를 밀면 FAIL
  const steps = await stepRows({ browser, base, ref: '__selftest:wizard', steps: [0, 1, 2, 3, 4] });
  allRows.push(...steps);
  expect('FR1 정상: 5단계(본문 길이가 달라도) × 4뷰포트 CTA 변위 ≤ 2px', steps.length === 16 && steps.every((r) => r.pass), `${steps.length}건 · 최대 ${steps.map((r) => r.val).slice(0, 1)}`);
  const drift = [];
  for (const step of [0, 3]) {
    drift.push(...(await injected({
      ref: '__selftest:wizard', query: `step=${step}`,
      inject: step === 3 ? () => { document.querySelector('[data-pz="flow-foot"]').style.transform = 'translateY(-24px)'; } : undefined,
      measure: async (page) => [{ cta: await page.evaluate(readFlowCta), step }],
    })));
  }
  const driftRows = compareCtas(drift.map((d) => ({ cta: d.cta, group: 'drift', vp: '390x844', label: `step${d.step}` })));
  expect('FR1 주입: 단계 3에서 CTA 를 24px 올리면 FAIL', driftRows.length === 1 && driftRows[0].pass === false, driftRows[0]?.val ?? '');

  // 3) FR2 진행 점
  const fr2 = async (inject) => injected({ ref: '__selftest:wizard', query: 'step=2', inject, measure: async (page, exp) => page.evaluate(measureFlowSteps, exp.steps) });
  expect('FR2 정상: 점 5개·가운데·등간격·aria-current 1개', (await fr2()).every((r) => r.pass));
  expect('FR2 주입: 점 하나 제거 → 개수 FAIL', (await fr2(() => document.querySelector('[data-pz="flow-steps"] > i:last-child').remove())).some((r) => !r.pass && /개수/.test(r.val)));
  expect('FR2 주입: aria-current 제거 → FAIL', (await fr2(() => document.querySelector('[data-pz="flow-steps"] > i[aria-current]').removeAttribute('aria-current'))).some((r) => !r.pass && /aria-current/.test(r.val)));
  expect('FR2 주입: 점 간격 불균등 → FAIL', (await fr2(() => { document.querySelector('[data-pz="flow-steps"] > i:nth-child(2)').style.marginRight = '12px'; })).some((r) => !r.pass));
  expect('FR2 주입: 점 묶음 치우침 → FAIL', (await fr2(() => { const s = document.querySelector('[data-pz="flow-steps"]'); s.style.justifyContent = 'flex-start'; s.style.width = '240px'; })).some((r) => !r.pass));

  // 4) FR3 시트 중첩 스크롤
  const fr3 = async (inject) => injected({ ref: '__selftest:wizard', query: 'sheet=1', inject, measure: async (page) => page.evaluate(measureSheetNesting) });
  expect('FR3 정상: 시트 내부 스크롤 0', (await fr3()).every((r) => r.pass));
  expect('FR3 주입: 시트 안에 스크롤 박스 → FAIL', (await fr3(() => {
    const box = document.createElement('div');
    box.style.cssText = 'height:40px;overflow:auto';
    box.innerHTML = '<div style="height:200px">긴 내용</div>';
    document.querySelector('.pz-sheet__body').appendChild(box);
  })).some((r) => !r.pass));

  // 5) FR4 카피·글리프
  const fr4 = async (inject) => injected({ ref: '__selftest:wizard', inject, measure: async (page) => page.evaluate(measureFlowCopy, copyConfig()) });
  expect('FR4 DOM 정상: 글리프·금지어·대문자 아이브로우 0', (await fr4()).every((r) => r.pass));
  for (const [name, html, pattern] of [
    ['문자 글리프(✓)', '<p>✓ 완료</p>', /글리프/],
    ['이모지(🎤)', '<p>🎤 마이크</p>', /글리프/],
    ['금지 용어(세션)', '<p>세션을 시작해요</p>', /금지어/],
    ['금지 표현(6자리)', '<p>6자리 코드를 입력해요</p>', /금지어/],
    ['영문 대문자 아이브로우', '<p>PRE JOIN PREVIEW</p>', /아이브로우/],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await openCase(page, base, '__selftest:wizard');
    await page.evaluate((markup) => { const p = document.createElement('div'); p.innerHTML = markup; document.querySelector('[data-pz="flow-col"]').appendChild(p); }, html);
    const rows = await page.evaluate(measureFlowCopy, copyConfig());
    await ctx.close();
    expect(`FR4 DOM 주입: ${name} → FAIL`, rows.some((r) => !r.pass && pattern.test(r.val)), rows[0]?.val ?? '');
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'class-flow-src-'));
  fs.writeFileSync(path.join(tmp, 'ok.tsx'), '// 세션 ✓ 주석은 무시\n/* 6자리 게스트 */\nexport const A = <p>좋아요 · 확인</p>;\n');
  expect('FR4 소스 정상: 주석 속 금지어·글리프는 무시', sourceRows([tmp])[0].pass, sourceRows([tmp])[0].val);
  fs.writeFileSync(path.join(tmp, 'bad.tsx'), 'export const B = <p>✓ 세션 시작</p>;\nconst x = "by-code";\n');
  const srcBad = sourceRows([tmp])[0];
  expect('FR4 소스 주입: 글리프·금지어·구 식별자 → FAIL', !srcBad.pass, srcBad.val);
  const kinds = ['srcGlyph', 'srcBanned', 'srcStale'].filter((k) => srcBad.val.includes(k));
  expect('FR4 소스 주입: srcGlyph·srcBanned·srcStale 3종 모두 검출', kinds.length === 3, kinds.join(','));
  fs.rmSync(tmp, { recursive: true, force: true });
  const realSrc = sourceRows([path.join(FRONTEND_ROOT, 'src', 'components', 'class', 'flow'), path.join(FRONTEND_ROOT, 'src', 'lib', 'class', 'flow')])[0];
  expect('FR4 소스: 실제 신규 경로(components/class/flow · lib/class/flow) 위반 0', realSrc.pass, realSrc.val);
  allRows.push({ id: 'src', vp: 'src', ...realSrc });

  // 6) FR5 상태 의존 요소
  const fr5 = async (ref, inject) => injected({ ref, inject, measure: async (page, exp) => page.evaluate(measureFlowState, { tracker: exp.tracker, avMode: exp.avMode }) });
  expect('FR5 정상: 접촉 불량이면 트래커 288×64·LED 3·라벨·범례', (await fr5('__selftest:electrodes-bad')).every((r) => r.pass), (await fr5('__selftest:electrodes-bad'))[0]?.val);
  expect('FR5 정상: 접촉 양호면 트래커 미노출', (await fr5('__selftest:electrodes-good')).every((r) => r.pass));
  expect('FR5 정상: 카메라 켜짐=영상, 꺼짐=가로 막대', (await fr5('__selftest:av-video')).every((r) => r.pass) && (await fr5('__selftest:av-bar')).every((r) => r.pass));
  expect('FR5 주입: 접촉 양호인데 트래커 노출 → FAIL', (await fr5('__selftest:electrodes-good', () => { const d = document.createElement('div'); d.setAttribute('data-pz', 'flow-electrodes'); d.style.cssText = 'width:100px;height:40px'; d.textContent = '트래커'; document.querySelector('[data-pz="flow-col"]').appendChild(d); })).some((r) => !r.pass));
  expect('FR5 주입: 트래커 폭이 288 이 아니면 → FAIL', (await fr5('__selftest:electrodes-bad', () => { document.querySelector('[data-pz="flow-electrodes"]').style.maxWidth = '200px'; })).some((r) => !r.pass));
  expect('FR5 주입: LED 하나 제거 → FAIL', (await fr5('__selftest:electrodes-bad', () => document.querySelector('[data-led="R"]').remove())).some((r) => !r.pass));
  expect('FR5 주입: 카메라 꺼짐인데 영상 노출 → FAIL', (await fr5('__selftest:av-bar', () => { const v = document.createElement('video'); v.style.cssText = 'width:100px;height:60px;display:block'; document.querySelector('[data-pz="flow-avcheck"]').appendChild(v); })).some((r) => !r.pass));
  expect('FR5 주입: 카메라 켜짐인데 가로 막대도 노출 → FAIL', (await fr5('__selftest:av-video', () => { const d = document.createElement('div'); d.setAttribute('data-pz', 'flow-level'); d.style.cssText = 'width:100px;height:8px'; document.querySelector('[data-pz="flow-avcheck"]').appendChild(d); })).some((r) => !r.pass));

  // 7) FR6 오버레이가 CTA 를 가리지 않음
  function cover() { const r = document.querySelector('[data-pz="flow-cta"]').getBoundingClientRect(); const d = document.createElement('div'); d.setAttribute('data-pz', 'banner'); d.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:99;background:#000`; document.body.appendChild(d); }
  const fr6 = async (query, inject) => injected({ ref: '__selftest:wizard', query, inject, measure: async (page) => page.evaluate(measureCtaCover) });
  expect('FR6 정상: 오버레이 없음 → 가려짐 없음', (await fr6('')).every((r) => r.pass));
  expect('FR6 주입: 배너가 CTA 를 덮음(시트 없음) → FAIL', (await fr6('', `(${cover})()`)).some((r) => !r.pass));
  expect('FR6 주입: 시트 열림 + 푸터 inert 해제 + 덮음 → FAIL', (await fr6('sheet=1', `document.querySelector('.pz-shell__dock').removeAttribute('inert'); (${cover})()`)).some((r) => !r.pass));
  expect('FR6 정상: 시트 열림 + 푸터 inert 면 덮여도 PASS', (await fr6('sheet=1', `(${cover})()`)).every((r) => r.pass));

  // 8) 균형 FS1·FS3·FS7·FS9
  const fs1 = async (inject) => injected({ ref: '__selftest:wizard', viewport: [1280, 720], inject, measure: async (page) => page.evaluate(measureFlowSymmetry) });
  expect('FS 정상: 컬럼 중심축·상단 바 대칭·세로 중앙·max-width 위반 0 (1280×720)', (await fs1()).length >= 4 && (await fs1()).every((r) => r.pass), (await fs1()).map((r) => `${r.rule} ${r.val}`).join(' / '));
  expect('FS1 주입: 컬럼을 오른쪽으로 40px 치우치면 FAIL', (await fs1(() => { document.querySelector('[data-pz="flow-col"]').style.marginLeft = '80px'; })).some((r) => r.rule === 'FS1' && !r.pass));
  expect('FS9 주입: 컬럼 폭 800px → FAIL', (await fs1(() => { document.querySelector('[data-pz="flow-col"]').style.cssText += ';width:800px;max-width:none'; })).some((r) => r.rule === 'FS9' && !r.pass));
  expect('FS3 주입: 상단 바 오른쪽 슬롯 폭 40px → FAIL', (await fs1(() => { document.querySelector('.pz-topbar__slot--end').style.width = '40px'; document.querySelector('[data-pz="flow-top"]').style.gridTemplateColumns = '96px 1fr 40px'; })).some((r) => r.rule === 'FS3' && !r.pass));
  expect('FS7 주입: 본문 컬럼을 위로 붙이면 FAIL', (await fs1(() => { const c = document.querySelector('[data-pz="flow-col"]'); c.style.margin = '0 auto auto'; })).some((r) => r.rule === 'FS7' && !r.pass));

  // 9) 공통 기준(measureFit 재사용)에 주입: 11px 글자·작은 버튼·코랄·페이지 스크롤
  const fitFails = await injected({
    ref: '__selftest:wizard',
    inject: () => {
      const bad = document.createElement('div');
      bad.style.cssText = 'position:absolute;left:8px;top:8px;z-index:9;color:#fff';
      bad.innerHTML = '<span style="font-size:11px">작은 글자</span><h3 style="color:#1f1f1f;font-size:15px">어두운 제목</h3><button type="button" style="width:20px;height:20px">x</button><i style="display:block;width:30px;height:30px;background:rgb(232,180,160)"></i>';
      document.querySelector('[data-pz="app"]').appendChild(bad);
      document.documentElement.style.minHeight = '3000px';
    },
    measure: async (page) => page.evaluate(measureFit, fitConfig('__selftest:wizard')),
  });
  const injectedRules = failedRules(fitFails);
  expect('공통 기준 주입: P1 스크롤·P2 11px·P3 터치·P9 코랄·PC 어두운 글자 FAIL', ['P1', 'P2', 'P3', 'P9', 'PC'].every((r) => injectedRules.includes(r)), `실제 FAIL 규칙: ${injectedRules.join(',') || '없음'}`);
  allRows.push(...asRows('__selftest:wizard+inject', fitFails));

  // 10) 보조 뷰포트 CTA 도달성: 푸터가 화면 밖으로 밀리면 FAIL
  const reach = await injected({ ref: '__selftest:wizard', viewport: [390, 600], inject: () => { document.querySelector('.pz-shell__dock').style.transform = 'translateY(300px)'; }, measure: async (page) => page.evaluate(measureCtaReach) });
  expect('CTA 도달성 주입(390×600): 푸터가 화면 밖이면 FAIL', reach.some((r) => !r.pass), reach[0]?.val);
  expect('FR 규칙 이름이 보고서에 출력된다', /FR1 .*하단 CTA 위치 고정/.test(formatReport({ title: 't', role: 'x', rows: [{ id: 'a', vp: '1x1', rule: 'FR1', val: 'v', pass: true }] })));

  writeReport(path.join(HERE, 'out', 'selftest.txt'), `${results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`).join('\n')}\n\n${formatReport({ title: '측정 스크립트 자가 검증 상세(사전 흐름)', role: 'selftest', rows: allRows })}`);
} finally {
  await browser.close();
  if (server) await server.close();
}

const bad = results.filter((r) => !r.ok);
console.log(`\n자가 검증 ${results.length - bad.length}/${results.length} 충족`);
if (bad.length) process.exitCode = 1;
