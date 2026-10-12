// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
import { TimestampSynchronizer } from './TimestampSynchronizer';

// LINK BAND BLE 패킷 → 샘플 변환 순수 함수 모음.
// timestamp 공식·endianness·ACC 연속성은 001/002 스펙에 고정 — 변경 금지.

const TIMESTAMP_CLOCK = 32768.0;
const SAMPLING_RATES = { EEG: 250, PPG: 50, ACC: 30 };

export interface ChunkMetadata {
  arrivalTime: number;
  deviceTimestampSec: number;
  numSamples: number;
  sensorType: 'EEG' | 'PPG' | 'ACC';
}

export interface EEGDataSample {
  timestamp: number;
  ch1: number;
  ch2: number;
  leadoff_ch1: boolean;
  leadoff_ch2: boolean;
}

export interface PPGDataSample {
  timestamp: number;
  red: number;
  ir: number;
}

export interface AccDataSample {
  timestamp: number;
  x: number;
  y: number;
  z: number;
}

export interface SamplingRateCounter {
  samples: number;
}

export interface EEGParseResult {
  samples: EEGDataSample[];
  chunkMetadata: ChunkMetadata;
  arrivalTime: number;
}

export interface PPGParseResult {
  samples: PPGDataSample[];
  chunkMetadata: ChunkMetadata;
  arrivalTime: number;
}

export interface ACCParseResult {
  samples: AccDataSample[];
  chunkMetadata: ChunkMetadata;
  arrivalTime: number;
  newLastTimestamp: number;
  newPacketCount: number;
}

export function parseEEGPacket(
  dataView: DataView,
  timestampSync: TimestampSynchronizer,
  samplingRateCounter: SamplingRateCounter
): EEGParseResult {
  const arrivalTime = Date.now();

  // EEG: little endian
  const timeRaw = dataView.getUint32(0, true);
  const baseTimestampSec = timeRaw / TIMESTAMP_CLOCK;
  const syncResult = timestampSync.normalizeTimestamp(baseTimestampSec * 1000, 'EEG');
  const baseTimestampMs = syncResult.correctedTimestamp;

  const numSamples = Math.floor((dataView.byteLength - 4) / 7);
  const sampleIntervalMs = 1000 / SAMPLING_RATES.EEG;

  const samples: EEGDataSample[] = [];

  for (let i = 0; i < numSamples; i++) {
    const offset = 4 + i * 7;
    if (offset + 7 > dataView.byteLength) break;

    const leadoffRaw = dataView.getUint8(offset);
    const leadoffCh1 = Boolean(leadoffRaw & 0x01);
    const leadoffCh2 = Boolean(leadoffRaw & 0x04);

    const ch1Raw = (dataView.getUint8(offset + 1) << 16) |
                   (dataView.getUint8(offset + 2) << 8) |
                   dataView.getUint8(offset + 3);
    const ch2Raw = (dataView.getUint8(offset + 4) << 16) |
                   (dataView.getUint8(offset + 5) << 8) |
                   dataView.getUint8(offset + 6);

    const ch1Signed = ch1Raw & 0x800000 ? ch1Raw - 0x1000000 : ch1Raw;
    const ch2Signed = ch2Raw & 0x800000 ? ch2Raw - 0x1000000 : ch2Raw;

    const ch1Uv = ch1Signed * 4.033 / 12 / (Math.pow(2, 23) - 1) * 1e6;
    const ch2Uv = ch2Signed * 4.033 / 12 / (Math.pow(2, 23) - 1) * 1e6;

    // 청크 baseTimestamp는 "마지막 샘플" 기준 → 앞으로 보간
    const sampleTimestamp = baseTimestampMs + (i - numSamples + 1) * sampleIntervalMs;

    samples.push({
      timestamp: sampleTimestamp,
      ch1: ch1Uv,
      ch2: ch2Uv,
      leadoff_ch1: leadoffCh1,
      leadoff_ch2: leadoffCh2,
    });
  }

  samplingRateCounter.samples += samples.length;

  return {
    samples,
    chunkMetadata: {
      arrivalTime,
      deviceTimestampSec: baseTimestampSec,
      numSamples: samples.length,
      sensorType: 'EEG',
    },
    arrivalTime,
  };
}

export function parsePPGPacket(
  dataView: DataView,
  timestampSync: TimestampSynchronizer,
  samplingRateCounter: SamplingRateCounter
): PPGParseResult {
  const arrivalTime = Date.now();

  // PPG: big endian (Python SDK: int.from_bytes(..., 'big'))
  const timeRaw = dataView.getUint32(0, false);
  const baseTimestampSec = timeRaw / TIMESTAMP_CLOCK;
  const syncResult = timestampSync.normalizeTimestamp(baseTimestampSec * 1000, 'PPG');
  const baseTimestampMs = syncResult.correctedTimestamp;

  const numSamples = Math.floor((dataView.byteLength - 4) / 6);
  const sampleIntervalMs = 1000 / SAMPLING_RATES.PPG;

  const samples: PPGDataSample[] = [];

  for (let i = 0; i < numSamples; i++) {
    const offset = 4 + i * 6;
    if (offset + 6 > dataView.byteLength) break;

    const redRaw = (dataView.getUint8(offset) << 16) |
                   (dataView.getUint8(offset + 1) << 8) |
                   dataView.getUint8(offset + 2);
    const irRaw = (dataView.getUint8(offset + 3) << 16) |
                  (dataView.getUint8(offset + 4) << 8) |
                  dataView.getUint8(offset + 5);

    const sampleTimestamp = baseTimestampMs + (i - numSamples + 1) * sampleIntervalMs;

    samples.push({ timestamp: sampleTimestamp, red: redRaw, ir: irRaw });
  }

  samplingRateCounter.samples += samples.length;

  return {
    samples,
    chunkMetadata: {
      arrivalTime,
      deviceTimestampSec: baseTimestampSec,
      numSamples: samples.length,
      sensorType: 'PPG',
    },
    arrivalTime,
  };
}

export function parseACCPacket(
  dataView: DataView,
  timestampSync: TimestampSynchronizer,
  samplingRateCounter: SamplingRateCounter,
  lastAccTimestamp: number,
  accPacketCount: number
): ACCParseResult {
  const arrivalTime = Date.now();

  // ACC: little endian
  const timeRaw = dataView.getUint32(0, true);
  const deviceTimestampSec = timeRaw / TIMESTAMP_CLOCK;
  const syncResult = timestampSync.normalizeTimestamp(deviceTimestampSec * 1000, 'ACC');
  const deviceTimestampMs = syncResult.correctedTimestamp;

  const numSamples = Math.floor((dataView.byteLength - 4) / 6);

  // 30Hz = 33333μs 정밀 간격
  const sampleIntervalMicros = Math.round(1000000 / SAMPLING_RATES.ACC);
  const sampleIntervalMs = sampleIntervalMicros / 1000;

  // 패킷 간 연속성: 이전 청크 last + N*interval = 현재 청크 last
  let baseTimestamp: number;
  if (lastAccTimestamp === 0) {
    baseTimestamp = deviceTimestampMs;
  } else {
    baseTimestamp = lastAccTimestamp + numSamples * sampleIntervalMs;

    const timeSinceLastPacket = deviceTimestampMs - lastAccTimestamp;
    const expectedPacketInterval = numSamples * sampleIntervalMs;
    // 예상의 3배 이상 벌어지면 재동기화
    if (timeSinceLastPacket > expectedPacketInterval * 3) {
      baseTimestamp = deviceTimestampMs;
    }
  }

  const newPacketCount = accPacketCount + 1;

  const samples: AccDataSample[] = [];

  for (let i = 0; i < numSamples; i++) {
    const offset = 4 + i * 6;
    if (offset + 6 > dataView.byteLength) break;

    const xRaw = dataView.getInt16(offset, true);
    const yRaw = dataView.getInt16(offset + 2, true);
    const zRaw = dataView.getInt16(offset + 4, true);

    // ±2g / 2^15
    const scale = 2.0 / 32768.0;

    const sampleTimestamp = baseTimestamp + (i - numSamples + 1) * sampleIntervalMs;

    samples.push({
      timestamp: sampleTimestamp,
      x: xRaw * scale,
      y: yRaw * scale,
      z: zRaw * scale,
    });
  }

  const newLastTimestamp = samples.length > 0
    ? samples[samples.length - 1].timestamp
    : lastAccTimestamp;

  samplingRateCounter.samples += samples.length;

  return {
    samples,
    chunkMetadata: {
      arrivalTime,
      deviceTimestampSec,
      numSamples: samples.length,
      sensorType: 'ACC',
    },
    arrivalTime,
    newLastTimestamp,
    newPacketCount,
  };
}

export function parseBatteryPacket(dataView: DataView): { level: number } | null {
  if (!dataView || dataView.byteLength < 1) return null;
  return { level: dataView.getUint8(0) };
}
