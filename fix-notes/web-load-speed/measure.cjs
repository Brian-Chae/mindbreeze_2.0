// 실행: node fix-notes/web-load-speed/measure.cjs <preview port> <결과 JSON>
// 원본 저장소 Playwright와 설치된 Chrome을 사용한다. 계정 정보·API 응답은 저장하지 않는다.
const { chromium } = require('../../frontend/node_modules/playwright');
const fs = require('node:fs');
const origin = 'https://dev.mindbreeze.looxidlabs.com';
const routes = ['/dashboard', '/classes', '/clients', '/reports', '/chat'];
(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const results = [];
  const traceEvidence = [];
  for (let run = 0; run < Number(process.env.MB_SPEED_RUNS || 3); run++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.routeWebSocket('**/socket.io/**', socket => socket.close());
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !/\/auth\/(login|refresh)$/.test(url.pathname)) return route.abort();
      if (url.origin === origin && process.argv[2] !== 'dev') {
        const response = await fetch(`http://127.0.0.1:${process.argv[2]}${url.pathname}${url.search}`);
        return route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'text/plain' }, body: Buffer.from(await response.arrayBuffer()) });
      }
      return route.continue();
    });
    const page = await context.newPage();
    let apiErrors = [];
    let pageErrors = 0;
    page.on('pageerror', () => { pageErrors++; });
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname.includes('/api/v1/') && response.status() >= 400) apiErrors.push({ path: url.pathname, status: response.status() });
    });
    await page.goto(`${origin}/login?role=counselor`);
    await page.locator('input[type=email]').fill(process.env.MB_SPEED_EMAIL || 'counselor@test.com');
    await page.locator('input[type=password]').fill(process.env.MB_SPEED_PASSWORD || (() => { throw new Error('MB_SPEED_PASSWORD를 설정하세요'); })());
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/dashboard');
    await page.waitForTimeout(1800);
    async function measure(path, mode) {
      apiErrors = []; pageErrors = 0;
      let start = 0;
      const tracing = run === 0 && path === '/classes' && mode === 'reload';
      const cdp = tracing ? await context.newCDPSession(page) : null;
      if (cdp) await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8,blink.user_timing,loading', transferMode: 'ReturnAsStream' });
      if (mode === 'reload') await page.goto(origin + path);
      else {
        start = await page.evaluate(() => performance.now());
        await page.locator(`a[href="${path}"]:visible`).first().click();
        await page.waitForURL(origin + path);
      }
      await page.waitForTimeout(1800);
      const row = await page.evaluate(({ start, path, mode, run }) => {
        const entries = performance.getEntriesByType('resource').filter(e => e.startTime >= start && e.name.includes('/api/v1/'));
        const counts = {};
        for (const e of entries) { const u = new URL(e.name); const key = u.pathname + u.search; counts[key] = (counts[key] || 0) + 1; }
        return { run, path, mode, completeMs: Math.round(Math.max(start, ...entries.map(e => e.responseEnd)) - start), requests: entries.length, duplicates: Object.values(counts).reduce((sum, n) => sum + Math.max(0, n - 1), 0), counts,
          resources: performance.getEntriesByType('resource').filter(e => e.startTime >= start && (e.name.includes('/api/v1/') || /\/assets\/.*\.js$/.test(e.name) || e.name.includes('background5.webp'))).map(e => { const u = new URL(e.name); return { path: u.pathname + u.search, start: Math.round(e.startTime-start), end: Math.round(e.responseEnd-start) }; }) };
      }, { start, path, mode, run });
      row.apiErrors = apiErrors;
      row.expectedApiErrors = apiErrors.filter(error => error.path === '/api/v1/classes/instructor-candidates' && error.status === 403);
      row.unexpectedApiErrors = apiErrors.filter(error => !row.expectedApiErrors.includes(error));
      row.pageErrors = pageErrors;
      row.visibleAlerts = await page.locator('[role="alert"]:visible').count();
      row.pendingViews = await page.locator('[aria-busy="true"]:visible').count();
      row.shellVisible = await page.locator('[data-shell-variant]:visible').count() > 0;
      if (row.unexpectedApiErrors.length || row.pageErrors || row.visibleAlerts || row.pendingViews || !row.shellVisible) throw new Error(`화면 검증 실패: ${path} ${mode} ${JSON.stringify({apiErrors, pageErrors, alerts: row.visibleAlerts, pending: row.pendingViews, shell: row.shellVisible})}`);
      if (cdp) {
        const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
        await cdp.send('Tracing.end');
        const { stream } = await done;
        let raw = '';
        while (true) { const chunk = await cdp.send('IO.read', { handle: stream }); raw += chunk.data; if (chunk.eof) break; }
        await cdp.send('IO.close', { handle: stream });
        const events = JSON.parse(raw).traceEvents;
        const nav = events.find(e => e.name === 'navigationStart');
        const zero = nav?.ts || events[0].ts;
        for (const e of events) {
          if (!['TimerInstall', 'TimerFire', 'FunctionCall', 'Layout', 'Paint'].includes(e.name)) continue;
          const d = e.args?.data || {};
          traceEvidence.push({ ms: Math.round((e.ts-zero)/1000), event: e.name, durationMs: Number(((e.dur || 0)/1000).toFixed(3)), ...Object.fromEntries(['timerId', 'timeout', 'functionName', 'lineNumber', 'columnNumber'].filter(k => k in d).map(k => [k,d[k]])) });
        }
        await cdp.detach();
      }
      results.push(row);
      console.log(JSON.stringify({run,path,mode,ms:row.completeMs,requests:row.requests,duplicates:row.duplicates}));
    }
    for (const path of routes) await measure(path, 'reload');
    // 홈을 포함해 모든 항목을 실제 메뉴 링크로 이동한다.
    for (const path of routes) await measure(path, 'menu');
    await context.close();
  }
  fs.writeFileSync(process.argv[3], JSON.stringify(results, null, 2));
  fs.writeFileSync(process.argv[3].replace('.json', '-trace.json'), JSON.stringify(traceEvidence, null, 2));
  await browser.close();
})().catch(error => { console.error(error.message); process.exit(1); });
