// SDD-246 T01 — oracle 전용 vitest 설정(plain 객체). frontend 설정/소스는 수정하지 않는다.
// ORACLE_FILTER=biquad(기본): 제품 번들(vite)과 같이 biquadjs 의 ESM(module) 빌드를 쓴다 → 진짜 biquad.
// ORACLE_FILTER=legacy_fallback: alias 없이 실행 → biquadjs main(IIFE)의 named import 가 풀리지 않아 TS fallback 필터 경로.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const mode = process.env.ORACLE_FILTER || 'biquad';
if (!['biquad', 'legacy_fallback'].includes(mode)) throw new Error('ORACLE_FILTER=biquad|legacy_fallback');

export default {
  root: resolve(repo, 'frontend'),
  cacheDir: resolve(repo, 'frontend/node_modules/.vite-oracle-' + mode),
  server: { fs: { strict: false } },
  resolve: mode === 'biquad'
    ? { alias: { biquadjs: resolve(repo, 'frontend/node_modules/biquadjs/dist/BiquadFilters.esm.js') } }
    : {},
  test: {
    globals: true,
    include: [resolve(here, '*.oracle.test.ts')],
    environment: 'node',
    testTimeout: 600000,
    hookTimeout: 600000,
    fileParallelism: false,
  },
};
