// SDD-246 T06 후속 — WebCaptureAdapter → live:metric, capture.start/renew/reanchor/close 흐름.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureController, RENEW_INTERVAL_MS } from '../../src/lib/measurement-web/capture-controller';
import type { CommandAck } from '../../src/lib/session-live/live-types';

const ack = (over: Partial<CommandAck> = {}): CommandAck => ({
  command_id: 'c', status: 'applied', epoch: '1', cursors: [], committed: true, ...over,
});

function makeClient() {
  const calls: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const metrics: Array<Record<string, unknown>> = [];
  let sendOk = true;
  return {
    calls, metrics,
    setSendOk: (v: boolean) => { sendOk = v; },
    client: {
      request: vi.fn(async (kind: string, payload: Record<string, unknown>) => {
        calls.push({ kind, payload });
        return ack();
      }),
      sendMetric: vi.fn((m: Record<string, unknown>) => { metrics.push(m); return sendOk; }),
      clockProbe: vi.fn(async () => ({ probeId: '0000000b-0000-4000-8000-00000000000b', rttMs: 20, offsetMs: 3, serverReceiveMs: 1, serverSendMs: 2 })),
    },
  };
}

describe('CaptureController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('미착용·EEG 미동의면 capture 요청 0', async () => {
    const { client, calls } = makeClient();
    const c = new CaptureController({ client: client as never, eegConsent: false, bandConnected: true, readStream: () => null, deviceProfile: 'linkband2-v1', algorithmVersion: 'web-ts-1', modelVersion: 'm' });
    await expect(c.start()).resolves.toBe('not_allowed');
    const d = new CaptureController({ client: client as never, eegConsent: true, bandConnected: false, readStream: () => null, deviceProfile: 'p', algorithmVersion: 'a', modelVersion: 'm' });
    await expect(d.start()).resolves.toBe('not_allowed');
    expect(calls).toHaveLength(0);
  });

  it('start → capture.start 후 stream_id 로 envelope 을 live:metric 으로 보낸다', async () => {
    const { client, calls, metrics } = makeClient();
    const c = new CaptureController({ client: client as never, eegConsent: true, bandConnected: true, readStream: () => ({ streamId: '0000000a-0000-4000-8000-00000000000a', generation: '1' }), deviceProfile: 'linkband2-v1', algorithmVersion: 'web-ts-1', modelVersion: 'm' });
    expect(await c.start()).toBe('started');
    expect(calls[0]).toMatchObject({ kind: 'capture.start', payload: { device_profile: 'linkband2-v1', algorithm_version: 'web-ts-1', model_version: 'm' } });
    expect(c.streamId()).toBe('0000000a-0000-4000-8000-00000000000a');
    expect(c.pushEnvelope({ sequence: '1', sqi: 0.9 })).toBe(true);
    expect(metrics[0]).toMatchObject({ stream_id: '0000000a-0000-4000-8000-00000000000a', sequence: '1' });
  });

  it('start 거절이면 envelope 을 보내지 않는다', async () => {
    const { client, metrics } = makeClient();
    client.request.mockResolvedValueOnce(ack({ status: 'rejected', code: 'eeg_consent_required' }));
    const c = new CaptureController({ client: client as never, eegConsent: true, bandConnected: true, readStream: () => ({ streamId: '0000000a-0000-4000-8000-00000000000a', generation: '1' }), deviceProfile: 'p', algorithmVersion: 'a', modelVersion: 'm' });
    expect(await c.start()).toBe('rejected');
    expect(c.pushEnvelope({ sequence: '1' })).toBe(false);
    expect(metrics).toHaveLength(0);
  });

  it('주기적으로 capture.renew, reanchor 는 clock_probe 를 거친다, close 는 capture.close', async () => {
    const { client, calls } = makeClient();
    const c = new CaptureController({ client: client as never, eegConsent: true, bandConnected: true, readStream: () => ({ streamId: '0000000a-0000-4000-8000-00000000000a', generation: '1' }), deviceProfile: 'p', algorithmVersion: 'a', modelVersion: 'm' });
    await c.start();
    await vi.advanceTimersByTimeAsync(RENEW_INTERVAL_MS + 10);
    expect(calls.some((x) => x.kind === 'capture.renew' && x.payload.owner_generation === '1')).toBe(true);
    await c.reanchor({ deviceTicks: '100', monotonicUs: '200' });
    expect(calls.find((x) => x.kind === 'capture.reanchor')?.payload).toMatchObject({ clock_probe_id: '0000000b-0000-4000-8000-00000000000b', device_ticks: '100', monotonic_us: '200' });
    await c.close('user_end');
    expect(calls.at(-1)).toMatchObject({ kind: 'capture.close' });
    expect(c.streamId()).toBeNull();
    const n = calls.length;
    await vi.advanceTimersByTimeAsync(RENEW_INTERVAL_MS * 2);
    expect(calls).toHaveLength(n);
  });
});
