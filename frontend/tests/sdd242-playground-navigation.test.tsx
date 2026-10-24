// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { UserRole } from '../src/lib/api/auth';
const state = vi.hoisted(() => ({ role: 'client' as UserRole }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (s: { user: { role: UserRole } }) => unknown) => selector({ user: { role: state.role } }) }));
vi.mock('../src/components/layout/AppShell', () => ({ default: ({ children }: { children: ReactNode }) => <main data-shell="host">{children}</main> }));
vi.mock('../src/components/client/ClientShell', () => ({ default: ({ children }: { children: ReactNode }) => <main data-shell="client">{children}</main> }));
vi.mock('../src/hooks/useBand', () => ({ useBand: () => ({ connect: async () => undefined, connectionState: 'disconnected' }) }));
vi.mock('../src/lib/eeg/eegPersonalScore', () => ({ getActiveModelCache: () => null, refreshActiveModel: async () => undefined }));
for (const name of ['AccPanel', 'CalibrationPanel', 'ConnectionPanel', 'DebugPanel', 'EegWaveformPanel', 'MetricsPanel', 'NormalizationPanel', 'PlaygroundMeditationSimulator', 'PpgPanel', 'SpectrumPanel', 'TrendPanel']) {
  vi.doMock(`../src/components/playground/${name}`, () => ({ [name]: () => <div data-panel={name} /> }));
}
const { default: PlaygroundPage } = await import('../src/pages/playground/PlaygroundPage');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: () => void;
afterEach(() => cleanup?.());
it.each(['client', 'counselor', 'org_admin', 'platform_admin'] as const)('%s 셸과 설정 복귀 경로 및 관리자 패널을 보존한다', async (role) => {
  state.role = role;
  const container = document.createElement('div'); const root = createRoot(container);
  cleanup = () => act(() => root.unmount());
  await act(async () => root.render(<MemoryRouter><PlaygroundPage /></MemoryRouter>));
  expect(container.querySelector('main')?.getAttribute('data-shell')).toBe(role === 'client' ? 'client' : 'host');
  expect(container.querySelector('a')?.getAttribute('href')).toBe(role === 'client' ? '/app/profile' : '/settings');
  expect(container.querySelector('[data-panel="NormalizationPanel"]') !== null).toBe(role === 'platform_admin');
});
