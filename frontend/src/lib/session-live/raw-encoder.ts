/**
 * SDD-117 — EEG raw 청크 인코딩
 *
 * raw 샘플(fp1/fp2)을 interleaved little-endian float32 ArrayBuffer로 인코딩.
 * 1초 청크 = 250샘플 @ 250Hz = 250 * 2ch * 4B = 2000 bytes.
 */

export const RAW_SAMPLE_RATE = 250;
export const RAW_CHANNELS = ['fp1', 'fp2'] as const;
export const RAW_SAMPLES_PER_CHUNK = 250; // 1초 @ 250Hz
export const RAW_SCHEMA_VERSION = 'eeg-raw-v1';
export const RAW_UNIT = 'uV';

/** raw 샘플 1건 — FP1/FP2 전극 전위(uV) */
export interface RawEegSample {
  fp1: number;
  fp2: number;
}

/**
 * 샘플 배열 → interleaved float32 [fp1_0, fp2_0, fp1_1, fp2_1, …] (little-endian).
 */
export function encodeRawChunk(samples: RawEegSample[]): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2 * 4);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i += 1) {
    view.setFloat32(i * 8, samples[i].fp1, true);
    view.setFloat32(i * 8 + 4, samples[i].fp2, true);
  }
  return buffer;
}
