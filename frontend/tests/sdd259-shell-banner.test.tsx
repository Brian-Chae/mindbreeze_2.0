// @vitest-environment jsdom
// SDD-259 후속: 회원 셸(ClientShell)에도 업데이트 배너가 붙는지, 경로별 노출을 시험한다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateDecision } from '../src/lib/update/update-config';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notice: UpdateDecision = { kind: 'android', latestLabel: '1.2.0', latestCode: 29, sizeBytes: 1, notes: '', dismissKey: 'android:29', forced: false, apkUrl: 'https://d/a.apk', sha256: 'a'.repeat(64), testflightUrl: '' };
vi.mock('../src/lib/update/use-app-update', () => ({
  useAppUpdate: () => ({ notice, phase: 'available', progress: null, errorMessage: '', installSupported: true, start: vi.fn(), openSettings: vi.fn(), dismiss: vi.fn() }),
}));

import AppUpdateBanner from '../src/components/update/AppUpdateBanner';

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
});

async function renderAt(path: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<MemoryRouter initialEntries={[path]}><AppUpdateBanner /></MemoryRouter>));
  return host.querySelectorAll('[role="dialog"]').length;
}

const src = (rel: string) => readFileSync(resolve(__dirname, '../src', rel), 'utf8');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('E1·E2 셸 소스 계약', () => {
  it('ClientShell·AppShell 각각 AppUpdateBanner 를 정확히 1번 렌더한다', () => {
    expect(count(src('components/client/ClientShell.tsx'), /<AppUpdateBanner \/>/g)).toBe(1);
    expect(count(src('components/layout/AppShell.tsx'), /<AppUpdateBanner \/>/g)).toBe(1);
  });
  it('StructureShell 은 role 로 한 셸만 고르고 배너를 직접 추가하지 않는다(중복 없음)', () => {
    const s = src('components/class/structure/structure-shell.tsx');
    expect(s).toMatch(/role === 'member' \? ClientShell : AppShell/);
    expect(s).not.toMatch(/AppUpdateBanner/);
  });
});

describe('E3·E4 경로별 노출', () => {
  it('역할 홈(/app, /dashboard, /dashboard/org)에서는 시트 1개', async () => {
    for (const p of ['/app', '/dashboard', '/dashboard/org']) {
      expect(await renderAt(p)).toBe(1);
      await act(async () => root!.unmount()); host!.remove(); root = null; host = null;
    }
  });
  it('클래스 입장·플레이어·측정·그 밖 화면에서는 0개', async () => {
    for (const p of ['/app/classes', '/class/x/enter', '/sessions/x/player', '/login']) {
      expect(await renderAt(p)).toBe(0);
      await act(async () => root!.unmount()); host!.remove(); root = null; host = null;
    }
  });
});
