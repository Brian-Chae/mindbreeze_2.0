import { describe, expect, it } from 'vitest';
import { scoreIndices } from '../src/lib/eeg/eegPersonalScore';
import { sigmoidScore } from '../src/lib/eeg/eegSigmoidScore';
import type { NormalizationModelDto } from '../src/lib/api/normalization-api';

// 하루명상 두뇌 휴식 = 활성 모델 totalNeuralActivity(m,s) + direction -1 강제
const model = (direction: 1 | -1 = 1, withTna = true): NormalizationModelDto =>
  ({
    id: 'm', version: 7, n_samples: 1, created_at: '', is_active: true,
    params: withTna
      ? { totalNeuralActivity: { m: 2.3252, s: 2.3342, direction }, relaxationIndex: { m: -1.4, s: 0.5, direction: 1 } }
      : { relaxationIndex: { m: -1.4, s: 0.5, direction: 1 } },
  }) as unknown as NormalizationModelDto;

describe('이완도 = 두뇌 휴식', () => {
  it('direction 을 -1 로 강제해 TNA 반전 점수를 낸다', () => {
    const tna = 1000;
    const expected = sigmoidScore('totalNeuralActivity', tna, { m: 2.3252, s: 2.3342, direction: -1 });
    expect(scoreIndices({ relaxationIndex: 0.5, totalNeuralActivity: tna }, model(1)).relaxationIndex).toBe(expected);
    expect(scoreIndices({ relaxationIndex: 0.5, totalNeuralActivity: tna }, model(-1)).relaxationIndex).toBe(expected);
    const lo = scoreIndices({ totalNeuralActivity: 2 }, model()).relaxationIndex as number;
    const hi = scoreIndices({ totalNeuralActivity: 5000 }, model()).relaxationIndex as number;
    expect(lo).toBeGreaterThan(hi);
  });

  it('모델이 없으면 null(0 아님)', () => {
    expect(scoreIndices({ relaxationIndex: 0.5, totalNeuralActivity: 100 }, null).relaxationIndex).toBeNull();
  });

  it('모델에 TNA params 가 없으면 null', () => {
    expect(scoreIndices({ relaxationIndex: 0.5, totalNeuralActivity: 100 }, model(1, false)).relaxationIndex).toBeNull();
  });

  it('TNA 없는 원격 raw 입력은 기존 α/(α+β) 점수 유지', () => {
    const r = scoreIndices({ relaxationIndex: 0.5 }, null).relaxationIndex;
    expect(typeof r).toBe('number');
  });
});
