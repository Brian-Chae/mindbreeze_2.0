// 저장소 .env 없이 관련 vitest와 기존 PDF 브라우저 테스트를 순차 실행한다.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
(async () => {
  const root = path.resolve(__dirname, '../../frontend');
  process.chdir(root);
  const browserFiles = ['tests/report-modal-pdf.test.cjs', 'tests/report-server-pdf.test.cjs'];
  const { startVitest } = await import(pathToFileURL(path.join(root, 'node_modules/vitest/dist/node.js')).href);
  const filters = fs.readdirSync(path.join(root, 'tests')).filter(name => /report|narrative|sdd234-c-/.test(name)).map(name => 'tests/' + name).filter(name => !browserFiles.includes(name));
  const ctx = await startVitest(process.argv.includes('--pdf-only') ? ['tests/sdd234-c-mobile.test.tsx'] : filters, { run: true, watch: false }, {
    root, envDir: fs.mkdtempSync('/tmp/sdd234-vitest-env-'),
    resolve: { alias: { '../design-system': path.resolve(root, '../design-system') } },
  });
  await ctx.close();
  const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href);
  const server = await createServer({ root,
envDir: fs.mkdtempSync('/tmp/sdd234-c-test-env-'),
    resolve: { alias: { '../design-system': path.resolve(root, '../design-system') } },
    server: { host: '127.0.0.1', port: 5445, strictPort: true, proxy: {}, hmr: false },
  });
  await server.listen();
  try {
    // 기존 테스트는 /node_modules/.vite/deps를 직접 import하므로 실제 진입점을 먼저 준비한다.
    const { chromium } = require(path.join(root, 'node_modules/playwright'));
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    try {
      const page = await browser.newPage();
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1') return route.abort();
        if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 401, json: {} });
        return route.continue();
      });
      await page.goto('http://127.0.0.1:5445');
      await page.waitForTimeout(1500);
    } finally { await browser.close(); }
    // Vite 8의 모듈별 해시를 기존 합성 HTML import에도 적용한다.
    // 리다이렉트만으로는 ESM 요청 URL별 캐시 때문에 Router context가 분리된다.
    const hashes = Object.fromEntries(server.environments.client.depsOptimizer.metadata.depInfoList.map(info => [path.basename(info.file), info.browserHash]));
    const preload = path.join(fs.mkdtempSync('/tmp/sdd234-c-pdf-'), 'legacy-imports.cjs');
    fs.writeFileSync(preload, `
      const {chromium} = require(${JSON.stringify(path.join(root, 'node_modules/playwright'))});
      const hashes = ${JSON.stringify(hashes)};
      const launch = chromium.launch.bind(chromium);
      chromium.launch = async (...args) => {
        const browser = await launch(...args);
        const newPage = browser.newPage.bind(browser);
        browser.newPage = async (...args) => {
          const page = await newPage(...args);
          const register = page.route.bind(page);
          page.route = (url, handler, options) => register(url, route => handler(new Proxy(route, {
            get(target, key) {
              if (key === 'fulfill') return options => {
                if (options.contentType === 'text/html' && typeof options.body === 'string') {
                  let body = options.body;
                  for (const [file, hash] of Object.entries(hashes)) {
                    const prefix = '/node_modules/.vite/deps/' + file;
                    body = body.split(prefix).map((part, index) => index ? '?v=' + hash + part.replace(/^\\?v=[a-f0-9]+/, '') : part).join(prefix);
                  }
                  return target.fulfill({...options, body});
                }
                return target.fulfill(options);
              };
              const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
            }
          })), options);
          return page;
        };
        return browser;
      };
    `);
    const code = await new Promise(resolve => {
      const child = spawn(process.execPath, ['--require', preload, '--test', '--test-concurrency=1', ...browserFiles], {
        cwd: root, stdio: 'inherit', env: { ...process.env, REPORT_TEST_BASE_URL: 'http://127.0.0.1:5445' },
      });
      child.on('exit', resolve);
    });
    if (code !== 0) process.exitCode = 1;
  } finally { await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
