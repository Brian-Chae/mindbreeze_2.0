// 시안(designs/class-flow-redesign/*.html)과 하니스(/design/class-flow) 같은 케이스를 같은 뷰포트로 찍어 나란히 비교할 스크린샷을 만든다.
// 사용: node e2e/class-flow/compare.mjs --design=http://127.0.0.1:5302 [--base=http://127.0.0.1:5190] [--ids=FM01:upcoming,FH05:online-ok] [--vp=390x844,1280x720] [--out=<디렉터리>]
//   시안 서버:  python3 -m http.server 5302 --directory "<repo>/designs"   (시안 주소: /class-flow-redesign/<member-a|member-b|host-a|host-b>.html?screen=FM01&case=upcoming)
//   기본 출력:  designs/class-flow-redesign/shots/compare/ (gitignore: designs/*/shots/) — 파일명 <화면>-<케이스>-<뷰포트>-<design|harness>.png
//   --ids 가 없으면 case-keys.json 의 전 케이스. 시안 화면이 없는(렌더 실패) 케이스는 건너뛰고 목록으로 알린다.
import fs from 'node:fs';
import path from 'node:path';
import { FRONTEND_ROOT, DEFAULT_BASE, launchBrowser, openCase, parseArgs } from './lib.mjs';

const REPO_ROOT = path.resolve(FRONTEND_ROOT, '..');
const DESIGN_DIR = path.join(REPO_ROOT, 'designs', 'class-flow-redesign');
const KEYS = JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, 'case-keys.json'), 'utf8'));

/** 화면 ID → 시안 파일(member-a 등). case-keys.json 의 files 표가 정본 */
function fileOf(screen) {
  for (const [file, screens] of Object.entries(KEYS.files)) if (screens.includes(screen)) return file;
  throw new Error(`시안 파일을 찾을 수 없는 화면: ${screen}`);
}

function parseVp(text) {
  return text.split(',').map((s) => s.trim().split('x').map(Number));
}

async function main() {
  const args = parseArgs(process.argv);
  const base = args.base || DEFAULT_BASE;
  const design = (args.design || 'http://127.0.0.1:5302').replace(/\/$/, '');
  const out = path.resolve(args.out || path.join(DESIGN_DIR, 'shots', 'compare'));
  const vps = parseVp(typeof args.vp === 'string' ? args.vp : '390x844,1280x720');
  const refs = typeof args.ids === 'string' ? args.ids.split(',').map((s) => s.trim()).filter(Boolean) : KEYS.cases;
  fs.mkdirSync(out, { recursive: true });
  const browser = await launchBrowser();
  const skipped = [];
  let shots = 0;
  try {
    for (const [w, h] of vps) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const designPage = await ctx.newPage();
      const harnessPage = await ctx.newPage();
      for (const ref of refs) {
        const [screen, key] = ref.split(':');
        const name = `${screen}-${key}-${w}x${h}`;
        try {
          await designPage.goto(`${design}/class-flow-redesign/${fileOf(screen)}.html?screen=${encodeURIComponent(screen)}&case=${encodeURIComponent(key)}`, { waitUntil: 'load' });
          await designPage.waitForTimeout(500);
          await designPage.screenshot({ path: path.join(out, `${name}-design.png`) });
          await openCase(harnessPage, base, ref);
          await harnessPage.screenshot({ path: path.join(out, `${name}-harness.png`) });
          shots += 2;
        } catch (error) {
          skipped.push(`${ref}@${w}x${h}: ${String(error.message).split('\n')[0]}`);
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`스크린샷 ${shots}장 → ${out}`);
  if (skipped.length) console.log(`건너뜀 ${skipped.length}건:\n${skipped.slice(0, 20).join('\n')}`);
}

await main();
