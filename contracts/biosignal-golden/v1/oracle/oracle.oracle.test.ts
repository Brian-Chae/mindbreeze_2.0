// SDD-246 T01 — 골든 oracle 시험.
//  ORACLE_WRITE=1 : expected/oracle/ 을 (재)생성한다(감독 승인된 변경에서만 사용).
//  기본          : 저장된 expected 와 hash 가 다르면 실패한다.
import { describe, expect, test } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { V1_DIR, canon, hashOf, runOracle, sha256, summarize } from './run-oracle';
import { parseACCPacket, parseEEGPacket, parsePPGPacket } from '../../../../frontend/src/lib/eeg/blePacketParser';
import { TimestampSynchronizer } from '../../../../frontend/src/lib/eeg/TimestampSynchronizer';

const OUT = join(V1_DIR, 'expected', 'oracle');
const WRITE = process.env.ORACLE_WRITE === '1';
const rj = (p: string) => JSON.parse(readFileSync(join(V1_DIR, p), 'utf8'));
const dvOf = (p: string) => { const b = readFileSync(join(V1_DIR, p)); return new DataView(b.buffer, b.byteOffset, b.byteLength); };

describe('TS 파서 vs 독립 산술 fixture (GF01)', () => {
  test('EEG signed24·leadoff·µV 가 독립 산술 expected 와 정확히 같다', () => {
    const e = rj('expected/gf01_eeg_signed24_leadoff.json');
    const r = parseEEGPacket(dvOf('packets/gf01_eeg_signed24_leadoff.bin'), new TimestampSynchronizer(), { samples: 0 } as never);
    expect(r.samples.length).toBe(e.samples.length);
    r.samples.forEach((s, i) => {
      expect(s.ch1).toBe(e.samples[i].ch1_uv_sdk_float);
      expect(s.ch2).toBe(e.samples[i].ch2_uv_sdk_float);
      expect(s.leadoff_ch1).toBe(e.samples[i].leadoff_ch1);
      expect(s.leadoff_ch2).toBe(e.samples[i].leadoff_ch2);
    });
    expect(r.chunkMetadata.deviceTimestampSec).toBe(e.header_ticks / 32768);
  });
  test('PPG 헤더는 little endian(1초), red/ir 는 BE uint24', () => {
    const e = rj('expected/gf01_ppg_header_le_1s.json');
    const r = parsePPGPacket(dvOf('packets/gf01_ppg_header_le_1s.bin'), new TimestampSynchronizer(), { samples: 0 } as never);
    expect(r.chunkMetadata.deviceTimestampSec).toBe(1);
    expect(r.samples.map((s) => [s.red, s.ir])).toEqual(e.samples.map((s: any) => [s.red, s.ir]));
    const probe = rj('expected/gf01_ppg_header_endian_probe.json');
    const p = parsePPGPacket(dvOf('packets/gf01_ppg_header_endian_probe.bin'), new TimestampSynchronizer(), { samples: 0 } as never);
    expect(p.chunkMetadata.deviceTimestampSec).toBe(probe.header_ticks / 32768);
    expect(p.chunkMetadata.deviceTimestampSec).not.toBe(probe.header_ticks_if_big_endian_wrong / 32768);
  });
  test('ACC LE int16 ×2/32768 g', () => {
    const e = rj('expected/gf01_acc_signed16.json');
    const r = parseACCPacket(dvOf('packets/gf01_acc_signed16.bin'), new TimestampSynchronizer(), { samples: 0 } as never, 0, 0);
    expect(r.samples.map((s) => [s.x, s.y, s.z])).toEqual(e.samples.map((s: any) => [s.x_g, s.y_g, s.z_g]));
  });
  test('앵커 의미: 현 웹은 헤더=마지막 샘플(D09), SDK 는 첫 샘플 — 두 정의의 차이를 µs 로 고정', () => {
    const e = rj('expected/gf01_eeg_signed24_leadoff.json');
    const r = parseEEGPacket(dvOf('packets/gf01_eeg_signed24_leadoff.bin'), new TimestampSynchronizer(), { samples: 0 } as never);
    const t = r.samples.map((s) => s.timestamp);
    const rel = t.map((x) => Math.round((x - t[t.length - 1]) * 1000)); // µs
    expect(rel.map(String)).toEqual(e.anchor_offsets_us.web_last_sample);
  });
});

describe('TS 파서 vs 독립 clock 규칙 — 차이를 기록(resolve 대상, 조용히 같다고 가정하지 않음)', () => {
  const STREAMS = ['gf02_multisensor_origin', 'gf02_wrap32', 'gf02_reset_segment', 'gf02_duplicate_conflict_order', 'gf02_truncated'];
  function tsRun(name: string) {
    const e = rj(`expected/${name}.json`);
    const sync = new TimestampSynchronizer();
    let lastAcc = 0, accN = 0;
    return e.packets.map((p: any) => {
      const b = readFileSync(join(V1_DIR, p.file));
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      let n = 0, threw = false;
      try {
        if (p.sensor === 'eeg') n = parseEEGPacket(dv, sync, { samples: 0 } as never).samples.length;
        else if (p.sensor === 'ppg') n = parsePPGPacket(dv, sync, { samples: 0 } as never).samples.length;
        else { const r = parseACCPacket(dv, sync, { samples: 0 } as never, lastAcc, accN); n = r.samples.length; lastAcc = r.newLastTimestamp; accN = r.newPacketCount; }
      } catch { threw = true; }
      return { i: p.index, file: p.file, ref_status: p.status ?? p.strict_status, ref_event: p.event ?? null, ref_strict: p.strict_status, ts_samples: n, ts_threw: threw };
    });
  }
  const collect = () => {
    const out: Record<string, unknown[]> = {};
    for (const s of STREAMS) {
      // 차이만 기록: strict 무효인데 TS 가 샘플을 낸 경우, 중복/충돌/역순인데 TS 가 샘플을 낸(혹은 정상인데 0) 경우
      out[s] = tsRun(s).filter((r: any) => {
        const refAccept = r.ref_strict === 'ok' && (r.ref_status === 'accepted');
        return refAccept ? r.ts_samples === 0 : r.ts_samples > 0;
      });
    }
    return out;
  };
  test('차이 목록이 expected/oracle/divergences.json 과 같다', () => {
    const got = collect();
    const f = join(OUT, 'divergences.json');
    if (WRITE) { mkdirSync(OUT, { recursive: true }); writeFileSync(f, JSON.stringify(got, null, 1) + '\n'); return; }
    expect(got).toEqual(JSON.parse(readFileSync(f, 'utf8')));
  });
  test('기본 경로(정상 forward/wrap/reset/센서 원점 상이)는 TS 가 모든 패킷을 샘플로 낸다', () => {
    for (const s of ['gf02_multisensor_origin', 'gf02_wrap32', 'gf02_reset_segment']) {
      const r = tsRun(s);
      expect(r.filter((x: any) => x.ts_samples === 0).map((x: any) => x.file)).toEqual([]);
    }
  });
});

describe('결정적 합성 입력 → 단계별 expected', () => {
  test('두 번 실행한 단계 hash 가 같다(비결정 요소 없음)', async () => {
    const a = summarize(await runOracle());
    const b = summarize(await runOracle());
    expect(b).toEqual(a);
  }, 600000);

  test(WRITE ? 'expected/oracle 생성' : '저장된 expected 와 일치', async () => {
    const bundle = await runOracle();
    const stages = summarize(bundle);
    const stream = readFileSync(join(V1_DIR, 'synth/stream.bin'));
    const sched = readFileSync(join(V1_DIR, 'synth/schedule.json'));
    const body = {
      oracle: 'frontend/src/lib/eeg (수정 없이 실행)',
      input: { stream_sha256: sha256(stream), schedule_sha256: sha256(sched) },
      meta: bundle.meta, stages,
    };
    // 단계별 상세는 별도 파일(리뷰/diff 용). 요약은 manifest 가 참조.
    const detailKeys = ['decoded', 'clock', 'eeg_psd_bandpower', 'eeg_raw_indices', 'ppg_peaks_rr', 'hrv_sdnn_respiration', 'display', 'acc'] as const;
    if (WRITE) {
      mkdirSync(OUT, { recursive: true });
      for (const k of detailKeys) writeFileSync(join(OUT, `${k}.json`), canon(bundle[k]) + '\n');
      writeFileSync(join(OUT, 'summary.json'), JSON.stringify(body, null, 2) + '\n');
      return;
    }
    expect(existsSync(join(OUT, 'summary.json'))).toBe(true);
    const saved = JSON.parse(readFileSync(join(OUT, 'summary.json'), 'utf8'));
    expect(body).toEqual(saved);
    for (const k of detailKeys) expect(hashOf(JSON.parse(readFileSync(join(OUT, `${k}.json`), 'utf8')))).toBe(stages[k].sha256);
  }, 600000);
});
