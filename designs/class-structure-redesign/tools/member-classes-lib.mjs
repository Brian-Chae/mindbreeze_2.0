// member-classes 측정 함수 — page.evaluate()로 직렬화되므로 외부 클로저를 쓰지 않는다.
// (class-flow-redesign/tools/member-a-lib.mjs 를 복사해 member-classes 화면 구조에 맞게 수정)

export function fitMeasure() {
  const vw = innerWidth, vh = innerHeight, se = document.scrollingElement;
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const lab = (el) => (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : el.tagName.toLowerCase()) + ':' + (el.textContent || '').trim().slice(0, 12);
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const hasText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const all = [...document.body.querySelectorAll('*')].filter((el) => !el.closest('svg') && vis(el));

  // 1) 11px 이하
  const small = [];
  for (const el of all) {
    const isCtl = el.matches('input,select,textarea');
    if (!hasText(el) && !isCtl) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs <= 11) small.push(lab(el) + ` ${fs}px`);
  }

  // 2) 잘림
  const clipped = [];
  for (const el of all) {
    if (el.matches('input,select')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline') continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !el.matches('.sh-scroll,.fl-root,.sh-root,.fl-layer')) clipped.push(lab(el) + ` w ${el.scrollWidth}>${el.clientWidth}`);
  }
  for (const el of document.querySelectorAll('button,.sh-chip,.fl-chip,.w-hchip,.fl-iconbtn,.w-hbtn,.w-hbox,.w-fc')) {
    if (!vis(el)) continue;
    if (el.scrollHeight > el.clientHeight + 1) clipped.push(lab(el) + ` h ${el.scrollHeight}>${el.clientHeight}`);
  }

  // 3) 이탈
  const major = ['.fl-top', '.fl-body > .fl-col', '.fl-foot > .fl-col', '.w-sheet', '.sh-head', '.sh-tabbar', '.sh-side'];
  const outside = [];
  for (const sel of major) for (const el of document.querySelectorAll(sel)) {
    if (!vis(el)) continue;
    const b = rect(el);
    if (b.x < -0.5 || b.y < -0.5 || b.r > vw + 0.5 || b.b > vh + 0.5) outside.push(sel + ` (${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.r)},${Math.round(b.b)})`);
  }
  const scroller = document.querySelector('.sh-scroll');
  if (scroller && vis(scroller)) {
    const sr = rect(scroller);
    for (const el of scroller.querySelectorAll('*')) {
      if (el.closest('svg') || !vis(el)) continue;
      const b = rect(el);
      if (b.x < sr.x - 0.5 || b.r > sr.r + 0.5) outside.push('scroll:' + lab(el) + ` x ${Math.round(b.x)}..${Math.round(b.r)} / ${Math.round(sr.x)}..${Math.round(sr.r)}`);
    }
  }

  // 4) 겹침
  const inter = (a, c) => Math.max(0, Math.min(a.r, c.r) - Math.max(a.x, c.x)) * Math.max(0, Math.min(a.b, c.b) - Math.max(a.y, c.y));
  const overlaps = [];
  const groups = [
    ['.fl-layer', '.fl-layer > *'], ['.sh-main', '.sh-main > *'], ['.fl-top', '.fl-top > *'],
    ['.sh-head', '.sh-head > *'], ['.w-col', '.w-col > *'], ['.fl-col', '.fl-col > *'], ['.w-hc', '.w-hc > *'], ['.w-sheet', '.w-sheet > *'],
    ['.w-tc', '.w-tc > *'], ['.w-cclink', '.w-cclink > *'], ['.w-cc', '.w-cc > *'], ['.w-next', '.w-next > *'], ['.w-tmain', '.w-tmain > *'],
    ['.w-ttop', '.w-ttop > *'], ['.w-trow', '.w-trow > *'], ['.w-story', '.w-story > *'], ['.w-mxcard', '.w-mxcard > *'], ['.w-empty', '.w-empty > *'],
    ['.w-tiles', '.w-tiles > *'], ['.w-nt', '.w-nt > *'], ['.w-row', '.w-row > *'], ['.w-ban', '.w-ban > *'], ['.w-mx', '.w-mx > *'], ['.w-cmp', '.w-cmp > *'],
  ];
  for (const [cont, sel] of groups) for (const c of document.querySelectorAll(cont)) {
    const kids = [...c.querySelectorAll(sel)].filter((k) => vis(k) && k.parentElement === c);
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      if (kids[i].contains(kids[j]) || kids[j].contains(kids[i])) continue;
      const a = inter(rect(kids[i]), rect(kids[j]));
      if (a > 1) overlaps.push(`${cont}: ${lab(kids[i])} x ${lab(kids[j])} (${Math.round(a)}px2)`);
    }
  }

  // 5) 터치 ≥44
  const small44 = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, [role=radio]')) {
    if (!vis(el)) continue;
    const b = rect(el);
    if (b.h < 43.5 || b.w < 43.5) small44.push(lab(el) + ` ${Math.round(b.w)}x${Math.round(b.h)}`);
  }

  // 6) 빈 영역
  const empties = [];
  for (const el of document.querySelectorAll('.sh-hero,.sh-card,.fl-card,.w-sheet,.w-info,.w-hbox,.w-ban,.w-tile')) {
    if (!vis(el)) continue;
    const br = rect(el);
    if (br.w * br.h < 3000) continue;
    const leaves = [...el.querySelectorAll('*')].filter((c) => vis(c) && (c.matches('svg,input,select,button') || hasText(c)));
    if (!leaves.length) { empties.push(lab(el) + ' (내용 없음)'); continue; }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const c of leaves) { const r = c.getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
    const fx = (x1 - x0) / br.w, fy = (y1 - y0) / br.h;
    if (fx < 0.35 || fy < 0.35) empties.push(lab(el) + ` (채움 ${Math.round(fx * 100)}%x${Math.round(fy * 100)}%)`);
  }
  const body = document.querySelector('.fl-body');
  if (body && vis(body)) { const c = body.querySelector('.fl-col'); if (!c || c.getBoundingClientRect().height < 120) empties.push('fl-body (콘텐츠 없음)'); }

  // 7) 텍스트 grep
  const texts = document.body.innerText + '\n' + [...document.querySelectorAll('[aria-label],[placeholder],input')].map((e) => (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('placeholder') || '') + ' ' + (e.value || '')).join('\n');
  const glyph = (texts.match(/[←-⇿•‹›×○●✓✕✗✔]|\p{Extended_Pictographic}/gu) || []);
  const banned = [];
  for (const w of ['수업', '세션', '참여하기', '오픈', '그래도 시작', '1:N', '게스트', '호스트', '강사', '점수', '순위', '평균', '종합', '등급', '%', '개선', '악화', '정원', '대기열', '들이쉬', '내쉬', '들이마', '함께 호흡']) if (texts.includes(w)) banned.push(w);
  if (/(^|[^A-Za-z])LB /.test(texts)) banned.push('LB ');
  const eyebrow = [];
  for (const el of all) {
    const cs = getComputedStyle(el);
    for (const n of el.childNodes) {
      if (n.nodeType !== 3) continue;
      const t = n.textContent.trim();
      if (/^[A-Z][A-Z0-9 .&\-]{3,}$/.test(t) && (t.match(/[A-Z]/g) || []).length >= 4) eyebrow.push(t);
      if (cs.textTransform === 'uppercase' && /[A-Za-z]/.test(t)) eyebrow.push('uppercase:' + t);
    }
  }

  // 8) 내부 스크롤 + 히어로 CTA 첫 화면 노출
  const inner = scroller && vis(scroller) ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
  const fold = [];
  const scr = (document.querySelector('[data-screen]') || {}).dataset ? document.querySelector('[data-screen]').dataset.screen : '';
  if ((scr === 'MC01' || scr === 'MC05') && scroller && vis(scroller)) {
    const cta = [...document.querySelectorAll('.w-hcta')].find(vis);
    if (cta && cta.getBoundingClientRect().bottom > scroller.getBoundingClientRect().bottom + 0.5) fold.push('히어로 CTA 가 첫 화면 밖 (' + Math.round(cta.getBoundingClientRect().bottom) + '>' + Math.round(scroller.getBoundingClientRect().bottom) + ')');
  }
  return {
    vw, vh, scrollH: se.scrollHeight, scrollW: se.scrollWidth, pageOk: se.scrollHeight <= vh && se.scrollWidth <= vw,
    small, clipped, outside, overlaps, small44, empties, glyph, banned, eyebrow, inner, fold,
  };
}

export function symMeasure() {
  const vw = innerWidth, vh = innerHeight, checks = [];
  const add = (rule, val, pass) => checks.push({ rule, val, pass });
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; };
  const R = (sel) => { const el = [...document.querySelectorAll(sel)].find(vis); return el ? box(el) : null; };
  const RA = (sel) => [...document.querySelectorAll(sel)].filter(vis).map(box);
  const f = (n) => (Math.round(n * 10) / 10).toString();
  const lab = (el) => (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : el.tagName.toLowerCase());
  const OK = [8, 16, 24, 32, 40, 48];
  const okGap = (g) => OK.some((s) => Math.abs(g - s) <= 1);
  const gapsOf = (sel) => {
    const out = [];
    for (const c of document.querySelectorAll(sel)) {
      if (!vis(c)) continue;
      const kids = [...c.children].filter((k) => vis(k) && getComputedStyle(k).position !== 'absolute').sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      for (let i = 1; i < kids.length; i++) out.push({ g: kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom, a: lab(kids[i - 1]), b: lab(kids[i]) });
    }
    return out;
  };
  const same = (arr, tol = 2) => arr.length < 2 || Math.max(...arr) - Math.min(...arr) <= tol;

  const kind = document.querySelector('[data-kind]').dataset.kind;
  const sheet = R('.w-sheet');
  if (sheet) {
    const side = sheet.w < vw * 0.6 && sheet.h > vh * 0.8;
    add('S5', `${vw < vh ? '세로형' : '가로형'} ${side ? '사이드 시트(위반)' : '바텀 시트'} 폭 ${f(sheet.w)}`, !side && sheet.w <= 642);
    add('S2', `바텀시트 좌${f(sheet.x)}/우${f(vw - sheet.r)}`, Math.abs(sheet.x - (vw - sheet.r)) <= 2);
    add('S1', `바텀시트 Δ${f(sheet.cx - vw / 2)}`, Math.abs(sheet.cx - vw / 2) <= 2);
    add('S9', `시트 폭 ${f(sheet.w)} ≤640`, sheet.w <= 642);
    const picks = RA('.w-pick'); if (picks.length > 1) add('S8', `선택 행 폭 ${picks.map((p) => f(p.w)).join('/')}`, same(picks.map((p) => p.w)));
    for (const g of gapsOf('.w-sheet')) add('S10', `시트 ${g.a}→${g.b} ${f(g.g)}`, okGap(g.g));
  }

  if (kind === 'shell') {
    const main = R('.sh-main'), col = R('.w-col'), axis = main.cx;
    add('S1', `본문 컬럼 Δ${f(col.cx - axis)}`, Math.abs(col.cx - axis) <= 2);
    add('S2', `본문 컬럼 좌${f(col.x - main.x)}/우${f(main.r - col.r)}`, Math.abs((col.x - main.x) - (main.r - col.r)) <= 2);
    add('S9', `본문 컬럼 폭 ${f(col.w)} ≤640`, col.w <= 642);
    const kids = [...document.querySelectorAll('.w-col > *')].filter(vis).map(box);
    if (kids.length) {
      add('S8', `컬럼 박스 폭 ${f(Math.min(...kids.map((k) => k.w)))}~${f(Math.max(...kids.map((k) => k.w)))}`, same(kids.map((k) => k.w)));
      add('S1', `컬럼 박스 중심 최대 Δ${f(Math.max(...kids.map((k) => Math.abs(k.cx - axis))))}`, kids.every((k) => Math.abs(k.cx - axis) <= 2));
    }
    const head = R('.sh-head'), hk = [...document.querySelectorAll('.sh-head > *')].filter(vis).map(box);
    if (head && hk.length >= 2) {
      const l = hk[0].x - head.x, r = head.r - hk[hk.length - 1].r;
      add('S3', `헤더 여백 좌${f(l)}/우${f(r)} · 세로중심 차 ${f(Math.abs(hk[0].cy - hk[hk.length - 1].cy))}`, Math.abs(l - r) <= 2 && Math.abs(hk[0].cy - hk[hk.length - 1].cy) <= 2);
      if (hk.length === 3) add('S3', `헤더 좌/우 요소 높이 ${f(hk[0].h)}/${f(hk[2].h)} · 제목 Δ${f(hk[1].cx - head.cx)}`, Math.abs(hk[0].h - hk[2].h) <= 2 && Math.abs(hk[1].cx - head.cx) <= 2);
    }
    const tab = R('.sh-tabbar');
    if (tab) {
      add('S2', `탭바 좌${f(tab.x - main.x)}/우${f(main.r - tab.r)}`, Math.abs((tab.x - main.x) - (main.r - tab.r)) <= 2);
      const it = RA('.sh-tabbar > a').sort((a, b) => a.x - b.x);
      const ws = it.map((i) => i.w), gaps = it.slice(1).map((i, n) => i.x - it[n].r);
      add('S6', `탭 ${it.length}개 폭 ${f(Math.min(...ws))}~${f(Math.max(...ws))} 간격 ${f(Math.min(...gaps))}~${f(Math.max(...gaps))}`, same(ws) && same(gaps) && Math.abs((it[0].x - tab.x) - (tab.r - it[it.length - 1].r)) <= 2);
    }
    // 사이드바 항목 균등
    const nav = RA('.w-nav a');
    if (nav.length) add('S6', `사이드바 ${nav.length}개 폭 ${f(Math.min(...nav.map((n) => n.w)))}~${f(Math.max(...nav.map((n) => n.w)))} 높이 ${f(Math.min(...nav.map((n) => n.h)))}~${f(Math.max(...nav.map((n) => n.h)))}`, same(nav.map((n) => n.w)) && same(nav.map((n) => n.h)));
    // 3열 요약 타일
    for (const t of document.querySelectorAll('.w-tiles')) {
      if (!vis(t)) continue;
      const ts = [...t.children].filter(vis).map(box), tb = box(t);
      add('S6', `요약 타일 폭 ${ts.map((x) => f(x.w)).join('/')} 높이 ${ts.map((x) => f(x.h)).join('/')}`, same(ts.map((x) => x.w)) && same(ts.map((x) => x.h)) && Math.abs((ts[0].x - tb.x) - (tb.r - ts[ts.length - 1].r)) <= 2);
    }
    // 진행 막대 칸 균등
    for (const sg of document.querySelectorAll('.w-seg')) {
      if (!vis(sg)) continue;
      const cs = [...sg.children].map(box);
      add('S6', `진행 막대 ${cs.length}칸 폭 ${f(Math.min(...cs.map((c) => c.w)))}~${f(Math.max(...cs.map((c) => c.w)))}`, same(cs.map((c) => c.w)));
    }
    // 흐름 띠: 열 폭 균등 · 행 높이 균등
    for (const m of document.querySelectorAll('.w-mx')) {
      if (!vis(m)) continue;
      const hd = [...m.querySelectorAll(':scope > .hd')].map(box);
      add('S6', `흐름 띠 ${hd.length}열 폭 ${f(Math.min(...hd.map((c) => c.w)))}~${f(Math.max(...hd.map((c) => c.w)))}`, same(hd.map((c) => c.w)));
      const cells = [...m.querySelectorAll(':scope > .w-fc')].map(box);
      add('S6', `흐름 띠 칸 크기 ${f(Math.min(...cells.map((c) => c.w)))}x${f(Math.min(...cells.map((c) => c.h)))}~${f(Math.max(...cells.map((c) => c.w)))}x${f(Math.max(...cells.map((c) => c.h)))}`, same(cells.map((c) => c.w)) && same(cells.map((c) => c.h)));
    }
    for (const sel of ['.w-col', '.w-hc', '.w-cc', '.w-cclink', '.w-next', '.w-tmain', '.w-story', '.w-mxcard', '.w-empty']) for (const g of gapsOf(sel)) add('S10', `${sel} ${g.a}→${g.b} ${f(g.g)}`, okGap(g.g));
  } else {
    const axis = vw / 2;
    const col = R('.fl-body > .fl-col'), body = R('.fl-body');
    add('S1', `본문 컬럼 Δ${f(col.cx - axis)}`, Math.abs(col.cx - axis) <= 2);
    add('S2', `본문 컬럼 좌${f(col.x)}/우${f(vw - col.r)}`, Math.abs(col.x - (vw - col.r)) <= 2);
    add('S9', `본문 컬럼 폭 ${f(col.w)} ≤640`, col.w <= 642);
    const kids = [...document.querySelectorAll('.fl-body > .fl-col > *')].filter(vis).map(box);
    add('S1', `본문 박스 중심 최대 Δ${f(Math.max(...kids.map((k) => Math.abs(k.cx - axis))))}`, kids.every((k) => Math.abs(k.cx - axis) <= 2));
    for (const [k, sel] of [['로고', '.w-logo.d'], ['아이콘', '.w-ic']]) { const b = R(sel); if (b) add('S1', `${k} Δ${f(b.cx - axis)}`, Math.abs(b.cx - axis) <= 2); }
    const c = R('.w-tc'), dx = c.cx - vw / 2, dy = c.cy - vh / 2;
    add('MS3', `전체 화면 카드 Δx${f(dx)} Δy${f(dy)}`, Math.abs(dx) <= 2 && Math.abs(dy) <= 4);
    for (const sel of ['.fl-body > .fl-col', '.w-tc']) for (const g of gapsOf(sel)) add('S10', `${sel} ${g.a}→${g.b} ${f(g.g)}`, okGap(g.g));
  }
  return checks;
}
