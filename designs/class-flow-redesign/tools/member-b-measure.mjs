// 회원 시안 B 측정 — 핏(fit) + 좌우 대칭(S1~S10, MS1·MS3)
// 사용: BEFORE=1 node tools/member-b-measure.mjs   (수정 전 기준선 저장 → fit/member-b-before.json)
//       node tools/member-b-measure.mjs            (최종: 기준선과 비교해 fit/member-b-fit.txt, member-b-symmetry.txt 작성)
// 서버: python3 -m http.server 5302 --directory "<designs/class-flow-redesign>"  (측정 후 반드시 종료)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { chromium } = createRequire('/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/package.json')('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:5302/class-flow-redesign/member-b.html';
const VPS = ['390x844', '834x1194', '1194x834', '1280x720'];
const IS_BEFORE = !!process.env.BEFORE;
const BREAK = !!process.env.BREAK;
const OUT = BREAK ? '/tmp/mb-break' : root;
if (BREAK) fs.mkdirSync('/tmp/mb-break/fit', { recursive: true });
const beforeFile = path.join(root, 'fit/member-b-before.json');

// ───────── 페이지 안에서 실행 (직렬화되므로 외부 클로저 금지) ─────────
function measurePage() {
  const vw = innerWidth, vh = innerHeight, de = document.documentElement;
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; };
  const $ = (s) => [...document.querySelectorAll(s)].find(vis);
  const $$ = (s) => [...document.querySelectorAll(s)].filter(vis);
  const B = (s) => { const el = $(s); return el ? box(el) : null; };
  const f = (n) => (Math.round(n * 10) / 10).toString();
  const label = (el) => (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : el.tagName.toLowerCase()) + '「' + (el.textContent || '').trim().slice(0, 10) + '」';
  const inLayer = (el) => !!el.closest('.fl-root');
  const fit = { scroll: [], layout: [], small: [], clipped: [], outside: [], overlap: [], touch: [], empty: [], glyph: [], banned: [], eyebrow: [], space8: [], nested: [], trk: [], av: [] };

  // 1) 페이지 스크롤 0 + 본문이 상·하단 바 사이에 들어오는지(overflow hidden 이라 scrollHeight 만으로는 못 잡는다)
  if (de.scrollHeight > vh + 0.5 || de.scrollWidth > vw + 0.5 || document.body.scrollHeight > vh + 0.5) fit.scroll.push(`scrollH ${de.scrollHeight}>${vh} / scrollW ${de.scrollWidth}>${vw}`);
  const body = B('.fl-body'), col = B('.fl-body > .fl-col'), topB = B('.fl-top'), footB = B('.fl-foot'), fv = B('.w-fv');
  if (col && body && (col.y < body.y - 0.5 || col.b > body.b + 0.5)) fit.layout.push(`본문 컬럼 ${f(col.y)}~${f(col.b)} 가 본문 영역 ${f(body.y)}~${f(body.b)} 밖`);
  if (col && footB && col.b > footB.y + 0.5) fit.layout.push('본문이 하단 버튼 영역을 침범');
  if (col && topB && col.y < topB.b - 0.5) fit.layout.push('본문이 상단 바를 침범');
  if (fv && (fv.y < 0.5 || fv.b > vh - 0.5)) fit.layout.push(`종료·대기 카드 ${f(fv.y)}~${f(fv.b)} 가 화면(0~${vh}) 밖`);
  const sheetEl = $('.w-sheet');
  if (sheetEl) {
    const sb = box(sheetEl);
    if (sb.y < -0.5 || sb.b > vh + 0.5) fit.layout.push(`시트 ${f(sb.y)}~${f(sb.b)} 가 화면 밖`);
    if (sheetEl.scrollHeight > sheetEl.clientHeight + 1) fit.nested.push(`시트 내부 스크롤 ${sheetEl.scrollHeight}>${sheetEl.clientHeight}`);
    for (const el of sheetEl.querySelectorAll('*')) { if (!vis(el) || el instanceof SVGElement) continue; const cs = getComputedStyle(el); if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) fit.nested.push('중첩 스크롤 ' + label(el)); }
  }

  // 2) 11px 이하 글자
  for (const el of document.body.querySelectorAll('.fl-root *, .w-scrim *')) {
    if (!vis(el) || el instanceof SVGElement) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (parseFloat(getComputedStyle(el).fontSize) < 12) fit.small.push(label(el));
  }

  // 3) 텍스트 잘림(가로·세로)
  const hSel = '.fl-btn,.fl-chip,.w-tag,.w-ct b,.w-ct .d,.w-il,.w-iv,.w-srow,.w-srow .v,.w-bt b,.w-bt .d,.w-li,.w-opt,.w-check,.w-scale .row button,.w-ax,.fl-top-title,.w-finfo div,.w-ftx p,.w-fnote,.w-hint,.w-dh,.w-rrow,.w-bgmh .tx b,.w-place b,.w-place .d,.fl-h1,.fl-sub,.fl-label';
  for (const el of document.querySelectorAll(hSel)) {
    if (!vis(el) || getComputedStyle(el).display === 'inline') continue;
    if (el.scrollWidth > el.clientWidth + 1) fit.clipped.push(label(el) + ` (w ${el.scrollWidth}>${el.clientWidth})`);
  }
  for (const el of document.querySelectorAll('.fl-card,.w-fv,.w-check,.w-srow,.w-li,.w-opt,.fl-btn,.fl-chip,.w-scale .row button,.w-tile,.w-finfo,.fl-input,.w-prev,.w-dh')) {
    if (!vis(el)) continue;
    if (el.scrollHeight > el.clientHeight + 1) fit.clipped.push(label(el) + ` (h ${el.scrollHeight}>${el.clientHeight})`);
  }

  // 4) 화면 이탈
  for (const el of document.querySelectorAll('.fl-root *, .w-scrim *')) {
    if (!vis(el) || el instanceof SVGElement) continue;
    if (el.matches('.fl-backdrop,.fl-layer,.fl-scrim')) continue;
    const r = el.getBoundingClientRect();
    if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) fit.outside.push(label(el) + ` (${f(r.left)},${f(r.top)})~(${f(r.right)},${f(r.bottom)})`);
  }

  // 5) 겹침: 같은 부모의 직계 자식끼리 + 상단 바·본문·하단 영역
  const groups = [];
  const fl = document.querySelector('.fl-layer');
  if (fl) groups.push([...fl.children]);
  for (const sel of ['.fl-body > .fl-col', '.fl-foot > .fl-col', '.w-fv', '.w-sheet', '.fl-top', '.w-head', '.w-dh', '.w-bh', '.w-irow', '.w-info', '.w-bgmh', '.w-bgmr', '.w-sum', '.w-ovb', '.w-ovt', '.w-avh', '.w-avh .l', '.w-avh .r', '.w-spk']) {
    const el = $(sel); if (el) groups.push([...el.children]);
  }
  for (const row of $$('.w-srow,.w-check,.w-li,.w-tile,.w-scale')) groups.push([...row.children]);
  const inter = (a, c) => Math.max(0, Math.min(a.right, c.right) - Math.max(a.left, c.left)) * Math.max(0, Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top));
  for (const g of groups) {
    const kids = g.filter((k) => vis(k) && !(k instanceof SVGElement && false));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), c = kids[j].getBoundingClientRect();
      if (inter(a, c) > 1) fit.overlap.push(`${label(kids[i])}×${label(kids[j])} ${Math.round(inter(a, c))}px²`);
    }
  }

  { const ov = [...document.querySelectorAll('.w-ovt, .w-ovb > *')].filter(vis);
    for (let i = 0; i < ov.length; i++) for (let j = i + 1; j < ov.length; j++) { const a = ov[i].getBoundingClientRect(), c = ov[j].getBoundingClientRect(); if (inter(a, c) > 1) fit.overlap.push(`오버레이 ${label(ov[i])}×${label(ov[j])}`); } }

  // 6) 터치 ≥44 (버튼·입력·스위치)
  for (const el of document.querySelectorAll('button, input, textarea, [role=switch]')) {
    if (!vis(el)) continue;
    const t = el.getAttribute('role') === 'switch' ? el.parentElement : el;
    const r = t.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) fit.touch.push(label(el) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
  }

  // 7) 빈 영역: 카드 안 콘텐츠 점유율, 빈 슬롯
  for (const el of document.querySelectorAll('.fl-card,.w-fv,.w-sheet')) {
    if (!vis(el)) continue;
    const br = el.getBoundingClientRect();
    const leaves = [...el.querySelectorAll('*')].filter((c) => vis(c) && (c.matches('svg,input,button,textarea,.w-bar,.w-level,.w-prev,.w-li,.w-tile,.w-srow,.w-check,.w-opt,.fl-chip,.w-finfo') || [...c.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())));
    if (!leaves.length) { fit.empty.push(label(el) + ' (내용 없음)'); continue; }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const c of leaves) { const r = c.getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
    const fx = (x1 - x0) / br.width, fy = (y1 - y0) / br.height;
    if (fx < 0.35 || fy < 0.35) fit.empty.push(label(el) + ` (채움 ${Math.round(fx * 100)}%×${Math.round(fy * 100)}%)`);
  }
  for (const el of $$('.w-slot')) if (!el.textContent.trim()) fit.empty.push('빈 하단 슬롯');
  if (col && col.h < 120) fit.empty.push(`본문 컬럼 높이 ${f(col.h)} (너무 작음)`);

  // 8) 글리프·금지 용어·영문 대문자 아이브로우
  const attrs = [...document.querySelectorAll('[aria-label],[placeholder],[value]')].map((e) => [e.getAttribute('aria-label'), e.getAttribute('placeholder'), e.getAttribute('value')].filter(Boolean).join(' ')).join(' ');
  const text = (document.querySelector('.fl-root') || document.body).innerText + ' ' + attrs;
  const glyphs = text.match(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}✓✕←→‹›•●○×]/gu);
  if (glyphs) fit.glyph.push(...new Set(glyphs));
  for (const w of ['세션', '수업', '참여하기', '오픈', '그래도 시작', 'LB ', '1:N', '%', '순위', '점수', '평균', '클래스 코드', '참여 코드', '참여코드', '코드 복사', '코드 입력', '6자리', '게스트', '인증 코드', 'OTP', 'QR', '귀']) if (text.includes(w)) fit.banned.push(w);
  for (const el of document.querySelectorAll('.fl-root *, .w-scrim *')) {
    if (!vis(el) || el instanceof SVGElement) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    if (!own) continue;
    if (getComputedStyle(el).textTransform === 'uppercase' || (/^[A-Z][A-Z0-9 \-·:]{5,}$/.test(own) && own !== 'LINK BAND')) fit.eyebrow.push(label(el));
  }

  // 9) 8의 배수 간격(padding·margin·gap)
  for (const el of document.querySelectorAll('.fl-root *, .w-scrim *')) {
    if (!vis(el) || el instanceof SVGElement) continue;
    const cs = getComputedStyle(el);
    for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'rowGap', 'columnGap']) {
      const v = cs[p]; if (v === 'normal' || v === 'auto') continue;
      const n = parseFloat(v); if (!n) continue;
      if (Math.abs(n / 8 - Math.round(n / 8)) * 8 > 0.5) { fit.space8.push(label(el) + ' ' + p + '=' + v); break; }
    }
  }

  // ───────── R2-3a started 시트 ─────────
  {
    const qs0 = new URLSearchParams(location.search), tk = (qs0.get('case') || '').split('-');
    const sh0 = $('.w-sheet');
    if (tk.includes('started')) {
      if (!sh0) fit.av.push('started: 시트 없음');
      else {
        const txt = sh0.innerText;
        if (!/상담사가 클래스를 시작했어요/.test(txt)) fit.av.push('started: 제목 문구 없음');
        const btns = [...sh0.querySelectorAll('button')].map((b) => b.innerText.trim());
        if (!btns.includes('지금 입장하기') || !btns.includes('준비 이어서 하기')) fit.av.push('started: 지금 입장하기/준비 이어서 하기 버튼 없음');
        if (!/진행 화면/.test(txt)) fit.av.push('started: 입장 후 이어서 하기 안내 한 줄 없음');
      }
    } else if (sh0 && /상담사가 클래스를 시작했어요/.test(sh0.innerText)) fit.av.push('started 토큰 없는데 시작 시트 노출');
  }

  // ───────── R1-2 전극 접촉 트래커 · R1-3 내 영상·소리 ─────────
  const qs = new URLSearchParams(location.search), screenId = qs.get('screen') || '', toks = (qs.get('case') || '').split('-');
  const trkEl = $('.w-trk');
  const RED = 'rgb(211, 63, 63)', MINT = 'rgb(1, 240, 200)';
  if (screenId === 'FM06c') {
    if (toks.some((t) => t.startsWith('leadoff'))) {
      if (!trkEl) fit.trk.push('접촉 불량인데 트래커 없음');
      else {
        const sv = trkEl.querySelector('svg'), r = sv.getBoundingClientRect();
        if (Math.abs(r.width - 288) > 1 || Math.abs(r.height - 64) > 1) fit.trk.push(`트래커 크기 ${f(r.width)}x${f(r.height)} (288x64 아님)`);
        const leds = [...trkEl.querySelectorAll('[data-led]')];
        if (leds.length !== 3) fit.trk.push(`LED ${leds.length}개 (3개 아님)`);
        const ok = Object.fromEntries(leds.map((l) => [l.dataset.led, l.dataset.ok === '1']));
        for (const l of leds) {
          const fill = getComputedStyle(l.querySelector('[data-fill]')).fill, want = l.dataset.ok === '1' ? MINT : RED;
          if (fill !== want) fit.trk.push(`${l.dataset.led} LED 색 ${fill} (기대 ${want})`);
          if (l.querySelector('[data-ico], path:not([data-shape]), polyline, line, circle')) fit.trk.push(`${l.dataset.led} LED 안 아이콘 존재(R2-1: 색만 써야 함)`);
        }
        if (ok.ref !== (ok.L && ok.R)) fit.trk.push('기준 LED 규칙 위반(L·R 모두 양호일 때만 민트)');
        const want = { leadoffl: [0, 1], leadoffr: [1, 0], leadoff: [0, 0] }[toks.find((t) => t.startsWith('leadoff'))];
        if (want && (ok.L !== !!want[0] || ok.R !== !!want[1])) fit.trk.push('케이스 토큰과 L/R 상태 불일치');
        if (!/접촉 양호/.test(trkEl.innerText) || !/접촉 실패/.test(trkEl.innerText)) fit.trk.push('범례 없음');
      }
    } else if (trkEl) fit.trk.push('접촉 불량이 아닌데 트래커 노출');
  }
  for (const el of document.querySelectorAll('.fl-root *, .w-scrim *')) {
    if (!vis(el) || el.closest('.w-trk')) continue;
    const cs = getComputedStyle(el);
    for (const p of ['color', 'backgroundColor', 'borderTopColor', 'fill', 'stroke']) if (cs[p] === RED) { fit.trk.push('트래커 밖 빨강 ' + label(el)); break; }
  }
  if (screenId === 'FM06d') {
    const av = $('.w-av'), vid = $('.w-vid'), colB = B('.fl-body > .fl-col');
    if (!av) fit.av.push('합친 내 영상·소리 컴포넌트 없음');
    if (document.querySelectorAll('.w-dev').length) fit.av.push('분리된 마이크/카메라 카드 잔존');
    const micOk = !toks.some((x) => ['micdenied', 'micnodev', 'unsupported'].includes(x));
    const camOn = toks.includes('camon');
    if (camOn) {
      if (!vid) fit.av.push('카메라 켜짐인데 영상 없음');
      else {
        const r = box(vid), ratio = r.w / r.h;
        if (vw < 700) { if (r.w < 341.5 || r.h < 220) fit.av.push(`영상 ${f(r.w)}x${f(r.h)} (모바일 ≥342x220 아님)`); }
        else { if (ratio < 1.31 || ratio > 1.8) fit.av.push(`영상 비율 ${f(ratio)} (4:3~16:9 아님)`); if (colB && r.w < colB.w - 16 - 2) fit.av.push(`영상 폭 ${f(r.w)} 가 컬럼 폭 전체(${f(colB.w - 16)})가 아님`); }
        const others = [...document.querySelectorAll('.fl-body > .fl-col > *')].filter(vis).filter((e) => !e.contains(vid)).map(box);
        if (others.some((o) => o.w * o.h >= r.w * r.h)) fit.av.push('영상이 화면에서 가장 큰 요소가 아님');
        if (!vid.querySelector('.w-tg')) fit.av.push('영상 위 토글 버튼 없음');
        // R2-2: 카메라 켜짐에서는 가로 레벨 막대 0
        if (document.querySelectorAll('.w-level').length) fit.av.push('카메라 켜짐인데 가로 레벨 막대 존재(R2-2)');
        // R3-1: 세로 미터 0 · 마이크 정상이면 아이콘 링 1개(5단계) + 칩 라벨
        if (document.querySelectorAll('.w-vmeter').length) fit.av.push('세로 레벨 미터 존재(R3-1 폐기)');
        if (micOk) {
          const rings = vid.querySelectorAll('.w-tg.ring');
          if (rings.length !== 1) fit.av.push(`아이콘 링 ${rings.length}개 (1개여야 함)`);
          else {
            const segs = rings[0].querySelectorAll('[data-seg]'), on = [...segs].filter((x) => x.dataset.on === '1').length;
            if (segs.length !== 5) fit.av.push(`링 단계 ${segs.length}개 (5단계 아님)`);
            const want = toks.includes('quiet') ? 1 : 3;
            if (on !== want) fit.av.push(`링 채움 ${on}단계 (기대 ${want})`);
            const lab = (vid.querySelector('.w-ovt').innerText || '');
            const wantLab = toks.includes('quiet') ? '조용해요' : '정상';
            if (!lab.includes(wantLab)) fit.av.push(`상태 칩 라벨 "${wantLab}" 없음`);
            const ic = rings[0].querySelector('.ic'); if (!ic) fit.av.push('링 안 마이크 아이콘 없음');
            else { const op = parseFloat(getComputedStyle(ic).opacity); if (toks.includes('quiet') ? op > 0.7 : op < 0.95) fit.av.push(`아이콘 밝기 ${op} (정상 1 / 조용해요 낮음 아님)`); }
          }
        }
      }
    } else {
      if (vid) fit.av.push('카메라 꺼짐인데 영상 영역 있음');
      if (micOk && !toks.includes('camdenied') ? !$('.w-level') : false) fit.av.push('카메라 꺼짐·마이크 정상인데 가로 레벨 막대 없음(유지해야 함)');
      if ($('.w-vmeter')) fit.av.push('카메라 꺼짐인데 세로 미터 존재');
    }
    for (const b of $$('.w-av .w-tg')) { const r = b.getBoundingClientRect(); if (r.width < 43.5 || r.height < 43.5) fit.av.push('토글 44 미만'); }
  }

  // ───────── 대칭 ─────────
  const sym = [];
  const add = (rule, val, pass) => sym.push({ rule, val, pass });
  const sb = B('.w-sheet');
  const side = !!sb && sb.x > vw * 0.4, bottom = !!sb && !side;
  const regionR = side ? sb.x : vw, axis = regionR / 2;
  const fcol = B('.fl-foot > .fl-col');
  const textCenter = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); const rs = [...rg.getClientRects()]; if (!rs.length) return null; const l = Math.min(...rs.map((r) => r.left)), r = Math.max(...rs.map((r) => r.right)); return (l + r) / 2; };
  // S1
  const singles = [['본문 컬럼', col], ['하단 컬럼', fcol], ['종료·대기 카드', fv]];
  const dots = $$('.fl-steps > i');
  if (dots.length) { const l = Math.min(...dots.map((d) => d.getBoundingClientRect().left)), r = Math.max(...dots.map((d) => d.getBoundingClientRect().right)); singles.push(['진행 점', { cx: (l + r) / 2 }]); }
  const h1 = $('.w-head h1, .w-fv h1'); if (h1) singles.push(['제목 글자', { cx: textCenter(h1) }]);
  const chips = $$('.fl-chiprow > .fl-chip'); if (chips.length) { const l = Math.min(...chips.map((d) => d.getBoundingClientRect().left)), r = Math.max(...chips.map((d) => d.getBoundingClientRect().right)); singles.push(['칩 줄', { cx: (l + r) / 2 }]); }
  const tnum = $('.w-time .fl-num'); if (tnum) singles.push(['시작 시각', { cx: textCenter(tnum) }]);
  const ttl = $('.fl-top-title'); if (ttl) singles.push(['상단 제목', { cx: textCenter(ttl) }]);
  const pbtn = $('.fl-foot .fl-btn'); if (pbtn) singles.push(['하단 주 버튼', box(pbtn)]);
  const ico = $('.w-hi, .w-ficon'); if (ico) singles.push(['상태 아이콘', box(ico)]);
  for (const [k, b] of singles) if (b && typeof b.cx === 'number') add('S1', `${k} Δ${f(b.cx - axis)}`, Math.abs(b.cx - axis) <= 2);
  // S2
  for (const [k, b] of [['본문 컬럼', col], ['하단 컬럼', fcol], ['종료·대기 카드', fv], ['바텀 시트', bottom ? sb : null]]) if (b) { const l = b.x, r = regionR - b.r; add('S2', `${k} 좌${f(l)}/우${f(r)}`, Math.abs(l - r) <= 2); }
  // S3
  const lEl = document.querySelector('.fl-top-l > *'), rEl = document.querySelector('.fl-top-r > *');
  if (lEl && rEl) { const l = box(lEl), r = box(rEl); add('S3', `여백 좌${f(l.x)}/우${f(regionR - r.r)} · 높이 ${f(l.h)}/${f(r.h)}`, Math.abs(l.x - (regionR - r.r)) <= 2 && Math.abs(l.h - r.h) <= 2); }
  // S4 — 이 시안에는 PiP 가 없어 해당 없음(건수 0)
  // S5
  if (sb) {
    if (vw < vh) add('S5', `세로형 ${side ? '사이드 시트(위반)' : '바텀 시트'}`, !side);
    else add('S5', `가로형 ${side ? '사이드 시트' : '바텀 시트'}`, side || vw < 1100);
    if (bottom) add('S5', `바텀 시트 폭 ${f(sb.w)} (≤640)`, sb.w <= 642);
  }
  // S6 — 균등 분배
  const even = (name, sel, itemSel) => { for (const c of $$(sel)) { const items = [...c.querySelectorAll(itemSel)].filter(vis).map(box).sort((a, b) => a.x - b.x); if (items.length < 2) continue; const ws = items.map((i) => i.w), gaps = items.slice(1).map((i, n) => i.x - items[n].r); add('S6', `${name} ${items.length}개 폭 ${f(Math.min(...ws))}~${f(Math.max(...ws))} 간격 ${f(Math.min(...gaps))}~${f(Math.max(...gaps))}`, Math.max(...ws) - Math.min(...ws) <= 2 && Math.max(...gaps) - Math.min(...gaps) <= 2); } };
  even('5단계 선택', '.w-scale .row', ':scope > button');
  even('설문 축', '.w-axes', ':scope > .w-ax');
  even('밴드 상태 타일', '.w-tiles', ':scope > .w-tile');
  even('마이크 레벨', '.w-level', ':scope > i');
  even('코드 칸', '.fl-codebox', ':scope > span');
  even('시트 보조 버튼', '.w-pair', ':scope > button');
  { const vd = $('.w-vid'); const tgs = vd ? [...vd.querySelectorAll('.w-ovb > .w-tg')].filter(vis).map(box).sort((a, b) => a.x - b.x) : [];
    if (vd && tgs.length === 2 && !vd.querySelector('.w-owarn')) {
      const vb = box(vd), cx = (tgs[0].x + tgs[1].r) / 2;
      add('S1', `영상 위 토글 쌍 Δ${f(cx - vb.cx)}`, Math.abs(cx - vb.cx) <= 2);
      add('S6', `영상 위 토글 쌍 폭 ${f(tgs[0].w)}/${f(tgs[1].w)} 간격 ${f(tgs[1].x - tgs[0].r)}`, Math.abs(tgs[0].w - tgs[1].w) <= 2 && Math.abs((tgs[1].x - tgs[0].r) - 8) <= 1);
    } }
  // S7 — 본문 세로 중앙
  if (col && topB && footB) { const up = col.y - topB.b, down = footB.y - col.b, tol = (footB.y - topB.b) * 0.08; add('S7', `본문 위${f(up)}/아래${f(down)} (허용 ±${f(tol)})`, Math.abs(up - down) <= tol); }
  // S8 — 같은 폭
  const colEl = $('.fl-body > .fl-col');
  if (colEl) { const kids = [...colEl.children].filter(vis).map(box); const ws = kids.map((k) => k.w); add('S8', `본문 블록 ${kids.length}개 폭 ${f(Math.min(...ws))}~${f(Math.max(...ws))}`, Math.max(...ws) - Math.min(...ws) <= 2); }
  const fvEl = $('.w-fv');
  if (fvEl) { const kids = [...fvEl.querySelectorAll(':scope > .w-finfo, :scope > .w-fbtns')].filter(vis).map(box); if (kids.length > 1) { const ws = kids.map((k) => k.w); add('S8', `카드 안 블록 ${kids.length}개 폭 ${f(Math.min(...ws))}~${f(Math.max(...ws))}`, Math.max(...ws) - Math.min(...ws) <= 2); } }
  // S9 — 중앙 컬럼 ≤640
  for (const [k, b] of [['본문 컬럼', col], ['하단 컬럼', fcol], ['종료·대기 카드', fv]]) if (b) add('S9', `${k} 폭 ${f(b.w)} ≤640`, b.w <= 642);
  // S10 — 8배수 + 같은 종류는 같은 값
  const okSet = (g) => [8, 16, 24, 32, 40, 48].some((s) => Math.abs(g - s) <= 1);
  const gapsOf = (el) => { const k = [...el.children].filter(vis).map(box).sort((a, b) => a.y - b.y); return k.slice(1).map((b, i) => b.y - k[i].b); };
  for (const [name, sel] of [['본문 블록', '.fl-body > .fl-col'], ['하단', '.fl-foot > .fl-col'], ['카드', '.w-fv'], ['시트', '.w-sheet']]) {
    const el = $(sel); if (!el) continue;
    const g = gapsOf(el); if (!g.length) continue;
    add('S10', `${name} 간격 ${g.map(f).join('/')}`, g.every(okSet) && Math.max(...g) - Math.min(...g) <= 1);
  }
  // MS1 — 오프라인에서 영상·마이크·BGM 자리째 제거, 컬럼 구조 동일
  if (document.getElementById('app').dataset.online === '0') {
    const media = $$('.w-media,.w-prev,.w-level,.w-sw').length;
    const expect = Math.min(vw - 32, 640);
    add('MS1', `오프라인 · 영상·마이크·BGM ${media}개 · 컬럼 ${col ? f(col.w) : '-'} (기대 ${expect})`, media === 0 && (!col || Math.abs(col.w - expect) <= 2));
  }
  // MS3 — 전체 화면 카드는 정중앙
  if (fv) { const dx = fv.cx - axis, dy = fv.cy - vh / 2; add('MS3', `카드 Δx${f(dx)} Δy${f(dy)}`, Math.abs(dx) <= 2 && Math.abs(dy) <= 4); }

  return { fit, sym };
}

// ───────── 실행 ─────────
const browser = await chromium.launch({ channel: 'chrome', args: ['--hide-scrollbars'] });
const browser2 = browser;
const probe = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await probe.goto(BASE);
await probe.waitForFunction(() => window.__ready === true);
const CASES = await probe.evaluate(() => window.__cases);
await probe.context().close();

const staleCases = Object.values(CASES).flat().filter((c) => c.includes('iconmeter'));
const FIT_KEYS = { scroll: '페이지 스크롤', layout: '본문 영역 이탈·침범', small: '11px 이하 글자', clipped: '텍스트 잘림', outside: '화면 이탈', overlap: '요소 겹침', touch: '터치 44 미만', empty: '빈 영역', glyph: '이모지·문자 글리프', banned: '금지 용어', eyebrow: '영문 대문자 아이브로우', space8: '8배수 아닌 간격', nested: '시트 내 중첩 스크롤', trk: 'R1-2 전극 트래커', av: 'R1-3 내 영상·소리' };
const SYM_NAMES = { S1: '단독 요소 중심축', S2: '좌우 여백 동일', S3: '상단 바 좌우 대칭', S4: 'PiP 짝 가운데(이 시안에 PiP 없음)', S5: '시트 분기(세로=바텀)', S6: '균등 분배', S7: '본문 세로 중앙', S8: '박스 폭 동일', S9: '중앙 컬럼 max-width', S10: '8배수·같은 종류 같은 간격', MS1: '오프라인 컬럼 구조', MS3: '전체 화면 정중앙' };
const rows = [];
for (const vp of VPS) {
  const [w, h] = vp.split('x').map(Number);
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  for (const [screen, list] of Object.entries(CASES)) for (const c of list) {
    await page.goto(`${BASE}?screen=${screen}&case=${c}`);
    await page.waitForFunction(() => window.__ready === true);
    await page.evaluate(() => document.fonts.ready);
    if (BREAK) await page.addStyleTag({ content: process.env.BREAK.length > 1 ? process.env.BREAK : '.fl-body > .fl-col{transform:translateX(24px)} .fl-top-l{transform:translateY(8px)} .w-fv{margin-top:40px} .fl-foot .fl-btn{min-height:40px} .w-head h1{font-size:10px!important}' });
    await page.waitForTimeout(80);
    const r = await page.evaluate(measurePage);
    rows.push({ screen, c, vp, ...r });
  }
  await page.context().close();
}

// 파일 소스 grep (이모지·문자 글리프)
const src = fs.readFileSync(path.join(root, 'member-b.html'), 'utf8');
const srcGlyph = [...new Set(src.match(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}✓✕←→‹›•●○×]/gu) || [])];
const srcExternal = (src.match(/https?:\/\//g) || []).length;
const WORDS = ['클래스 코드', '참여 코드', '참여코드', '코드 복사', '코드 입력', '6자리', '게스트', '인증 코드', 'OTP', 'QR', '귀'];
const srcBanned = WORDS.filter((w) => src.includes(w));
const srcStale = ['w-vmeter', 'iconmeter'].filter((w) => src.includes(w));
const idxPage = await (await browser2.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await idxPage.goto(`${BASE}?index=1`);
await idxPage.waitForFunction(() => window.__ready === true);
const idxText = await idxPage.evaluate(() => document.body.innerText);
const idxBanned = WORDS.filter((w) => idxText.includes(w));
await idxPage.context().close();

const fitCount = Object.fromEntries(Object.keys(FIT_KEYS).map((k) => [k, rows.reduce((s, r) => s + r.fit[k].length, 0)]));
fitCount.srcGlyph = srcGlyph.length;
fitCount.srcBanned = srcBanned.length;
fitCount.srcStale = srcStale.length + staleCases.length;
fitCount.idxBanned = idxBanned.length;
const symAll = rows.flatMap((r) => r.sym.map((s) => ({ ...s, id: `${r.screen}/${r.c}`, vp: r.vp })));
const symCount = Object.fromEntries(Object.keys(SYM_NAMES).map((k) => [k, symAll.filter((s) => s.rule === k && !s.pass).length]));
const symTotal = Object.fromEntries(Object.keys(SYM_NAMES).map((k) => [k, symAll.filter((s) => s.rule === k).length]));
const pages = rows.length;

if (IS_BEFORE && !BREAK) fs.writeFileSync(beforeFile, JSON.stringify({ fit: fitCount, sym: symCount, pages }, null, 1));
const before = fs.existsSync(beforeFile) ? JSON.parse(fs.readFileSync(beforeFile, 'utf8')) : null;
const bf = (k) => (before && before.fit[k] !== undefined ? before.fit[k] : '-');
const bs = (k) => (before && before.sym[k] !== undefined ? before.sym[k] : '-');

const nScreens = Object.keys(CASES).length, nCases = Object.values(CASES).reduce((s, l) => s + l.length, 0);
await browser.close();
const fitFail = Object.values(fitCount).reduce((s, n) => s + n, 0) + srcExternal;
const symFail = Object.values(symCount).reduce((s, n) => s + n, 0);
const out = IS_BEFORE ? 'before' : 'final';

const F = [];
F.push('MIND BREEZE 2.0 · 클래스 사전 흐름 · 회원 시안 B (FM06a~e · FM07 · FM08 · FM09) 핏 측정');
F.push(`측정: tools/member-b-measure.mjs · 대상: 화면 ${nScreens}개 · 케이스 ${nCases}개 · 뷰포트 4개(${VPS.join(', ')}) · 측정 페이지 ${pages}장`);
F.push(`판정: ${fitFail === 0 ? 'PASS (위반 0건)' : 'FAIL (위반 ' + fitFail + '건)'}${IS_BEFORE ? '  ← 수정 전 기준선' : ''}`);
F.push('');
F.push('항목별 위반 건수 (수정 전 → 수정 후):');
for (const [k, name] of Object.entries(FIT_KEYS)) F.push(`  ${k.padEnd(8)} ${name.padEnd(20)} ${String(bf(k)).padStart(4)} → ${String(fitCount[k]).padStart(4)}`);
F.push(`  srcGlyph 파일 소스 이모지·글리프 ${String(bf('srcGlyph')).padStart(4)} → ${String(srcGlyph.length).padStart(4)}`);
F.push(`  srcBanned 파일 소스 R1 금지어(${WORDS.join('·')}) ${String(bf('srcBanned')).padStart(4)} → ${String(srcBanned.length).padStart(4)}  ${srcBanned.join(',')}`);
F.push(`  srcStale  R3 폐기 흔적(w-vmeter·iconmeter) ${String(bf('srcStale')).padStart(4)} → ${String(srcStale.length).padStart(4)}  ${srcStale.join(',')}`);
F.push(`  idxBanned 인덱스 표 R1 금지어 ${String(bf('idxBanned')).padStart(4)} → ${String(idxBanned.length).padStart(4)}  ${idxBanned.join(',')}`);
F.push(`  외부 http 리소스 참조 ${srcExternal}건`);
F.push('측정 방식 메모: 영문 대문자 아이브로우 검사는 제품명 "LINK BAND"(필수 표기)를 예외로 한다. 금지 용어에는 %·순위·점수·평균을 포함한다. 11px 이하는 12px 미만 글자 수.');
F.push('');
const bad = rows.filter((r) => Object.values(r.fit).some((v) => v.length));
if (bad.length) {
  F.push('=== 위반 목록 (화면 | 케이스 | 뷰포트 | 항목: 내용) ===');
  for (const r of bad) for (const [k, v] of Object.entries(r.fit)) if (v.length) F.push(`FAIL | ${r.screen} | ${r.c} | ${r.vp} | ${k}: ${[...new Set(v)].slice(0, 6).join(' ; ')}${new Set(v).size > 6 ? ' …' : ''}`);
  F.push('');
}
F.push('=== 전체 일람표 (화면 | 케이스 | 뷰포트 | 판정) ===');
for (const r of rows) F.push(`${r.screen.padEnd(6)} | ${r.c.padEnd(40)} | ${r.vp.padEnd(8)} | ${Object.values(r.fit).every((v) => !v.length) ? 'PASS' : 'FAIL'}`);
fs.writeFileSync(path.join(OUT, IS_BEFORE ? 'fit/member-b-fit.before.txt' : 'fit/member-b-fit.txt'), F.join('\n') + '\n');

const S = [];
S.push('MIND BREEZE 2.0 · 클래스 사전 흐름 · 회원 시안 B 좌우 대칭·비율 균형 측정 (균형.md S1~S10, MS1·MS3)');
S.push(`측정: tools/member-b-measure.mjs · 대상: 화면 ${nScreens}개 · 케이스 ${nCases}개 × 뷰포트 4개 · 총 검사 ${symAll.length}건`);
S.push(`위반 ${symFail}건 / 전체 ${symAll.length}건 ${symFail === 0 ? ' → PASS' : ' → FAIL'}${IS_BEFORE ? '  ← 수정 전 기준선' : ''}`);
S.push('');
S.push('규칙별 위반 건수 (수정 전 → 수정 후 / 전체 검사 건수):');
for (const [k, name] of Object.entries(SYM_NAMES)) S.push(`  ${k.padEnd(4)} ${name.padEnd(30)} ${String(bs(k)).padStart(4)} → ${String(symCount[k]).padStart(4)} / ${symTotal[k]}`);
S.push('');
S.push('뷰포트별 위반 건수: ' + VPS.map((v) => `${v}=${symAll.filter((s) => s.vp === v && !s.pass).length}`).join('  '));
S.push('');
const sf = symAll.filter((s) => !s.pass);
if (sf.length) { S.push('=== 위반 목록 ==='); for (const s of sf) S.push(`FAIL | ${s.id.padEnd(46)} | ${s.vp.padEnd(8)} | ${s.rule.padEnd(4)} | ${s.val}`); S.push(''); }
S.push('=== 전체 일람표 (화면/케이스 | 뷰포트 | 규칙 | 측정값 | 판정) ===');
for (const s of symAll) S.push(`${s.id.padEnd(46)} | ${s.vp.padEnd(8)} | ${s.rule.padEnd(4)} | ${s.val} | ${s.pass ? 'PASS' : 'FAIL'}`);
fs.writeFileSync(path.join(OUT, IS_BEFORE ? 'fit/member-b-symmetry.before.txt' : 'fit/member-b-symmetry.txt'), S.join('\n') + '\n');

console.log(F.slice(0, 22).join('\n'));
console.log('\n' + S.slice(0, 20).join('\n'));
console.log(`\n[${out}] 핏 위반 ${fitFail}건 · 대칭 위반 ${symFail}건 · 페이지 ${pages}`);
