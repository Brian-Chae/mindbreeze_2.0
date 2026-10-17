// host-a 측정 공용 함수 — page.evaluate()로 직렬화되므로 외부 클로저를 쓰지 않는다.
export function measureFit() {
  const vw = innerWidth, vh = innerHeight, de = document.documentElement;
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const lab = (el) => (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : el.tagName.toLowerCase()) + ':' + (el.textContent || '').trim().slice(0, 10);
  const isScroller = (el) => { const o = getComputedStyle(el).overflowY; return o === 'auto' || o === 'scroll'; };
  const all = [...document.body.querySelectorAll('*')].filter((el) => el instanceof HTMLElement && !el.closest('svg') && vis(el));
  const out = {};
  out.scrollH = de.scrollHeight; out.vh = vh; out.scrollW = de.scrollWidth; out.vw = vw;
  out.scroll = (de.scrollHeight > vh || de.scrollWidth > vw) ? [de.scrollHeight + '/' + vh + ' ' + de.scrollWidth + '/' + vw] : [];
  // 11px 이하
  out.small = all.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) <= 11).map(lab);
  // 형제 겹침
  const overlap = [];
  for (const p of all) {
    const kids = [...p.children].filter((c) => c instanceof HTMLElement && vis(c) && getComputedStyle(c).position !== 'absolute' && getComputedStyle(c).position !== 'fixed');
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 1 && h > 1) overlap.push(lab(kids[i]) + '×' + lab(kids[j]));
    }
  }
  out.overlap = overlap;
  // 이탈: 뷰포트 밖 + 부모 밖(스크롤 영역 안의 세로 이탈은 허용)
  const outside = [];
  for (const el of all) {
    if (el.closest('.fl-banner') && false) continue;
    const r = el.getBoundingClientRect();
    let inScroll = false;
    for (let p = el.parentElement; p; p = p.parentElement) if (isScroller(p)) { inScroll = true; break; }
    if (r.left < -0.5 || r.right > vw + 0.5) outside.push('뷰포트가로 ' + lab(el));
    if (!inScroll && (r.top < -0.5 || r.bottom > vh + 0.5)) outside.push('뷰포트세로 ' + lab(el));
    const p = el.parentElement;
    if (p && p !== document.body && !isScroller(p) && getComputedStyle(el).position !== 'absolute' && getComputedStyle(el).position !== 'fixed') {
      const pr = p.getBoundingClientRect();
      if (r.right > pr.right + 1 || r.left < pr.left - 1) outside.push('부모가로 ' + lab(el));
      if (!inScroll && (r.bottom > pr.bottom + 1 || r.top < pr.top - 1) && getComputedStyle(p).overflow !== 'hidden') outside.push('부모세로 ' + lab(el));
    }
  }
  out.outside = [...new Set(outside)];
  // 잘림(내용이 박스보다 큼)
  const clip = [];
  for (const el of all) {
    if (el === document.body || el === de) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) clip.push('가로 ' + lab(el) + ' ' + el.scrollWidth + '>' + el.clientWidth);
    if (!isScroller(el) && el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0) clip.push('세로 ' + lab(el) + ' ' + el.scrollHeight + '>' + el.clientHeight);
  }
  out.clip = clip;
  // 터치
  out.touch = [...document.querySelectorAll('button, a, input, select, textarea')].filter(vis).filter((el) => { const r = el.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((el) => lab(el) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height));
  // 빈 영역
  const empty = [];
  for (const el of document.querySelectorAll('.fl-card, .sh-card, .sh-hero, .w-sheet, .w-qr, .w-next')) {
    if (!vis(el)) continue;
    const br = el.getBoundingClientRect();
    if (br.width * br.height < 3000) continue;
    const leaves = [...el.querySelectorAll('*')].filter((c) => vis(c) && (c.matches('svg,input,button') || [...c.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())));
    if (!leaves.length) { empty.push(lab(el) + ' 내용 없음'); continue; }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const c of leaves) { const r = c.getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
    const fx = (x1 - x0) / br.width, fy = (y1 - y0) / br.height;
    if (fx < 0.35 || fy < 0.35) empty.push(lab(el) + ' 채움 ' + Math.round(fx * 100) + '%×' + Math.round(fy * 100) + '%');
  }
  out.empty = empty;
  // 문자열 검사(보이는 텍스트 + placeholder·aria-label)
  const texts = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('svg')) continue;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) texts.push({ t: n.textContent.trim(), el });
    for (const a of ['placeholder', 'aria-label', 'value']) if (el.getAttribute && el.getAttribute(a)) texts.push({ t: el.getAttribute(a), el: null });
  }
  const glyph = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2022}\u{2023}\u{25A0}-\u{25FF}×✓✕←→‹›•●○]/u;
  const forbidden = /세션|수업|참여하기|오픈|그래도 시작|LB |1:N|QR|OTP|게스트|6자리|귀|회원 전용|초대 기반 입장|초대받은 회원만|초대한 회원만|로그인한 계정으로 입장|30일 보관|관리자가 삭제를 지시|동의하고 계속하기|대기 그만하기|대시보드로 이동|LINK BAND 연결이 필요|필수 클래스라|입장할 수 없어요|회원이 LINK BAND를 연결해야|알림 받음|전달되지 않았어요|발송 완료|발송 실패|정원 10 고정|그룹은 최대 10명/;
  out.glyph = texts.filter((x) => glyph.test(x.t)).map((x) => x.t.slice(0, 20));
  out.forbidden = texts.filter((x) => forbidden.test(x.t)).map((x) => x.t.slice(0, 20));
  out.eyebrow = texts.filter((x) => x.el && /^[A-Z][A-Z\s]{3,}$/.test(x.t) && !x.el.closest('.w-code, .w-codebig, .w-codebtn')).map((x) => x.t);
  out.scrollers = [...document.querySelectorAll('*')].filter((el) => el instanceof HTMLElement && vis(el) && isScroller(el) && el.scrollHeight > el.clientHeight + 1).map(lab);
  return out;
}

export function measureSym() {
  const vw = innerWidth, vh = innerHeight, checks = [];
  const add = (rule, val, pass) => checks.push({ rule, val, pass });
  const f = (n) => (Math.round(n * 10) / 10).toString();
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; };
  const Q1 = (sel) => { const el = [...document.querySelectorAll(sel)].find(vis); return el || null; };
  const QA = (sel) => [...document.querySelectorAll(sel)].filter(vis);
  const lab = (el) => (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : el.tagName.toLowerCase());
  // 내용 중심: 보이는 텍스트·아이콘·자식 상자의 합집합
  const contentBox = (el) => {
    let x0 = 1e9, x1 = -1e9;
    const walk = (n) => {
      if (n.nodeType === 3) {
        if (!n.textContent.trim()) return;
        const rg = document.createRange(); rg.selectNodeContents(n);
        const ls = parseFloat(getComputedStyle(n.parentElement).letterSpacing) || 0; // 마지막 글자 뒤 자간은 보이는 잉크가 아니다
        const rs = [...rg.getClientRects()];
        rs.forEach((r, i) => { x0 = Math.min(x0, r.left); x1 = Math.max(x1, r.right - (i === rs.length - 1 ? ls : 0)); });
        return;
      }
      if (n.nodeType !== 1) return;
      if (!vis(n) && n !== el) return;
      if (n.tagName === 'svg' || n.matches('input,button') || n.classList.contains('w-qr') || (n.tagName === 'I' && !n.childNodes.length)) { const r = n.getBoundingClientRect(); x0 = Math.min(x0, r.left); x1 = Math.max(x1, r.right); return; }
      for (const c of n.childNodes) walk(c);
    };
    walk(el);
    return { cx: (x0 + x1) / 2 };
  };

  const shell = !!Q1('.sh-root');
  const main = shell ? rect(Q1('.sh-main')) : { x: 0, r: vw, w: vw, cx: vw / 2, y: 0, b: vh, h: vh };
  const axis = main.cx, regL = main.x, regR = main.r;
  const sheetEl = Q1('.w-sheet');

  if (shell) {
    const page = Q1('.w-page');
    const pg = page ? rect(page) : null;
    if (pg) {
      add('S1', `본문 컬럼 Δ${f(pg.cx - axis)}`, Math.abs(pg.cx - axis) <= 2);
      const l = pg.x - regL, r = regR - pg.r;
      add('S2', `본문 컬럼 좌${f(l)}/우${f(r)}`, Math.abs(l - r) <= 2);
      add('S9', `본문 컬럼 폭 ${f(pg.w)} ≤640`, pg.w <= 642);
    }
    for (const el of QA('.w-live, .w-tabs, .w-detail-hero, .w-empty .sh-card, .sh-card')) {
      const r = rect(el); if (!pg) continue;
      if (el.closest('.w-list')) continue;
      add('S1', `${lab(el)} Δ${f(r.cx - axis)}`, Math.abs(r.cx - axis) <= 2);
    }
    const hr = Q1('.w-headrow');
    if (hr && pg) {
      const kids = [...hr.children].filter(vis); const a = rect(kids[0]), b = rect(kids[kids.length - 1]);
      if (kids.length > 1) add('S3', `머리줄 좌${f(a.x - pg.x)}/우${f(pg.r - b.r)}`, Math.abs((a.x - pg.x) - (pg.r - b.r)) <= 2);
    }
    const tb = Q1('.sh-tabbar');
    if (tb) { const it = [...tb.children].filter(vis).map(rect); const ws = it.map((i) => i.w); add('S6', `탭바 ${it.length}항목 폭 ${f(Math.min(...ws))}~${f(Math.max(...ws))}`, Math.max(...ws) - Math.min(...ws) <= 2); }
    const emp = Q1('.w-empty .sh-card'), ew = Q1('.w-empty');
    if (emp && ew) { const e = rect(emp), w = rect(ew); const dv = e.cy - w.cy; add('S7', `빈 상태 카드 Δy${f(dv)}`, Math.abs(dv) <= w.h * 0.08); }
  } else {
    const col = Q1('.fl-body .fl-col'), body = Q1('.fl-body'), foot = Q1('.fl-foot .fl-col');
    const top = Q1('.fl-top');
    if (top) {
      const l = document.querySelector('.fl-top-l > *'), r = document.querySelector('.fl-top-r > *');
      const a = rect(l), b = rect(r);
      add('S3', `상단 바 여백 좌${f(a.x)}/우${f(vw - b.r)} · 높이 ${f(a.h)}/${f(b.h)}`, Math.abs(a.x - (vw - b.r)) <= 2 && Math.abs(a.h - b.h) <= 2);
      const t = rect(Q1('.fl-top-title'));
      add('S1', `상단 제목 Δ${f(t.cx - axis)}`, Math.abs(t.cx - axis) <= 2);
    }
    for (const el of QA('.fl-steps, .w-solo')) { const c = contentBox(el); add('S1', `${lab(el)} Δ${f(c.cx - axis)}`, Math.abs(c.cx - axis) <= 2); }
    for (const [k, el] of [['본문 컬럼', col], ['하단 컬럼', foot]]) if (el) {
      const r = rect(el); add('S1', `${k} Δ${f(r.cx - axis)}`, Math.abs(r.cx - axis) <= 2);
      add('S2', `${k} 좌${f(r.x)}/우${f(vw - r.r)}`, Math.abs(r.x - (vw - r.r)) <= 2);
      add('S9', `${k} 폭 ${f(r.w)} ≤640`, r.w <= 642);
    }
    for (const el of QA('.fl-card')) { const r = rect(el); add('S1', `카드 Δ${f(r.cx - axis)}`, Math.abs(r.cx - axis) <= 2); add('S9', `카드 폭 ${f(r.w)} ≤640`, r.w <= 642); }
    if (col && body) {
      const c = rect(col), b = rect(body), tg = c.y - b.y, bg = b.b - c.b;
      add('S7', `본문 위${f(tg)}/아래${f(bg)}`, Math.abs(tg - bg) <= b.h * 0.08);
    }
  }
  // 배너
  for (const el of QA('.fl-banner')) { const r = rect(el); add('S1', `배너 Δ${f(r.cx - axis)}`, Math.abs(r.cx - axis) <= 2); add('S8', `배너 폭 ${f(r.w)} ≤480`, r.w <= 482); const l = r.x - regL, rr = regR - r.r; add('S2', `배너 좌${f(l)}/우${f(rr)}`, Math.abs(l - rr) <= 2); }
  // 시트
  if (sheetEl) {
    const s = rect(sheetEl), side = Math.abs(vh - s.b) > 1;
    if (vw < vh) { add('S5', side ? '세로형인데 사이드 시트' : '세로형 바텀 시트', !side); } else add('S5', `가로형 ${side ? '사이드' : '바텀'} 시트`, true);
    if (!side) { add('S2', `바텀 시트 좌${f(s.x)}/우${f(vw - s.r)}`, Math.abs(s.x - (vw - s.r)) <= 2); add('S1', `바텀 시트 Δ${f(s.cx - vw / 2)}`, Math.abs(s.cx - vw / 2) <= 2); add('S9', `바텀 시트 폭 ${f(s.w)} ≤640`, s.w <= 642); add('S5', `바텀 시트 하단 붙음 ${f(vh - s.b)}`, Math.abs(vh - s.b) <= 1); }
    else { add('S2', `사이드 시트 상${f(s.y)}/하${f(vh - s.b)}`, Math.abs(s.y - (vh - s.b)) <= 2); add('S5', `사이드 시트 우측 여백 ${f(vw - s.r)}`, Math.abs(vw - s.r - s.y) <= 2); }
  }
  // S6 균등 분배
  for (const el of QA('.fl-seg, .w-btnrow, .w-ghostrow, .w-tabs, .w-sfoot, .w-live-act .row2, .w-days')) {
    const it = [...el.children].filter(vis).map(rect).sort((a, b) => a.x - b.x || a.y - b.y);
    if (it.length < 2) continue;
    // 같은 행끼리만
    const rows = []; for (const i of it) { const row = rows.find((r) => Math.abs(r[0].y - i.y) < 4); if (row) row.push(i); else rows.push([i]); }
    const box = rect(el);
    for (const row of rows) {
      if (row.length < 2) continue;
      const ws = row.map((i) => i.w), gaps = row.slice(1).map((i, n) => i.x - row[n].r);
      const inL = row[0].x - box.x, inR = box.r - row[row.length - 1].r;
      const ok = Math.max(...ws) - Math.min(...ws) <= 2 && Math.max(...gaps) - Math.min(...gaps) <= 2 && Math.abs(inL - inR) <= 2;
      add('S6', `${lab(el)} ${row.length}항목 폭${f(Math.min(...ws))}~${f(Math.max(...ws))} 간격${f(Math.min(...gaps))}~${f(Math.max(...gaps))} 안쪽${f(inL)}/${f(inR)}`, ok);
    }
  }
  // S8 같은 부모 안의 같은 종류 박스 폭
  for (const p of QA('.w-form, .w-group, .w-card, .w-page')) {
    const kids = [...p.children].filter((c) => vis(c) && c.matches('.fl-row, .w-info, .w-note, .fl-input, .w-inwrap, .w-stepper, .w-prow, .w-form, .w-group, .fl-seg, .w-pchips, .w-count, .w-btnrow, .sh-card, .sh-hero, .w-live, .w-tabs, .w-list')).map(rect);
    if (kids.length < 2) continue;
    const ws = kids.map((k) => k.w);
    add('S8', `${lab(p)} 자식 ${kids.length}개 폭 ${f(Math.min(...ws))}~${f(Math.max(...ws))}`, Math.max(...ws) - Math.min(...ws) <= 2);
  }
  // S10 수직 간격
  const okSet = (g) => [0, 8, 16, 24, 32, 40, 48].some((s) => Math.abs(g - s) <= 1);
  for (const p of QA('.fl-col, .w-form, .w-group, .w-card, .w-page, .w-live-main, .w-live-act, .w-list, .w-detail-hero, .w-sbody, .w-sheet')) {
    const kids = [...p.children].filter((c) => vis(c) && getComputedStyle(c).position !== 'absolute').map(rect).sort((a, b) => a.y - b.y);
    if (kids.length < 2) continue;
    const gaps = kids.slice(1).map((k, i) => k.y - kids[i].b).filter((g) => g > -1);
    const flexRow = getComputedStyle(p).flexDirection === 'row';
    if (flexRow) continue;
    if (!gaps.length) continue;
    add('S10', `${lab(p)} 간격 ${[...new Set(gaps.map((g) => Math.round(g)))].join('/')}`, gaps.every((g) => okSet(g) && g > 0.5));
  }
  return checks;
}
