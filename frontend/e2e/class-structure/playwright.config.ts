import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['read.spec.ts', 'visual.spec.ts'],
  outputDir: 'out',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
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
      command: 'VITE_API_BASE_URL=http://127.0.0.1:4173/api/v1 npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'python3 -m http.server 5415 --bind 127.0.0.1 --directory ../designs',
      url: 'http://127.0.0.1:5415',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
