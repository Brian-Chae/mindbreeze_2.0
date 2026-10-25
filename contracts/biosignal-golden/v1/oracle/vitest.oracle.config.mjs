// SDD-246 T01 — oracle 전용 vitest 설정(plain 객체: contracts 경로에서 vitest/config 를 해석하지 않아도 됨).
// frontend 설정 파일은 수정하지 않는다. 기존 eeg 코드는 상대 import 만 쓰므로 '@' alias 가 필요 없다.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');

export default {
  root: resolve(repo, 'frontend'),
  cacheDir: resolve(repo, 'frontend/node_modules/.vite-oracle'),
  server: { fs: { strict: false } },
  test: {
    globals: true,
    include: [resolve(here, '*.oracle.test.ts')],
    environment: 'node',
    testTimeout: 600000,
    hookTimeout: 600000,
    fileParallelism: false,
  },
};
