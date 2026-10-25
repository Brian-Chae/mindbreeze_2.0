// SDD-246 T06 — lib/measurement-web: WASM McCore(Web Worker) 어댑터. 가짜 코어/가짜 Worker 로 계약만 검증한다.
// 실제 WASM 수치 패리티는 T02(cargo test·verify-wasm)와 아래 선택 시험(MC_WASM_PKG 지정 시)이 맡는다.
import { describe, expect, it, vi } from 'vitest';
import { CoreSession, type McCoreLike } from '../../src/lib/measurement-web/core-session';
import { WebCaptureAdapter, type WorkerLike } from '../../src/lib/measurement-web/capture-adapter';
import { toMetricEnvelope } from '../../src/lib/measurement-web/envelope';

const FRAME = {
  sequence: '5', window_start_us: '1000000', window_end_us: '2000000', observed_at_ms: 1_760_000_000_000,
  sqi: 0.9, contact: { fp1: 'contact', fp2: 'contact' },
  metrics: { focus_display: { value: 50, unit: 'score_0_100', validity: 'valid', reason: null, last_valid_sequence: '5', last_valid_observed_at_ms: 1_760_000_000_000 } },
  feature_hash: 'f'.repeat(64),
};

function fakeCore(frames: unknown[] = [FRAME]): McCoreLike & { pushed: number; freed: boolean } {
  const c = {
    pushed: 0,
    freed: false,
    push_packet_raw: vi.fn((): string => { c.pushed += 1; return JSON.stringify({ ok: true, value: { packet: { status: 'accepted' }, frames: c.pushed === 1 ? frames : [] } }); }),
    advance: vi.fn((): string => JSON.stringify({ ok: true, value: { frames: [] } })),
    checkpoint: vi.fn(() => new Uint8Array([1])),
    close: vi.fn((): string => JSON.stringify({ ok: true, value: { final_sequences: { eeg: '1', ppg: '0', acc: '0', metric: '1' }, segments: 1, raw_sha256: 'a'.repeat(64), feature_sha256: 'b'.repeat(64) } })),
    free: vi.fn(() => { c.freed = true; }),
  };
  return c as unknown as McCoreLike & { pushed: number; freed: boolean };
}

const META = {
  sessionId: '00000001-0000-4000-8000-000000000001',
  participantId: '00000002-0000-4000-8000-000000000002',
  streamId: '00000014-0000-4000-8000-000000000014',
  streamGeneration: '3',
  clockAnchorId: '0000001e-0000-4000-8000-00000000001e',
  clockUncertaintyMs: 12.5,
  deviceProfileVersion: 'linkband2-v1', algorithmVersion: 'web-ts-1', modelVersion: 'b0-cohort-2',
};

describe('toMetricEnvelope', () => {
  it('프레임에 식별·버전 필드를 붙이고 종합점수 필드는 만들지 않는다', () => {
    const env = toMetricEnvelope(FRAME as never, META);
    expect(env).toMatchObject({ stream_id: META.streamId, stream_generation: '3', sequence: '5', feature_hash: FRAME.feature_hash });
    expect(Object.keys(env)).not.toContain('score');
    expect(Object.keys(env.metrics)).toEqual(['focus_display']);
  });
});

describe('CoreSession (워커 내부 로직)', () => {
  it('packet → 프레임을 envelope 로 반환하고 오류 값은 throw 하지 않는다', () => {
    const core = fakeCore();
    const s = new CoreSession(core, META);
    const out = s.push({ sensor: 'eeg', bytes: new Uint8Array([1, 2, 3]), arrivalUs: 1, wallMs: 2, anchorUs: 0 });
    expect(out.envelopes).toHaveLength(1);
    expect(out.error).toBeNull();
    (core.push_packet_raw as ReturnType<typeof vi.fn>).mockReturnValueOnce(JSON.stringify({ ok: false, error: { code: 'invalid_config', message: 'x' } }));
    const bad = s.push({ sensor: 'eeg', bytes: new Uint8Array([1]), arrivalUs: 1, wallMs: 2, anchorUs: 0 });
    expect(bad.envelopes).toEqual([]);
    expect(bad.error?.code).toBe('invalid_config');
  });

  it('close 는 final manifest 를 돌려주고 핸들을 해제하며 이후 push 는 거절', () => {
    const core = fakeCore();
    const s = new CoreSession(core, META);
    const fin = s.close();
    expect(fin?.final_sequences.metric).toBe('1');
    expect(core.freed).toBe(true);
    expect(s.push({ sensor: 'eeg', bytes: new Uint8Array([1]), arrivalUs: 1, wallMs: 2, anchorUs: 0 }).error?.code).toBe('closed');
  });
});

class FakeWorker implements WorkerLike {
  sent: unknown[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  terminated = false;
  postMessage(m: unknown): void { this.sent.push(m); }
  terminate(): void { this.terminated = true; }
  reply(data: unknown): void { this.onmessage?.({ data }); }
}

describe('WebCaptureAdapter', () => {
  it('밴드 미착용(start 전)에는 워커를 만들지 않고 어떤 코어/권한/capture 요청도 보내지 않는다', () => {
    const create = vi.fn(() => new FakeWorker());
    const onCaptureRequest = vi.fn();
    const a = new WebCaptureAdapter({ createWorker: create, onEnvelope: vi.fn(), onCaptureRequest });
    a.pushPacket({ sensor: 'eeg', bytes: new Uint8Array([1]), arrivalUs: 1, wallMs: 1, anchorUs: 0 });
    expect(create).not.toHaveBeenCalled();
    expect(onCaptureRequest).not.toHaveBeenCalled();
    expect(a.isActive()).toBe(false);
  });

  it('EEG 동의 없이는 start 가 거절된다(코어·capture 요청 0)', async () => {
    const create = vi.fn(() => new FakeWorker());
    const onCaptureRequest = vi.fn();
    const a = new WebCaptureAdapter({ createWorker: create, onEnvelope: vi.fn(), onCaptureRequest });
    await expect(a.start({ ...META, eegConsent: false, bandConnected: true, configJson: '{}' })).rejects.toThrow('eeg_consent_required');
    expect(create).not.toHaveBeenCalled();
    expect(onCaptureRequest).not.toHaveBeenCalled();
  });

  it('start 후 packet 은 Transferable 로 워커에 전달되고 envelope 가 콜백된다', async () => {
    const w = new FakeWorker();
    const envs: unknown[] = [];
    const a = new WebCaptureAdapter({ createWorker: () => w, onEnvelope: (e) => envs.push(e), onCaptureRequest: vi.fn() });
    const p = a.start({ ...META, eegConsent: true, bandConnected: true, configJson: '{}' });
    expect((w.sent[0] as { type: string }).type).toBe('init');
    w.reply({ type: 'ready' });
    await p;
    a.pushPacket({ sensor: 'ppg', bytes: new Uint8Array([9, 9]), arrivalUs: 5, wallMs: 6, anchorUs: 0 });
    expect((w.sent[1] as { type: string; sensor: string }).type).toBe('packet');
    w.reply({ type: 'frames', envelopes: [toMetricEnvelope(FRAME as never, META)], error: null });
    expect(envs).toHaveLength(1);
  });

  it('stop 은 워커 close 결과(final manifest)를 받은 뒤 terminate 한다', async () => {
    const w = new FakeWorker();
    const a = new WebCaptureAdapter({ createWorker: () => w, onEnvelope: vi.fn(), onCaptureRequest: vi.fn() });
    const p = a.start({ ...META, eegConsent: true, bandConnected: true, configJson: '{}' });
    w.reply({ type: 'ready' }); await p;
    const stopping = a.stop();
    expect((w.sent.at(-1) as { type: string }).type).toBe('close');
    w.reply({ type: 'closed', final: { final_sequences: { eeg: '1', ppg: '0', acc: '0', metric: '1' }, segments: 1, raw_sha256: 'a', feature_sha256: 'b' } });
    const fin = await stopping;
    expect(fin?.segments).toBe(1);
    expect(w.terminated).toBe(true);
    expect(a.isActive()).toBe(false);
  });

  it('워커 init 실패(WASM 없음)는 start 를 거절하고 측정을 시도하지 않는다', async () => {
    const w = new FakeWorker();
    const a = new WebCaptureAdapter({ createWorker: () => w, onEnvelope: vi.fn(), onCaptureRequest: vi.fn() });
    const p = a.start({ ...META, eegConsent: true, bandConnected: true, configJson: '{}' });
    w.reply({ type: 'init_error', message: 'wasm_unavailable' });
    await expect(p).rejects.toThrow('wasm_unavailable');
    expect(w.terminated).toBe(true);
  });
});
