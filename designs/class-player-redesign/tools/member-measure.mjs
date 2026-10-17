// 회원 시안 공용 측정 함수 — page.evaluate()로 직렬화되므로 외부 클로저를 쓰지 않는다.
export function measure() {
  const vw = innerWidth, vh = innerHeight, de = document.documentElement;
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const rects = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; });
  const label = (el) => (el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ':' + (el.textContent || '').trim().slice(0, 14);

  // 11px 이하 텍스트
  let small = 0; const smallList = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (parseFloat(getComputedStyle(el).fontSize) <= 11) { small++; smallList.push(label(el)); }
  }

  // 텍스트 잘림: 가로(nowrap 요소) + 세로(카드류)
  const clipped = [];
  const hSel = '.tp-title,.guide,.dk .lb,.m-label,.off-title,.off-sub,.mcell .ml,.trend-label,.trend-change,.conn .txt,.sig b,.sig span,.now b,.pill-btn,.mbtn,.chip-btn,.info-card .tx p,.info-card .tx b,.empty-card p,.empty-card h3,.stat b,.note,.dev-top b,.dev-top .tx span,.sig-hint,.grp-tag,.banner,.side-row .tx b,.side-row .tx p,.net-down p,.net-down h3,.fv-card h2,.fv-card p,.fv-info div';
  for (const el of document.body.querySelectorAll(hSel)) {
    if (!vis(el) || getComputedStyle(el).display === 'inline') continue;
    if (el.scrollWidth > el.clientWidth + 1) clipped.push(label(el) + ` (${el.scrollWidth}>${el.clientWidth})`);
  }
  for (const el of document.body.querySelectorAll('.guide,.info-card,.mbtn,.net-down,.fv-card,.side-card,.mypip,.pip,.banner,.dock,.media-row,.conn')) {
    if (!vis(el)) continue;
    if (el.scrollHeight > el.clientHeight + 1) clipped.push(label(el) + ` (h ${el.scrollHeight}>${el.clientHeight})`);
  }
  // 링 코어 안에서 텍스트가 원 밖으로 나가는지
  const core = document.querySelector('.core');
  if (core && vis(core)) {
    const cr = core.getBoundingClientRect(), cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2, rad = cr.width / 2;
    for (const el of core.querySelectorAll('.core-ic,.m-label,.m-num,.off-title,.off-sub,.dots')) {
      if (!vis(el)) continue;
      const rg = document.createRange(); rg.selectNodeContents(el);
      for (const r of rg.getClientRects()) {
        for (const [px, py] of [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]) {
          if (Math.hypot(px - cx, py - cy) > rad - 3) { clipped.push('core:' + label(el)); break; }
        }
      }
    }
  }

  // 주요 박스
  const named = {
    leave: '.topbar > .circle-btn', title: '.title-pill', conn: '.conn', banner: '.banner', pip: '.pip', mypip: '.mypip', ring: '.ring',
    guide: '.guide', trend: '.trend', info: '.stack .info-card', netdown: '.net-down', side: '.hero-side', media: '.media-row', dock: '.dock',
    sheet: '.sheet', fv: '.fv-card',
  };
  const boxes = {};
  for (const [k, sel] of Object.entries(named)) { const r = rects(sel); if (r.length) boxes[k] = r[0]; }
  const outside = Object.entries(boxes).filter(([, b]) => b.x < -0.5 || b.y < -0.5 || b.r > vw + 0.5 || b.b > vh + 0.5).map(([k]) => k);
  const grow = (b, g) => ({ x: b.x - g, y: b.y - g, r: b.r + g, b: b.b + g });
  const inter = (a, c) => Math.max(0, Math.min(a.r, c.r) - Math.max(a.x, c.x)) * Math.max(0, Math.min(a.b, c.b) - Math.max(a.y, c.y));
  const names = Object.keys(boxes), overlaps = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = boxes[names[i]], c = boxes[names[j]];
    const ga = names[i] === 'ring' ? grow(a, a.w * 0.03) : a, gc = names[j] === 'ring' ? grow(c, c.w * 0.03) : c;
    const area = inter(ga, gc);
    if (area > 1) overlaps.push(`${names[i]}×${names[j]}(${Math.round(area)}px²)`);
  }

  // 시트 내부 넘침
  const sheetOverflow = [];
  const sh = document.querySelector('.sheet');
  if (sh && vis(sh)) {
    if (sh.scrollHeight > sh.clientHeight + 1) sheetOverflow.push(`sheet ${sh.scrollHeight}>${sh.clientHeight}`);
    const pn = [...document.querySelectorAll('.panel')].find(vis);
    if (pn && pn.scrollHeight > pn.clientHeight + 1 && !pn.querySelector('.msgs')) sheetOverflow.push(`panel ${pn.scrollHeight}>${pn.clientHeight}`);
  }

  // 빈 영역: 콘텐츠 없는 큰 박스 (내용 bbox가 박스의 35% 미만이거나 텍스트·아이콘이 없음)
  const empties = [];
  for (const el of document.querySelectorAll('.sheet,.trend,.stack .info-card,.net-down,.side-card,.fv-card,.core,.mypip,.pip,.dock,.media-row,.banner')) {
    if (!vis(el)) continue;
    const br = el.getBoundingClientRect();
    if (br.width * br.height < 3000) continue;
    const leaves = [...el.querySelectorAll('*')].filter((c) => vis(c) && (c.matches('svg,input,button,i.dot,.end') || [...c.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())));
    if (!leaves.length) { empties.push(label(el) + ' (내용 없음)'); continue; }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const c of leaves) { const r = c.getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
    const fx = (x1 - x0) / br.width, fy = (y1 - y0) / br.height;
    const isChat = !!el.querySelector('.msgs');
    if (!isChat && !el.matches('.core') && (fx < 0.35 || fy < 0.35)) empties.push(label(el) + ` (채움 ${Math.round(fx * 100)}%×${Math.round(fy * 100)}%)`);
  }
  // 무대(stage)에 보이는 콘텐츠가 있는지
  const stage = document.querySelector('.stage');
  if (stage && vis(stage)) {
    const any = ['.ring', '.net-down'].some((s) => rects(s).length);
    if (!any) empties.push('stage (히어로 없음)');
  }

  // 배경 노출률: 시트·도크·미디어·상단 필·카드·PiP가 가린 면적 제외
  const cov = document.createElement('canvas'); cov.width = vw; cov.height = vh;
  const g = cov.getContext('2d'); g.fillStyle = '#000';
  for (const k of ['leave', 'title', 'conn', 'banner', 'pip', 'mypip', 'guide', 'trend', 'info', 'netdown', 'side', 'media', 'dock', 'sheet', 'fv']) { const b = boxes[k]; if (b) g.fillRect(b.x, b.y, b.w, b.h); }
  const d = g.getImageData(0, 0, vw, vh).data; let covered = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) covered++;

  // 터치 타깃
  const small44 = [];
  for (const el of document.querySelectorAll('button, input[type=range], .switch')) {
    if (!vis(el)) continue;
    const wrap = el.classList.contains('switch') ? el.parentElement.getBoundingClientRect() : el.getBoundingClientRect();
    if (wrap.height < 43.5 || wrap.width < 43.5) small44.push(label(el) + ' ' + Math.round(wrap.width) + 'x' + Math.round(wrap.height));
  }
  return {
    vw, vh, scrollH: de.scrollHeight, scrollW: de.scrollWidth, ok: de.scrollHeight <= vh && de.scrollWidth <= vw,
    small, smallList, clipped, outside, overlaps, sheetOverflow, empties, bgVisible: 1 - covered / (vw * vh), small44,
  };
}
