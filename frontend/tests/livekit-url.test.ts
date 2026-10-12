// SDD-197 TS7 — LiveKit URL 은 환경변수에서 유도한다(소스 하드코딩 금지)
import { expect, it } from 'vitest';
import { resolveLiveKitUrl } from '../src/lib/livekit-url';

it('VITE_LIVEKIT_URL 이 있으면 우선한다', () => {
  expect(resolveLiveKitUrl({ VITE_LIVEKIT_URL: 'wss://lk.example.com', VITE_API_BASE_URL: 'https://api.x.com/api/v1' }))
    .toBe('wss://lk.example.com');
});
it('API 주소에서 wss 주소를 유도한다', () => {
  expect(resolveLiveKitUrl({ VITE_API_BASE_URL: 'https://api.mindbreeze.looxidlabs.com/api/v1' }))
    .toBe('wss://api.mindbreeze.looxidlabs.com/livekit');
  expect(resolveLiveKitUrl({ VITE_API_BASE_URL: 'http://10.0.0.5:8000/api/v1' })).toBe('ws://10.0.0.5:8000/livekit');
});
it('로컬·미설정·잘못된 주소는 로컬 기본값', () => {
  expect(resolveLiveKitUrl({ VITE_API_BASE_URL: 'http://localhost:8000/api/v1' })).toBe('ws://localhost:7880');
  expect(resolveLiveKitUrl({})).toBe('ws://localhost:7880');
  expect(resolveLiveKitUrl({ VITE_API_BASE_URL: 'not a url' })).toBe('ws://localhost:7880');
});
it('소스에 dev 주소가 하드코딩되어 있지 않다', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['src/hooks/useLiveKit.ts', 'src/hooks/useMemberLiveKit.ts', 'src/lib/livekit-url.ts']) {
    expect(readFileSync(f, 'utf-8')).not.toMatch(/dev-api\.mindbreeze/);
  }
});
