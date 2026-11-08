// SDD-318 addendum-2 — 채팅·설정·로고·폰트 캡처/측정. 서버 없이 빌드 산출물 + 합성 API.
// 사용: node e2e/sdd318-capture-a2.mjs <dist-v2(신규)> <출력 디렉터리> [<dist-전(비교용)>]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
const distBefore = process.argv[4] ? path.resolve(process.argv[4]) : null;
fs.mkdirSync(out, { recursive: true });
const HOST = 'https://sdd318.local';
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.html': 'text/html', '.json': 'application/json' };
const iso = (d, h, m) => new Date(2026, 10, d, h, m).toISOString();
const user = { id: 'u-1', email: 'client@example.test', name: '합성 회원', role: 'client', verified_tier: 'verified', onboarding_completed: true, auth_provider: 'google', counselors: [{ id: 'h-1', name: '가나' }], phone: null };
const room = (id, name, type, unread, text, d) => ({ id, session_id: type === 'session' ? 's-' + id : null, room_type: type, host_id: 'h-1', name, peer_name: name, peer_id: 'h-1', session_title: type === 'session' ? name : null, session_scheduled_at: type === 'session' ? iso(d, 19, 30) : null, participant_count: 2, created_at: iso(d, 9, 0), unread_count: unread, last_message_at: iso(d, 20, 5), last_message: { content: text, created_at: iso(d, 20, 5) } });
const rooms = { rooms: [room('r1', '가나 코치', 'direct', 2, '오늘 수업에서 느낀 점을 편하게 남겨 주세요.', 6), room('r2', '저녁의 호흡', 'session', 0, '다음 회차는 목요일 저녁 7시 30분이에요.', 5), room('r3', '잠시 머무는 연습', 'group', 12, '자료를 공유드렸어요 — 읽어 보시고 궁금한 점은 이곳에 남겨 주세요.', 4)] };
const msg = (id, mine, text, h, mi) => ({ id, room_id: 'r1', sender_id: mine ? 'u-1' : 'h-1', sender_name: mine ? '합성 회원' : '가나 코치', type: 'text', content: text, file_url: null, event_type: null, created_at: iso(6, h, mi), read_by: mine ? ['h-1'] : [], recipient_count: 1 });
const messages = { messages: [msg('m6', true, '네, 호흡이 훨씬 편안했어요.', 20, 5), msg('m5', false, '오늘 수업에서 느낀 점을 편하게 남겨 주세요.', 20, 3), msg('m4', true, '감사합니다. 다음 주에 뵐게요 🙂', 19, 58), msg('m3', false, '떠오른 생각을 알아차리고 호흡으로 돌아오는 연습을 했어요.', 19, 50), msg('m2', true, '안녕하세요!', 19, 31), msg('m1', false, '안녕하세요, 곧 시작할게요.', 19, 30)], next_cursor: null };
const notifications = { notifications: [], total: 0, unread: 0 };

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const screens = [
  { key: 'chat-list', url: '/app/chat', waitFor: '.u2-chatlist', scroller: '.u2-scroll' },
  { key: 'chat-room', url: '/app/chat/r1', waitFor: '.chat-room textarea', scroller: '.chat-room [class*="overflow-y-auto"]', room: true },
  { key: 'chat-lucy', url: '/app/chat/lucy', waitFor: '.u2-chat-body', scroller: null, room: true },
  { key: 'settings', url: '/app/profile', waitFor: '.u2-setlist', scroller: '.u2-scroll', open: true },
  { key: 'settings-participation', url: '/app/participation-profile', waitFor: 'h1', scroller: '.u2-scroll' },
  { key: 'settings-optional', url: '/settings/optional-profile', waitFor: 'form input', scroller: '.u2-scroll' },
];
const widths = [390, 393, 768];
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
const contrast = [['#FFFFFF', '#5F0080', '내 말풍선 글자/배경'], ['#25212C', '#FFFFFF', '본문/표면'], ['#25212C', '#F4F4F7', '본문/캔버스(상대 말풍선)'], ['#68616F', '#FFFFFF', '보조/표면'], ['#68616F', '#F4F4F7', '보조/캔버스'], ['#5F0080', '#EEE5F5', '액센트/틴트'], ['#B3264B', '#FFFFFF', '위험 동작/표면'], ['#111111', '#F4F4F7', '워드마크/캔버스']].map(([fg, bg, label]) => ({ fg, bg, label, ratio: ratio(fg, bg) }));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = []; const errors = []; const fonts = [];

async function newPage(distDir, width, opts = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 768 ? 1024 : 844 }, serviceWorkers: 'block', deviceScaleFactor: 2, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  await context.routeWebSocket('**/*', (s) => s.close());
  await context.addInitScript((u) => localStorage.setItem('mb_user', JSON.stringify(u)), user);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url()); const p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': HOST, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
    if (url.hostname !== 'sdd318.local') return route.abort('blockedbyclient');
    if (route.request().method() === 'OPTIONS') return json({});
    if (p.startsWith('/api/')) {
      if (p.endsWith('/auth/refresh')) return json({ access_token: 'synthetic', token_type: 'bearer' });
      if (p.endsWith('/auth/users/me')) return json(user);
      if (/\/client\/counselors/.test(p)) return json(user.counselors);
      if (/\/chat\/rooms\/r1\/messages/.test(p)) return json(messages);
      if (/\/chat\/rooms\/[^/]+\/(read|participants)/.test(p)) return json({});
      if (/\/chat\/rooms\/r1$/.test(p)) return json(rooms.rooms[0]);
      if (/\/chat\/rooms/.test(p)) return json(rooms);
      if (/\/agent\/consent/.test(p)) return json({ agreed: true, version: '1' });
      if (/\/agent\/unread-count/.test(p)) return json({ unread: 1 });
      if (/\/agent\/messages/.test(p)) return json({ items: [], has_more: false });
      if (/\/reports\/counts/.test(p)) return json({ unread: 0 });
      if (/\/notifications\/unread-count/.test(p)) return json({ unread: 0 });
      if (/\/users\/me\/consents/.test(p)) { const c = (agreed) => ({ agreed, version: '1', agreed_at: null, withdrawn_at: null }); return json({ tos: c(true), privacy: c(true), sensitive: c(true), eeg: c(false), research: c(false) }); }
      if (/\/chat\/blocks/.test(p)) return json({ blocks: [] });
      if (/\/devices\/web-push/.test(p)) return json({ public_key: '' });
      if (/\/notifications\/preferences/.test(p)) return json({ push: {}, email: {}, in_app: {} });
      if (/\/notifications/.test(p)) return json(notifications);
      if (/\/clients\/me\/profile/.test(p)) return json({ id: 'u-1', email: 'client@example.test', name: '합성 회원', role: 'client', phone: null, gender: null, birth_date: null, concerns: [], interests: [] });
      if (/\/counseling/.test(p)) return json({ relationships: [], total: 0 });
      if (/\/reports\/?$/.test(p) || /\/classes\/?$/.test(p) || /\/sessions\/?$/.test(p)) return json({ reports: [], classes: [], sessions: [], total: 0 });
      return json({}, 200);
    }
    const asset = path.join(distDir, p);
    const file = path.extname(p) && fs.existsSync(asset) ? asset : path.join(distDir, 'index.html');
    return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  return { context, page };
}

async function measureFonts(page, label, width) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const targets = [['상단 로고(모바일 상단 바)', '.u2-logo-word, .u2-brand'], ['큰 제목 h1', '.ui-v2 h1'], ['본문/목록 제목', '.u2-chatrow strong, .u2-setgroup .u2-body strong, .u2-listrow strong, .u2-card h2'], ['보조 문구', '.u2-chatrow .u2-body > span:last-child, .u2-heading p, .u2-footnote'], ['하단 내비 라벨', '.u2-nav a span:last-child'], ['데스크톱 사이드바 브랜드', '[data-sidebar-brand] span:not([class*="rounded"])']];
  for (const [name, sel] of targets) {
    try {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
      if (!nodeId) { fonts.push({ label, width, target: name, result: '요소 없음/측정 불가' }); continue; }
      const { fonts: used } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      const css = await page.evaluate((s) => { const el = document.querySelector(s); const cs = getComputedStyle(el); return { family: cs.fontFamily.slice(0, 80), weight: cs.fontWeight, size: cs.fontSize, ls: cs.letterSpacing, text: (el.textContent || '').trim().slice(0, 14) }; }, sel);
      fonts.push({ label, width, target: name, declared: css.family, weight: css.weight, size: css.size, letterSpacing: css.ls, sample: css.text, rendered: used.map((f) => `${f.familyName}${f.isCustomFont ? ' (웹폰트)' : ' (시스템)'} ×${f.glyphCount}`).join(', ') || '글리프 없음' });
    } catch (e) { fonts.push({ label, width, target: name, result: `측정 실패: ${String(e.message).slice(0, 60)}` }); }
  }
  await cdp.detach();
}

// 1) 폰트 전/후 측정 + 로고 비교 캡처 (설정 화면, 모바일·데스크톱)
for (const [label, dir] of process.env.SKIP_FONTS ? [] : [...(distBefore ? [['전(현행 dev 번들)', distBefore]] : []), ['후(이번 변경)', dist]]) {
  for (const width of [390, 1024]) {
    const { context, page } = await newPage(dir, width);
    await page.goto(HOST + '/app/classes', { waitUntil: 'load' });
    await page.waitForSelector('.ui-v2 h1', { timeout: 15000 }).catch(() => errors.push(`${label}/${width}: h1 없음`));
    console.error('font', label, width);
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(900);
    await measureFonts(page, label, width);
    await page.screenshot({ path: path.join(out, `font-${label.startsWith('전') ? 'before' : 'after'}-${width}.png`), clip: { x: 0, y: 0, width, height: width === 390 ? 260 : 300 } });
    if (label.startsWith('후')) {
      const geo = await page.evaluate(() => {
        const vis = (sel) => Array.from(document.querySelectorAll(sel)).find((e) => e.getBoundingClientRect().width > 0); const sym = vis('.u2-logo-symbol, [data-sidebar-brand] img'); const word = vis('.u2-logo-word, [data-sidebar-brand] span:not([class*="rounded"])');
        if (!sym || !word) return null;
        const s = sym.getBoundingClientRect(); const w = word.getBoundingClientRect(); const fs = parseFloat(getComputedStyle(word).fontSize);
        const capH = fs * 1448 / 2048;
        return { symbolH: +s.height.toFixed(2), symbolW: +s.width.toFixed(2), capHeight: +capH.toFixed(2), gap: +(w.left - s.right).toFixed(2), capVsSymbol: +(capH / s.height).toFixed(2), gapVsHalfSymbol: +((w.left - s.right) / (s.height / 2)).toFixed(2), fontSize: fs, wordText: word.textContent.replace(/\u00a0/g, ' ') };
      });
      fonts.push({ label, width, target: '락업 비율 실측', geo });
    }
    await context.close();
  }
}

fs.writeFileSync(path.join(out, 'fonts-a2.json'), JSON.stringify(fonts, null, 2));
// 2) 화면 × 폭 캡처·측정
for (const width of widths) {
  const { context, page } = await newPage(dist, width);
  for (const s of screens.filter((x) => !ONLY || ONLY.includes(x.key))) {
    console.error('shot', width, s.key);
    await page.goto(HOST + s.url, { waitUntil: 'load' });
    await page.waitForSelector(s.waitFor, { timeout: 15000 }).catch(() => errors.push(`${width}/${s.key}: ${s.waitFor} 없음`));
    if (s.open) await page.evaluate(() => document.querySelectorAll('details[data-settings-group]').forEach((d, i) => { if (i === 0) d.open = true; }));
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, `${s.key}-${width}.png`) });
    const m = await page.evaluate(({ scroller, room }) => {
      const doc = document.documentElement; const sc = scroller ? document.querySelector(scroller) : null;
      const overflow = doc.scrollWidth > doc.clientWidth || (sc && sc.scrollWidth > sc.clientWidth + 1);
      const small = [];
      document.querySelectorAll('.ui-v2 a, .ui-v2 button, .ui-v2 input, .ui-v2 select, .ui-v2 textarea, .ui-v2 summary, .ui-v2 [role=tab]').forEach((el) => {
        const target = el.matches('input[type=checkbox],input[type=radio]') ? (el.closest('label') || el) : el;
        const r = target.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(target).visibility === 'hidden') return;
        if (r.width < 43.5 || r.height < 43.5) small.push(`${el.tagName.toLowerCase()}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 14)}:${Math.round(r.width)}x${Math.round(r.height)}`);
      });
      const vw = doc.clientWidth; const off = [];
      document.querySelectorAll('.ui-v2 *').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > vw + 1 && !el.closest('svg')) off.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)}:${Math.round(r.right)}>${vw}`); });
      const h1 = document.querySelector('.ui-v2 h1'); const h1Clipped = h1 ? h1.scrollWidth > h1.clientWidth + 1 : null;
      const forbidden = (document.body.innerText.match(/점수|종합점수|좋음|나쁨|완료율|보증|100\s*%/g) || []);
      const nav = document.querySelector('.u2-nav'); const navShown = !!nav && getComputedStyle(nav.parentElement).display !== 'none';
      let hidden = false; let gap = null; let hiddenBy = null;
      if (sc) sc.scrollTop = sc.scrollHeight;
      if (navShown && !room) { const navTop = nav.getBoundingClientRect().top; const kids = Array.from(document.querySelectorAll('.u2-main > *, .u2-main li, .u2-main section, .u2-main p, .u2-main summary')).filter((k) => k.checkVisibility()); const last = Math.max(0, ...kids.map((k) => k.getBoundingClientRect().bottom).filter((b) => b > 0)); gap = Math.round(navTop - last); hidden = last > navTop + 1; if (hidden) hiddenBy = kids.map((k) => ({ t: k.tagName, c: String(k.className).slice(0, 24), txt: (k.textContent || '').trim().slice(0, 16), b: Math.round(k.getBoundingClientRect().bottom) })).filter((x) => x.b > navTop).slice(0, 6); }
      let composer = null;
      const ta = document.querySelector('.chat-room textarea, .u2-chat-body textarea');
      if (ta) { const r = ta.closest('form, .chat-room__composer')?.getBoundingClientRect() ?? ta.getBoundingClientRect(); composer = { bottom: Math.round(r.bottom), viewportH: window.innerHeight, navPresent: navShown, padBottom: getComputedStyle(ta.closest('.chat-room__composer') || ta.parentElement).paddingBottom }; }
      const logo = document.querySelector('.u2-logo'); const bell = document.querySelector('.u2-toolbar .u2-icon-btn:last-of-type');
      let logoBox = null; if (logo && getComputedStyle(logo).display !== 'none') { const l = logo.getBoundingClientRect(); const b = bell ? bell.getBoundingClientRect() : null; logoBox = { w: Math.round(l.width), h: Math.round(l.height), overlapBell: b ? !(l.right <= b.left || l.left >= b.right) : false, label: logo.getAttribute('aria-label') }; }
      return { hiddenBy, isUi: !!document.querySelector('.ui-v2'), overflow: !!overflow, off: off.slice(0, 5), small, h1Clipped, forbidden, hidden, gap, navShown, composer, logoBox };
    }, { scroller: s.scroller, room: !!s.room });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, `${s.key}-${width}-bottom.png`) });
    results.push({ width, screen: s.key, ...m });
  }
  await context.close();
}

fs.writeFileSync(path.join(out, 'results-a2.json'), JSON.stringify({ contrast, results, errors }, null, 2));
// 3) 모션 줄이기, 말풍선 색 실측, 접힘 전환(큰 제목 → 작은 제목) 로고 충돌
{
  const { context, page } = await newPage(dist, 390, { reduced: true });
  await page.goto(HOST + '/app/chat/r1', { waitUntil: 'load' });
  await page.waitForSelector('.chat-msg__bubble', { timeout: 15000 }).catch(() => errors.push('reduced: 말풍선 없음'));
  const probe = await page.evaluate(() => {
    const animated = Array.from(document.querySelectorAll('.ui-v2, .ui-v2 *')).filter((el) => { const cs = getComputedStyle(el); return (parseFloat(cs.transitionDuration) > 0.001 && cs.transitionDuration !== '0s') || (cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0.001); }).length;
    const bubbles = Array.from(document.querySelectorAll('.chat-msg__bubble')).map((b) => ({ bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color, mine: b.closest('.chat-msg__row--mine') !== null }));
    const dialogNav = !!document.querySelector('.u2-nav');
    return { animated, bubbles: bubbles.slice(0, 4), bottomNavInRoom: dialogNav };
  });
  results.push({ screen: 'room-probe', ...probe });
  await context.close();
}
{
  const { context, page } = await newPage(dist, 390);
  await page.goto(HOST + '/app/profile', { waitUntil: 'load' });
  await page.waitForSelector('.u2-setlist', { timeout: 30000 }).catch(() => errors.push('collapse: .u2-setlist 없음'));
  await page.evaluate(() => { const s = document.querySelector('.u2-scroll'); if (s) s.scrollTop = 400; });
  await page.waitForTimeout(500);
  const collapsed = await page.evaluate(() => {
    const logo = document.querySelector('.u2-logo'); const compact = document.querySelector('.u2-compact-title'); const bell = document.querySelector('.u2-toolbar .u2-icon-btn:last-of-type');
    const rect = (el) => el && el.getBoundingClientRect(); const l = rect(logo); const c = rect(compact); const b = rect(bell);
    const word = document.querySelector('.u2-logo-word');
    return { compactShown: compact?.dataset.shown, wordDisplay: word ? getComputedStyle(word).display : null, logoRight: l && Math.round(l.right), compactLeft: c && Math.round(c.left), compactRight: c && Math.round(c.right), bellLeft: b && Math.round(b.left), overlapLogoCompact: l && c ? !(l.right <= c.left || l.left >= c.right) : null, overlapCompactBell: c && b ? !(c.right <= b.left || c.left >= b.right) : null };
  });
  results.push({ screen: 'collapse-transition', ...collapsed });
  await page.screenshot({ path: path.join(out, 'settings-collapsed-390.png'), clip: { x: 0, y: 0, width: 390, height: 140 } });
  await context.close();
}
await browser.close();
fs.writeFileSync(path.join(out, 'measure-a2.json'), JSON.stringify({ contrast, fonts, results, errors }, null, 2));
const bad = results.filter((r) => r.screen && r.width && (!r.isUi || r.overflow || r.small?.length || r.h1Clipped || r.forbidden?.length || r.hidden));
console.log(JSON.stringify({ total: results.length, bad: bad.map((b) => ({ w: b.width, s: b.screen, isUi: b.isUi, overflow: b.overflow, off: b.off, small: b.small, h1Clipped: b.h1Clipped, forbidden: b.forbidden, hidden: b.hidden, gap: b.gap })), errors, minContrast: Math.min(...contrast.map((c) => c.ratio)) }, null, 1));
