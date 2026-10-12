import { mergeConfig, defineConfig } from 'vitest/config';
import viteConfig from './vite.config';

// TQ-03: 브라우저 QA 스위트 전용 실행 구성.
//
// `tests/*.browser.cjs` 는 파일명 규약이 기본 include(`*.test.*`/`*.spec.*`)와 달라
// 일반 `vitest run` 에서 수집되지 않던 "죽은 테스트"였다. 이 구성이 명시적으로 include 하고,
// 실제 앱 서버(기본 5176)와 Playwright 브라우저를 준비한 뒤 실행한다:
//
//   npm run test:browser
//
// (일반 단위 실행은 vitest.config.ts 가 이 패턴을 exclude 하므로 영향을 받지 않는다.)
export default mergeConfig(
  viteConfig,
  defineConfig({
    cacheDir: 'node_modules/.vite-vitest-browser',
    test: {
      setupFiles: ['./tests/setup-node-test-shim.mjs'],
      include: ['tests/**/*.browser.{cjs,mjs,js}'],
      exclude: ['**/node_modules/**', '**/dist/**'],
      // 브라우저 기동 + 실 라우트 렌더에 시간이 걸린다.
      testTimeout: 180000,
      hookTimeout: 180000,
      fileParallelism: false,
    },
  }),
);
