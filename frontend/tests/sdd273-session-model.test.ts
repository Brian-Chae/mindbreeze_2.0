// SDD-273 — WebMeasurementSession 이 시작 시 활성 표준 모델을 1회 pin 한다(V4~V9).
import { describe, expect, it, vi } from 'vitest';
import { WebMeasurementSession } from '../src/lib/measurement-web/web-measurement-session';
import { fetchActiveModelForStart, buildWebModelPin, webModelVersionOf } from '../src/lib/measurement-web/model-pin';
import type { WorkerLike } from '../src/lib/measurement-web/capture-adapter';
import type { NormalizationModelDto } from '../src/lib/api/normalization-api';
import type { CommandAck } from '../src/lib/session-live/live-types';

const SID = '11111111-1111-4111-8111-111111111111';
const model = (params: NormalizationModelDto['params'], version: number | string = 7): NormalizationModelDto =>
  ({ id: 1, version, n_samples: 10, created_at: '', is_active: true, params });
const GOOD = model({ focusIndex: { m: 0.3, s: 0.8, direction: 1 }, relaxationIndex: { m: -1.4, s: 0.5, direction: 1 } });

class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  posted: Record<string, unknown>[] = [];
  constructor(private readonly ok = true) {}
  postMessage(msg: unknown): void {
    const m = msg as Record<string, unknown>;
    this.posted.push(m);
    if (m.type === 'init') queueMicrotask(() => this.onmessage?.({ data: this.ok ? { type: 'ready' } : { type: 'init_error', message: 'set_model_failed' } }));
    if (m.type === 'close') queueMicrotask(() => this.onmessage?.({ data: { type: 'closed', final: null } }));
  }
  terminate(): void {}
}

function make(fetchModel: () => Promise<NormalizationModelDto | null>, workerOk = true) {
  const worker = new FakeWorker(workerOk);
  const started: Record<string, unknown>[] = [];
  const client = {
    request: vi.fn(async (kind: string, payload: Record<string, unknown>): Promise<CommandAck> => {
      if (kind === 'capture.start') started.push(payload);
      return { command_id: 'c', status: 'applied', epoch: '1', cursors: [], committed: true,
        result: { stream_id: '33333333-3333-4333-8333-333333333333', participant_id: '22222222-2222-4222-8222-222222222222', generation: '1', owner_generation: '1', lease: { expires_at_ms: 1 } } };
    }),
    sendMetricBatch: vi.fn(async () => ({ kind: 'acks' as const, acks: [] })),
    sendDevice: vi.fn(async () => ({ kind: 'ack' as const, status: 'accepted' as const })),
    clockProbe: vi.fn(async () => null),
  };
  const session = new WebMeasurementSession({
    client: client as never, sessionId: SID, accountId: 'entry:p', createWorker: () => worker,
    subscribeRaw: () => () => undefined, fetchModel,
  });
  return { session, worker, client, started };
}
const init = (w: FakeWorker) => w.posted.find((m) => m.type === 'init') as { configJson: string; modelJson: string | null; meta: { modelVersion: string } };

describe('SDD-273 세션: 시작 시 활성 모델 1회 pin', () => {
  it('V4 모델 있음: 워커 init 에 modelJson + active_sigmoid, capture.start modelVersion 이 코어 config·메타와 같다', async () => {
    const t = make(async () => GOOD);
    expect(await t.session.start({ eegConsent: true, bandConnected: true })).toBe('capturing');
    const i = init(t.worker);
    const cfg = JSON.parse(i.configJson) as Record<string, string>;
    expect(cfg.model_mode).toBe('active_sigmoid');
    expect(cfg.model_version).toBe('sigmoid-7');
    expect(cfg.model_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(i.meta.modelVersion).toBe('sigmoid-7');
    expect(JSON.parse(i.modelJson as string)).toEqual({ focusIndex: { m: 0.3, s: 0.8, direction: 1 }, relaxationIndex: { m: -1.4, s: 0.5, direction: 1 } });
    expect(t.started[0].model_version).toBe('sigmoid-7');
    await t.session.stop('t');
  });

  it('V5 모델 없음/유효 지표 0개: legacy_cohort(b0-cohort-2) 유지하고 정상 시작', async () => {
    for (const m of [null, model({ focusIndex: { m: 0, s: 0, direction: 1 } })]) {
      const t = make(async () => m);
      expect(await t.session.start({ eegConsent: true, bandConnected: true })).toBe('capturing');
      const cfg = JSON.parse(init(t.worker).configJson) as Record<string, string>;
      expect(cfg.model_mode).toBe('legacy_cohort');
      expect(cfg.model_version).toBe('b0-cohort-2');
      expect(init(t.worker).modelJson).toBeNull();
      expect(t.started[0].model_version).toBe('b0-cohort-2');
      await t.session.stop('t');
    }
  });

  it('V5 조회가 throw 해도 시작은 legacy 로 이어진다', async () => {
    const t = make(async () => { throw new Error('network'); });
    expect(await t.session.start({ eegConsent: true, bandConnected: true })).toBe('capturing');
    expect(init(t.worker).modelJson).toBeNull();
    await t.session.stop('t');
  });

  it('V7 시작 후 모델이 바뀌어도 세션 중 교체하지 않는다(init 은 1회)', async () => {
    let current: NormalizationModelDto | null = GOOD;
    const t = make(async () => current);
    await t.session.start({ eegConsent: true, bandConnected: true });
    current = model({ focusIndex: { m: 9, s: 9, direction: 1 } }, 8);
    await t.session.start({ eegConsent: true, bandConnected: true });
    expect(t.worker.posted.filter((m) => m.type === 'init')).toHaveLength(1);
    expect(t.worker.posted.some((m) => m.type === 'set_model')).toBe(false);
    await t.session.stop('t');
  });

  it('V9 set_model 실패(워커 init_error)면 core_unavailable, 서버 capture.start 요청 없음', async () => {
    const t = make(async () => GOOD, false);
    expect(await t.session.start({ eegConsent: true, bandConnected: true })).toBe('core_unavailable');
    expect(t.started).toHaveLength(0);
  });
});

describe('SDD-273 model-pin 단위', () => {
  it('V8 s≤0·direction 3·음수 s 지표는 제외, 나머지만 pin', async () => {
    const pin = await buildWebModelPin(model({
      focusIndex: { m: 0, s: 0, direction: 1 },
      relaxationIndex: { m: 0, s: 1, direction: 3 as never },
      stressIndex: { m: 0.2, s: 0.9, direction: -1 },
      faa: { m: 0, s: -1, direction: -1 },
    }));
    expect(pin && JSON.parse(pin.paramsJson)).toEqual({ stressIndex: { m: 0.2, s: 0.9, direction: -1 } });
  });

  it('model_version 은 서버 _VERSION_RE 를 항상 통과하고 64자 이하', () => {
    const re = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
    for (const v of [7, '12', 'v 1/2!', '', null, 'x'.repeat(200)]) expect(webModelVersionOf(v as never)).toMatch(re);
    expect(webModelVersionOf(7)).toBe('sigmoid-7');
  });

  it('V6 일시 실패 후 재시도 성공(3초 이내), 끝내 실패하면 null', async () => {
    const refresh = vi.fn<() => Promise<NormalizationModelDto | null>>().mockResolvedValueOnce(null).mockResolvedValueOnce(GOOD);
    const got = await fetchActiveModelForStart({ getCache: () => null, refresh, delaysMs: [1, 1], timeoutMs: 1000 });
    expect(got).toBe(GOOD);
    expect(refresh).toHaveBeenCalledTimes(2);
    const never = vi.fn(async () => null);
    expect(await fetchActiveModelForStart({ getCache: () => null, refresh: never, delaysMs: [1, 1], timeoutMs: 1000 })).toBeNull();
    expect(never).toHaveBeenCalledTimes(3);
  });

  it('조회가 멈춰도 timeout 안에 null 로 풀려 시작을 막지 않는다', async () => {
    const hang = () => new Promise<NormalizationModelDto | null>(() => undefined);
    const t0 = Date.now();
    expect(await fetchActiveModelForStart({ getCache: () => null, refresh: hang, delaysMs: [], timeoutMs: 50 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('캐시가 있으면 조회 없이 즉시 사용', async () => {
    const refresh = vi.fn(async () => null);
    expect(await fetchActiveModelForStart({ getCache: () => GOOD, refresh })).toBe(GOOD);
    expect(refresh).not.toHaveBeenCalled();
  });
});
