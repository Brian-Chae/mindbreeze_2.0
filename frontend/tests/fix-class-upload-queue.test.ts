// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';

const native = vi.hoisted(() => ({ isNative: false, request: vi.fn(async () => ({ status: 200 })) }));
vi.mock('@capacitor/core', async importOriginal => ({ ...(await importOriginal<object>()), Capacitor: { isNativePlatform: () => native.isNative }, CapacitorHttp: { request: native.request } }));

import { BiosignalQueue, LEASE_TTL_MS } from '../src/lib/biosignal/durable-queue';
import { uploadBiosignalQueue, UPLOAD_BATCH } from '../src/lib/biosignal/upload-queue';
import { putEegRawToPresignedUrl } from '../src/lib/api/eeg-raw';
import { ApiError } from '../src/lib/api/client';
import { AnalysisMetricsService } from '../src/lib/eeg/AnalysisMetricsService';
import { applyEegFeatureToMetrics } from '../src/lib/session-live/apply-eeg-feature';

const scope = { accountId: 'user:1', sessionId: 's1', participantId: 'p1', deviceAlias: 'LINK-BAND' };
let now = 1_000_000;
const feat = (i: number) => ({ artifact_alias: `FEATURES-${i}`, artifact_kind: 'feature' as const, stream_id: 'st', segment_id: 'sg', signal: 'ppg' as const, sequence: i, row_count: 1, schema_version: 'feature-v1', checksum: `c${i}`, size_bytes: 8 });
const payload = () => new Uint8Array(8).buffer;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  now = 1_000_000; native.isNative = false; native.request.mockClear();
});

describe('전송 큐: presign 남발·적체', () => {
  it('한 번에 UPLOAD_BATCH 건만 payload 를 읽고, 같은 객체를 겹쳐 presign 하지 않는다', async () => {
    const queue = new BiosignalQueue(scope, 'tab-a', () => now);
    await queue.acquire();
    for (let i = 0; i < 100; i++) await queue.enqueueArtifact(feat(i), payload());
    expect((await queue.counts()).pending).toBe(100);
    const seen: string[] = [];
    const api = { presign: vi.fn(async (_s: string, _p: string | null, _k: string, meta: { artifact_alias: string; checksum: string; size_bytes: number }) => { seen.push(meta.artifact_alias); return { artifact_id: meta.artifact_alias, artifact_alias: meta.artifact_alias, checksum: meta.checksum, size_bytes: 8, upload_url: 'https://s3/x', upload_headers: {}, upload_status: 'pending' as const }; }),
      ack: vi.fn(async (_s: string, _p: string | null, _k: string, id: string, checksum: string) => ({ artifact_id: id, artifact_alias: id, checksum, size_bytes: 8, upload_status: 'uploaded' as const, verified_at_us: '1', failure_reason: null })) };
    const put = vi.fn(async () => undefined);
    const summary = await uploadBiosignalQueue(queue, api as never, put, () => true, () => now);
    expect(summary.acked).toBe(UPLOAD_BATCH);
    expect(new Set(seen).size).toBe(seen.length);
    expect((await queue.counts()).pending).toBe(100 - UPLOAD_BATCH);
  });

  it('409 는 영구 재시도하지 않고 보관(dead_letter)하며 다음 라운드에서 다시 presign 하지 않는다', async () => {
    const queue = new BiosignalQueue(scope, 'tab-a', () => now);
    await queue.acquire();
    await queue.enqueueArtifact(feat(1), payload());
    const api = { presign: vi.fn(async () => { throw new ApiError(409, 'conflict', { code: 'artifact_conflict' }); }), ack: vi.fn() };
    await uploadBiosignalQueue(queue, api as never, vi.fn(), () => true, () => now);
    await uploadBiosignalQueue(queue, api as never, vi.fn(), () => true, () => now + 120_000);
    expect(api.presign).toHaveBeenCalledTimes(1);
    expect(await queue.counts()).toEqual({ pending: 0, blocked: 1 });
  });
});

describe('기록 잠금(lease)', () => {
  it('메인 스레드가 오래 멈춰 TTL 이 지나도 같은 창이면 권한을 유지한다', async () => {
    const queue = new BiosignalQueue(scope, 'tab-a', () => now);
    await queue.acquire();
    now += LEASE_TTL_MS * 3;
    await expect(queue.renew()).resolves.toBeUndefined();
  });
  it('다른 창이 쥔 lease 는 TTL 이 지나면 자동으로 인계된다', async () => {
    const a = new BiosignalQueue(scope, 'tab-a', () => now);
    await a.acquire();
    const b = new BiosignalQueue(scope, 'tab-b', () => now);
    await expect(b.acquire()).rejects.toThrow(/lease_held/);
    now += LEASE_TTL_MS + 1;
    await expect(b.acquire()).resolves.toBeGreaterThan(0);
  });
  it('정상 종료(release) 후 즉시 다른 창이 획득한다', async () => {
    const a = new BiosignalQueue(scope, 'tab-a', () => now);
    await a.acquire(); await a.release();
    await expect(new BiosignalQueue(scope, 'tab-b', () => now).acquire()).resolves.toBeGreaterThan(0);
  });
});

describe('네이티브 S3 PUT', () => {
  it('Android 앱은 WebView CORS 를 거치지 않는 CapacitorHttp 로 서명 헤더 그대로 PUT 한다', async () => {
    native.isNative = true;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await putEegRawToPresignedUrl('https://s3/x', payload(), { 'x-amz-checksum-sha256': 'abc' });
    expect(native.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'PUT', url: 'https://s3/x', headers: { 'x-amz-checksum-sha256': 'abc' }, dataType: 'file' }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('호흡·HRV 계산', () => {
  it('RR 끝 시각이 NaN 이어도 RR 버퍼가 쌓여 SDNN 이 계산된다', async () => {
    AnalysisMetricsService.resetInstance();
    const svc = AnalysisMetricsService.getInstance();
    let t = 5_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => t);
    const rr = [820, 860, 800, 900, 840, 780, 880, 830, 810, 870];
    for (let i = 0; i < 12; i++) {
      t += 5000;
      await svc.processPPGAnalysisMetrics({ vitals: { heartRate: 72 } }, t, 90, true, rr, rr.map(() => NaN));
    }
    expect(svc.getCurrentSDNN()).not.toBeNull();
    vi.restoreAllMocks();
  });
});

describe('상담사 화면 HRV', () => {
  it('live 이벤트의 sdnn 이 행에 반영된다', () => {
    const rows = [{ participant_id: 'p1', display_name: 'a', is_guest: false, band_connected: true, device_status: 'ok', band_battery: 50, avg_efficiency: null, current_efficiency: 50, upload_status: 'streaming', last_eeg_at: new Date().toISOString(), signal_quality: 0.9 }] as never;
    const out = applyEegFeatureToMetrics(rows, { participant_id: 'p1', band_connected: true, feature: { sdnn: 42, respiratory_rate: 14, heart_rate: 70 } } as never);
    expect((out[0] as { sdnn?: number }).sdnn).toBe(42);
  });
});
