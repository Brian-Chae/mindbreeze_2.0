// [MB261028][FIX] 운영 앱(build:prod)이 VITE_LIVE_PROTOCOL_V2 를 주입받지 못해 v1 클라이언트로 동작 →
// v2 회차(서버 LIVE_PROTOCOL_V2=true)에서 상담사 대기 화면이 회원 준비 현황을 받지 못했다.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Node 전용 릴리스 검사기에는 선언 파일이 없다.
import { checkReleaseBundle } from '../scripts/check-release-bundle.mjs';

describe('운영 번들 v2 플래그', () => {
  it('vite 운영 define 이 VITE_LIVE_PROTOCOL_V2 를 기본 true 로 주입한다', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../vite.config.ts'), 'utf8');
    expect(src).toMatch(/'import\.meta\.env\.VITE_LIVE_PROTOCOL_V2'/);
    expect(src).toMatch(/=== 'false' \? 'false' : 'true'/);
  });

  it('검사기: 플래그 없는 번들은 requireLiveProtocolV2 일 때 거부, 있으면 통과', async () => {
    const dir = await mkdtemp(resolve(import.meta.dirname, 'livev2-bundle-'));
    try {
      await writeFile(resolve(dir, 'index.js'), 'var a={VITE_API_BASE_URL:`https://api.mindbreeze.looxidlabs.com/api/v1`}');
      await expect(checkReleaseBundle(dir, { requireLiveProtocolV2: true })).rejects.toThrow('VITE_LIVE_PROTOCOL_V2');
      expect((await checkReleaseBundle(dir)).bytes).toBeGreaterThan(0);
      await writeFile(resolve(dir, 'index.js'), 'var a={VITE_LIVE_PROTOCOL_V2:`true`}');
      expect((await checkReleaseBundle(dir, { requireLiveProtocolV2: true })).bytes).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
