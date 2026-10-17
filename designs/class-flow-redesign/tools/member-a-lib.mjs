// member-a 측정 함수 — page.evaluate()로 직렬화되므로 외부 클로저를 쓰지 않는다.

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

  // 2) 잘림: 가로 넘침(모든 보이는 블록), 세로 넘침(칩·버튼)
  const clipped = [];
  for (const el of all) {
    if (el.matches('input,select')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline') continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !el.matches('.sh-scroll,.fl-root,.sh-root,.fl-layer')) clipped.push(lab(el) + ` w ${el.scrollWidth}>${el.clientWidth}`);
  }
  for (const el of document.querySelectorAll('button,.sh-chip,.fl-chip,.w-hchip,.fl-iconbtn,.w-hbtn,.w-msg,.w-hbox')) {
    if (!vis(el)) continue;
    if (el.scrollHeight > el.clientHeight + 1) clipped.push(lab(el) + ` h ${el.scrollHeight}>${el.clientHeight}`);
  }

  // 3) 이탈: 주요 박스는 뷰포트 안, 스크롤 영역 안 요소는 가로만
  const major = ['.fl-top', '.fl-body > .fl-col', '.fl-foot > .fl-col', '.w-sheet', '.sh-head', '.sh-tabbar', '.sh-side', '.w-foot'];
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

  // 4) 겹침: 컨테이너별 인접 자식 + 상단 바
  const inter = (a, c) => Math.max(0, Math.min(a.r, c.r) - Math.max(a.x, c.x)) * Math.max(0, Math.min(a.b, c.b) - Math.max(a.y, c.y));
  const overlaps = [];
  const groups = [
    ['.fl-layer', '.fl-layer > *'], ['.sh-main', '.sh-main > *'], ['.fl-top', '.fl-top > *, .fl-top .fl-top-l > *, .fl-top .fl-top-r > *'],
    ['.sh-head', '.sh-head > *'], ['.w-col', '.w-col > *'], ['.fl-col', '.fl-col > *'], ['.w-hc', '.w-hc > *'], ['.w-sheet', '.w-sheet > *'], ['.w-code-card', '.w-code-card > *'], ['.w-form', '.w-form > *'], ['.w-tc', '.w-tc > *'],
  ];
  for (const [cont, sel] of groups) for (const c of document.querySelectorAll(cont)) {
    const kids = [...c.querySelectorAll(sel)].filter((k) => vis(k) && (k.parentElement === c || k.parentElement.parentElement === c));
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

  // 6) 빈 영역: 내용이 박스의 35% 미만으로 채운 큰 박스
  const empties = [];
  for (const el of document.querySelectorAll('.sh-hero,.sh-card,.fl-card,.w-sheet,.w-msg,.w-info,.w-hbox')) {
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
  // 몰입형: 본문이 화면 중앙 영역을 실제로 차지하는지
  const body = document.querySelector('.fl-body');
  if (body && vis(body)) { const c = body.querySelector('.fl-col'); if (!c || c.getBoundingClientRect().height < 120) empties.push('fl-body (콘텐츠 없음)'); }

  // 7) 텍스트 grep: 이모지·글리프, 금지 용어, 영문 대문자 아이브로우
  const texts = document.body.innerText + '\n' + [...document.querySelectorAll('[aria-label],[placeholder],input')].map((e) => (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('placeholder') || '') + ' ' + (e.value || '')).join('\n');
  const glyph = (texts.match(/[←-⇿•‹›×○●✓✕✗✔]|\p{Extended_Pictographic}/gu) || []);
  const banned = [];
  for (const w of ['회원 전용', '초대 기반 입장', '초대받은 회원만', '초대한 회원만', '로그인한 계정으로 입장해요', '30일 보관', '관리자가 삭제를 지시하기 전까지', '동의하고 계속하기', '녹음과 AI 기록', '대기 그만하기', '대시보드로 이동', '6자리', 'LINK BAND 연결이 필요해요', '필수 클래스라', '회원이 LINK BAND를 연결해야', '알림 받음', '전달되지 않았어요', '발송 완료', '발송 실패', '수업', '세션', '참여하기', '오픈', '그래도 시작', '1:N', '게스트', '인증 코드', 'OTP', '인증 요청', 'QR', '참여 코드', '참여코드', '코드 복사', 'LINK BAND (필수)', '입장 전에 연결을 확인해요']) if (texts.includes(w)) banned.push(w);
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

  // 8) 내부 스크롤(셸 목록)
  const inner = scroller && vis(scroller) ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
  return {
    vw, vh, scrollH: se.scrollHeight, scrollW: se.scrollWidth, pageOk: se.scrollHeight <= vh && se.scrollWidth <= vw,
    small, clipped, outside, overlaps, small44, empties, glyph, banned, eyebrow, inner,
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

  const kind = document.querySelector('[data-kind]').dataset.kind;
  const sheet = R('.w-sheet');
  if (sheet) {
    // S5 시트 분기: 세로형은 바텀 시트(사이드 금지), 폭 ≤640, 좌우 여백 동일
    const side = sheet.w < vw * 0.6 && sheet.h > vh * 0.8;
    add('S5', `${vw < vh ? '세로형' : '가로형'} ${side ? '사이드 시트(위반)' : '바텀 시트'} 폭 ${f(sheet.w)}`, !side && sheet.w <= 642);
    add('S2', `바텀시트 좌${f(sheet.x)}/우${f(vw - sheet.r)}`, Math.abs(sheet.x - (vw - sheet.r)) <= 2);
    add('S1', `바텀시트 Δ${f(sheet.cx - vw / 2)}`, Math.abs(sheet.cx - vw / 2) <= 2);
    add('S9', `시트 폭 ${f(sheet.w)} ≤640`, sheet.w <= 642);
    const picks = RA('.w-pick'); if (picks.length > 1) add('S8', `선택 행 폭 ${picks.map((p) => f(p.w)).join('/')}`, Math.max(...picks.map((p) => p.w)) - Math.min(...picks.map((p) => p.w)) <= 2);
    for (const g of gapsOf('.w-sheet')) add('S10', `시트 ${g.a}→${g.b} ${f(g.g)}`, okGap(g.g));
  }

  if (kind === 'shell') {
    const main = R('.sh-main'), col = R('.w-col'), axis = main.cx;
    add('S1', `본문 컬럼 Δ${f(col.cx - axis)}`, Math.abs(col.cx - axis) <= 2);
    add('S2', `본문 컬럼 좌${f(col.x - main.x)}/우${f(main.r - col.r)}`, Math.abs((col.x - main.x) - (main.r - col.r)) <= 2);
    add('S9', `본문 컬럼 폭 ${f(col.w)} ≤640`, col.w <= 642);
    // S1/S8: 컬럼 직계 박스는 같은 폭·같은 중심
    const kids = [...document.querySelectorAll('.w-col > *')].filter(vis).map(box);
    if (kids.length) {
      add('S8', `컬럼 박스 폭 ${f(Math.min(...kids.map((k) => k.w)))}~${f(Math.max(...kids.map((k) => k.w)))}`, Math.max(...kids.map((k) => k.w)) - Math.min(...kids.map((k) => k.w)) <= 2);
      add('S1', `컬럼 박스 중심 최대 Δ${f(Math.max(...kids.map((k) => Math.abs(k.cx - axis))))}`, kids.every((k) => Math.abs(k.cx - axis) <= 2));
    }
    // S3 헤더: 좌우 바깥 여백 동일, 세로 중심 동일
    const head = R('.sh-head'), hk = [...document.querySelectorAll('.sh-head > *')].filter(vis).map(box);
    if (head && hk.length >= 2) {
      const l = hk[0].x - head.x, r = head.r - hk[hk.length - 1].r;
      add('S3', `헤더 여백 좌${f(l)}/우${f(r)} · 세로중심 차 ${f(Math.abs(hk[0].cy - hk[hk.length - 1].cy))}`, Math.abs(l - r) <= 2 && Math.abs(hk[0].cy - hk[hk.length - 1].cy) <= 2);
      if (hk.length === 3) {
        add('S3', `헤더 좌/우 요소 높이 ${f(hk[0].h)}/${f(hk[2].h)} · 제목 Δ${f(hk[1].cx - head.cx)}`, Math.abs(hk[0].h - hk[2].h) <= 2 && Math.abs(hk[1].cx - head.cx) <= 2);
      }
    }
    // S2/S6 탭바(모바일)
    const tab = R('.sh-tabbar');
    if (tab) {
      add('S2', `탭바 좌${f(tab.x - main.x)}/우${f(main.r - tab.r)}`, Math.abs((tab.x - main.x) - (main.r - tab.r)) <= 2);
      const it = RA('.sh-tabbar > a').sort((a, b) => a.x - b.x);
      const ws = it.map((i) => i.w), gaps = it.slice(1).map((i, n) => i.x - it[n].r);
      add('S6', `탭 ${it.length}개 폭 ${f(Math.min(...ws))}~${f(Math.max(...ws))} 간격 ${f(Math.min(...gaps))}~${f(Math.max(...gaps))}`, Math.max(...ws) - Math.min(...ws) <= 2 && Math.max(...gaps) - Math.min(...gaps) <= 2 && Math.abs((it[0].x - tab.x) - (tab.r - it[it.length - 1].r)) <= 2);
    }
    const foot = R('.w-foot .w-col');
    if (foot) {
      add('S1', `하단 CTA 컬럼 Δ${f(foot.cx - axis)}`, Math.abs(foot.cx - axis) <= 2);
      add('S8', `하단 CTA 폭 ${f(foot.w)} = 본문 ${f(col.w)}`, Math.abs(foot.w - col.w) <= 2);
      const fb = [...document.querySelectorAll('.w-foot .w-col > *')].filter(vis).map(box);
      add('S8', `하단 박스 폭 ${fb.map((b) => f(b.w)).join('/')}`, Math.max(...fb.map((b) => b.w)) - Math.min(...fb.map((b) => b.w)) <= 2);
    }
    // 준비물 격자 균등
    const pl = RA('.w-prep li');
    if (pl.length === 3) {
      const ws = pl.map((p) => p.w), hs = pl.map((p) => p.h);
      const wide = pl[1].x > pl[0].r - 1;
      add('S6', `준비물 ${wide ? '3열' : '1열'} 폭 ${f(Math.min(...ws))}~${f(Math.max(...ws))}`, wide ? Math.max(...ws) - Math.min(...ws) <= 2 && Math.abs((pl[1].x - pl[0].r) - (pl[2].x - pl[1].r)) <= 2 : Math.max(...ws) - Math.min(...ws) <= 2);
    }
    for (const sel of ['.w-col', '.w-foot .w-col', '.w-hc']) for (const g of gapsOf(sel)) add('S10', `${sel} ${g.a}→${g.b} ${f(g.g)}`, okGap(g.g));
  } else {
    const axis = vw / 2;
    const col = R('.fl-body > .fl-col'), body = R('.fl-body'), top = R('.fl-top'), fcol = R('.fl-foot > .fl-col');
    // S1/S2/S9
    add('S1', `본문 컬럼 Δ${f(col.cx - axis)}`, Math.abs(col.cx - axis) <= 2);
    add('S2', `본문 컬럼 좌${f(col.x)}/우${f(vw - col.r)}`, Math.abs(col.x - (vw - col.r)) <= 2);
    add('S9', `본문 컬럼 폭 ${f(col.w)} ≤640`, col.w <= 642);
    if (fcol) {
      add('S1', `하단 컬럼 Δ${f(fcol.cx - axis)}`, Math.abs(fcol.cx - axis) <= 2);
      add('S2', `하단 컬럼 좌${f(fcol.x)}/우${f(vw - fcol.r)}`, Math.abs(fcol.x - (vw - fcol.r)) <= 2);
      add('S8', `본문 폭 ${f(col.w)} = 하단 폭 ${f(fcol.w)}`, Math.abs(col.w - fcol.w) <= 2);
      const fb = [...document.querySelectorAll('.fl-foot > .fl-col > *')].filter(vis).map(box);
      add('S8', `하단 박스 폭 ${fb.map((b) => f(b.w)).join('/')}`, Math.max(...fb.map((b) => b.w)) - Math.min(...fb.map((b) => b.w)) <= 2);
    }
    const kids = [...document.querySelectorAll('.fl-body > .fl-col > *')].filter(vis).map(box);
    if (kids.length > 1) add('S8', `본문 박스 폭 ${kids.map((k) => f(k.w)).join('/')}`, Math.max(...kids.map((k) => k.w)) - Math.min(...kids.map((k) => k.w)) <= 2);
    add('S1', `본문 박스 중심 최대 Δ${f(Math.max(...kids.map((k) => Math.abs(k.cx - axis))))}`, kids.every((k) => Math.abs(k.cx - axis) <= 2));
    // 카드 안 단독 요소(로고·아이콘·코드칸)
    for (const [k, sel] of [['로고', '.w-logo.d'], ['아이콘', '.w-ic'], ['코드 칸', '.w-codewrap']]) { const b = R(sel); if (b) add('S1', `${k} Δ${f(b.cx - axis)}`, Math.abs(b.cx - axis) <= 2); }
    // S3 상단 바
    if (top) {
      const l = R('.fl-top-l > *'), r = R('.fl-top-r > *'), t = R('.fl-top-title');
      add('S3', `상단 바 여백 좌${f(l.x)}/우${f(vw - r.r)} · 높이 ${f(l.h)}/${f(r.h)} · 제목 Δ${f(t.cx - axis)}`, Math.abs(l.x - (vw - r.r)) <= 2 && Math.abs(l.h - r.h) <= 2 && Math.abs(t.cx - axis) <= 2);
    }
    // S6 균등 분배: 코드 칸·분할 버튼
    const cells = RA('.w-codebox > span');
    if (cells.length === 4) {
      const ws = cells.map((c) => c.w), gaps = cells.slice(1).map((c, n) => c.x - cells[n].r), wrap = R('.w-codewrap');
      add('S6', `코드 칸 폭 ${f(Math.min(...ws))}~${f(Math.max(...ws))} 간격 ${f(Math.min(...gaps))}~${f(Math.max(...gaps))} 안쪽 ${f(cells[0].x - wrap.x)}/${f(wrap.r - cells[3].r)}`, Math.max(...ws) - Math.min(...ws) <= 2 && Math.max(...gaps) - Math.min(...gaps) <= 2 && Math.abs((cells[0].x - wrap.x) - (wrap.r - cells[3].r)) <= 2);
    }
    const seg = RA('.fl-seg > button');
    if (seg.length === 3) add('S6', `성별 버튼 폭 ${seg.map((s) => f(s.w)).join('/')}`, Math.max(...seg.map((s) => s.w)) - Math.min(...seg.map((s) => s.w)) <= 2);
    // S7 본문 블록은 상단 바~하단 컬럼 사이 세로 중앙
    const topB = top ? top.b : 0, botB = fcol ? R('.fl-foot').y : vh;
    const dv = col.cy - (topB + botB) / 2, tol = (botB - topB) * 0.08 + 8;
    add('S7', `본문 중심 Δ${f(dv)} (허용 ±${f(tol)})`, Math.abs(dv) <= tol);
    // MS3 전체 화면 상태: 정중앙
    if (document.querySelector('[data-screen="FM10"]')) {
      const c = R('.w-tc'), dx = c.cx - vw / 2, dy = c.cy - vh / 2;
      add('MS3', `전체 화면 카드 Δx${f(dx)} Δy${f(dy)}`, Math.abs(dx) <= 2 && Math.abs(dy) <= 4);
    }
    for (const sel of ['.fl-body > .fl-col', '.fl-foot > .fl-col', '.w-code-card', '.w-tc', '.w-sum', '.w-who', '.w-opt']) for (const g of gapsOf(sel)) add('S10', `${sel} ${g.a}→${g.b} ${f(g.g)}`, okGap(g.g));
  }
  return checks;
}
