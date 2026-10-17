// 사전·사후 흐름 합격 기준 측정: 공통 P1·P2·P3·P5·PC·P9·P13(class-player measureFit 재사용) + 신규 FR1~FR6 + 균형 FS1·FS3·FS7·FS9
// 사용: node e2e/class-flow/fit.mjs [--base=URL] [--ids=FM06c:on-group-opt-member-idle,__selftest:wizard] [--steps=0,1,2,3,4] [--reach=false] [--out=파일]
//   --ids 가 없으면 하니스에 등록된 전 케이스(회원+상담사). --steps 는 --ids 의 각 케이스를 &step=N 으로 열어 FR1(단계별 CTA 고정)을 본다.
//   FR1 은 기본적으로 같은 마법사 그룹(FM06a~e 의 같은 장소·인원·밴드 모드, FH02a~e)의 CTA 박스를 비교한다.
// 위반이 있으면 종료 코드 1. 균형 S1~S10 중 S2·S8·S10 은 이 단계에서 측정하지 않고(해당 규칙은 H 트랙 픽스처 합류 후 추가), S4·S5(시트는 sheet-mode.ts 단위 테스트)·S6 은 해당 없음.
import path from 'node:path';
import {
  DEFAULT_BASE, FRONTEND_ROOT, HERE, SHORT_VIEWPORTS, VIEWPORTS, copyConfig, fitConfig, formatReport, launchBrowser, measureCtaCover, measureCtaReach,
  measureFit, measureFlowCopy, measureFlowState, measureFlowSteps, measureFlowSymmetry, measureSheetNesting, openCase, parseArgs, readExpected,
  readFlowCta, readRegistry, sourceRows, writeReport,
} from './lib.mjs';

const CTA_TOLERANCE = 2;

/** 한 케이스를 한 뷰포트에서 측정한다. 반환: { rows, cta } */
export async function measureCase(page, { base, ref, query = '', vp }) {
  await openCase(page, base, ref, query);
  const expected = await readExpected(page, ref, query);
  const rows = [];
  rows.push(...(await page.evaluate(measureFit, fitConfig(ref))));
  rows.push(...(await page.evaluate(measureFlowSteps, expected.steps)));
  rows.push(...(await page.evaluate(measureSheetNesting)));
  rows.push(...(await page.evaluate(measureFlowCopy, copyConfig())));
  rows.push(...(await page.evaluate(measureFlowState, { tracker: expected.tracker, avMode: expected.avMode })));
  rows.push(...(await page.evaluate(measureCtaCover)));
  rows.push(...(await page.evaluate(measureFlowSymmetry)));
  const cta = await page.evaluate(readFlowCta);
  if (cta.count > 1) rows.push({ rule: 'FR1', val: `하단 주 버튼 ${cta.count}개(1개여야 함)`, pass: false });
  const label = query ? `${ref}?${query}` : ref;
  return { rows: rows.map((r) => ({ id: label, vp, ...r })), cta, group: expected.fr1Group, label };
}

/** FR1: 같은 그룹 안에서 하단 주 버튼 박스(x·y·w·h) 변위 ≤ 2px. 기준 = 그룹의 첫 케이스 */
export function compareCtas(entries) {
  const rows = [];
  const byGroup = new Map();
  for (const e of entries) {
    if (!e.group || !e.cta.rect) continue;
    const key = `${e.group}|${e.vp}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), e]);
  }
  for (const [key, list] of byGroup) {
    if (list.length < 2) continue;
    const [group, vp] = key.split('|');
    const base = list[0];
    for (const e of list.slice(1)) {
      const d = ['x', 'y', 'w', 'h'].map((k) => Math.abs(e.cta.rect[k] - base.cta.rect[k]));
      const max = Math.max(...d);
      rows.push({
        id: `${group}`, vp, rule: 'FR1',
        val: `${e.label} ↔ ${base.label} Δx${d[0].toFixed(1)} Δy${d[1].toFixed(1)} Δw${d[2].toFixed(1)} Δh${d[3].toFixed(1)} (허용 ${CTA_TOLERANCE})`,
        pass: max <= CTA_TOLERANCE,
      });
    }
  }
  return rows;
}

/** --steps: 같은 케이스를 &step=N 으로 열어 하단 주 버튼이 단계마다 같은 자리에 있는지(FR1) */
export async function stepRows({ browser, base, ref, steps, viewports = VIEWPORTS, extraQuery = '' }) {
  const rows = [];
  for (const [w, h] of viewports) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const ctas = [];
    for (const step of steps) {
      await openCase(page, base, ref, `step=${step}${extraQuery ? `&${extraQuery}` : ''}`);
      ctas.push({ step, ...(await page.evaluate(readFlowCta)) });
    }
    const vp = `${w}x${h}`;
    const first = ctas[0];
    for (const c of ctas.slice(1)) {
      if (!c.rect || !first.rect) { rows.push({ id: ref, vp, rule: 'FR1', val: `step ${c.step}: 하단 주 버튼 없음`, pass: false }); continue; }
      const d = ['x', 'y', 'w', 'h'].map((k) => Math.abs(c.rect[k] - first.rect[k]));
      rows.push({ id: ref, vp, rule: 'FR1', val: `step ${c.step} ↔ step ${first.step} Δx${d[0].toFixed(1)} Δy${d[1].toFixed(1)} Δw${d[2].toFixed(1)} Δh${d[3].toFixed(1)} (허용 ${CTA_TOLERANCE})`, pass: Math.max(...d) <= CTA_TOLERANCE });
    }
    await ctx.close();
  }
  return rows;
}

export async function runFit({ browser, base, refs, viewports = VIEWPORTS, reach = true }) {
  const rows = [];
  const entries = [];
  for (const [w, h] of viewports) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const vp = `${w}x${h}`;
    for (const ref of refs) {
      try {
        const m = await measureCase(page, { base, ref, vp });
        rows.push(...m.rows);
        entries.push({ ...m, vp });
        if (!m.rows.length) rows.push({ id: ref, vp, rule: 'REG', val: '검사 항목 0건', pass: false });
      } catch (error) {
        rows.push({ id: ref, vp, rule: 'REG', val: `측정 실패: ${String(error.message).split('\n')[0]}`, pass: false });
      }
    }
    await ctx.close();
  }
  rows.push(...compareCtas(entries));
  if (reach) {
    for (const [w, h] of SHORT_VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      for (const ref of refs) {
        try {
          await openCase(page, base, ref);
          const checks = await page.evaluate(measureCtaReach);
          rows.push(...checks.map((c) => ({ id: ref, vp: `${w}x${h}`, ...c })));
        } catch (error) {
          rows.push({ id: ref, vp: `${w}x${h}`, rule: 'P14', val: `측정 실패: ${String(error.message).split('\n')[0]}`, pass: false });
        }
      }
      await ctx.close();
    }
  }
  return rows;
}

export const SOURCE_ROOTS = [
  path.join(FRONTEND_ROOT, 'src', 'components', 'class', 'flow'),
  path.join(FRONTEND_ROOT, 'src', 'lib', 'class', 'flow'),
];

async function main() {
  const args = parseArgs(process.argv);
  const base = args.base || DEFAULT_BASE;
  const out = path.resolve(args.out || path.join(HERE, 'out', 'fit.txt'));
  const explicit = typeof args.ids === 'string' ? args.ids.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const steps = typeof args.steps === 'string' ? args.steps.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const browser = await launchBrowser();
  try {
    let refs = explicit;
    if (!refs) {
      const registry = await readRegistry(await (await browser.newContext()).newPage(), base);
      refs = [...registry.member, ...registry.host];
    }
    if (!refs.length) {
      console.error(`하니스에 등록된 케이스가 없습니다(${base}). 픽스처(lib/class/flow/fixtures/*.ts)를 먼저 추가하거나 --ids 로 지정하세요.`);
      process.exitCode = 2;
      return;
    }
    let rows = await runFit({ browser, base, refs, reach: args.reach !== 'false' });
    if (steps) for (const ref of refs) rows.push(...(await stepRows({ browser, base, ref, steps })));
    rows.push(...sourceRows(SOURCE_ROOTS));
    const text = formatReport({
      title: 'MIND BREEZE 2.0 · 클래스 사전·사후 흐름 합격 기준 측정 (verify P1~P3·P9·P13·PC + FR1~FR6 + 균형 FS1·FS3·FS7·FS9)',
      role: explicit ? 'ids' : 'member+host',
      rows,
    });
    writeReport(out, text);
    console.log(text.split('\n').slice(0, 28).join('\n'));
    console.log(`\n결과 파일: ${out}`);
    if (rows.some((r) => !r.pass)) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('class-flow/fit.mjs')) await main();
