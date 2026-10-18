import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['read.spec.ts', 'visual.spec.ts'],
  outputDir: 'out',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: 4,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5441',
    browserName: 'chromium',
    channel: 'chrome',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium' }],
  webServer: [
    {
      command: `VITE_API_BASE_URL=http://127.0.0.1:5441/api/v1 node --input-type=module -e 'import { createServer } from "vite"; import { resolve } from "node:path"; const tokens = resolve("../design-system/build/outputs/css/tokens.css"); const server = await createServer({ configFile: resolve("vite.config.ts"), resolve: { alias: [{ find: "../design-system/build/outputs/css/tokens.css", replacement: tokens }] }, server: { host: "127.0.0.1", port: 5441, strictPort: true }, plugins: [{ name: "q-readonly-design-token-alias", enforce: "pre", resolveId(source) { if (source === "../design-system/build/outputs/css/tokens.css") return tokens; } }] }); await server.listen(); server.printUrls();'`,
      cwd: '../..',
      url: 'http://127.0.0.1:5441',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'python3 -m http.server 5440 --bind 127.0.0.1 --directory ../designs',
      cwd: '../..',
      url: 'http://127.0.0.1:5440',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
