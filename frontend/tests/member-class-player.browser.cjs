// 실행: NODE_PATH=<playwright 설치 경로> node --test tests/member-class-player.browser.cjs   (또는 npm run test:browser)
// SDD-208 I1: 새 회원 진행 화면(MemberClassContainer)을 실제 번들로 띄워 한 화면·도달성·신호·몰입을 검증한다.
// 외부 경계(BLE useBand · 실시간 소켓 · LiveKit 토큰 훅)만 대체하고 화면·CSS 는 그대로 쓴다.
// 이전 시나리오(GuestMeditationPanel)에서 바뀐 점:
//   - 그룹 평균 수신·"그룹 N" 배지·6개 다이얼 단언은 삭제(spec 합의 #5: 회원 화면은 다른 참가자와 견주지 않는다) → 반대로 평균이 화면·구독에 없음을 확인
//   - 클래스 이름(.player-*, .member-*) 대신 측정 훅(data-pz)과 역할/이름으로 찾는다
//   - 지표 6개는 도크 "내 상태" 시트로 이동, 기기 연결은 "기기" 시트로 이동
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const baseUrl = process.env.PLAYER_TEST_URL || 'http://127.0.0.1:5176';
const outputDir = process.env.PLAYER_SCREENSHOTS || '/tmp/member-player-qa';
const frontend = path.resolve(__dirname, '..');

const MODULE_MOCKS = new Map([
  ['useBand.ts', `
    import { useState } from 'react';
    export function useBand() {
      const [connected, setConnected] = useState(false);
      const [leadOff, setLeadOff] = useState(false);
      window.setBandLeadOff = setLeadOff;
      return { connectionState: connected ? 'connected' : 'disconnected', deviceStatus: leadOff ? 'lead_off' : 'ok',
        lastEegAt: new Date().toISOString(), battery: 80, signalQualityLevel: 'ok', isSupported: true, isMock: false,
        leadOff: { ch1: leadOff, ch2: false }, error: null, pendingCount: 0,
        scoredIndices: { focusIndex: 80, relaxationIndex: 60, emotionalStability: 70 },
        heartRate: 72, respiratoryRate: 14, sdnn: 42, connectedElapsedSec: 92,
        getEegWaveformSamples: () => ({ fp1: [0, 1, 2, 1, 0, -1, -2, -1], fp2: [0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5] }),
        connect: async () => setConnected(true), disconnect: async () => setConnected(false) };
    }`],
  ['useSessionLiveSocket.ts', `
    export function useSessionLiveSocket(opts) {
      window.socketOpts = opts;
      return { isConnected: true, sendSignal: (type) => { window.sentSignal = type; return 'sent'; } };
    }`],
  ['useMemberLiveKit.ts', `
    export function useMemberLiveKit() {
      return { token: null, roomId: null, canPublish: false, error: null, loading: false, notReady: false, attemptCount: 0,
        connect: async () => undefined, disconnect: () => undefined, serverUrl: 'wss://qa.invalid',
        speaking: false, raisedHand: false, raising: false, raiseHandError: null, raiseHand: async () => undefined };
    }`],
]);

const readCss = (...parts) => fs.readFileSync(path.join(frontend, ...parts), 'utf8');

/** 새 회원 컨테이너를 실제 번들로 띄운다. place: online | offline */
async function mount(page, place = 'online') {
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => localStorage.setItem('mb_class_onboarding_seen', '1'));
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: {} }));
  const { build } = require('esbuild');
  const bundle = await build({
    stdin: {
      contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { MemberClassContainer } from './src/components/class/player/member/MemberClassContainer';
      createRoot(document.getElementById('root')).render(React.createElement(MemberClassContainer, {
        title: '마음챙김 명상 4주차', startedAt: new Date(Date.now() - 92000).toISOString(), durationMin: 50,
        sessionId: 'qa-session', participantId: 'qa-participant', classCode: null,
        locationType: '${place}', participantMode: 'group', maxParticipants: ${place === 'offline' ? 30 : 12},
        onLeave: () => { window.leftClass = true; }
      }));`,
      resolveDir: frontend,
      loader: 'tsx',
    },
    bundle: true, write: false, format: 'esm', jsx: 'automatic',
    define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'player-test-boundaries',
      setup(b) {
        b.onLoad({ filter: /\/use(Band|SessionLiveSocket|MemberLiveKit)\.ts$/ }, (args) => ({ contents: MODULE_MOCKS.get(path.basename(args.path)), loader: 'js', resolveDir: frontend }));
        b.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
      },
    }],
  });
  // 번들에서 css import 를 비웠으므로 화면 CSS 를 직접 싣는다(공용 토큰 → 공용 → 회원). 앱 전역 CSS(dist)를 함께 싣는다
  const assets = path.join(frontend, 'dist/assets');
  const globalStyle = fs.existsSync(assets) ? fs.readdirSync(assets).find((n) => n.startsWith('style-') && n.endsWith('.css')) : null;
  // 앱 전역 CSS(Tailwind 기본 스타일·mb-tokens)가 화면 치수에 영향을 주므로 빌드 산출물이 반드시 필요하다
  if (!globalStyle) throw new Error('dist/assets/style-*.css 가 없습니다 — 먼저 `npm run build` 를 실행하세요');
  const css = [
    fs.readFileSync(path.join(assets, globalStyle), 'utf8'),
    readCss('src/components/class/player/shared/player-tokens.css'),
    readCss('src/components/class/player/shared/player-shared.css').replace(/@import[^;]+;/g, ''),
    readCss('src/components/class/player/member/member-player.css'),
  ].join('\n');
  await page.route('**/player-fixture.js', (route) => route.fulfill({ contentType: 'application/javascript', body: bundle.outputFiles[0].text }));
  await page.route('**/member-player-test', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
      <body><div id="root"></div><script type="module" src="/player-fixture.js"></script></body></html>`,
  }));
  await page.goto(`${baseUrl}/member-player-test`);
  await page.locator('[data-pz="ring"]').waitFor();
}

const dockItem = (page, label) => page.locator('[data-pz="dk"]').filter({ hasText: label });

async function assertLayout(page) {
  const layout = await page.evaluate(() => {
    const de = document.documentElement;
    const items = [...document.querySelectorAll('[data-pz="dk"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { label: el.textContent, h: r.height, rect: [r.left, r.top, r.right, r.bottom].map(Math.round), inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
    });
    const ring = document.querySelector('[data-pz="ring"]').getBoundingClientRect();
    return {
      viewport: [innerWidth, innerHeight], scroll: [de.scrollWidth, de.scrollHeight],
      items, ringInside: ring.left >= 0 && ring.right <= innerWidth && ring.top >= 0 && ring.bottom <= innerHeight,
    };
  });
  assert.ok(layout.scroll[0] <= layout.viewport[0] && layout.scroll[1] <= layout.viewport[1], `페이지 스크롤이 생김: ${JSON.stringify(layout)}`);
  assert.equal(layout.items.length, 5, JSON.stringify(layout));
  assert.deepEqual(layout.items.filter((i) => i.h < 44 || !i.inside), [], JSON.stringify(layout));
  assert.equal(layout.ringInside, true, JSON.stringify(layout));
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`${viewport.width}×${viewport.height}: 1화면·밴드 연결·신호·몰입`, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport });
      await page.clock.install();
      await mount(page);
      await assertLayout(page);
      await page.screenshot({ path: `${outputDir}/player-${viewport.width}-disconnected.png` });

      // 기기 시트에서 밴드를 연결하면 링에 지표 값이 나온다
      await dockItem(page, '기기').click();
      await page.getByRole('button', { name: 'LINK BAND 연결', exact: true }).click();
      await page.clock.runFor(2000);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-pz="ring"]').getAttribute('data-core'), 'gauge');
      assert.equal(await page.locator('[data-pz="ring"] .pz-ring__num b').textContent(), '60');
      await assertLayout(page);
      await page.screenshot({ path: `${outputDir}/player-${viewport.width}-connected.png` });

      // 다른 참가자와 견주는 값은 화면에도 구독에도 없다(그룹 평균·순위·상위/하위)
      assert.doesNotMatch(await page.locator('body').innerText(), /평균|순위|상위|하위|종합/);
      assert.equal(await page.evaluate(() => typeof window.socketOpts.onGroupAverage), 'undefined');

      // 조용한 신호는 도크의 시트에서 보낸다
      await dockItem(page, '조용한 신호').click();
      await page.getByRole('button', { name: /잘 따라가요/ }).click();
      assert.equal(await page.evaluate(() => window.sentSignal), 'following');
      await page.keyboard.press('Escape');

      // 소리 시트: 상담사 음성 음소거, 화면 끄기(몰입)
      await dockItem(page, '소리').click();
      const speaker = page.getByRole('switch', { name: '상담사 음성 듣기' });
      assert.equal(await speaker.getAttribute('aria-checked'), 'true');
      await speaker.click();
      assert.equal(await speaker.getAttribute('aria-checked'), 'false');
      await page.getByRole('button', { name: '화면 끄기', exact: true }).click();
      assert.equal(await page.getByTestId('member-screen-off').getAttribute('aria-hidden'), 'false');
      // 진행 중에는 BGM 을 재생하지 않는다(fd93da24 정책)
      assert.equal(await page.locator('.player-bgm').count(), 0);
      await page.getByRole('button', { name: '화면 켜기', exact: true }).click();
      assert.equal(await page.getByTestId('member-screen-off').getAttribute('aria-hidden'), 'true');
    } finally { await browser.close(); }
  });
}

test('현장 수업(오프라인)은 영상·마이크 UI 없이 현장 안내 카드를 보이고 이 기기에서는 소리를 내지 않는다', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mount(page, 'offline');
    assert.equal(await page.locator('[data-pz="pip"]').count(), 0);
    assert.equal(await page.locator('[data-pz="mypip"]').count(), 0);
    assert.equal(await page.locator('[data-pz="media-row"]').count(), 0);
    assert.equal(await page.locator('[data-pz="side-card"]').count(), 1);
    // 현장 수업은 이 기기에서 상담사 음성을 재생하지 않는다 — 소리 시트에는 안내와 화면 끄기만 있다
    await dockItem(page, '소리').click();
    assert.equal(await page.getByRole('switch').count(), 0);
    assert.match(await page.locator('[data-pz="sheet"]').innerText(), /같은 공간의 스피커로 함께 들어요/);
  } finally { await browser.close(); }
});

for (const viewport of [{ width: 390, height: 600 }, { width: 1280, height: 420 }]) {
  test(`${viewport.width}×${viewport.height}: 짧은 화면에서도 도크 항목이 전부 눌린다`, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport });
      await mount(page);
      const unreachable = await page.evaluate(() => [...document.querySelectorAll('[data-pz="dk"]')].filter((el) => {
        const r = el.getBoundingClientRect();
        const inside = r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !inside || !(hit === el || el.contains(hit));
      }).map((el) => el.textContent));
      assert.deepEqual(unreachable, []);
      // 조용한 신호 3종도 시트 안에서 눌러 보낼 수 있다
      await dockItem(page, '조용한 신호').click();
      for (const [label, signal] of [['잘 따라가요', 'following'], ['조금 어려워요', 'difficult'], ['잠시 쉴게요', 'resting']]) {
        const button = page.getByRole('button', { name: new RegExp(label) });
        const reachable = await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button') === element;
        });
        assert.equal(reachable, true, `${label} 버튼이 화면 안에서 클릭 가능해야 한다`);
        await button.click();
        assert.equal(await page.evaluate(() => window.sentSignal), signal);
      }
    } finally { await browser.close(); }
  });
}
