// R0 산출물 생성기 — 4개 시안의 ?index=1 / window.__REG 를 읽어
//   designs/class-flow-redesign/case-keys.json, gallery.html,
//   specs/sdd-209-class-flow-redesign/investigation/_mock-index.md 를 만든다.
// 사용: 서버 5301~5304 (designs/ 루트 서빙)를 띄운 뒤  node tools/r0-build.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const D = path.resolve(here, '..');
const REPO = path.resolve(D, '../..');
const { chromium } = createRequire(path.resolve(REPO, 'frontend/package.json'))('playwright');

const FILES = [
  { f: 'member-a', port: 5301, title: '회원 A — 홈·목록·상세·코드 입장·입장 확인' },
  { f: 'member-b', port: 5302, title: '회원 B — 준비 마법사·시작 대기·종료' },
  { f: 'host-a', port: 5303, title: '상담사 A — 목록·만들기·상세' },
  { f: 'host-b', port: 5304, title: '상담사 B — 세팅·로비·시작·종료' },
];

const browser = await chromium.launch({ channel: 'chrome' });
const out = [];
for (const F of FILES) {
  const pg = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await pg.goto(`http://localhost:${F.port}/class-flow-redesign/${F.f}.html?index=1`);
  await pg.waitForFunction(() => window.__ready === true);
  const data = await pg.evaluate(() => {
    const R = window.__REG;
    const reg = Array.isArray(R) ? R.map((s) => [s.id, s.cases]) : Object.entries(R);
    const meta = {};
    document.querySelectorAll('table tbody tr').forEach((tr) => {
      const cells = [...tr.children].map((c) => c.textContent.trim());
      const anchors = [...tr.querySelectorAll('a[href*="screen="]')];
      anchors.forEach((a) => {
        const u = new URL(a.getAttribute('href'), location.href);
        const k = u.searchParams.get('screen') + ':' + u.searchParams.get('case');
        meta[k] = { title: a.getAttribute('title') || '', cells };
      });
    });
    return { reg, meta };
  });
  await pg.close();
  out.push({ ...F, ...data });
}
await browser.close();

// case-keys.json
const keys = { version: 1, task: 'SDD-209 R0', total: 0, files: {}, screens: {}, cases: [] };
for (const o of out) {
  keys.files[o.f] = o.reg.map(([id]) => id);
  for (const [id, cs] of o.reg) {
    keys.screens[id] = { file: o.f, count: cs.length, cases: cs };
    for (const c of cs) keys.cases.push(`${id}:${c}`);
  }
}
keys.total = keys.cases.length;
if (new Set(keys.cases).size !== keys.total) throw new Error('중복 케이스 키');
fs.writeFileSync(path.join(D, 'case-keys.json'), JSON.stringify(keys, null, 2) + '\n');

// _mock-index.md
let md = `# 시안 인덱스 (R0 확정 — R4/R5 정합화)\n\n> 자동 생성: \`designs/class-flow-redesign/tools/r0-build.mjs\` · 정본 키 목록 \`designs/class-flow-redesign/case-keys.json\` · 확정 케이스 수 **${keys.total}** (회원 ${out.slice(0, 2).reduce((n, o) => n + o.reg.reduce((m, [, c]) => m + c.length, 0), 0)} · 상담사 ${out.slice(2).reduce((n, o) => n + o.reg.reduce((m, [, c]) => m + c.length, 0), 0)}). 구현 하니스 \`?index=1\` 은 이 표와 키가 일치해야 한다(verify G1).\n`;
for (const o of out) {
  md += `\n=== ${o.f} (${o.reg.reduce((m, [, c]) => m + c.length, 0)})\n\n| 화면 | 케이스 수 | 케이스 키 |\n|---|---|---|\n`;
  for (const [id, cs] of o.reg) md += `| ${id} | ${cs.length} | ${cs.map((c) => '`' + c + '`').join(' ')} |\n`;
}
fs.writeFileSync(path.join(REPO, 'specs/sdd-209-class-flow-redesign/investigation/_mock-index.md'), md);

// gallery.html
const VPS = [['모바일', '390x844'], ['태블릿 세로', '834x1194'], ['태블릿 가로', '1194x834'], ['데스크톱', '1280x720']];
const head = fs.readFileSync(path.join(D, 'gallery.html'), 'utf8');
const style = head.slice(0, head.indexOf('</style>') + 8).replace(/\(R3\)/, '(R0 · R4/R5 정합화)');
let g = style + `\n<header><b>클래스 사전 흐름 시안 (R4/R5 정합화 · 케이스 ${keys.total})</b>\n` +
  FILES.map((F) => `<a href="#${F.f}">${F.title}</a>`).join('\n') + `\n<a href="기획.md">기획.md</a></header><main><p class="note">R4·R5(2026-10-17): 로그인 없는 4자리 코드 입장 → 개인정보 입력, 리포트 반영 선택·연구 동의 분리, 밴드 없이 참가(권장 안내), 대기 취소, 비회원 이메일 초대·리포트 자동 발송, 정원 스텐퍼. 기간은 <code>{N}일</code> 자리표시. 케이스는 모바일 390×844 · 태블릿 세로 834×1194 · 태블릿 가로 1194×834 · 데스크톱 1280×720 순서. “직접 열기”는 동작하는 시안(?screen=&amp;case=), 개발자 인덱스는 ?index=1, 정본 키 목록은 case-keys.json 입니다. 정적 시연이며 서버 연동은 없습니다.</p>\n`;
for (const o of out) {
  g += `<h2 id="${o.f}">${FILES.find((x) => x.f === o.f).title}</h2><p class="note">측정: <a style="color:#B373EF" href="fit/${o.f}-fit.txt">fit</a> · <a style="color:#B373EF" href="fit/${o.f}-symmetry.txt">대칭</a> · <a style="color:#B373EF" href="${o.f}.html?index=1">인덱스</a></p>\n`;
  for (const [id, cs] of o.reg) {
    g += `<h3>${id}</h3>\n`;
    for (const c of cs) {
      g += `<div class="case">${c}<a href="${o.f}.html?screen=${id}&amp;case=${c}">직접 열기</a></div><div class="row">\n` +
        VPS.map(([n, v]) => `<figure><figcaption>${n} ${v}</figcaption><img loading="lazy" src="shots/${o.f}/${id}-${c}-${v}.png"></figure>`).join('\n') + '\n</div>\n';
    }
  }
}
g += '</main>\n';
fs.writeFileSync(path.join(D, 'gallery.html'), g);
console.log('total', keys.total, Object.fromEntries(out.map((o) => [o.f, o.reg.reduce((m, [, c]) => m + c.length, 0)])));
