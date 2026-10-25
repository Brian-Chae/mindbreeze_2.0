// PPG 헤더 시각은 little endian(공식 SDK와 동일)으로 읽어야 한다.
import { expect, test } from 'vitest';
import { parsePPGPacket } from '../src/lib/eeg/blePacketParser';
import { TimestampSynchronizer } from '../src/lib/eeg/TimestampSynchronizer';

function packet(ticks: number): DataView {
  const buf = new ArrayBuffer(4 + 6 * 28);
  const dv = new DataView(buf);
  dv.setUint32(0, ticks, true); // 장치는 little endian 으로 보낸다
  return dv;
}

test('연속 PPG 패킷 헤더 시각 간격이 실제 간격(약 560ms)으로 해석된다', () => {
  const sync = new TimestampSynchronizer();
  const counter = { samples: 0 } as never;
  const t0 = 32768 * 1000; // 1000초
  const a = parsePPGPacket(packet(t0), sync, counter);
  const b = parsePPGPacket(packet(t0 + Math.round(32.768 * 560)), sync, counter);
  const diffSec = b.chunkMetadata.deviceTimestampSec - a.chunkMetadata.deviceTimestampSec;
  expect(diffSec).toBeGreaterThan(0.5);
  expect(diffSec).toBeLessThan(0.62);
});
