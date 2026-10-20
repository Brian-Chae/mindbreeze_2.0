// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ upload: vi.fn(), raw: vi.fn(), queue: vi.fn(), socket: vi.fn(() => ({ connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn() })), toggle: vi.fn() }));
vi.mock('../src/lib/api/session', async original => ({ ...await original<typeof import('../src/lib/api/session')>(), postSessionFeatures: calls.upload }));
vi.mock('../src/lib/api/class-flow', async original => ({ ...await original<typeof import('../src/lib/api/class-flow')>(), postEntryFeatures: calls.upload }));
vi.mock('../src/lib/socket', async original => ({ ...await original<typeof import('../src/lib/socket')>(), getSessionLiveSocket: calls.socket, emitSessionLiveFeature: calls.upload }));
vi.mock('../src/hooks/useEegRawUpload', () => ({ useEegRawUpload: () => ({ enqueueChunk: calls.raw, drain: vi.fn() }) }));
vi.mock('../src/lib/session-live/feature-queue', () => ({ enqueueFeature: calls.queue, listPendingFeatures: async () => [], loadStreamCursor: async () => ({ streamId: 'test', nextSequence: 0 }), removeAckedFeature: vi.fn() }));
vi.mock('../src/lib/eeg/eegPersonalScore', async original => ({ ...await original<typeof import('../src/lib/eeg/eegPersonalScore')>(), refreshActiveModel: async () => undefined }));
import { useBand, type UseBandResult } from '../src/hooks/useBand';
import { ConnectionPanel } from '../src/components/playground/ConnectionPanel';
let band: UseBandResult;
let root: Root;
let container: HTMLDivElement;
function Harness({ forceMock = true }: { forceMock?: boolean }) {
  const currentBand = useBand({ sessionId: 'demo', participantId: 'member', forceMock });
  useEffect(() => { band = currentBand; });
  return <ConnectionPanel band={currentBand} useMock onToggleMock={calls.toggle} />;
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });
it('예시 모드는 관찰 옵션 없이도 움직이며 저장과 업로드를 하지 않는다', async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => band.connect());
  await act(async () => vi.advanceTimersByTimeAsync(2200));
  const first = band.rawIndices; const spectrum = band.spectrum;
  expect(band.eegWaveform.fp1.length).toBeGreaterThan(0); expect(spectrum).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(band.rawIndices).not.toEqual(first); expect(band.spectrum).not.toEqual(spectrum);
  await act(async () => band.disconnect());
  expect(calls.upload).not.toHaveBeenCalled(); expect(calls.raw).not.toHaveBeenCalled();
  expect(calls.queue).not.toHaveBeenCalled(); expect(calls.socket).not.toHaveBeenCalled();
  expect(band.rawIndices).toBeNull(); expect(band.eegWaveform.fp1).toEqual([]);
});
it('체험 시작 버튼과 한국어 예시 안내를 제공한다', async () => {
  await act(async () => root.render(<Harness />));
  expect(container.textContent).toContain('체험 모드(예시 데이터)');
  expect(container.textContent).not.toContain('Mock');
});

vi.mock('../src/components/layout/AppShell', () => ({ default: ({ children }: { children: import('react').ReactNode }) => <main>{children}</main> }));
vi.mock('../src/components/playground/EegWaveformPanel', () => ({ EegWaveformPanel: () => null }));
vi.mock('../src/components/playground/SpectrumPanel', () => ({ SpectrumPanel: () => null }));
vi.mock('../src/components/playground/PpgPanel', () => ({ PpgPanel: () => null }));
vi.mock('../src/components/playground/AccPanel', () => ({ AccPanel: () => null }));
vi.mock('../src/components/playground/MetricsPanel', () => ({ MetricsPanel: () => null }));
vi.mock('../src/components/playground/TrendPanel', () => ({ TrendPanel: () => null }));
vi.mock('../src/components/playground/DebugPanel', () => ({ DebugPanel: () => <div>Debug panel</div> }));
vi.mock('../src/components/playground/CalibrationPanel', () => ({ CalibrationPanel: () => <div>Calibration panel</div> }));
vi.mock('../src/components/playground/NormalizationPanel', () => ({ NormalizationPanel: () => <div>Normalization panel</div> }));
vi.mock('recharts', () => ({ CartesianGrid: () => null, Legend: () => null, Line: () => null, LineChart: () => null, ResponsiveContainer: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }));
import PlaygroundPage from '../src/pages/playground/PlaygroundPage';
import { useMeditationSessionStore } from '../src/stores/useMeditationSessionStore';

it('운영 화면은 한 번 클릭으로 체험·명상을 시작하고 종료 때 예시 상태를 초기화한다', async () => {
  vi.stubEnv('DEV', false);
  try {
    await act(async () => root.render(<PlaygroundPage />));
    const start = [...container.querySelectorAll('button')].find(button => button.textContent === '체험 모드(예시 데이터)');
    expect(start).toBeDefined();
    await act(async () => start!.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe('예시 데이터입니다 · 실제 측정값이 아닙니다');
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(useMeditationSessionStore.getState().elapsedSec).toBe(5);
    expect(container.textContent).toContain('추정 참고 지표');
    expect(container.textContent).not.toMatch(/Debug panel|Calibration panel|Normalization panel/);
    const stop = [...container.querySelectorAll('button')].find(button => button.textContent === '체험 종료');
    await act(async () => stop!.click());
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(useMeditationSessionStore.getState().elapsedSec).toBe(0);
    expect(calls.queue).not.toHaveBeenCalled(); expect(calls.upload).not.toHaveBeenCalled();
  } finally { vi.unstubAllEnvs(); }
});


it('명시적 실측 선택은 이전 환경의 예시 설정을 덮어쓴다', async () => {
  vi.stubEnv('VITE_USE_MOCK_EEG', 'true');
  try {
    await act(async () => root.render(<Harness forceMock={false} />));
    expect(band.isMock).toBe(false);
  } finally { vi.unstubAllEnvs(); }
});
