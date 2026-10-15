// SDD-207 회귀 시나리오 실행기: regressions.json (야간 탐색이 발견·등록한 문제)을 매 배포마다 다시 확인한다.
// 항목: { id, role, path, check, detail, added, origin }
import { readFileSync } from 'node:fs';
import { scenario, uiLogin, go, bodyText, finish, HOME, BASE } from './lib.mjs';

const list = JSON.parse(readFileSync(new URL('./regressions.json', import.meta.url), 'utf8'));
const BAD_TEXT = /\bundefined\b|\bnull\b|\bNaN\b|\[object Object\]|\{\{|\}\}|Invalid Date/;
const NOISE = /favicon|ResizeObserver|Download the React DevTools|websocket|WebSocket|socket\.io|net::ERR_ABORTED|Failed to load resource.*(sw\.js|manifest)/i;

for (const e of list) {
  const mobile = e.check === 'mobile_overflow';
  await scenario(`[회귀] ${e.id}: ${e.path} ${e.check}`, async (p) => {
    const errs = [];
    p.on('pageerror', (x) => errs.push(`js: ${x.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(`console: ${m.text()}`); });
    p.on('response', (r) => { const u = r.url(); if (u.includes('/api/') && r.request().method() === 'GET' && r.status() >= 400 && r.status() !== 401) errs.push(`api ${r.status()} ${new URL(u).pathname}`); });
    await uiLogin(p, e.role, HOME[e.role]);
    errs.length = 0;
    await go(p, e.path);
    await p.waitForTimeout(600);
    const text = await bodyText(p);
    switch (e.check) {
      case 'js_error': case 'console_error': { const x = errs.filter((s) => s.startsWith('js') || s.startsWith('console')); if (x.length) throw new Error(x[0].slice(0, 160)); break; }
      case 'api_5xx': case 'api_4xx': { const x = errs.filter((s) => s.startsWith('api')); if (x.length) throw new Error(x[0]); break; }
      case 'bad_text': { const m = text.match(BAD_TEXT); if (m) throw new Error(`문구 노출: ${m[0]}`); break; }
      case 'empty_page': if (text.trim().length < 20) throw new Error('본문 거의 없음'); break;
      case 'dup_heading': { const h = (await p.locator('h2,h3').allInnerTexts()).map((s) => s.trim()).filter(Boolean); const d = h.filter((s, i, a) => a.indexOf(s) !== i); if (d.length) throw new Error(`제목 중복: ${d[0]}`); break; }
      case 'broken_image': { const n = await p.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0 && i.src && !i.src.startsWith('data:')).length); if (n) throw new Error(`깨진 이미지 ${n}개`); break; }
      case 'mobile_overflow': { const o = await p.evaluate(() => { const iw = innerWidth; const clipped = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { const ox = getComputedStyle(n).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true; } return false; }; return document.documentElement.scrollWidth - document.documentElement.clientWidth + [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > iw + 2 && getComputedStyle(e).position !== 'fixed' && !clipped(e); }).length; }); if (o > 2) throw new Error('모바일 가로 넘침'); break; }
      default: throw new Error(`알 수 없는 점검: ${e.check}`);
    }
  }, { mobile });
}
if (list.length === 0) console.log('등록된 회귀 시나리오 없음');
await finish('regressions-result.json', '회귀');
