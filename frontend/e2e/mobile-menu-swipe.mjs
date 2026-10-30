// SDD-240: 실제 앱 번들 + 합성 API로 검증한다. 외부 네트워크·실계정·백엔드는 사용하지 않는다.
import { build } from 'vite';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(frontend, '../specs/sdd-240-mobile-menu-swipe/captures');
const output = process.env.SDD240_BUILD_DIR || '/tmp/sdd240-web-build';
const envDir = '/tmp/sdd240-empty-env';
const counseling = process.argv.includes('--counseling');
await mkdir(envDir, { recursive: true });
await mkdir(artifacts, { recursive: true });
if (!process.argv.includes('--skip-build')) await build({ root: frontend, envDir, mode: 'swipe-qa',
  define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1'), 'import.meta.env.VITE_SOCKET_URL': JSON.stringify('http://127.0.0.1:5442'), 'import.meta.env.VITE_COUNSELING_ENABLED': JSON.stringify(String(counseling)) },
  plugins: [{ name: 'sdd240-local-protection-fixture', transformIndexHtml: { order: 'pre', handler() { return [{ tag: 'script', attrs: { type: 'module' }, children: `import {registerMobileSwipeProtection,notifyMobileSwipeProtection} from '/src/lib/mobile-menu-swipe-protection.ts'; let busy=false; registerMobileSwipeProtection(()=>busy); window.__sdd240Protect=value=>{busy=value;notifyMobileSwipeProtection();};` }]; } } }],
  build: { outDir: output, emptyOutDir: false }, logLevel: 'warn' });
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.html': 'text/html' };
const server = createServer(async (req, res) => {
  try {
    let path = resolve(output, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(output + '/')) path = resolve(output, 'index.html');
    try { if (!(await stat(path)).isFile()) path = resolve(output, 'index.html'); } catch { path = resolve(output, 'index.html'); }
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(500).end(); }
});
await new Promise(r => server.listen(5442, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = []; const pageErrors = []; const unknownApi = new Set();
const record = (name, detail = {}) => { results.push({ name, ...detail }); console.log(`통과: ${name}`); };
const classes = Array.from({ length: 5 }, (_, i) => ({ id: `class-${i}`, title: `합성 검증 클래스 ${i + 1}`, status: 'active', schedule_mode: 'fixed', planned_session_count: 3, area: 'meditation', progress: { completed: 1, total: 3 }, session_count: 3, next_session: { id: `session-${i}`, seq: 2, scheduled_at: '2026-11-20T10:00:00+09:00', status: 'scheduled', host: { id: 'qa-host', name: '합성 코치' } }, has_open_session: false }));
const counselor = { id: 'qa-host', name: '합성 코치', profile_image: null };
const dashboard = { counselor_id: 'qa-host', counselor_name: '합성 코치', org_id: 'qa-org', org_name: '합성 검증 기관', org_code: 'QAONLY', org_kind: 'institution', total_counselors: 0, total_classes: 5, in_progress_classes: 0, completed_classes: 0, total_participants: 0, pending_review_count: 0, counselors: [], classes: [] };
const shell = '[data-mobile-menu-swipe]'; const pageLayer = '[data-mobile-swipe-page]';
async function install(context, role) {
  const user = { id: `qa-${role}`, email: `${role}@example.test`, name: '합성 검증', role, verified_tier: 'verified', onboarding_completed: true, auth_provider: 'google', counselors: [counselor] };
  await context.addInitScript(u => localStorage.setItem('mb_user', JSON.stringify(u)), user);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/socket.io')) return route.fulfill({ status: 400, body: '합성 검증: 소켓 사용 안 함' });
    if (!url.pathname.startsWith('/api/v1/')) return route.continue();
    const path = url.pathname.slice(7); let data;
    if (path === '/auth/refresh') data = { access_token: 'synthetic-qa-only', token_type: 'bearer' };
    else if (route.request().method() !== 'GET') return route.fulfill({ status: 405, json: { detail: '읽기 전용 합성 검증' } });
    else if (path === '/auth/me') data = user;
    else if (path === '/devices/web-push/public-key') data = { public_key: '' };
    else if (path === '/client/counselors') data = [counselor];
    else if (path === '/classes/instructor-candidates') data = { instructors: [] };
    else if (path === '/classes') data = { classes, total: classes.length };
    else if (path === '/classes/class-0') data = { ...classes[0], location_type: 'online', linkband_mode: 'none', record_audio: false, capacity: 0, participant_mode: 'open', default_duration_min: 60, host_view: role === 'client' ? null : { access_code: null, instructors: [] } };
    else if (/^\/classes\/[^/]+\/sessions$/.test(path)) data = { sessions: [], total: 0 };
    else if (/^\/dashboard\//.test(path)) data = dashboard;
    else if (path === '/sessions') data = { sessions: [], total: 0 };
    else if (path === '/reports') data = { reports: [], total: 0, unread: 0, pending_review: 0 };
    else if (path === '/reports/auto-approve') data = { enabled: false };
    else if (path === '/chat/rooms') data = { rooms: [] };
    else if (path === '/notifications') data = { notifications: [], total: 0, unread: 0 };
    else if (path === '/notifications/unread-count') data = { unread: 0 };
    else if (path === '/counseling') data = { relationships: [], total: 0 };
    else if (/\/counselors$/.test(path)) data = [];
    else if (path.endsWith('/memberships')) data = { memberships: [], total: 0 };
    else { unknownApi.add(path); return route.fulfill({ status: 404, json: { detail: '합성 fixture 미등록' } }); }
    return route.fulfill({ status: 200, json: data });
  });
  await context.routeWebSocket(/.*/, socket => socket.close());
}
async function ready(page, path) {
  await page.goto(`http://127.0.0.1:5442${path}`);
  await page.locator(shell).waitFor();
  await page.waitForTimeout(200);
}
async function coords(page) {
  return page.locator(shell).evaluate(el => { const r = el.getBoundingClientRect(); return { width: r.width, top: r.top, height: r.height }; });
}
async function touch(page, from, to, { steps = 10, duration = 200, hold = false, cancel = false } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1], radiusX: 1, radiusY: 1, force: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await page.waitForTimeout(duration / steps);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from[0] + (to[0] - from[0]) * i / steps, y: from[1] + (to[1] - from[1]) * i / steps }] });
  }
  if (hold) { await page.waitForTimeout(40); return cdp; }
  await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  await cdp.detach(); await page.waitForTimeout(400);
}
async function swipe(page, dx, options) {
  const r = await coords(page); const x = dx < 0 ? 285 : 105;
  // 첫 화면의 공백에서 시작한다. 테스트 요소를 덧씌워 제스처 표면을 대체하지 않는다.
  const y = await page.locator(shell).evaluate((root, x) => {
    const r = root.getBoundingClientRect();
    for (let y = r.top + 28; y < r.bottom - 120; y += 4) {
      const el = document.elementFromPoint(x, y);
      const excluded = 'a,button,input,select,textarea,label,[contenteditable],table,canvas,.recharts-wrapper,[data-no-swipe],[data-mobile-swipe-native-x]';
      if (el && root.contains(el) && [-10,0,10].every(dy => {
        const near=document.elementFromPoint(x,y+dy); return near && root.contains(near) && !near.closest(excluded);
      })) return y;
    }
    throw new Error('실제 본문에서 터치 가능한 공백을 찾지 못함');
  }, x);
  await page.evaluate(({x,y}) => {
    window.__swipeTrace=[];
    if (!window.__swipeTraceInstalled) {
      window.__swipeTraceInstalled=true;
      for(const type of ['pointerdown','pointermove','pointercancel','pointerup']) document.addEventListener(type,e=>window.__swipeTrace.push({type,x:e.clientX,y:e.clientY,target:e.target.tagName,cls:e.target.className,touch:getComputedStyle(e.target).touchAction}),{capture:true});
    }
    window.__swipeStart = {x,y, chain:[]};
    for(let e=document.elementFromPoint(x,y);e;e=e.parentElement) window.__swipeStart.chain.push({tag:e.tagName,cls:e.className,touch:getComputedStyle(e).touchAction,native:e.hasAttribute('data-mobile-swipe-native-x'),width:e.clientWidth,scrollWidth:e.scrollWidth});
  },{x,y});
  await touch(page, [x, y], [x + dx, y], options);
}
async function pathIs(page, path, name) {
  if (new URL(page.url()).pathname !== path) {
    await capture(page, 'debug-failure.png');
    console.log('진단', await page.evaluate(() => ({ trace:window.__swipeTrace,start:window.__swipeStart,active: document.activeElement?.outerHTML.slice(0,500), inputs: [...document.querySelectorAll('input,textarea,select')].map(e=>({html:e.outerHTML.slice(0,300),value:e.value})), overlays:[...document.querySelectorAll('dialog[open],[role=dialog],[aria-modal=true],.fixed.inset-0')].map(e=>e.outerHTML.slice(0,300)), root:document.querySelector('[data-mobile-menu-swipe]')?.outerHTML.slice(0,400)})));
  }
  assert.equal(new URL(page.url()).pathname, path, name); record(name); }
async function capture(page, name) { await page.screenshot({ path: resolve(artifacts, name), fullPage: false }); }

try {
  for (const role of ['client', 'counselor', 'org_admin'].filter(role => !process.argv.some(arg => arg.startsWith('--role=')) || process.argv.includes(`--role=${role}`))) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    await install(context, role); const page = await context.newPage(); page.on('pageerror', e => pageErrors.push(`${role}: ${e.message}`));
    const tabs = role === 'client' ? ['/app', '/app/classes', counseling ? '/app/counseling' : '/app/chat', '/app/reports'] : [role === 'org_admin' ? '/dashboard/org' : '/dashboard', '/classes', counseling ? '/counseling' : '/reports', '/chat'];
    await ready(page, tabs[0]);
    if (process.argv.includes('--visual-only')) {
      const colors=await page.locator('.mobile-menu-swipe-hint').evaluate(el=>({background:getComputedStyle(el).backgroundColor,text:getComputedStyle(el.querySelector('p')).color}));
      const luminance=color=>color.match(/[0-9.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
      const l=[luminance(colors.background),luminance(colors.text)].sort((a,b)=>a-b);const contrast=(l[1]+.05)/(l[0]+.05);
      assert.ok(contrast>=4.5,`안내 대비 ${contrast}`);record(`${role}: 안내 본문 대비 4.5 이상`,{...colors,contrast});
      await capture(page,`${role}-home${counseling?'-counseling':''}.png`);
      const r=await coords(page);const c=await touch(page,[285,r.top+28],[165,r.top+28],{hold:true});
      await capture(page,`${role}-drag${counseling?'-counseling':''}.png`);
      await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await c.detach();await page.waitForTimeout(400);
      await pathIs(page,tabs[1],`${role}: 시각 확인 후 이웃 이동`);await capture(page,`${role}-classes${counseling?'-counseling':''}.png`);
      await context.close();continue;
    }
    if (process.argv.includes('--padding-only')) {
      const r=await coords(page);await page.evaluate(()=>{window.__pad=[];for(const t of ['pointerdown','pointercancel','pointermove'])document.addEventListener(t,e=>window.__pad.push({type:t,target:e.target.tagName,cls:e.target.className,touch:getComputedStyle(e.target).touchAction}),true);});const c=await touch(page,[195,r.top+4],[75,r.top+4],{hold:true});
      const offset=await page.locator(pageLayer).evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m41);
      console.log('padding 진단',await page.evaluate(()=>window.__pad));assert.ok(Math.abs(offset+120)<2, `본문 padding 추종 ${offset}`);record('본문 padding 터치 1:1 추종');
      await c.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await c.detach();await context.close();break;
    }
    assert.deepEqual(await page.locator('nav[aria-label="하단 메뉴"] a').evaluateAll(els => els.map(e => new URL(e.href).pathname)), tabs);
    record(`${role}: 표시 메뉴 순서`);
    const hitAreas=await page.locator('nav[aria-label="하단 메뉴"] a,nav[aria-label="하단 메뉴"] button').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height};}));
    assert.ok(hitAreas.every(r=>r.width>=44 && r.height>=44));record(`${role}: 하단 버튼 44px 이상`,{hitAreas});
    await capture(page, `${role}-home${counseling ? '-counseling' : ''}.png`);
    await swipe(page, 110); await pathIs(page, tabs[0], `${role}: 첫 탭 비순환`);
    await swipe(page, -25, { duration: 350 }); await pathIs(page, tabs[0], `${role}: 짧은 이동 복귀`);
    const r = await coords(page); const y = r.top + 28;
    const cdp = await touch(page, [285, y], [165, y], { hold: true });
    const follow = await page.locator(pageLayer).evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41);
    assert.ok(Math.abs(follow + 120) <= 2, `${role}: 추종 ${follow}`);
    const preview = page.locator('[data-mobile-swipe-preview]'); assert.equal(await preview.count(), 1);
    assert.equal(await preview.getAttribute('aria-hidden'), 'true');
    await capture(page, `${role}-drag${counseling ? '-counseling' : ''}.png`);
    record(`${role}: 120px 1:1 추종·이웃 비활성 미리보기`, { offset: follow });
    const historyBefore = await page.evaluate(() => history.length);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); await page.waitForTimeout(500);
    await pathIs(page, tabs[1], `${role}: 왼쪽 이동`);
    assert.equal(await page.evaluate(() => history.length), historyBefore + 1); record(`${role}: history 1회 push`);
    assert.ok(await page.evaluate(()=>document.activeElement?.hasAttribute('data-mobile-swipe-title') || document.activeElement?.hasAttribute('data-mobile-menu-swipe')));record(`${role}: 목적지 제목 포커스`);
    assert.match(await page.locator('[data-mobile-menu-swipe] [role=status]').textContent(), /메뉴로 이동했어요/);record(`${role}: 접근성 live 이동 안내`);
    assert.equal(await page.locator('nav[aria-label="하단 메뉴"] [aria-current="page"]').getAttribute('href'), tabs[1]);
    await capture(page, `${role}-classes${counseling ? '-counseling' : ''}.png`);
    await swipe(page, 120); await pathIs(page, tabs[0], `${role}: 오른쪽 이동`);
    const visitedR=await coords(page);const visitedTouch=await touch(page,[285,visitedR.top+28],[165,visitedR.top+28],{hold:true});
    assert.equal(await page.locator('[data-mobile-swipe-preview]').getAttribute('data-mobile-swipe-preview-kind'),'visited');
    assert.equal(await page.locator('[data-mobile-swipe-preview] [id]').count(),0);record(`${role}: 재방문 실제 화면 미리보기·id 중복 없음`);
    await visitedTouch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await visitedTouch.detach();await page.waitForTimeout(200);
    for (let i = 1; i < tabs.length; i++) { await swipe(page, -120); await pathIs(page, tabs[i], `${role}: 이웃 탭 ${i + 1}`); }
    await swipe(page, -120); await pathIs(page, tabs[3], `${role}: 마지막 탭·더보기 비진입`);
    assert.equal(await page.locator('[data-mobile-swipe-preview]').count(), 0);
    await page.goBack(); await page.waitForTimeout(300); await pathIs(page, tabs[2], `${role}: back 이전 방문`);
    if (role === 'client' && !counseling && !process.argv.includes('--smoke')) {
      await ready(page, tabs[1]);
      await swipe(page, -60, { steps: 3, duration: 24 }); await pathIs(page, tabs[2], '실제 짧은 빠른 플릭');
      await ready(page, tabs[0]);
      const hintClose = page.getByRole('button', { name: '메뉴 이동 안내 닫기' });
      if (await hintClose.isVisible()) await hintClose.click();
      const paddingR=await coords(page);const paddingTouch=await touch(page,[195,paddingR.top+4],[75,paddingR.top+4],{hold:true});
      const paddingOffset=await page.locator(pageLayer).evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m41);
      assert.ok(Math.abs(paddingOffset+120)<2);record('본문 padding 터치 1:1 추종',{offset:paddingOffset});await capture(page,'client-padding-drag.png');
      await paddingTouch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await paddingTouch.detach();await page.waitForTimeout(200);
      const beforeVertical = await page.locator('.cs-structure-scroll').evaluate(e => e.scrollTop);
      await touch(page, [195, 530], [195, 270]);
      const afterVertical = await page.locator('.cs-structure-scroll').evaluate(e => e.scrollTop);
      assert.ok(afterVertical > beforeVertical + 20, `실제 세로 스크롤 ${beforeVertical}→${afterVertical}`);
      await pathIs(page, tabs[0], '실제 세로 스크롤 메뉴 유지'); record('실제 세로 스크롤 증가', { beforeVertical, afterVertical });
      const rail = page.locator('.mh-track').first();
      await rail.scrollIntoViewIfNeeded(); await page.waitForTimeout(100);
      const railRect = await rail.boundingBox(); assert.ok(railRect);
      const ry = Math.min(railRect.y + 100, 590);
      const railBefore = await rail.evaluate(e=>e.scrollLeft);
      await touch(page, [285, ry], [120, ry]);
      const railAfter = await rail.evaluate(e=>e.scrollLeft);
      assert.ok(railAfter > railBefore + 20, `레일 스크롤 ${railBefore}→${railAfter}`);
      await pathIs(page, tabs[0], '실제 홈 레일 메뉴 제외'); record('실제 홈 레일 자체 가로 스크롤', { railBefore, railAfter });
      await rail.evaluate(e=>e.scrollLeft=e.scrollWidth); await touch(page, [285, ry], [120, ry]);
      await pathIs(page, tabs[0], '레일 끝에서 메뉴 인계 없음');
      await ready(page, tabs[1]);
      for (const activity of ['수업 중', '녹음 중', '통화 중', '측정 중', '미저장 편집', '저장 중']) {
        await page.evaluate(() => window.__sdd240Protect(true));
        await swipe(page, -120); await pathIs(page, tabs[1], `${activity} 공유 보호 callback 차단`);
        await page.evaluate(() => window.__sdd240Protect(false));
      }
      for (const kind of ['table', 'chart', 'slider']) {
        const point = await page.locator(pageLayer).evaluate((el, kind) => {
          const target=document.createElement(kind==='table'?'table':'div'); target.id='sdd240-control';
          if(kind==='chart') target.className='recharts-wrapper';
          if(kind==='slider') target.setAttribute('role','slider');
          target.textContent='합성 '+kind+' 조작 영역'; target.style.cssText='position:absolute;left:40px;top:200px;width:280px;height:80px;background:#eee;z-index:5';
          el.append(target); const r=target.getBoundingClientRect();return {x:r.x+220,y:r.y+40};
        },kind);
        await touch(page,[point.x,point.y],[point.x-120,point.y]); await pathIs(page,tabs[1],`${kind} 합성 조작 영역 출발 제외`);
        await page.locator('#sdd240-control').evaluate(e=>e.remove());
      }
      const protectedArea=await coords(page);
      const interrupted=await touch(page,[285,protectedArea.top+28],[165,protectedArea.top+28],{hold:true});
      await page.evaluate(()=>window.__sdd240Protect(true));
      await interrupted.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await interrupted.detach();await page.waitForTimeout(400);
      await pathIs(page,tabs[1],'드래그 도중 작업 보호 발생 취소'); await page.evaluate(()=>window.__sdd240Protect(false));
      const neutral = await coords(page); const yy = neutral.top + Math.min(150, neutral.height - 130);
      await touch(page, [12, yy], [140, yy]); await pathIs(page, tabs[1], '왼쪽 가장자리 24px 제외');
      await touch(page, [378, yy], [250, yy]); await pathIs(page, tabs[1], '오른쪽 가장자리 24px 제외');
      await swipe(page, -120, { cancel: true }); await pathIs(page, tabs[1], 'pointercancel 원위치');
      await touch(page, [270, yy], [260, yy - 100]); await pathIs(page, tabs[1], '세로 우세 유지');
      await page.locator('nav[aria-label="하단 메뉴"] button').click();
      await capture(page, 'client-drawer-protected.png');
      const drawerArea = await coords(page); await touch(page, [285, drawerArea.top + 150], [165, drawerArea.top + 150]); await pathIs(page, tabs[1], '실제 더보기 서랍 열림 보호');
      await ready(page, tabs[3]);
      const search = page.getByRole('searchbox', { name: '제목·요약 검색' });
      await search.focus(); await swipe(page, 120); await pathIs(page, tabs[3], '실제 검색 입력 포커스 보호');
      await search.fill('미전송 검증'); await search.blur();
      await swipe(page, 120); await pathIs(page, tabs[3], 'blur 후 입력 보전');
      assert.equal(await search.inputValue(), '미전송 검증'); record('취소 후 실제 입력 데이터 보전');
      await capture(page, 'client-input-protected.png');
      await ready(page, tabs[1]);
      const detail = page.getByText('합성 검증 클래스 1', { exact: true }).first();
      await detail.click(); await page.waitForTimeout(300);
      assert.match(new URL(page.url()).pathname, /\/app\/classes\/class-0/);
      await swipe(page, -120); await pathIs(page, '/app/classes/class-0', '실제 클래스 상세 스와이프 제외');
      await ready(page, tabs[1]);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const rr = await coords(page);
      const reducedTouch = await touch(page, [285, rr.top + 28], [165, rr.top + 28], { hold: true });
      const reducedOffset = await page.locator(pageLayer).evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41);
      assert.equal(reducedOffset, 0); record('움직임 줄이기 추종 생략');
      await reducedTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await reducedTouch.detach(); await page.waitForTimeout(400);
      await pathIs(page, tabs[2], '움직임 줄이기 이동 유지');
      await capture(page, 'client-reduced-motion.png');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await ready(page, tabs[1]);
      await page.setViewportSize({ width: 768, height: 844 });
      await swipe(page, -120); await pathIs(page, tabs[1], '768px 데스크톱 터치 비활성');
      await page.setViewportSize({ width: 390, height: 844 });
      const mm = await coords(page);
      await page.mouse.move(285, mm.top + 28); await page.mouse.down(); await page.mouse.move(105, mm.top + 28, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(300);
      await pathIs(page, tabs[1], '마우스 드래그 비활성');
      for (const width of [360, 767]) {
        await page.setViewportSize({ width, height: 844 }); await ready(page, tabs[1]);
        await swipe(page, -170); await pathIs(page, tabs[2], `${width}px 모바일 동작`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await ready(page, tabs[1]);
      await page.locator('nav[aria-label="하단 메뉴"] a').nth(2).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      await pathIs(page, tabs[2], '키보드 Enter로 동등한 메뉴 이동');
      assert.equal(await page.locator('nav[aria-label="하단 메뉴"] [aria-current="page"]').count(), 1); record('aria-current 단일 활성');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1); record('390px 가로 넘침 없음', { overflow });
    }
    await context.close();
  }
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  record('실제 앱 JS 실행 오류 0');
} finally {
  await writeFile(resolve(artifacts, process.argv.includes('--visual-only') ? `touch-results-visual${counseling?'-counseling':''}.json` : process.argv.includes('--padding-only') ? 'touch-results-padding.json' : counseling ? 'touch-results-counseling.json' : 'touch-results.json'), JSON.stringify({ chrome: browser.version(), viewport: '390x844', counseling, checks: results, pageErrors, unknownApi: [...unknownApi], synthetic: true }, null, 2));
  await browser.close(); await new Promise(r => server.close(r));
}
