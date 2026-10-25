// SDD-246 T06 — WASM McCore 래퍼(워커 안에서 실행). 코어 결과는 `{ok,value|error}` 값이며 throw 하지 않는다.
import { toMetricEnvelope, type CoreFinalManifest, type CoreMetricFrame, type EnvelopeMeta, type MetricEnvelope } from './envelope';

/** wasm-bindgen `McCore` 의 사용 부분(packages/measurement-core WASM). */
export interface McCoreLike {
  push_packet_raw(sensor: number, bytes: Uint8Array, arrivalUs: number, wallMs: number, anchorUs: number): string;
  advance(monoUs: number): string;
  checkpoint(): Uint8Array;
  close(): string;
  free(): void;
}

export type SensorName = 'eeg' | 'ppg' | 'acc';
const SENSOR_CODE: Record<SensorName, number> = { eeg: 0, ppg: 1, acc: 2 };

export interface PacketInput {
  sensor: SensorName;
  bytes: Uint8Array;
  arrivalUs: number;
  wallMs: number;
  anchorUs: number;
}

export interface CoreErrorValue { code: string; message: string }
export interface PushOutput { envelopes: MetricEnvelope[]; error: CoreErrorValue | null; status: string | null }

type CoreResult<T> = { ok: true; value: T } | { ok: false; error: CoreErrorValue };

function parse<T>(raw: string): CoreResult<T> {
  try {
    return JSON.parse(raw) as CoreResult<T>;
  } catch {
    return { ok: false, error: { code: 'invalid_config', message: 'unparseable core output' } };
  }
}

export class CoreSession {
  private core: McCoreLike | null;
  private readonly meta: EnvelopeMeta;

  constructor(core: McCoreLike, meta: EnvelopeMeta) {
    this.core = core;
    this.meta = meta;
  }

  push(p: PacketInput): PushOutput {
    if (!this.core) return { envelopes: [], error: { code: 'closed', message: 'session closed' }, status: null };
    const r = parse<{ packet: { status: string }; frames: CoreMetricFrame[] }>(
      this.core.push_packet_raw(SENSOR_CODE[p.sensor], p.bytes, p.arrivalUs, p.wallMs, p.anchorUs),
    );
    if (!r.ok) return { envelopes: [], error: r.error, status: null };
    return {
      envelopes: r.value.frames.map((f) => toMetricEnvelope(f, this.meta)),
      error: null,
      status: r.value.packet.status,
    };
  }

  /** 패킷이 없어도 시간이 흐르면 gap 프레임을 만든다 */
  advance(monoUs: number): PushOutput {
    if (!this.core) return { envelopes: [], error: { code: 'closed', message: 'session closed' }, status: null };
    const r = parse<{ frames: CoreMetricFrame[] }>(this.core.advance(monoUs));
    if (!r.ok) return { envelopes: [], error: r.error, status: null };
    return { envelopes: r.value.frames.map((f) => toMetricEnvelope(f, this.meta)), error: null, status: null };
  }

  checkpoint(): Uint8Array | null {
    return this.core ? this.core.checkpoint() : null;
  }

  close(): CoreFinalManifest | null {
    if (!this.core) return null;
    const r = parse<CoreFinalManifest>(this.core.close());
    this.core.free();
    this.core = null;
    return r.ok ? r.value : null;
  }
}
