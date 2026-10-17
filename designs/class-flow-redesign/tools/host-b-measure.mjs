// 상담사 시안 B(host-b.html) 캡처 + 완료 조건 실측 (지시서-공통 §측정, 균형.md S1~S10)
// 사용: node tools/host-b-measure.mjs before|after|shots
//   before → fit/host-b-fit-before.txt, fit/host-b-symmetry-before.txt   (수정 전 위반 기록)
//   after  → fit/host-b-fit.txt, fit/host-b-symmetry.txt
//   shots  → 스크린샷만
// 서버: python3 -m http.server 5304 --directory designs   (tokens.css 가 ../class-player-redesign 에 있어 designs 루트를 서빙)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const D = path.resolve(HERE, '..');
const require = createRequire(path.resolve(D, '../../frontend/package.json'));
const { chromium } = require('playwright');

const mode = process.argv[2] || 'after';
const BASE = process.env.BASE || 'http://localhost:5304/class-flow-redesign/host-b.html';
const SHOTS = process.env.SHOTS_DIR || `${D}/shots/host-b`;
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(`${D}/fit`, { recursive: true });
const suffix = mode === 'before' ? '-before' : '';
const VPS = [[390, 844], [834, 1194], [1194, 834], [1280, 720]];

const BANNED = /세션|수업|참여하기|오픈|그래도 시작|LB |1:N|6자리|회원 전용|초대 기반 입장|초대받은 회원만|초대한 회원만|로그인한 계정으로 입장해요|30일 보관|관리자가 삭제를 지시하기 전까지|동의하고 계속하기|대기 그만하기|대시보드로 이동|LINK BAND 연결이 필요해요|필수 클래스라|입장할 수 없어요|회원이 LINK BAND를 연결해야|알림 받음|전달되지 않았어요|발송 완료|발송 실패|게스트|OTP|QR|귀/;
const GLYPH = /[✓✕←-↓‹›•○●×]|\p{Extended_Pictographic}/u;

const measure = ({ glyphSrc, bannedSrc }) => {
  const vw = innerWidth, vh = innerHeight, de = document.documentElement;
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const R = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; };
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const name = (e) => (e.className && e.className.baseVal === undefined ? String(e.className).split(' ')[0] : e.tagName.toLowerCase()) || e.tagName.toLowerCase();
  const fit = {}; const sym = [];
  const add = (rule, label, value, ok, unit = 'px') => sym.push({ rule, label, value: typeof value === 'number' ? Math.round(value * 10) / 10 : value, ok, unit });
  const TOL = 2;
  const root = q('.fl-root');

  // 1 페이지 스크롤
  fit.scroll = { ok: de.scrollHeight <= vh && de.scrollWidth <= vw && document.body.scrollHeight <= vh && document.body.scrollWidth <= vw, sh: de.scrollHeight, sw: de.scrollWidth };

  // 2 11px 이하 글자
  const small = []; const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let nd;
  const texts = [];
  while ((nd = tw.nextNode())) {
    const t = nd.textContent.trim(); if (!t) continue; const el = nd.parentElement;
    if (!el || el.closest('script,style,svg')) continue; if (!vis(el)) continue;
    texts.push({ t, el });
    if (parseFloat(getComputedStyle(el).fontSize) <= 11) small.push(t);
  }
  fit.small = small.length; fit.smallT = small.slice(0, 3);

  // 3 블록 겹침·이탈
  const body = q('.fl-body'), foot = q('.fl-foot'), top = q('.w-top'), main = q('.w-main');
  const bodyCol = q('.fl-body > .fl-col'), footCol = q('.fl-foot > .fl-col');
  const bodyBlocks = [...bodyCol.children].filter(vis);
  const footBlocks = [...footCol.children].filter(vis);
  const blocks = [{ n: 'top', e: top }, ...bodyBlocks.map((e, i) => ({ n: `body${i}:${name(e)}`, e })), ...footBlocks.map((e, i) => ({ n: `foot${i}:${name(e)}`, e }))];
  const outside = [], overlaps = [];
  const bodyR = R(body), footR = R(foot);
  for (const b of blocks) {
    const r = R(b.e);
    if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) outside.push(b.n);
    if (b.n.startsWith('body') && (r.top < bodyR.top - 0.5 || r.bottom > bodyR.bottom + 0.5)) outside.push(b.n + '(본문영역 이탈)');
  }
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const a = R(blocks[i].e), c = R(blocks[j].e);
    const w = Math.min(a.right, c.right) - Math.max(a.left, c.left), h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
    if (w > 0.5 && h > 0.5) overlaps.push(`${blocks[i].n}x${blocks[j].n}`);
  }
  fit.outside = outside; fit.overlaps = overlaps;

  // 3b 잘림(글자·요소) + 내부 스크롤
  const clipped = [], scrollers = [];
  qa('.fl-root *').forEach((e) => {
    if (!vis(e) || e.closest('svg')) return;
    const cs = getComputedStyle(e);
    const oy = cs.overflowY, ox = cs.overflowX;
    if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1) scrollers.push(name(e));
    else if ((oy === 'hidden' || ox === 'hidden') && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) && !e.classList.contains('fl-body') && !e.classList.contains('fl-root') && !e.classList.contains('fl-backdrop') && !e.classList.contains('fl-layer')) clipped.push(`${name(e)}(${e.scrollWidth}x${e.scrollHeight}/${e.clientWidth}x${e.clientHeight})`);
  });
  fit.clipped = clipped;
  fit.scrollers = scrollers; fit.badScrollers = scrollers.filter((n) => n !== 'w-list');

  // 4 터치 영역
  const touch = [];
  qa('button, [role=switch], [role=checkbox], a, input').forEach((e) => {
    if (!vis(e)) return; const r = R(e);
    if (r.height < 43.5 || r.width < 43.5) touch.push(`${name(e)}:${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 8)}(${Math.round(r.width)}x${Math.round(r.height)})`);
  });
  fit.touch = touch;

  // 5 빈 영역 — 컨테이너 직계 자식 묶음이 컨테이너를 채우는 비율
  const empty = [];
  qa('.fl-card, .w-listcard, .w-opt, .w-empty, .w-prev, .w-codecard').forEach((e) => {
    if (!vis(e)) return; const r = R(e); const kids = [...e.children].filter(vis);
    if (!kids.length) { empty.push(name(e) + '(자식 없음)'); return; }
    const l = Math.min(...kids.map((k) => R(k).left)), rr = Math.max(...kids.map((k) => R(k).right)), t = Math.min(...kids.map((k) => R(k).top)), b = Math.max(...kids.map((k) => R(k).bottom));
    const wr = (rr - l) / r.width, hr = (b - t) / r.height;
    const centered = e.classList.contains('w-empty') || e.classList.contains('w-trk');
    if ((!centered && wr < 0.6) || hr < 0.5) empty.push(`${name(e)}(폭${Math.round(wr * 100)}/높이${Math.round(hr * 100)})`);
  });
  fit.empty = empty;

  // R1-3 합친 '내 영상·소리' / R2-2 세로 미터·아이콘 미터 / R2-1 LED 안 아이콘 없음
  const media = q('.w-media');
  fit.media = null;
  if (media && vis(media)) {
    const r = R(media);
    const areas = bodyBlocks.map((e) => R(e).width * R(e).height);
        const tg = media.querySelector('.w-vtg');
    fit.media = { w: Math.round(r.width), h: Math.round(r.height), low: media.classList.contains('low'), largest: r.width * r.height >= Math.max(...areas) - 1,
      hbar: media.querySelectorAll('.w-meter').length, ring: media.querySelectorAll('.w-ringbtn').length, tog: media.querySelectorAll('.w-tg .fl-iconbtn, .w-vtg .fl-iconbtn').length,
      vmeter: qa('.w-vmeter, [role=meter]').length, ringSteps: media.querySelector('.w-ringbtn') ? (media.querySelector('.w-ringbtn').getAttribute('style') || '').split('rgba(255,255,255,0.22)').length - 1 : -1,
      tgd: tg ? Math.abs(R(tg).cx - r.cx) : null, tgSize: tg ? [...tg.children].map((b) => Math.round(R(b).width) + 'x' + Math.round(R(b).height)).join(',') : null };
  }
  fit.trackers = qa('.w-trksvg').filter(vis).map((e) => { const r = R(e); return `${Math.round(r.width)}x${Math.round(r.height)}`; });
  fit.trackerLabels = qa('.w-trksvg').filter(vis).map((e) => ['왼쪽', '기준', '오른쪽'].every((k) => e.textContent.includes(k)));
  fit.ledIcons = qa('.w-led .ic, .w-legend .ic').filter(vis).length + qa('.w-trksvg path[stroke="#fff"], .w-trksvg path[stroke="#04211C"]').length;
  fit.invite = !!q('.w-invite');
  // R2-3
  const startBtn = foot.querySelector('button.fl-btn.primary');
  fit.start = { disabled: startBtn ? startBtn.disabled : null, rows: qa('.w-mrow').length, lines: foot.querySelector('.w-fnote') && startBtn ? R(foot.querySelector('.w-fnote')).bottom <= R(startBtn).top + 0.5 : null, note: (foot.querySelector('.w-fnote') || {}).textContent };
  const pr = qa('.w-pr'); const sh = q('.w-sheet');
  fit.pending = { rows: pr.filter((e) => !e.classList.contains('w-pmore')).length, more: qa('.w-pmore').length, btns: sh ? qa('.w-sheet .fl-btn, .w-sheet .fl-btn.ghost').map((b) => b.textContent.trim()) : [], hasNote: sh ? sh.textContent.includes('시작 후에도 입장해서 이어서 준비할 수 있어요') : false, emptyHead: sh ? sh.textContent.includes('아직 아무도 입장하지 않았어요') : false, emptyNote: sh ? sh.textContent.includes('시작하면 초대한 회원이 이후에 입장해요') : false, chips: pr.filter((e) => !e.classList.contains('w-pmore')).map((e) => e.querySelectorAll('.w-mchip').length) };

  // 6·7·8 글리프·금지어·대문자 아이브로우 (화면 텍스트)
  const all = texts.map((x) => x.t).join('\n');
  fit.glyph = (all.match(new RegExp(glyphSrc, 'gu')) || []).length;
  fit.banned = (all.match(new RegExp(bannedSrc, 'g')) || []);
  fit.eyebrow = texts.filter((x) => /^[A-Z][A-Z0-9 \-·]{3,}$/.test(x.t) && !x.el.closest('.w-code') && !x.el.closest('.w-mchip')).map((x) => x.t);

  // 9 간격 8의 배수
  const bad8 = new Set();
  const ok8 = (v) => { const n = parseFloat(v); return !isFinite(n) || n === 0 || n % 8 === 0; };
  qa('.fl-root *').forEach((e) => {
    if (!vis(e) || e.closest('svg')) return; const cs = getComputedStyle(e);
    for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'rowGap', 'columnGap']) {
      const v = cs[p]; if (v === 'normal' || v === 'auto') continue;
      if (!ok8(v)) bad8.add(`${name(e)}.${p}=${v}`);
    }
  });
  fit.spacing = [...bad8];

  // ───── 대칭 S1~S10 ─────
  const mainR = R(main), axis = mainR.cx;
  // S3 상단 바
  const tR = R(top), left = R(top.children[0]), ph = R(top.children[2]), ttl = R(top.children[1]);
  const lm = left.left - tR.left, rm = tR.right - ph.right;
  add('S3', '상단바 좌/우 바깥여백 차', Math.abs(lm - rm), Math.abs(lm - rm) <= TOL);
  add('S3', '상단바 좌/우 요소 높이 차', Math.abs(left.height - ph.height), Math.abs(left.height - ph.height) <= TOL);
  add('S3', '상단바 제목 중앙', Math.abs(ttl.cx - tR.cx), Math.abs(ttl.cx - tR.cx) <= TOL);
  add('S2', '상단바 좌우여백(메인영역 기준)', Math.abs((tR.left - mainR.left) - (mainR.right - tR.right)), Math.abs((tR.left - mainR.left) - (mainR.right - tR.right)) <= TOL);
  // S1·S2 본문/푸터 블록
  const colBlocks = [...bodyBlocks.map((e, i) => [`본문 ${name(e)}`, e]), ...footBlocks.map((e, i) => [`푸터 ${name(e)}`, e])];
  for (const [n, e] of colBlocks) {
    const r = R(e);
    const d1 = Math.abs(r.cx - axis), d2 = Math.abs((r.left - mainR.left) - (mainR.right - r.right));
    add('S1', `${n} 가로중심=메인축`, d1, d1 <= TOL); add('S2', `${n} 좌우여백`, d2, d2 <= TOL);
  }
  // S8 같은 폭
  const ws = colBlocks.map(([, e]) => R(e).width);
  if (ws.length > 1) add('S8', '본문·푸터 블록 폭 편차', Math.max(...ws) - Math.min(...ws), Math.max(...ws) - Math.min(...ws) <= TOL);
  // S9 컬럼 최대 폭
  add('S9', '본문 컬럼 폭(<=640)', R(bodyCol).width, R(bodyCol).width <= 641);
  add('S9', '푸터 컬럼 폭(<=640)', R(footCol).width, R(footCol).width <= 641);
  // S10 간격 스케일
  const okSet = [8, 16, 24, 32, 40, 48];
  const chain = (arr, lab) => { for (let i = 0; i < arr.length - 1; i++) { const g = R(arr[i + 1]).top - R(arr[i]).bottom; if (g < 0) continue; add('S10', `${lab} 간격 ${i + 1}`, g, okSet.includes(Math.round(g))); } };
  chain(bodyBlocks, '본문'); chain(footBlocks, '푸터');
  const padB = getComputedStyle(body); add('S10', '본문 좌우 안쪽여백', parseFloat(padB.paddingLeft), okSet.includes(parseFloat(padB.paddingLeft)));
  // S7 본문 묶음 세로 중앙
  if (bodyBlocks.length) {
    const t0 = Math.min(...bodyBlocks.map((e) => R(e).top)), b0 = Math.max(...bodyBlocks.map((e) => R(e).bottom));
    const gc = (t0 + b0) / 2, bc = (bodyR.top + bodyR.bottom) / 2; const d = Math.abs(gc - bc);
    add('S7', '본문 묶음 세로중앙(본문영역 기준)', d, d <= bodyR.height * 0.08 + 0.5);
  }
  // S6 도크
  const dock = q('.w-dock');
  if (dock && vis(dock)) {
    const dr = R(dock), items = [...dock.children].filter(vis).map(R);
    const iw = items.map((i) => i.width), gp = items.slice(1).map((i, k) => i.left - items[k].right);
    add('S6', '도크 항목 폭 편차', Math.max(...iw) - Math.min(...iw), Math.max(...iw) - Math.min(...iw) <= TOL);
    if (gp.length) add('S6', '도크 항목 간격 편차', Math.max(...gp) - Math.min(...gp), Math.max(...gp) - Math.min(...gp) <= TOL);
    add('S6', '도크 안쪽 좌우여백 차', Math.abs((items[0].left - dr.left) - (dr.right - items.at(-1).right)), Math.abs((items[0].left - dr.left) - (dr.right - items.at(-1).right)) <= TOL);
    const need = Math.min(mainR.width * 0.92, 560);
    add('S6', `도크 폭 >= ${Math.round(need)}`, dr.width, dr.width >= need - 1);
  }
  // S5 시트
  const wrap = q('.w-wrap'), sheet = q('.w-sheet');
  if (wrap && sheet) {
    const s = R(sheet), portrait = vw < vh, sideAllowed = vw >= 1000 && !portrait;
    const isTool = wrap.classList.contains('tool'); const inFlow = getComputedStyle(wrap).position === 'static';
    if (isTool && sideAllowed) {
      add('S5', '가로형 도구 시트: 사이드', inFlow ? '사이드' : '바텀', inFlow, '');
      const rr = vw - s.right; add('S5', '사이드 시트 우 여백=16', Math.abs(rr - 16), Math.abs(rr - 16) <= TOL); add('S5', '사이드 시트 상/하 여백 동일(세로 중앙)', Math.abs(s.top - (vh - s.bottom)), Math.abs(s.top - (vh - s.bottom)) <= TOL);
      add('S5', '사이드 시트: 메인영역과 겹침 없음', Math.max(0, mainR.right - s.left), mainR.right <= s.left + 0.5);
    } else {
      add('S5', '세로형/모바일/확인 시트: 사이드 금지(바텀)', inFlow ? '사이드' : '바텀', !inFlow, '');
      add('S5', '바텀 시트 좌우여백 차', Math.abs(s.left - (vw - s.right)), Math.abs(s.left - (vw - s.right)) <= TOL);
      add('S1', '바텀 시트 가로중심=화면 중앙', Math.abs(s.cx - vw / 2), Math.abs(s.cx - vw / 2) <= TOL);
      add('S5', '바텀 시트 최대폭 <= 640', s.width, s.width <= 641);
      add('S5', '바텀 시트 화면 하단 밀착', Math.abs(s.bottom - vh), Math.abs(s.bottom - vh) <= 16);
    }
    add('S5', '시트 상단이 화면 안', s.top, s.top >= 0);
    const bad = []; [...sheet.querySelectorAll('*')].forEach((e) => { if (!vis(e) || e.closest('svg')) return; const r = R(e); if (r.bottom > s.bottom + 0.5 || r.right > s.right + 0.5 || r.left < s.left - 0.5) bad.push(name(e)); });
    fit.sheetOverflow = bad;
  }
  return { fit, sym, small: fit.small };
};

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto(`${BASE}?index=1`, { waitUntil: 'networkidle' });
const reg = await page.evaluate(() => Object.fromEntries(Object.entries(REG).map(([k, v]) => [k, Object.keys(v.cases)])));
const jobs = [];
for (const [id, cases] of Object.entries(reg)) for (const c of cases) for (const vp of VPS) jobs.push({ id, c, vp });

if (mode === 'probe') {
  const css = process.env.PERTURB || '.w-dock{margin-left:8px} .w-ttl p{font-size:11px} .w-btn44{min-height:40px} .w-top{padding-left:16px}';
  const picks = [['FH06', 'g-on-3', [390, 844]], ['FH06', 'g-on-3', [1280, 720]], ['FH06a', 'share', [1194, 834]], ['FH07', 'ok', [834, 1194]], ['FH09', 'end-ai', [390, 844]]];
  for (const [id, c, vp] of picks) {
    await page.setViewportSize({ width: vp[0], height: vp[1] });
    await page.goto(`${BASE}?screen=${id}&case=${c}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: css });
    const m = await page.evaluate(measure, { glyphSrc: GLYPH.source, bannedSrc: BANNED.source });
    console.log(id, c, vp.join('x'), '대칭위반', m.sym.filter((s) => !s.ok).map((s) => `${s.rule}:${s.label}=${s.value}`).join(' | ') || '없음', '/ 11px', m.fit.small, '/ 터치', m.fit.touch.length);
  }
  await browser.close(); process.exit(0);
}
const fitLines = [], symLines = [];
const fitFail = {}, symFail = {};
let screens = 0;
const caseSet = new Set();
for (const j of jobs) {
  const [w, h] = j.vp; const vpn = `${w}x${h}`;
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE}?screen=${j.id}&case=${j.c}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready="1"]');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/${j.id}-${j.c}-${vpn}.png` });
  screens++; caseSet.add(`${j.id}/${j.c}`);
  if (mode === 'shots') continue;
  const m = await page.evaluate(measure, { glyphSrc: GLYPH.source, bannedSrc: BANNED.source });
  const f = m.fit; const tag = `${j.id} ${j.c} ${vpn}`;
  const fails = [];
  if (!f.scroll.ok) fails.push(`스크롤(sh=${f.scroll.sh},sw=${f.scroll.sw})`);
  if (f.small) fails.push(`11px이하 ${f.small}건 ${JSON.stringify(f.smallT)}`);
  if (f.outside.length) fails.push(`이탈 ${f.outside.join('|')}`);
  if (f.overlaps.length) fails.push(`겹침 ${f.overlaps.join('|')}`);
  if (f.clipped.length) fails.push(`잘림 ${f.clipped.join('|')}`);
  if (f.badScrollers.length) fails.push(`허용 외 내부스크롤 ${f.badScrollers.join('|')}`);
  if (f.touch.length) fails.push(`터치<44 ${f.touch.join('|')}`);
  if (f.empty.length) fails.push(`빈 영역 ${f.empty.join('|')}`);
  const CAM_ON = ['ok', 'quiet', 'mic-off', 'mic-off-warn', 'mic-denied'];
  if (j.id === 'FH05' && j.c !== 'offline') {
    const md = f.media;
    if (!md) fails.push('R1-3 합친 내 영상·소리 컴포넌트 없음');
    else {
      if (md.tog !== 2) fails.push(`R1-3 토글 2개 아님(${md.tog})`);
      if (!md.low) {
        if (w <= 420 && (md.w < 342 || md.h < 220)) fails.push(`R1-3 모바일 영상 ${md.w}x${md.h} (>=342x220 필요)`);
        if (!md.largest) fails.push('R1-3 영상이 본문에서 가장 큰 요소가 아님');
      }
      if (CAM_ON.includes(j.c)) {
        if (md.hbar !== 0) fails.push(`R3-1 카메라 켜짐인데 가로 레벨 막대 ${md.hbar}개`);
        if (md.vmeter !== 0) fails.push(`R3-1 세로 레벨 미터 ${md.vmeter}개 (0이어야 함)`);
        if (md.ring !== 1) fails.push(`R3-1 아이콘 링 버튼 ${md.ring}개 (1이어야 함)`);
        if (j.c === 'ok' && md.ringSteps !== 1) fails.push(`R3-1 정상은 5단계 중 4단계 채움이어야 함(빈 단계 ${md.ringSteps})`);
        if (j.c === 'quiet' && md.ringSteps !== 4) fails.push(`R3-1 조용해요는 5단계 중 1단계 채움이어야 함(빈 단계 ${md.ringSteps})`);
        if (md.tgd == null || md.tgd > 2) fails.push(`S1 토글 쌍 가운데 정렬 편차 ${md.tgd}`);
      } else if (j.c === 'cam-off') { if (md.hbar !== 1 || !md.low) fails.push('R2-2 카메라 꺼짐은 가로 막대 유지(낮은 카드) 아님'); }
      else if (md.hbar !== 1) fails.push(`R2-2 권한 거부·장치 없음·미지원은 기존 가로 막대 유지(${md.hbar})`);
    }
  }
  const wantTrk = j.id === 'FH06a' && j.c.startsWith('band-bad') ? 1 : 0;
  if (f.trackers.length !== wantTrk || f.trackers.some((x) => x !== '288x64')) fails.push(`R1-2 전극 트래커 ${JSON.stringify(f.trackers)} (기대 ${wantTrk}개 288x64)`);
  if (f.trackerLabels.some((x) => !x)) fails.push('R2-1 전극 아래 라벨(왼쪽/기준/오른쪽) 없음');
  if (f.ledIcons) fails.push(`R2-1 LED·범례 안 아이콘 ${f.ledIcons}개`);
  if (['FH06', 'FH06a', 'FH07', 'FH08'].includes(j.id) && !f.invite) fails.push('R1-1 초대 현황 카드 없음');
  if (['FH06', 'FH06a', 'FH07', 'FH08'].includes(j.id)) {
    if (f.start.disabled !== false) fails.push(`R3-2 시작하기가 비활성(대기 ${f.start.rows}명) — 항상 활성이어야 함`);
    if (!f.start.lines) fails.push('R2-3 상태줄이 시작하기 버튼 위에 없음');
    if (f.start.rows === 0 && f.start.note !== '대기실이 비어 있어요 · 초대한 회원은 시작 후에도 입장할 수 있어요') fails.push(`R3-2 대기 0명 상태줄 문구(${f.start.note})`);
    if (f.start.rows > 0 && !/^\d+명 준비 완료 · \d+명 준비 중$|^\d+명 모두 준비 완료$|^회원이 준비 완료$/.test(f.start.note || '')) fails.push(`R2-3 상태줄 형식(${f.start.note})`);
  }
  if (j.id === 'FH07') {
    const p = f.pending;
    if (p.rows) {
      if (!p.btns.includes('지금 시작하기') || !p.btns.includes('조금 더 기다리기')) fails.push(`R2-3 FH07 버튼 문구(${p.btns.join('|')})`);
      if (!p.hasNote) fails.push('R2-3 FH07 준비 중 안내 문구 없음');
      if (p.chips.some((c) => c < 1)) fails.push('R2-3 미완 단계 칩 없는 행');
      if (p.rows > 5 || (p.more && p.rows !== 3)) fails.push(`R2-3 목록 접기 규칙(행 ${p.rows}, 외 N명 ${p.more})`);
    } else if (f.start.rows === 0) {
      if (!p.emptyHead || !p.emptyNote) fails.push('R3-2 FH07 empty-wait 문구(아직 아무도 입장하지 않았어요 / 시작하면 초대한 회원이 이후에 입장해요) 없음');
      if (!p.btns.includes('지금 시작하기') || !p.btns.includes('조금 더 기다리기')) fails.push(`R3-2 FH07 empty-wait 버튼(${p.btns.join('|')})`);
    } else if (!p.btns.includes('시작하기')) fails.push('R2-3 FH07 전원 준비 완료 시 간단 확인 아님');
  }
  if (f.glyph) fails.push(`글리프 ${f.glyph}건`);
  if (f.banned.length) fails.push(`금지어 ${f.banned.join(',')}`);
  if (f.eyebrow.length) fails.push(`대문자 아이브로우 ${f.eyebrow.join(',')}`);
  if (f.spacing.length) fails.push(`8의 배수 아님 ${f.spacing.join('|')}`);
  if (f.sheetOverflow && f.sheetOverflow.length) fails.push(`시트 안 요소 이탈 ${f.sheetOverflow.join('|')}`);
  fitLines.push(`${fails.length ? 'FAIL' : 'PASS'}  ${tag}${f.scrollers.length ? `  [내부스크롤: ${[...new Set(f.scrollers)].join(',')}]` : ''}${fails.length ? '\n        - ' + fails.join('\n        - ') : ''}`);
  if (fails.length) fitFail[tag] = fails;
  const sv = m.sym.filter((s) => !s.ok);
  for (const s of m.sym) symLines.push(`${s.ok ? 'ok  ' : 'FAIL'}  ${tag}  ${s.rule}  ${s.label}: ${s.value}${s.unit}`);
  if (sv.length) symFail[tag] = sv;
}
await browser.close();
if (mode === 'shots') { console.log(`shots ${screens}`); process.exit(0); }

const nFitFail = Object.keys(fitFail).length, nSymFail = Object.values(symFail).reduce((a, v) => a + v.length, 0);
const byRule = {};
for (const l of symLines) { const mt = l.match(/^(ok  |FAIL)\s+\S+ \S+ \S+\s+(S\d+)/); if (mt) { byRule[mt[2]] ??= { n: 0, v: 0 }; byRule[mt[2]].n++; if (mt[1] === 'FAIL') byRule[mt[2]].v++; } }
const head = [`# host-b ${mode} — 화면 ${new Set(jobs.map((j) => j.id)).size} / 케이스 ${caseSet.size} / 스크린샷 ${screens}`];
const src = fs.readFileSync(process.env.SRC || `${D}/host-b.html`, 'utf8');
const cnt = (re) => (src.match(re) || []).length;
const stat = [
  '# 파일 전체 정적 grep (host-b.html)',
  `#   이모지 ${cnt(/\p{Extended_Pictographic}/gu)}건 / 문자 글리프(✓ ✕ ← → ‹ › • ● ○ ×) ${cnt(/[✓✕←→‹›•●○×]/g)}건`,
  `#   R1 금지어(파일 전체, 화면 텍스트+인덱스 표 포함; 4자리 입장 코드는 상담사 화면이라 허용): 귀 ${cnt(/귀/g)} / 게스트 ${cnt(/게스트/g)} / OTP ${cnt(/OTP/g)} / QR ${cnt(/QR/g)} / 6자리 ${cnt(/6자리/g)} / 인증 코드 ${cnt(/인증 코드/g)} / 30일 보관 ${cnt(/30일 보관/g)} / 회원 전용 ${cnt(/회원 전용/g)} / 알림 받음 ${cnt(/알림 받음/g)} / 전달되지 않았어요 ${cnt(/전달되지 않았어요/g)}`,
  `#   금지어: 세션 ${cnt(/세션/g)} / 수업 ${cnt(/수업/g)} / 참여하기 ${cnt(/참여하기/g)} / 오픈 ${cnt(/오픈/g)} / 그래도 시작 ${cnt(/그래도 시작/g)} / "LB " ${cnt(/LB /g)} / 1:N ${cnt(/1:N/g)}`,
  `#   외부 http(s) 리소스 ${cnt(/https?:\/\//g)}건 / 11px 이하 font-size 선언 ${cnt(/font-size:\s*(?:[0-9]|1[01])px/g)}건`,
  '#   화면 텍스트 기준 grep(글리프·금지어·영문 대문자 아이브로우·11px 이하)은 아래 케이스별 판정에 포함',
  '#   페이지 스크롤은 전 케이스 0. 내부 스크롤은 대기 회원 목록(.w-list)만 허용 — 발생 케이스는 줄 끝 [내부스크롤] 표기',
  ''];
const fitHead = [...head, `# fit: 케이스×뷰포트 ${jobs.length}건 중 FAIL ${nFitFail}건 (PASS ${jobs.length - nFitFail})`, ...stat];
const symHead = [...head, `# 대칭 위반 합계 ${nSymFail}건 (측정 ${symLines.length}건)`, ...Object.entries(byRule).sort().map(([r, v]) => `#   ${r}: 측정 ${v.n} / 위반 ${v.v}`), ''];
fs.writeFileSync(`${D}/fit/host-b-fit${suffix}.txt`, [...fitHead, ...fitLines].join('\n') + '\n');
fs.writeFileSync(`${D}/fit/host-b-symmetry${suffix}.txt`, [...symHead, ...symLines.filter((l) => l.startsWith('FAIL')), '', '# 전체 측정 로그', ...symLines].join('\n') + '\n');
console.log(`fit FAIL ${nFitFail}/${jobs.length}, sym 위반 ${nSymFail}`);
const cats = {};
for (const v of Object.values(fitFail)) for (const f of v) { const k = f.split(' ')[0]; cats[k] = (cats[k] || 0) + 1; }
console.log('fit 항목별', JSON.stringify(cats));
console.log('sym 규칙별', JSON.stringify(byRule));
