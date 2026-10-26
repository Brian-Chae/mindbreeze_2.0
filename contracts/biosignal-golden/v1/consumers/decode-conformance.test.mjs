// SDD-246 T01 — 소비자 공통 decode 계약 (T02 Rust / T03 backend / T06 web / T07 iOS / T08 Android 가 따라야 할 기준).
// 이 파일은 DataView 가 아닌 Buffer 로 짠 '세 번째' 디코더다(생성기=Python 수동 산술, 검증기=struct, 기존 TS=DataView).
// 모든 packets/*.bin 을 디코드해 expected JSON 의 정수·boolean·상태와 정확히 일치하는지 본다.
// 소비자는 같은 입력(packets/, expected/)을 자기 언어로 디코드해 같은 JSON 필드를 만들어야 한다 — README 의 '소비 방법' 참고.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const V1 = join(dirname(fileURLToPath(import.meta.url)), '..');
const rj = (p) => JSON.parse(readFileSync(join(V1, p), 'utf8'));
const SIZE = { eeg: 7, ppg: 6, acc: 6 };
const MIN = { eeg: 8, ppg: 8, acc: 10 };

function decode(sensor, buf) {
  if (buf.length < 4) return { status: 'invalid_header_short' };
  if (buf.length < MIN[sensor]) return { status: 'invalid_too_short' };
  if ((buf.length - 4) % SIZE[sensor] !== 0) return { status: 'invalid_remainder' };
  const ticks = buf.readUInt32LE(0); // 세 센서 모두 little endian (PPG 포함)
  const n = (buf.length - 4) / SIZE[sensor];
  const samples = [];
  for (let i = 0; i < n; i++) {
    const o = 4 + i * SIZE[sensor];
    if (sensor === 'eeg') {
      samples.push({
        lo: buf[o], l1: (buf[o] & 1) !== 0, l2: (buf[o] & 4) !== 0,
        c1: buf.readIntBE(o + 1, 3), c2: buf.readIntBE(o + 4, 3), // BE signed24
      });
    } else if (sensor === 'ppg') {
      samples.push({ red: buf.readUIntBE(o, 3), ir: buf.readUIntBE(o + 3, 3) }); // BE uint24
    } else {
      samples.push({ x: buf.readInt16LE(o), y: buf.readInt16LE(o + 2), z: buf.readInt16LE(o + 4) });
    }
  }
  return { status: 'ok', ticks, samples };
}

for (const name of ['gf01_eeg_signed24_leadoff', 'gf01_ppg_header_le_1s', 'gf01_acc_signed16', 'gf01_ppg_header_endian_probe']) {
  test(`GF01 ${name}`, () => {
    const e = rj(`expected/${name}.json`);
    const d = decode(e.sensor, readFileSync(join(V1, e.file)));
    assert.equal(d.status, 'ok');
    assert.equal(d.ticks, e.header_ticks);
    assert.equal(d.samples.length, e.samples.length);
    d.samples.forEach((s, i) => {
      const x = e.samples[i];
      if (e.sensor === 'eeg') assert.deepEqual([s.lo, s.l1, s.l2, s.c1, s.c2], [x.leadoff_byte, x.leadoff_ch1, x.leadoff_ch2, x.ch1_signed, x.ch2_signed]);
      else if (e.sensor === 'ppg') assert.deepEqual([s.red, s.ir], [x.red, x.ir]);
      else assert.deepEqual([s.x, s.y, s.z], [x.x_raw, x.y_raw, x.z_raw]);
    });
  });
}

for (const f of readdirSync(join(V1, 'expected')).filter((n) => /^gf02_.*\.json$/.test(n))) {
  test(`GF02 ${f} — 모든 패킷의 상태·길이·헤더`, () => {
    const e = rj(`expected/${f}`);
    for (const p of e.packets) {
      const buf = readFileSync(join(V1, p.file));
      assert.equal(buf.length, p.length, p.file);
      const d = decode(p.sensor, buf);
      assert.equal(d.status === 'ok' ? 'ok' : d.status, p.strict_status, p.file);
      if (d.status === 'ok') {
        assert.equal(d.ticks, p.extended_ticks % 2 ** 32, `${p.file} 헤더 raw tick`); // extended 는 32bit wrap 확장 값
      }
    }
  });
}

test('단계 상태 요약: 소비자가 따라야 할 status 집합', () => {
  const seen = new Set();
  for (const f of readdirSync(join(V1, 'expected')).filter((n) => /^gf02_.*\.json$/.test(n))) for (const p of rj(`expected/${f}`).packets) seen.add(p.status);
  assert.deepEqual([...seen].sort(), ['accepted', 'conflict', 'duplicate', 'invalid', 'out_of_order']);
});

test('PPG 헤더를 big endian 으로 읽으면 반드시 불일치(오해 방지)', () => {
  const b = readFileSync(join(V1, 'packets/gf01_ppg_header_le_1s.bin'));
  assert.equal(b.readUInt32LE(0), 32768);
  assert.notEqual(b.readUInt32BE(0), 32768);
});
