// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppUpdateView } from '../src/components/update/AppUpdateBanner';
import type { UpdateDecision } from '../src/lib/update/update-config';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
});

const android: UpdateDecision = { kind: 'android', latestLabel: '1.2.0', latestCode: 28, sizeBytes: 110157515, notes: '', dismissKey: 'android:28', forced: false, apkUrl: 'https://d/a.apk', sha256: 'a'.repeat(64), testflightUrl: '' };
const ios: UpdateDecision = { ...android, kind: 'ios', apkUrl: '', sha256: '', sizeBytes: 0, testflightUrl: 'https://testflight.apple.com/join/x', dismissKey: 'ios:12' };

async function render(over: Partial<Parameters<typeof AppUpdateView>[0]> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const props = { notice: android, phase: 'available' as const, progress: null, errorMessage: '', installSupported: true, onStart: vi.fn(), onOpenSettings: vi.fn(), onDismiss: vi.fn(), ...over };
  await act(async () => root!.render(<AppUpdateView {...props} />));
  return props;
}
const btn = (label: string) => [...host!.querySelectorAll('button')].find((b) => b.textContent === label);

describe('A11 AppUpdateView', () => {
  it('Android: 버전·크기·[업데이트]·[나중에]', async () => {
    const p = await render();
    expect(host!.textContent).toContain('1.2.0');
    expect(host!.textContent).toContain('105.1MB');
    await act(async () => btn('업데이트')!.click());
    expect(p.onStart).toHaveBeenCalled();
    await act(async () => btn('나중에')!.click());
    expect(p.onDismiss).toHaveBeenCalled();
  });
  it('설치 미지원 빌드: 다운로드 사이트 열기', async () => {
    await render({ installSupported: false });
    expect(btn('다운로드 사이트 열기')).toBeTruthy();
  });
  it('iOS: TestFlight 안내', async () => {
    await render({ notice: ios });
    expect(host!.textContent).toContain('TestFlight');
    expect(btn('TestFlight 열기')).toBeTruthy();
  });
  it('진행률', async () => {
    await render({ phase: 'downloading', progress: { received: 50, total: 100 } });
    expect(host!.textContent).toContain('50%');
    expect((btn('업데이트') as HTMLButtonElement).disabled).toBe(true);
  });
  it('설치 허용 단계', async () => {
    const p = await render({ phase: 'needs-permission' });
    expect(host!.textContent).toContain('설치 허용이 필요해요');
    await act(async () => btn('설정 열기')!.click());
    expect(p.onOpenSettings).toHaveBeenCalled();
  });
  it('오류 → 재시도', async () => {
    await render({ phase: 'error', errorMessage: '다운로드에 실패했어요.' });
    expect(host!.querySelector('[role=alert]')!.textContent).toContain('실패');
    expect(btn('다시 시도')).toBeTruthy();
  });
  it('강제 업데이트: [나중에] 없음', async () => {
    await render({ notice: { ...android, forced: true } });
    expect(btn('나중에')).toBeUndefined();
  });
});
