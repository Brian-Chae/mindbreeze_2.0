// SDD-273 — 같은 PPG 원시 바이트 열을 JS 알림 모양(정상/유실/정지 후 몰림/중복/순서 뒤바뀜)으로 코어에 흘려 sdnn·호흡이 갈라지는 입력을 찾는다.
// 입력: 심박 72bpm + RSA(0.25Hz) + 드리프트 + 잡음, 50Hz. 패킷 = 헤더 tick(LE, 마지막 샘플) + 샘플(red u24 BE, ir u24 BE).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CoreSession, type McCoreLike } from '../src/lib/measurement-web/core-session';
import { WEB_CORE_CONFIG_JSON } from '../src/lib/measurement-web/core-config';

const WASM_DIR = resolve(__dirname, '../src/lib/measurement-web/wasm');
const BASE_MS = 1_760_000_000_000;
const N = 150 * 50;

function sample(i: number): [number, number] {
  const t = i / 50;
  const phase = 2 * Math.PI * (1.2 * t - (0.08 / (2 * Math.PI * 0.25)) * 1.2 * Math.cos(2 * Math.PI * 0.25 * t));
  const pulse = Math.max(0, Math.sin(phase)) ** 2;
  const drift = 3000 * Math.sin(2 * Math.PI * 0.02 * t) + 800 * Math.sin(2 * Math.PI * 0.25 * t);
  const noise = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 80;
  return [Math.round(90000 + drift * 0.7 + 1000 * pulse + noise), Math.round(120000 + drift + 1500 * pulse + noise)];
}
const u24 = (v: number): number[] => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
interface Pkt { bytes: Uint8Array; lastIdx: number }
function packets(per: number): Pkt[] {
  const out: Pkt[] = [];
  for (let s = 0; s + per <= N; s += per) {
    const last = s + per - 1;
    const tick = Math.round(((last + 1) / 50) * 32768);
    const b = new Uint8Array(4 + per * 6);
    new DataView(b.buffer).setUint32(0, tick, true);
    for (let k = 0; k < per; k += 1) { const [r, ir] = sample(s + k); b.set([...u24(r), ...u24(ir)], 4 + k * 6); }
    out.push({ bytes: b, lastIdx: last });
  }
  return out;
}

interface Delivery { arrUs: number; p: Pkt }
type Shape = (pk: Pkt[]) => Delivery[];
const ideal = (pk: Pkt[]): Delivery[] => pk.map((p) => ({ arrUs: 1_000_000 + Math.round(((p.lastIdx + 1) / 50) * 1e6), p }));

async function run(shape: Shape, per: number) {
  const wasm = (await import('../src/lib/measurement-web/wasm/measurement_core.js')) as unknown as {
    initSync: (m: { module: Buffer }) => unknown; McCore: new (c: string) => McCoreLike;
  };
  wasm.initSync({ module: readFileSync(resolve(WASM_DIR, 'measurement_core_bg.wasm')) });
  const core = new CoreSession(new wasm.McCore(WEB_CORE_CONFIG_JSON), {
    sessionId: 's', participantId: 'p', streamId: 'st', streamGeneration: '1', clockAnchorId: 'c', clockUncertaintyMs: 0,
    deviceProfileVersion: 'linkband2-v1', algorithmVersion: 'web-ts-1', modelVersion: 'b0-cohort-2',
  });
  const status: Record<string, number> = {};
  const rows: { t: number; sdnn: number | null; resp: number | null; bpm: number | null }[] = [];
  let prev = 0;
  for (const d of shape(packets(per))) {
    const arr = Math.max(prev, d.arrUs); prev = arr;
    const o = core.push({ sensor: 'ppg', bytes: d.p.bytes.slice(), arrivalUs: arr, wallMs: BASE_MS + Math.floor(arr / 1000), anchorUs: arr });
    if (o.status) status[o.status] = (status[o.status] ?? 0) + 1;
    for (const e of o.envelopes) {
      const m = e.metrics as Record<string, { value: number | null } | undefined>;
      rows.push({ t: Number(e.window_end_us) / 1e6 - (BASE_MS * 1000) / 1e6, sdnn: m.sdnn?.value ?? null, resp: m.respiration?.value ?? null, bpm: m.bpm?.value ?? null });
    }
  }
  core.close();
  const fill = (k: 'sdnn' | 'resp' | 'bpm', a: number, b: number): string => {
    const w = rows.slice(a, b); return w.length ? `${Math.round((w.filter((r) => r[k] !== null).length / w.length) * 100)}%` : '-';
  };
  const v = rows.map((r) => r.sdnn).filter((x): x is number => x !== null);
  const mean = v.length ? (v.reduce((x, y) => x + y, 0) / v.length).toFixed(1) : '-';
  return { status, frames: rows.length, respFill: [fill('resp', 0, 60), fill('resp', 60, 90), fill('resp', 90, 120), fill('resp', 120, 150)], sdnnFill: fill('sdnn', 0, 150), sdnnMean: mean, bpmFill: fill('bpm', 0, 150) };
}

const dropEvery = (n: number): Shape => (pk) => ideal(pk).filter((_, i) => i % n !== n - 1);
// 메인 스레드가 ms 만큼 멈췄다가 밀린 알림이 한꺼번에 도착(period 마다)
const stall = (periodS: number, stallMs: number): Shape => (pk) => {
  const base = ideal(pk);
  return base.map((d) => { const per = periodS * 1e6; const ph = d.arrUs % per; return ph < stallMs * 1000 ? { ...d, arrUs: d.arrUs - ph + stallMs * 1000 } : d; });
};
const dup = (n: number): Shape => (pk) => ideal(pk).flatMap((d, i) => (i % n === 0 ? [d, { ...d, arrUs: d.arrUs + 1000 }] : [d]));
const swap = (n: number): Shape => (pk) => { const b = ideal(pk); for (let i = 0; i + 1 < b.length; i += n) { const a = b[i]; b[i] = { ...b[i + 1], arrUs: a.arrUs }; b[i + 1] = { ...a, arrUs: b[i + 1].arrUs }; } return b; };

const burstDrop = (every: number, len: number): Shape => (pk) => ideal(pk).filter((_, i) => i % every >= len);
// 도착이 점점 늦어지는 경우(웹뷰 큐 적체): 1초에 d ms 씩 지연이 누적
const lag = (msPerSec: number, capMs: number): Shape => (pk) => ideal(pk).map((d) => ({ ...d, arrUs: d.arrUs + Math.min(capMs, (d.arrUs / 1e6) * msPerSec) * 1000 }));
// 지연이 주기적으로 1.5초 ↔ 0 을 오가며 최소 도착차(window_min)가 흔들리는 경우
const wave = (periodS: number, ampMs: number): Shape => (pk) => ideal(pk).map((d) => ({ ...d, arrUs: d.arrUs + (Math.floor(d.arrUs / 1e6 / periodS) % 2) * ampMs * 1000 }));
const CASES: [string, Shape][] = [
  ['정지 8s/30s 후 몰림', stall(30, 8000)],
  ['정지 12s/40s 후 몰림', stall(40, 12000)],
  ['지연 누적 30ms/s(최대 4s)', lag(30, 4000)],
  ['지연 파동 6s주기 1.5s', wave(6, 1500)],
  ['지연 파동 20s주기 3s', wave(20, 3000)],
  ['유실 1/10', dropEvery(10)],
  ['유실 1/5', dropEvery(5)],
  ['연속유실 2/30', burstDrop(30, 2)],
  ['연속유실 4/60', burstDrop(60, 4)],
  ['정상', ideal],
  ['유실 1/20', dropEvery(20)],
  ['유실 1/50', dropEvery(50)],
  ['정지 0.5s/10s 후 몰림', stall(10, 500)],
  ['정지 1.5s/10s 후 몰림', stall(10, 1500)],
  ['정지 3s/20s 후 몰림', stall(20, 3000)],
  ['중복 1/10', dup(10)],
  ['순서 뒤바뀜 1/10', swap(10)],
];

describe('SDD-273 PPG 알림 모양별 코어 출력(웹 방식 앵커)', () => {
  for (const per of [10, 25]) {
    it(`패킷 ${per}샘플: 케이스별 호흡 채움(0-60/60-90/90-120/120-150프레임)·sdnn 채움/평균`, async () => {
      const lines: string[] = [];
      let base: Awaited<ReturnType<typeof run>> | null = null;
      for (const [name, shape] of CASES) {
        const r = await run(shape, per);
        if (name === '정상') base = r;
        lines.push(`${per}샘플 ${name.padEnd(18)} resp=${r.respFill.join('/')} sdnn채움=${r.sdnnFill} sdnn평균=${r.sdnnMean} bpm채움=${r.bpmFill} 상태=${JSON.stringify(r.status)}`);
      }
      console.log(lines.join('\n'));
      expect(base?.frames ?? 0).toBeGreaterThan(100);
    }, 120_000);
  }
});
