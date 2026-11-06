// SDD-318 — 운영 번들(VITE_UI_V2 미설정/기본)에서 D안(UI_V2)이 활성 경로로 쓰이지 않는지 검사한다.
// 사용: node scripts/check-ui-v2-off.mjs <dist 디렉터리>
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function checkUiV2Off(root) {
  const problems = [];
  const info = { files: 0, cssRules: 0, v2CssFiles: [] };
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      const name = relative(root, file).replaceAll('\\', '/');
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!/\.(js|css|html)$/.test(name)) continue;
      const content = await readFile(file, 'utf8');
      info.files += 1;
      if (name.endsWith('.js')) {
        // ① 플래그 true 고정 금지
        if (/VITE_UI_V2:[`"']true[`"']/.test(content)) problems.push(`${name}: VITE_UI_V2=true 가 번들에 있음`);
        // ② D안 컴포넌트 식별자·청크가 JS 에 없어야 한다(분기 제거)
        if (/UiV2[A-Z][A-Za-z]+/.test(content)) problems.push(`${name}: UiV2* 컴포넌트가 번들에 포함됨`);
        if (/ui-v2-(home|classes|class-detail|reports)-page/.test(content)) problems.push(`${name}: D안 화면 청크 참조`);
        // ③ 루트 클래스 부여 코드
        if (/className:`[^`]*ui-v2|className:"[^"]*ui-v2/.test(content)) problems.push(`${name}: ui-v2 루트 클래스 부여 코드`);
      }
      if (name.endsWith('.css') && /\.ui-v2\b|\.u2-/.test(content)) info.v2CssFiles.push(name);
    }
  }
  await walk(root);
  const names = (await readdir(resolve(root, 'assets')).catch(() => [])).filter((n) => /ui-v2/.test(n));
  if (names.length) problems.push(`assets: ui-v2 청크 파일 ${names.join(', ')}`);
  if (problems.length) { const e = new Error(problems.join('\n')); e.info = info; throw e; }
  return info;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const info = await checkUiV2Off(resolve(process.argv[2] || 'dist'));
    console.log(`UI_V2 off 검사 통과: ${info.files}개 파일 검사, .ui-v2 CSS 포함 파일 ${info.v2CssFiles.length}개 (JS 활성 경로 없음)`);
  } catch (e) { console.error(`UI_V2 off 검사 실패:\n${e.message}`); process.exit(1); }
}
