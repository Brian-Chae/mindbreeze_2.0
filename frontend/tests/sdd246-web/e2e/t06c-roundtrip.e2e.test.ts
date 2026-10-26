// SDD-246 T06c 로컬 왕복 실측 — 실제 LiveClient·CaptureController·CoreSession(WASM, Node 빌드)·socket.io-client 로
// 회원 측정 → live:metric → 서버 sink(T05b) → metrics.updated → 상담사 LiveClient 를 잰다. 합성 계정·로컬 격리 서버 전용.
// 실행: T06C_E2E=1 npx vitest run tests/sdd246-web/e2e/t06c-roundtrip.e2e.test.ts  (서버 /tmp/t06c/start-be.sh, 시드 /tmp/t06/seed.json,
//       WASM wasm-bindgen --target nodejs 산출물 /tmp/t06c/wasm). 결과: /tmp/t06c/roundtrip.json
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { describe, expect, it } from 'vitest';
import { LiveClient, type LiveSocketLike, type MetricSendOutcome, type RestFallback } from '../../../src/lib/session-live/live-client';
import { CaptureController } from '../../../src/lib/measurement-web/capture-controller';
import { CoreSession, type McCoreLike, type SensorName } from '../../../src/lib/measurement-web/core-session';
import { WEB_CORE_CONFIG, WEB_CORE_CONFIG_JSON } from '../../../src/lib/measurement-web/core-config';
import { toBandReport } from '../../../src/lib/measurement-web/band-report';
import type { MetricEnvelope } from '../../../src/lib/measurement-web/envelope';

const RUN = process.env.T06C_E2E === '1';
const BASE = process.env.T06C_BASE ?? 'http://127.0.0.1:8746';
const SYNTH = new URL('../../../../contracts/biosignal-golden/v1/synth/', import.meta.url);
const REPLAY_S = Number(process.env.T06C_REPLAY_S ?? 40);

interface Seed { password: string; session_id: string; host: { email: string }; members: Array<{ email: string; participant_id: string }> }

const noRest: RestFallback = {
  getSnapshot: () => Promise.reject(new Error('rest_disabled_in_e2e')),
  postCommand: () => Promise.reject(new Error('rest_disabled_in_e2e')),
};

async function login(email: string, password: string, role: string): Promise<string> {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, role }) });
  if (!r.ok) throw new Error(`login ${r.status}`);
  return ((await r.json()) as { access_token: string }).access_token;
}

function connect(token: string, sessionId: string, self: string | null) {
  const sock = io(`${BASE}/session-live`, { path: '/socket.io', transports: ['websocket'], auth: { token }, reconnection: false });
  const client = new LiveClient({
    sessionId, selfParticipantId: self, socket: sock as unknown as LiveSocketLike, rest: noRest,
    uuid: () => randomUUID(), clientInstanceId: randomUUID(), appBuild: 'web-e2e', capabilities: ['paint_ack'],
  });
  client.start();
  return { sock, client };
}

const until = async (cond: () => boolean, ms: number): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 20)); }
  return cond();
};
const pct = (xs: number[], p: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

describe.skipIf(!RUN)('T06c 로컬 왕복', () => {
  it('웹 측정 → live:metric → sink → host metrics.updated', async () => {
    const seed = JSON.parse(fs.readFileSync('/tmp/t06/seed.json', 'utf8')) as Seed;
    const sid = seed.session_id;
    const me = seed.members[0]!;
    const out: Record<string, unknown> = { session_id: sid, participant_id: me.participant_id, replay_s: REPLAY_S, steps: [] as unknown[] };
    const step = (name: string, ok: boolean, extra: Record<string, unknown> = {}) => { (out.steps as unknown[]).push({ name, ok, ...extra }); };
    const save = () => fs.writeFileSync('/tmp/t06c/roundtrip.json', JSON.stringify(out, null, 1));

    const host = connect(await login(seed.host.email, seed.password, 'counselor'), sid, null);
    const member = connect(await login(me.email, seed.password, 'client'), sid, me.participant_id);
    step('host READY', await until(() => host.client.getState().phase === 'READY', 15_000));
    step('member READY', await until(() => member.client.getState().phase === 'READY', 15_000));

    const startAck = await host.client.request('session.start', {});
    step('session.start', startAck.status === 'applied' || startAck.status === 'duplicate', { status: startAck.status, code: startAck.code ?? null });
    const enter = await member.client.request('entry.enter', {});
    step('entry.enter', enter.status === 'applied' || enter.status === 'duplicate', { status: enter.status, code: enter.code ?? null });

    // 회원 송신 계측: live:metric 응답 집계
    const ackTally: Record<string, number> = {};
    const sentAt = new Map<string, number>();
    const origSend = member.client.sendMetricBatch.bind(member.client);
    member.client.sendMetricBatch = async (w: readonly MetricEnvelope[]): Promise<MetricSendOutcome> => {
      const t = Date.now();
      for (const e of w) if (!sentAt.has(e.sequence)) sentAt.set(e.sequence, t);
      const r = await origSend(w);
      if (r.kind === 'acks') for (const a of r.acks) { const k = `${a.status}${a.code ? `:${a.code}` : ''}`; ackTally[k] = (ackTally[k] ?? 0) + 1; }
      else { const k = r.kind === 'error' ? `error:${r.code}` : r.kind; ackTally[k] = (ackTally[k] ?? 0) + 1; }
      return r;
    };

    let lastTick = '0';
    const stopped: string[] = [];
    const ctl = new CaptureController({
      client: member.client, sessionId: sid, eegConsent: true, bandConnected: true,
      deviceProfile: WEB_CORE_CONFIG.device_profile_version, algorithmVersion: WEB_CORE_CONFIG.algorithm_version, modelVersion: WEB_CORE_CONFIG.model_version,
      deviceTicks: () => lastTick, onStopped: (c) => stopped.push(c),
    });
    const startRes = await ctl.start();
    const info = ctl.capture();
    step('capture.start(ACK result 사용)', startRes === 'started' && info?.participantId === me.participant_id, { startRes, info });
    member.client.subscribe((s) => { const d = s.devices[me.participant_id]?.data; if (d) ctl.observeDevice(d); });

    // host 쪽 수신 계측
    const hostSeen: Array<{ seq: string; freshness: string; observed: number | null; recvAt: number }> = [];
    host.client.subscribe((s) => {
      const m = s.metrics[me.participant_id]?.data;
      if (m && m.stream_id === info?.streamId && hostSeen.at(-1)?.seq !== m.sequence) hostSeen.push({ seq: m.sequence, freshness: m.freshness, observed: m.observed_at_ms, recvAt: Date.now() });
    });

    // 합성 패킷 실시간 재생 → WASM 코어 → envelope → CaptureController
    const require = createRequire(import.meta.url);
    const wasm = require('/tmp/t06c/wasm/measurement_core.js') as { McCore: new (cfg: string) => McCoreLike };
    const core = new CoreSession(new wasm.McCore(WEB_CORE_CONFIG_JSON), {
      sessionId: sid, participantId: 'pending', streamId: 'pending', streamGeneration: '0', clockAnchorId: 'pending', clockUncertaintyMs: 300_000,
      deviceProfileVersion: WEB_CORE_CONFIG.device_profile_version, algorithmVersion: WEB_CORE_CONFIG.algorithm_version, modelVersion: WEB_CORE_CONFIG.model_version,
    });
    const blob = fs.readFileSync(new URL('stream.bin', SYNTH));
    const sched = JSON.parse(fs.readFileSync(new URL('schedule.json', SYNTH), 'utf8')) as Array<[number, SensorName, number, number]>;
    const t0 = performance.now() * 1000;
    let frames = 0;
    const coreErrors: string[] = [];
    for (const [arr, sensor, off, len] of sched) {
      if (arr > REPLAY_S * 1_000_000) break;
      const due = t0 + arr;
      while (performance.now() * 1000 < due) await new Promise((r) => setTimeout(r, 2));
      const bytes = new Uint8Array(blob.subarray(off, off + len));
      if (sensor === 'eeg') lastTick = String(new DataView(bytes.buffer).getUint32(0, true));
      const arrivalUs = Math.round(due);
      const o = core.push({ sensor, bytes, arrivalUs, wallMs: Date.now(), anchorUs: arrivalUs });
      if (o.error) coreErrors.push(o.error.code);
      for (const e of o.envelopes) { frames += 1; ctl.pushEnvelope(e); }
      if (frames > 0 && frames % 5 === 0) void ctl.flush();
    }
    await ctl.flush();
    await until(() => ctl.pendingMetricCount() === 0, 10_000);
    await new Promise((r) => setTimeout(r, 1_500));
    const lat = hostSeen.map((h) => (sentAt.has(h.seq) ? h.recvAt - sentAt.get(h.seq)! : null)).filter((x): x is number => x !== null);
    const fresh: Record<string, number> = {};
    for (const h of hostSeen) fresh[h.freshness] = (fresh[h.freshness] ?? 0) + 1;
    Object.assign(out, {
      core_frames: frames, core_errors: [...new Set(coreErrors)], ack_tally: ackTally, pending_after: ctl.pendingMetricCount(),
      host_updates: hostSeen.length, host_freshness: fresh, first_host: hostSeen[0] ?? null, last_host: hostSeen.at(-1) ?? null,
      send_to_host_ms: { p50: pct(lat, 50), p95: pct(lat, 95), max: lat.length ? Math.max(...lat) : null, n: lat.length },
    });
    step('host 가 metrics.updated 수신', hostSeen.length > 0, { n: hostSeen.length });

    // live:device 왕복
    const dev = await ctl.reportDevice(toBandReport({ connectionState: 'connected', leadOff: { ch1: false, ch2: true }, signalQuality: 70, battery: 81 }));
    const devOk = await until(() => host.client.getState().devices[me.participant_id]?.data.battery_pct === 81, 5_000);
    step('live:device → host device.changed(밴드 필드)', dev === 'accepted' && devOk, { dev, host_device: host.client.getState().devices[me.participant_id]?.data ?? null });

    // 실측 window 시각: 서버가 환산한 observed_at 이 실제 수신 시각 근처인지(미래·과거로 튀지 않는지)
    const skew = hostSeen.filter((h) => h.observed !== null).map((h) => h.recvAt - (h.observed as number));
    out.observed_vs_recv_ms = { p50: pct(skew, 50), min: skew.length ? Math.min(...skew) : null, max: skew.length ? Math.max(...skew) : null };
    step('observed_at 이 수신 시각과 같은 시간축(|차이|<5초)', skew.length > 0 && skew.every((x) => Math.abs(x) < 5_000), out.observed_vs_recv_ms as Record<string, unknown>);

    // fencing: 같은 회원이 새 stream 을 열면 이전 owner 는 멈춘다. 이전 stream 의 늦은 창은 이력 저장만(live 투영 없음, T05b),
    // 세대가 다른 창은 stale_owner_generation 으로 거절된다.
    const old = ctl.capture()!;
    const ctl2 = new CaptureController({
      client: member.client, sessionId: sid, eegConsent: true, bandConnected: true,
      deviceProfile: WEB_CORE_CONFIG.device_profile_version, algorithmVersion: WEB_CORE_CONFIG.algorithm_version, modelVersion: WEB_CORE_CONFIG.model_version,
    });
    const s2 = await ctl2.start();
    const halted = await until(() => stopped.length > 0, 5_000);
    const hostSeqBefore = host.client.getState().metrics[me.participant_id]?.data.sequence ?? null;
    const lateWin = (seq: string, gen: string): MetricEnvelope => ({
      sequence: seq, session_id: sid, participant_id: old.participantId, stream_id: old.streamId,
      stream_generation: gen, clock_anchor_id: old.clockAnchorId, window_start_us: String(Date.now() * 1000 - 1_000_000), window_end_us: String(Date.now() * 1000),
      observed_at_ms: Date.now(), feature_hash: 'c'.repeat(64), contact: { fp1: 'unknown', fp2: 'unknown' }, sqi: null, metrics: {},
      device_profile_version: WEB_CORE_CONFIG.device_profile_version, algorithm_version: WEB_CORE_CONFIG.algorithm_version, model_version: WEB_CORE_CONFIG.model_version,
      clock_uncertainty_ms: 300_000,
    });
    const late = await origSend([lateWin('999990', old.generation)]);
    await new Promise((r) => setTimeout(r, 1_500));
    const hostSeqAfter = host.client.getState().metrics[me.participant_id]?.data.sequence ?? null;
    const wrongGen = await origSend([lateWin('999991', (BigInt(old.generation) - 1n).toString())]);
    step('fencing: 새 stream 시작 → 이전 controller 정지', s2 === 'started' && halted, { s2, stopped, gen2: ctl2.capture()?.generation ?? null });
    step('fencing: 이전 stream 늦은 창은 이력만(host live 불변)', late.kind === 'acks' && hostSeqBefore === hostSeqAfter, { late_status: late.kind === 'acks' ? late.acks[0]?.status : late, hostSeqBefore, hostSeqAfter });
    step('fencing: 세대 불일치 창은 stale_owner_generation', wrongGen.kind === 'acks' && wrongGen.acks[0]?.code === 'stale_owner_generation', { wrongGen: wrongGen.kind === 'acks' ? wrongGen.acks[0] : wrongGen });
    await ctl2.close('e2e_end');
    core.close();

    host.sock.close();
    member.sock.close();
    save();
    expect((out.steps as Array<{ ok: boolean }>).every((s) => s.ok)).toBe(true);
  }, 180_000);
});
