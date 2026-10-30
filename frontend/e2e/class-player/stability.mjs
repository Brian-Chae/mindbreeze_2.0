// P11 자리 고정(R1): 같은 화면에서 상태만 바꿔도 링·도크·미디어 줄(회원) / 상단 바·헤드·그리드·도크(상담사)가 움직이지 않는다.
// 하니스 래퍼가 노출한 window.__patchCase 로 band·mic·cam·net·rec 만 바꾸고, 각 상태를 기준 상태와 비교해 박스 변위(x·y·w·h)가 ±2px 이내인지 본다.
// 사용: node e2e/class-player/stability.mjs [--base=URL] [--out=파일]   위반이 있으면 종료 코드 1
import path from 'node:path';
import { DEFAULT_BASE, HERE, RULE_NAMES, VIEWPORTS, formatReport, launchBrowser, openCase, parseArgs, writeReport } from './lib.mjs';

RULE_NAMES.P11 = '상태 전환 시 자리 고정';
const TOL = 2;
const pz = (name) => `[data-pz="${name}"]`;

/** 기준 상태와 비교할 박스. 같은 케이스·같은 뷰포트에서 상태만 바뀐다 */
const SETS = [
  {
    role: 'member', id: 'M01', label: '회원 온라인 1:1',
    boxes: { topbar: pz('topbar'), ring: pz('ring'), pip: pz('pip'), mypip: pz('mypip'), media: pz('media-row'), dock: pz('dock') },
    base: { band: 'on', mic: 'on', cam: 'on', net: 'ok' },
    steps: [
      ['band', ['leadoff', 'lost', 'low', 'weak', 'pending', 'off', 'unsupported']],
      ['mic', ['off', 'denied']],
      ['cam', ['off', 'denied']],
      ['net', ['reconnecting']],
    ],
  },
  {
    role: 'member', id: 'M02', label: '회원 온라인 그룹',
    boxes: { topbar: pz('topbar'), ring: pz('ring'), pip: pz('pip'), media: pz('media-row'), dock: pz('dock') },
    base: { band: 'on', hand: 'idle' },
    steps: [['band', ['leadoff', 'lost', 'weak', 'off']], ['hand', ['waiting', 'speaking']]],
  },
  {
    role: 'host', id: 'C01', label: '코치 온라인 그룹',
    boxes: { top: pz('top'), head: pz('head'), gridscroll: pz('gridscroll'), dock: pz('dock') },
    base: { cam: 'on', mic: 'on', rec: 'none', net: 'ok' },
    steps: [['cam', ['off', 'denied']], ['mic', ['off', 'denied']], ['rec', ['rec', 'paused']], ['net', ['reconnecting']]],
  },
  {
    role: 'host', id: 'C05', label: '코치 온라인 1:1',
    boxes: { top: pz('top'), head: pz('head'), solo: pz('solo'), dock: pz('dock') },
    base: { cam: 'on', mic: 'on', rec: 'none', net: 'ok' },
    steps: [['cam', ['off', 'denied']], ['mic', ['off', 'denied']], ['rec', ['rec', 'paused']], ['net', ['reconnecting']]],
  },
];

/** 박스 이름 → 첫 번째 보이는 요소의 사각형(없으면 null). page.evaluate 로 직렬화되므로 자기완결 */
function readBoxes(boxes) {
  const out = {};
  for (const [name, selector] of Object.entries(boxes)) {
    const el = [...document.querySelectorAll(selector)].find((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; });
    if (!el) { out[name] = null; continue; }
    const r = el.getBoundingClientRect();
    out[name] = { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  return out;
}

function compare(base, now) {
  const problems = [];
  for (const name of Object.keys(base)) {
    const a = base[name];
    const b = now[name];
    if (a === null && b === null) continue;
    if (a === null || b === null) { problems.push(`${name} ${a === null ? '나타남' : '사라짐'}`); continue; }
    const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
    if (d > TOL) problems.push(`${name} Δ${d.toFixed(1)}px`);
  }
  return problems;
}

const args = parseArgs(process.argv);
const base = args.base || DEFAULT_BASE;
const out = path.resolve(args.out || path.join(HERE, 'out', 'stability.txt'));
const browser = await launchBrowser();
const rows = [];
try {
  for (const [w, h] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const vp = `${w}x${h}`;
    for (const set of SETS) {
      await openCase(page, base, set.role, set.id);
      const patch = async (partial) => {
        await page.evaluate((p) => window.__patchCase(p), partial);
        await page.waitForTimeout(300);
        await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* 이미 끝남 */ } }));
      };
      await patch(set.base);
      const baseline = await page.evaluate(readBoxes, set.boxes);
      for (const [key, values] of set.steps) {
        for (const value of values) {
          await patch({ [key]: value });
          const now = await page.evaluate(readBoxes, set.boxes);
          const problems = compare(baseline, now);
          rows.push({ id: `${set.id} ${key}=${value}`, vp, rule: 'P11', val: problems.length ? problems.join(' | ') : `${Object.values(baseline).filter(Boolean).length}개 박스 ±${TOL}px 이내`, pass: problems.length === 0 });
          await patch({ [key]: set.base[key] });
        }
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
const text = formatReport({ title: 'MIND BREEZE 2.0 · 상태 전환 시 자리 고정 측정 (verify P11)', role: 'member+host', rows });
writeReport(out, text);
console.log(text.split('\n').slice(0, 30).join('\n'));
console.log(`\n결과 파일: ${out}`);
if (rows.some((r) => !r.pass)) process.exitCode = 1;
