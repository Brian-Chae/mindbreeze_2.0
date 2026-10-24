import type { RawPacket, Signal } from './raw-types';

export const EEG_ADC_SCALE = 4.033 / 12 / (2 ** 23 - 1) * 1e6;
export const ACC_ADC_SCALE = 2 / 32768;
interface RawListener { receive: (packet: RawPacket) => void; onError: (error: unknown) => void }
const listeners = new Set<RawListener>();

/** 분석기와 독립된 원문 parser. 잘린 payload 전체를 보존하고 부분 샘플을 만들지 않는다. */
export function parseRawPacket(signal: Signal, source: DataView,
  receivedUtcUs = (BigInt(Date.now()) * 1000n).toString(),
  receivedMonotonicUs = Math.round(performance.now() * 1000).toString(),
): RawPacket {
  const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
  const view = new DataView(bytes.buffer);
  const stride = signal === 'eeg' ? 7 : 6;
  const malformed = bytes.length < 4 + stride || (bytes.length - 4) % stride !== 0;
  const tickRaw = bytes.length >= 4 ? view.getUint32(0, signal !== 'ppg') : null;
  const rows: number[][] = [];
  const u24 = (offset: number) => view.getUint8(offset) * 65536 + view.getUint8(offset + 1) * 256 + view.getUint8(offset + 2);
  const i24 = (offset: number) => { const n = u24(offset); return n >= 0x800000 ? n - 0x1000000 : n; };
  if (!malformed) {
    for (let offset = 4; offset < bytes.length; offset += stride) {
      if (signal === 'eeg') {
        const a = i24(offset + 1), b = i24(offset + 4);
        rows.push([a, b, view.getUint8(offset), Math.fround(a * EEG_ADC_SCALE), Math.fround(b * EEG_ADC_SCALE)]);
      } else if (signal === 'ppg') {
        rows.push([u24(offset), u24(offset + 3)]);
      } else {
        const a = view.getInt16(offset, true), b = view.getInt16(offset + 2, true), c = view.getInt16(offset + 4, true);
        rows.push([a, b, c, Math.fround(a * ACC_ADC_SCALE), Math.fround(b * ACC_ADC_SCALE), Math.fround(c * ACC_ADC_SCALE)]);
      }
    }
  }
  return { signal, bytes, rows, tickRaw, malformedReason: malformed ? 'truncated_packet' : null, receivedUtcUs, receivedMonotonicUs };
}

/** T08 journal은 이 동기 알림에서 메모리 소유권을 받고 durable 완료 전 제거하지 않는다. */
export function subscribeRawPackets(receive: (packet: RawPacket) => void,
  onError: (error: unknown) => void = () => { console.error('생체신호 원문 수집 실패: journal 상태 확인 필요'); },
): () => void {
  const listener = { receive, onError };
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** BLE notify의 첫 단계. PPG 비동기 dispatch·분석 busy 가드 이전에 실행한다. */
export function captureRawPacket(signal: Signal, source: DataView): void {
  if (!listeners.size || !source) return;
  const packet = parseRawPacket(signal, source);
  for (const listener of listeners) {
    try { listener.receive(packet); } catch (error) {
      // 수집 실패를 숨기지 않되 기존 상담·분석 callback은 계속 실행한다.
      try { listener.onError(error); } catch { console.error('생체신호 수집 오류 처리 실패'); }
    }
  }
}
