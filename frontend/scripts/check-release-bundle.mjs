import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function checkReleaseBundle(root) {
  const problems = [];
  let bytes = 0;
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      const name = relative(root, file).replaceAll('\\', '/');
      if (entry.isDirectory()) { await walk(file); continue; }
      bytes += (await stat(file)).size;
      if (/\.(js|json|html|css)$/.test(name)) {
        const content = await readFile(file, 'utf8');
        if (/dev-api\.|mindbreeze-dev|(?:localhost|127\.0\.0\.1):8000/.test(content)) problems.push(`${name}: 개발 서버 주소`);
      }
      if (name === 'chat-test.html' || /(^|\/)mb-design\/.*\.html$/.test(name) || /assets\/(DesignIndexPage|HomepagePage|OperatorAppPage|UserAppPage|ReportPage|DocsPage|ClassPlayerCasesPage|ClassFlowCasesPage)-/.test(name)) {
        problems.push(`${name}: 디자인·시험 산출물`);
      }
    }
  }
  await walk(root);
  if (problems.length) throw new Error(problems.join('\n'));
  return { bytes };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await checkReleaseBundle(resolve(process.argv[2] || 'dist'));
  console.log(`운영 번들 검사 통과: ${result.bytes} bytes`);
}
