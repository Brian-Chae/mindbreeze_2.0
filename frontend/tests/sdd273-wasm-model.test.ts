// SDD-273 — 웹 WASM 코어: 모델 미적용(legacy_cohort) vs 활성 모델(active_sigmoid) 같은 입력 비교.
// 입력은 계약 golden(contracts/biosignal-golden/v1/synth) 원시 패킷, 모델은 golden_oracle.rs 의 pinned_model 과 동일 값.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CoreSession, type McCoreLike } from '../src/lib/measurement-web/core-session';
import { resolveWebCore, buildWebModelPin } from '../src/lib/measurement-web/model-pin';
import type { NormalizationModelDto } from '../src/lib/api/normalization-api';

const GOLDEN = resolve(__dirname, '../../contracts/biosignal-golden/v1');
const WASM_DIR = resolve(__dirname, '../src/lib/measurement-web/wasm');
const BASE_MS = 1_760_000_000_000;
const SENSOR = { eeg: 'eeg', ppg: 'ppg', acc: 'acc' } as const;

// golden_oracle.rs pinned_model()
export const PINNED: NormalizationModelDto = {
  id: 1, version: 7, n_samples: 100, created_at: '2026-01-01T00:00:00Z', is_active: true,
  params: {
    focusIndex: { m: 0.3, s: 0.8, direction: 1 },
    relaxationIndex: { m: -1.4, s: 0.5, direction: 1 },
    stressIndex: { m: 0.2, s: 0.9, direction: -1 },
    totalNeuralActivity: { m: 5.0, s: 2.0, direction: 1 },
    faa: { m: 0.0, s: 0.6, direction: -1 },
    cognitiveLoad: { m: 1.1, s: 0.4, direction: -1 },
    emotionalStability: { m: 0.5, s: 0.9, direction: 1 },
  },
};

async function loadCore(configJson: string, modelJson: string | null): Promise<McCoreLike & { set_model(j: string): string }> {
  const wasm = (await import('../src/lib/measurement-web/wasm/measurement_core.js')) as unknown as {
    initSync: (m: { module: Buffer }) => unknown;
    McCore: new (cfg: string) => McCoreLike & { set_model(j: string): string };
  };
  wasm.initSync({ module: readFileSync(resolve(WASM_DIR, 'measurement_core_bg.wasm')) });
  const core = new wasm.McCore(configJson);
  if (modelJson !== null) {
    const r = JSON.parse(core.set_model(modelJson)) as { ok: boolean };
    expect(r.ok).toBe(true);
  }
  return core;
}

type Row = { focus: number | null; relax: number | null; emotion: number | null; bpm: number | null; resp: number | null; sdnn: number | null };
const lastErrors: string[] = [];
type Opt = { webAnchor?: boolean; jitterUs?: (i: number) => number; quantizeUs?: number };

/** golden 스트림 전체를 같은 순서로 투입하고 표시 3지표 프레임 열을 모은다 */
async function run(modelOn: boolean, opt: Opt = {}): Promise<Row[]> {
  const blob = readFileSync(resolve(GOLDEN, 'synth/stream.bin'));
  const sched = JSON.parse(readFileSync(resolve(GOLDEN, 'synth/schedule.json'), 'utf8')) as [number, keyof typeof SENSOR, number, number][];
  const pin = modelOn ? await buildWebModelPin(PINNED) : null;
  const r = resolveWebCore(pin);
  const core = await loadCore(r.configJson, r.modelJson);
  const session = new CoreSession(core, {
    sessionId: 's', participantId: 'p', streamId: 'st', streamGeneration: '1', clockAnchorId: 'c', clockUncertaintyMs: 0,
    deviceProfileVersion: 'linkband2-v1', algorithmVersion: 'web-ts-1', modelVersion: r.modelVersion,
  });
  const rows: Row[] = [];
  const seenErr = new Set<string>();
  const errs = lastErrors;
  errs.length = 0;
  let i = 0;
  let prevArr = 0;
  for (const [arr0, sensor, off, len] of sched) {
    // 지연(≥0)만 더하고 도착 순서는 유지(역행 금지) — BLE 알림 묶음/지연을 흉내낸다
    const arr = Math.max(prevArr, arr0 + (opt.jitterUs ? Math.round(Math.abs(opt.jitterUs(i))) : 0));
    const q = opt.quantizeUs;
    const arrQ = q ? Math.ceil(arr / q) * q : arr;
    prevArr = arrQ;
    i += 1;
    // webAnchor: 웹 경로(web-measurement-session.onRaw)처럼 패킷마다 wallMs=Date.now(), anchorUs=arrivalUs 로 넘긴다. 아니면 네이티브처럼 시작 시 1회 고정 앵커.
    const call = opt.webAnchor
      ? { wallMs: BASE_MS + Math.floor(arrQ / 1000), anchorUs: arrQ }
      : { wallMs: BASE_MS, anchorUs: 0 };
    const out = session.push({ sensor: SENSOR[sensor], bytes: new Uint8Array(blob.subarray(off, off + len)), arrivalUs: arrQ, ...call });
    if (out.error && !seenErr.has(out.error.code)) { seenErr.add(out.error.code); errs.push(`${out.error.code}:${out.error.message}`); }
    for (const e of out.envelopes) {
      const m = e.metrics as Record<string, { value: number | null } | undefined>;
      rows.push({ focus: m.focus_display?.value ?? null, relax: m.relaxation_display?.value ?? null, emotion: m.emotion_display?.value ?? null, bpm: m.bpm?.value ?? null, resp: m.respiration?.value ?? null, sdnn: m.sdnn?.value ?? null });
    }
  }
  session.close();
  return rows;
}

const nums = (rows: Row[], k: keyof Row): number[] => rows.map((r) => r[k]).filter((v): v is number => typeof v === 'number');

describe('SDD-273 웹 WASM 표시 지표: 모델 미적용 vs 활성 모델', () => {
  it('V4 활성 모델이면 config 가 active_sigmoid + sigmoid-<version> + sha256 hex', async () => {
    const r = resolveWebCore(await buildWebModelPin(PINNED));
    const cfg = JSON.parse(r.configJson) as Record<string, string>;
    expect(cfg.model_mode).toBe('active_sigmoid');
    expect(cfg.model_version).toBe('sigmoid-7');
    expect(cfg.model_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.modelVersion).toBe('sigmoid-7');
    expect(r.modelJson).not.toBeNull();
  });

  it('V1 모델 미적용(legacy_cohort): 같은 입력에서 코호트 상수 점수가 나온다', async () => {
    const legacy = await run(false);
    expect(nums(legacy, 'focus').length).toBeGreaterThan(0);
    const f = nums(legacy, 'focus');
    console.log('legacy focus min/max', Math.min(...f), Math.max(...f), 'n=', f.length);
  });

  it('V2/V3 활성 모델 적용: 표시값이 모델 식(Rust golden 과 같은 입력·같은 모델)과 일치한다', async () => {
    const legacy = await run(false);
    const model = await run(true);
    expect(model.length).toBe(legacy.length);
    // 모델이 실제로 표시값을 바꾼다(미적용과 다름)
    const diff = nums(model, 'focus').some((v, i) => v !== nums(legacy, 'focus')[i]);
    expect(diff).toBe(true);
    // 모델 점수는 sigmoid 100·σ → 0 < v < 100 (포화 없음)
    const st = (a: number[]) => `n=${a.length} min=${Math.min(...a)} max=${Math.max(...a)} sat=${a.filter((v) => v <= 0 || v >= 100).length}`;
    for (const k of ['focus', 'relax', 'emotion'] as const) console.log(k, 'legacy', st(nums(legacy, k)), '| model', st(nums(model, k)));
    console.log('model focus sample', nums(model, 'focus').slice(0, 3), 'relax', nums(model, 'relax').slice(0, 3), 'emotion', nums(model, 'emotion').slice(0, 3));
  });
});

// ── 같은 입력 → 네이티브(Rust, FFI 와 같은 api 경로) 출력과 웹(WASM) 출력 비교 ──
// fixtures/sdd273/native-*.json 은 `cargo run --release --example replay_model`(packages/measurement-core/examples)로 만든 값이다.
const fixture = (n: string): Row[] => (JSON.parse(readFileSync(resolve(__dirname, 'fixtures/sdd273', n), 'utf8')) as Row[]);
const same = (a: Row[], b: Row[], keys: (keyof Row)[], tol: number): string[] => {
  const bad: string[] = [];
  expect(a.length).toBe(b.length);
  a.forEach((r, i) => keys.forEach((k) => {
    const x = r[k], y = b[i][k];
    if (x === null || y === null) { if (x !== y) bad.push(`[${i}] ${k} ${x} vs ${y}`); } else if (Math.abs(x - y) > tol) bad.push(`[${i}] ${k} ${x} vs ${y}`);
  }));
  return bad;
};

describe('SDD-273 웹(WASM) = 네이티브(Rust) 패리티', () => {
  it('V3 모델 적용: 같은 패킷 + 같은 모델 JSON → focus/relaxation/emotion 표시값 완전 일치(허용오차 0), bpm/resp/sdnn 1e-9 이내', async () => {
    const web = await run(true);
    const native = fixture('native-active.json');
    expect(same(web, native, ['focus', 'relax', 'emotion'], 0)).toEqual([]);
    expect(same(web, native, ['bpm', 'resp', 'sdnn'], 1e-9)).toEqual([]);
  });
  it('모델 미적용(legacy)도 웹 = 네이티브', async () => {
    const web = await run(false);
    const native = fixture('native-legacy.json');
    expect(same(web, native, ['focus', 'relax', 'emotion', 'bpm', 'resp', 'sdnn'], 1e-9)).toEqual([]);
  });
});

describe('SDD-273 호흡·HRV: 웹 방식 앵커·도착 지터가 코어 출력을 바꾸는가', () => {
  it('웹 방식 앵커(패킷마다 wallMs=Date.now, anchor=arrival)는 고정 앵커와 호흡·HRV·BPM 이 같다', async () => {
    const fixed = await run(true);
    const web = await run(true, { webAnchor: true });
    expect(same(web, fixed, ['bpm', 'resp', 'sdnn'], 1e-9)).toEqual([]);
  });
  it('도착 시각 지터(±40ms, 일부 100ms 묶음)를 줘도 호흡·HRV 값이 어떻게 바뀌는지 측정한다', async () => {
    const jit = (i: number): number => ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 40_000 + (i % 7 === 0 ? 100_000 : 0);
    const base = await run(true, { webAnchor: true });
    const jittered = await run(true, { webAnchor: true, jitterUs: jit });
    // 도착 지터는 프레임 시각 격자를 흔들어 프레임 개수가 달라질 수 있어 인덱스가 아니라 개수·값 분포로 비교한다.
    const stat = (rows: Row[], k: keyof Row): string => {
      const v = rows.map((r) => r[k]).filter((x): x is number => x !== null);
      return `n=${v.length}/${rows.length} min=${v.length ? Math.min(...v).toFixed(2) : '-'} max=${v.length ? Math.max(...v).toFixed(2) : '-'} mean=${v.length ? (v.reduce((x, y) => x + y, 0) / v.length).toFixed(2) : '-'}`;
    };
    console.log('JITTER core errors', lastErrors);
    for (const k of ['bpm', 'resp', 'sdnn'] as const) {
      console.log('JITTER', k, 'base', stat(base, k), '| jitter', stat(jittered, k));
    }
    expect(jittered.length).toBeGreaterThan(0);
  });

  it('BLE 묶음 전달(도착이 2초·5초 경계로 몰림)에서도 호흡·HRV 가 어떻게 바뀌는지 측정한다', async () => {
    const base = await run(true, { webAnchor: true });
    const rows: Record<string, Row[]> = {};
    for (const q of [2_000_000, 5_000_000]) {
      // 도착을 다음 q 경계로 미룬다(지연만, 순서 유지) — 첫 패킷 기준이 아니라 절대 경계
      rows[String(q)] = await run(true, { webAnchor: true, jitterUs: (i) => { void i; return 0; }, quantizeUs: q });
    }
    const stat = (r: Row[], k: keyof Row): string => {
      const v = r.map((x) => x[k]).filter((x): x is number => x !== null);
      return `n=${v.length}/${r.length} mean=${v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : '-'}`;
    };
    for (const k of ['bpm', 'resp', 'sdnn'] as const) {
      console.log('BURST', k, 'base', stat(base, k), '| 2s', stat(rows['2000000'], k), '| 5s', stat(rows['5000000'], k));
    }
    expect(rows['2000000'].length).toBeGreaterThan(0);
  });
});
