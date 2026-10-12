// 실행: NODE_PATH=<playwright 설치 경로> node --test tests/member-class-player.browser.cjs
// 페이지와 번들을 라우팅 fixture로 제공한다. 외부 BLE/WS만 대체하고 실제 화면을 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseUrl = process.env.PLAYER_TEST_URL || 'http://127.0.0.1:5176';
const outputDir = process.env.PLAYER_SCREENSHOTS || '/tmp/member-player-qa';

async function mount(page, mode = 'online') {
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => localStorage.setItem('mb_class_onboarding_seen', '1'));
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: {} }));
  const moduleMocks = new Map([
    ['useBand.ts', `
    import { useState } from 'react';
    export function useBand() {
      const [connected, setConnected] = useState(false);
      const [leadOff, setLeadOff] = useState(false);
      window.setBandLeadOff = setLeadOff;
      return { connectionState: connected ? 'connected' : 'disconnected', deviceStatus: leadOff ? 'lead_off' : 'ok',
        lastEegAt: new Date().toISOString(), battery: 80, signalQualityLevel: 'ok', isSupported: true, isMock: false,
        leadOff: {ch1: leadOff, ch2: false}, error: null,
        scoredIndices: { focusIndex: window.focusValue ?? 80, relaxationIndex: 60, emotionalStability: 70 },
        heartRate: 72, respiratoryRate: 14, sdnn: 42, connectedElapsedSec: 92,
        acc: { magnitude: [0, 1, 0.5, 2, 1] },
        getEegWaveformSamples: () => ({ fp1: [0, 1, 2, 1, 0, -1, -2, -1], fp2: [0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5] }),
        getPpgWaveformSamples: () => ({ red: [0, 1, 2, 1, 0, -1, -2, -1], ir: [0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5] }),
        connect: async () => setConnected(true), disconnect: async () => setConnected(false) };
    }`],
    ['useSessionLiveSocket.ts', `
    export function useSessionLiveSocket(opts) {
      window.emitGroupAverage = (event) => opts?.onGroupAverage?.(event);
      return { sendSignal: type => {window.sentSignal = type; return true;} };
    }
  `],
  ]);
  const path = require('node:path');
  const fs = require('node:fs');
  const frontend = path.resolve(__dirname, '..');
  const {build} = require('esbuild');
  const bundle = await build({
    stdin: {contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {GuestMeditationPanel} from './src/components/class/GuestMeditationPanel';
      createRoot(document.getElementById('root')).render(React.createElement(GuestMeditationPanel, {
        title:'마음챙김 명상 4주차', startedAt:new Date(Date.now()-92000).toISOString(), durationMin:50,
        sessionId:'qa-session', participantId:'qa-participant', classCode:null,
        locationType:'${mode}', participantMode:'group', maxParticipants:${mode === 'offline' ? 30 : 12}, onLeave:()=>{window.leftClass=true;}
      }));`, resolveDir:frontend, loader:'tsx'},
    bundle:true, write:false, format:'esm', jsx:'automatic', define:{'import.meta.env':'{}','process.env.NODE_ENV':'\"production\"'},
    plugins:[{name:'player-test-boundaries',setup(build){
      build.onLoad({filter:/\/use(Band|SessionLiveSocket)\.ts$/}, args => ({contents:moduleMocks.get(path.basename(args.path)),loader:'js',resolveDir:frontend}));
      build.onLoad({filter:/\.css$/}, () => ({contents:'',loader:'js'}));
    }}]
  });
  const styleFile = fs.readdirSync(path.join(frontend,'dist/assets')).find(name => name.startsWith('style-') && name.endsWith('.css'));
  const css = fs.readFileSync(path.join(frontend,'dist/assets',styleFile),'utf8') + '\\n' + fs.readFileSync(path.join(frontend,'src/components/class/member-class-player.css'),'utf8');
  await page.route('**/player-fixture.js', route => route.fulfill({contentType:'application/javascript',body:bundle.outputFiles[0].text}));
  await page.route('**/member-player-test', route => route.fulfill({contentType:'text/html; charset=utf-8',body:`
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
    <body><div id="root"></div><script type="module" src="/player-fixture.js"></script></body></html>`}));
  await page.goto(`${baseUrl}/member-player-test`);
  await page.locator('.player-metric').first().waitFor();
}

async function assertLayout(page) {
  const layout = await page.evaluate(() => {
    const root = document.querySelector('.member-class-player');
    const frame = document.querySelector('.player-body').getBoundingClientRect();
    // 우측 컬럼(.member-right)은 모바일에서 내부 스크롤 — 디바이스/raw 카드는 스크롤 영역이므로
    // '한 화면' 검증 대상은 스크롤되지 않는 좌측 카드 + 우측 상단 지표 카드로 한정한다.
    const selectors = ['.member-video-card', '.member-signal-card', '.member-metrics-card'];
    return { viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      root: [root.scrollWidth, root.scrollHeight], videoHeight: document.querySelector('.member-video-card').getBoundingClientRect().height,
      outside: selectors.filter(selector => {const r = document.querySelector(selector).getBoundingClientRect(); return r.right > frame.right + 1 || (innerWidth >= 1024 && r.bottom > frame.bottom + 1);}),
      smallButtons: [...document.querySelectorAll('.player-screen button')].filter(b => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 44).map(b => b.textContent)
    };
  });
  assert.deepEqual(layout.document, layout.viewport, JSON.stringify(layout));
  assert.deepEqual(layout.root, layout.viewport, JSON.stringify(layout));
  assert.deepEqual(layout.outside, [], JSON.stringify(layout));
  assert.deepEqual(layout.smallButtons, [], JSON.stringify(layout));
  assert.ok(layout.videoHeight >= 180, JSON.stringify(layout));
  return layout;
}

for (const viewport of [{width:1280,height:720},{width:390,height:844}]) {
  test(`${viewport.width}×${viewport.height}: 1화면·지표·시그널·몰입`, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport });
      await page.clock.install();
      await mount(page);
      await assertLayout(page);
      await page.screenshot({path:`${outputDir}/player-${viewport.width}-disconnected.png`});
      await page.getByRole('button', {name:'LINK BAND 연결', exact:true}).click();
      // SDD-124: rAF raw 파형이 fake clock에서 수만 프레임을 동기 실행해 느려지므로
      // runFor를 최소(2초)로 제한 — 1Hz 지표 갱신 2틱이면 다이얼/그룹 평균 검증에 충분.
      await page.clock.runFor(2000);
      // SDD-125: 마음3+몸3 = 6개 다이얼 + raw 2블록(EEG·PPG, ACC 제거)
      assert.equal(await page.locator('.player-metric').count(), 6);
      assert.equal(await page.locator('.member-raw-block').count(), 2);
      if (viewport.width >= 768) {
        // 그룹 평균 수신 → 각 다이얼에 "그룹 N" 태그 + "그룹 평균보다 ±N" 배지
        await page.evaluate(() => window.emitGroupAverage({
          session_id: 'qa-session', wearer_count: 5, min_wearers: 3, sample_status: 'ok',
          metrics: {
            focus_index: { mean: 0.5 }, relaxation_index: { mean: 0.4 }, emotional_stability: { mean: 0.45 },
            heart_rate: { mean: 70 }, respiratory_rate: { mean: 12 }, sdnn: { mean: 40 },
          },
        }));
        assert.equal(await page.locator('.player-dial-average').count(), 6);
        assert.match(await page.locator('.caption-avg').first().textContent(), /그룹 평균/);
        // 표본 부족 → 배지가 "표본 부족"으로 접힌다
        await page.evaluate(() => window.emitGroupAverage({
          session_id: 'qa-session', wearer_count: 1, min_wearers: 3, sample_status: 'insufficient',
          metrics: {
            focus_index: { mean: null }, relaxation_index: { mean: null }, emotional_stability: { mean: null },
            heart_rate: { mean: null }, respiratory_rate: { mean: null }, sdnn: { mean: null },
          },
        }));
        assert.equal(await page.locator('.player-dial-average').count(), 0);
        assert.match(await page.locator('.caption-avg').first().textContent(), /표본 부족/);
      }
      await assertLayout(page);
      await page.screenshot({path:`${outputDir}/player-${viewport.width}-connected.png`});
      await page.getByRole('button',{name:/잘 따라가요/}).click();
      assert.equal(await page.evaluate(() => window.sentSignal),'following');
      await page.getByRole('button',{name:'스피커 음소거',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'스피커 켜기',exact:true}).getAttribute('aria-pressed'),'false');
      await page.getByRole('button',{name:'화면 끄기',exact:true}).click();
      assert.equal(await page.locator('.player-screen').getAttribute('inert'),'');
      // 진행 중에는 BGM을 재생하지 않는다(fd93da24 정책).
      assert.equal(await page.locator('.player-bgm').count(),0);
      await page.getByRole('button',{name:'화면 켜기',exact:true}).click();
    } finally { await browser.close(); }
  });
}

test('강당형은 영상 없이 타이머·기본 뮤트 유지', async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    await mount(page,'offline');
    assert.equal(await page.locator('.player-live-tile').count(),0);
    assert.equal(await page.locator('.player-timer').count(),1);
    assert.equal(await page.getByRole('button',{name:'스피커 켜기',exact:true}).getAttribute('aria-pressed'),'false');
    await assertLayout(page);
  } finally { await browser.close(); }
});

for (const viewport of [{ width: 390, height: 600 }, { width: 1280, height: 420 }]) {
  test(`${viewport.width}×${viewport.height}: 짧은 화면에서 조용한 신호에 접근해 전송한다`, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport });
      await mount(page);
      for (const [label, signal] of [['잘 따라가요', 'following'], ['조금 어려워요', 'difficult'], ['잠시 쉴게요', 'resting']]) {
        const button = page.getByRole('button', { name: new RegExp(label) });
        await page.mouse.move(viewport.width - 40, viewport.height - 80);
        await page.mouse.wheel(0, 1000);
        await page.waitForTimeout(100);
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
