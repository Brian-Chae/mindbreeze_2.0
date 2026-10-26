// @vitest-environment jsdom
// SDD-246 T06c — useWebMeasurementV2: v2 off/미지원/앱 이면 Worker·capture 요청 0, v2 on+웹+착용+동의면 READY 후 시작.
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toBandReport } from '../../src/lib/measurement-web/band-report';
import type { UseLiveV2Result } from '../../src/lib/session-live/use-live-v2';
import type { LiveClient } from '../../src/lib/session-live/live-client';

const h = vi.hoisted(() => ({ v2: true, native: false, ble: true, workers: 0 }));
vi.mock('../../src/lib/session-live/live-flag', () => ({ isLiveProtocolV2Enabled: () => h.v2 }));
vi.mock('../../src/lib/native-measurement', () => ({ isNativeMeasurementAvailable: () => h.native }));
vi.mock('../../src/lib/ble', () => ({ isBleSupported: () => h.ble }));

import { useWebMeasurementV2, type UseWebMeasurementResult } from '../../src/lib/measurement-web/use-web-measurement';

class NoWasmWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor() { h.workers += 1; }
  postMessage(m: { type: string }): void {
    if (m.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'init_error', message: 'wasm_unavailable' } }));
  }
  terminate(): void { /* 시험용 */ }
}

function liveV2(request: ReturnType<typeof vi.fn>): UseLiveV2Result {
  const client = { request, sendMetricBatch: vi.fn(), sendDevice: vi.fn(), clockProbe: vi.fn() } as unknown as LiveClient;
  return { active: true, state: null, client, nowMs: 0, ready: true, rows: () => [] };
}

let root: Root;
let host: HTMLDivElement;
const seen: { last: UseWebMeasurementResult | null } = { last: null };
function Probe(p: Parameters<typeof useWebMeasurementV2>[0]) {
  const r = useWebMeasurementV2(p);
  useEffect(() => { seen.last = r; });
  return null;
}
const band = toBandReport({ connectionState: 'connected', leadOff: { ch1: false, ch2: false }, signalQuality: 80, battery: 90 });
const base = (request: ReturnType<typeof vi.fn>) => ({
  liveV2: liveV2(request), sessionId: '00000001-0000-4000-8000-000000000001', selfParticipantId: '00000002-0000-4000-8000-000000000002',
  bandOptIn: true, eegConsent: true, bandConnected: true, band, enabled: true,
});

async function render(p: Parameters<typeof useWebMeasurementV2>[0]): Promise<void> {
  await act(async () => { root.render(<Probe {...p} />); });
  await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
}

describe('useWebMeasurementV2', () => {
  beforeEach(() => {
    h.v2 = true; h.native = false; h.ble = true; h.workers = 0; seen.last = null;
    vi.stubGlobal('Worker', NoWasmWorker);
    host = document.createElement('div');
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

  it('v2 플래그 off 면 legacy — Worker·capture 요청 0', async () => {
    h.v2 = false;
    const request = vi.fn();
    await render(base(request));
    expect(seen.last?.path).toBe('legacy');
    expect(h.workers).toBe(0);
    expect(request).not.toHaveBeenCalled();
  });

  it('Web Bluetooth 미지원·EEG 미동의면 off — Worker·capture 요청 0', async () => {
    h.ble = false;
    const request = vi.fn();
    await render(base(request));
    expect(seen.last?.path).toBe('off');
    await render({ ...base(request), eegConsent: false });
    expect(seen.last?.path).toBe('off');
    expect(h.workers).toBe(0);
    expect(request).not.toHaveBeenCalled();
  });

  it('앱(native)은 웹 수집을 만들지 않는다(native facade 경로)', async () => {
    h.native = true;
    const request = vi.fn();
    await render(base(request));
    expect(seen.last?.path).toBe('native');
    expect(h.workers).toBe(0);
  });

  it('웹+v2+착용+동의면 READY 에서 워커를 올리고, WASM 이 없으면 서버 요청 없이 core_unavailable', async () => {
    const request = vi.fn();
    await render(base(request));
    expect(seen.last?.path).toBe('web_wasm');
    expect(h.workers).toBe(1);
    expect(seen.last?.status).toBe('core_unavailable');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('toBandReport', () => {
  it('접촉은 leadoff 에서만, SQI 0~1, 미연결이면 unknown/null(0 으로 채우지 않음)', () => {
    expect(toBandReport({ connectionState: 'connected', leadOff: { ch1: false, ch2: true }, signalQuality: 75, battery: 64.6 }))
      .toEqual({ band_state: 'connected', contact: { fp1: 'contact', fp2: 'leadoff' }, sqi: 0.75, battery_pct: 65, state_reason: null });
    expect(toBandReport({ connectionState: 'disconnected', leadOff: null, signalQuality: null, battery: null }))
      .toEqual({ band_state: 'not_worn', contact: { fp1: 'unknown', fp2: 'unknown' }, sqi: null, battery_pct: null, state_reason: null });
  });
});
