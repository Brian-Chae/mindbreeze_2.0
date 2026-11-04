// SDD-286 — 비회원 코드 입장 버튼 플래그: 함수·운영 define 고정·번들 검사기·dev 워크플로 주입.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isGuestEntryEnabled } from '../src/lib/feature-flags';
// @ts-expect-error Node 전용 릴리스 검사기에는 선언 파일이 없다.
import { checkReleaseBundle } from '../scripts/check-release-bundle.mjs';

afterEach(() => vi.unstubAllEnvs());

describe('isGuestEntryEnabled', () => {
  it("'true' 일 때만 켜지고 기본은 꺼짐", () => {
    vi.stubEnv('VITE_GUEST_ENTRY_ENABLED', 'true');
    expect(isGuestEntryEnabled()).toBe(true);
    for (const v of ['', 'false', '1', 'TRUE']) {
      vi.stubEnv('VITE_GUEST_ENTRY_ENABLED', v);
      expect(isGuestEntryEnabled()).toBe(false);
    }
  });
});

describe('운영 고정·dev 주입', () => {
  it("vite 운영 define 이 환경변수와 무관하게 'false' 로 고정한다 (V-5)", () => {
    const src = readFileSync(resolve(import.meta.dirname, '../vite.config.ts'), 'utf8');
    expect(src).toContain("'import.meta.env.VITE_GUEST_ENTRY_ENABLED': JSON.stringify('false')");
  });
  it('deploy-dev.yml 은 true 를 주입하고 운영 워크플로는 건드리지 않는다', () => {
    const wf = (n: string) => readFileSync(resolve(import.meta.dirname, '../../.github/workflows', n), 'utf8');
    expect(wf('deploy-dev.yml')).toContain('VITE_GUEST_ENTRY_ENABLED=true');
    expect(wf('deploy-prod.yml')).not.toContain('VITE_GUEST_ENTRY_ENABLED');
    expect(wf('release-build.yml')).not.toContain('VITE_GUEST_ENTRY_ENABLED');
  });
});

describe('번들 검사기', () => {
  it('true 가 들어 있으면 실패, false 면 통과 (V-4)', async () => {
    const dir = await mkdtemp(resolve(import.meta.dirname, 'guest-bundle-'));
    try {
      await writeFile(resolve(dir, 'index.js'), 'var a={VITE_GUEST_ENTRY_ENABLED:`false`,VITE_LIVE_PROTOCOL_V2:`true`}');
      expect((await checkReleaseBundle(dir, { requireLiveProtocolV2: true })).bytes).toBeGreaterThan(0);
      await writeFile(resolve(dir, 'index.js'), 'var a={VITE_GUEST_ENTRY_ENABLED:"true",VITE_LIVE_PROTOCOL_V2:`true`}');
      await expect(checkReleaseBundle(dir, { requireLiveProtocolV2: true })).rejects.toThrow('VITE_GUEST_ENTRY_ENABLED');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
