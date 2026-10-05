/// <reference types="vitest/config" />
import { mergeConfig, defineConfig } from 'vitest/config';
import viteConfig from './vite.config';

// 기존 vite.config(플러그인·alias·proxy)를 그대로 상속한다.
// - setupFiles: node:test(.cjs) 스위트를 vitest 러너에 연결하는 브리지
// - testTimeout: Playwright 브라우저 시나리오(페이지 로드/다운로드)는 기본 5초를 넘긴다.
// - fileParallelism: 브라우저를 띄우는 테스트가 동시에 몰리지 않도록 파일 단위 직렬 실행.
export default mergeConfig(
  viteConfig,
  defineConfig({
    // 개발 서버(node_modules/.vite)와 캐시를 분리한다. 같은 캐시를 공유하면
    // vitest 의 dep 최적화가 개발 서버의 browserHash 를 덮어써 테스트 중
    // Vite 가 재최적화 → full-reload 를 일으키고 모듈 인스턴스가 뒤섞인다.
    cacheDir: 'node_modules/.vite-vitest',
    test: {
      setupFiles: ['./tests/setup-node-test-shim.mjs'],
      testTimeout: 120000,
      hookTimeout: 120000,
      fileParallelism: false,
    },
  }),
);
