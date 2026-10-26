// SDD-246 T01 — GF05: backend 독립 Python 스코어링(expected) vs 웹 TS sigmoid 구현.
// 같은 mode(active_sigmoid)·같은 모델에서만 비교한다. legacy_cohort(backend 사다리꼴)는 TS 실시간(선형)과 정의가 달라 비교 대상이 아니다.
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { V1_DIR, pinnedModel } from './run-oracle';
import { sigmoidScore, type CalibrationMetricKey } from '../../../../frontend/src/lib/eeg/eegSigmoidScore';
import { scoreIndices } from '../../../../frontend/src/lib/eeg/eegPersonalScore';

const exp = JSON.parse(readFileSync(join(V1_DIR, 'expected/scoring/gf05_scoring.json'), 'utf8'));

describe('GF05 sigmoid: Python 정수 점수 == TS 정수 점수 (exact)', () => {
  test('모델 정의가 run-oracle.ts pinnedModel 과 같다', () => {
    expect((pinnedModel() as any).params).toEqual(exp.sigmoid.model);
  });
  test('모든 벡터에서 TS sigmoidScore 가 Python 과 정확히 같다(null 포함)', () => {
    const bad: unknown[] = [];
    for (const v of exp.sigmoid.vectors) {
      const p = exp.sigmoid.model[v.key];
      const ts = sigmoidScore(v.key as CalibrationMetricKey, v.raw === null ? Number.NaN : v.raw, p);
      if (ts !== v.score) bad.push({ v, ts });
    }
    expect(bad).toEqual([]);
  });
  test('half-up 반올림 경계가 Python 과 같다', () => {
    for (const h of exp.sigmoid.half_rounding) {
      expect(sigmoidScore('focusIndex', h.raw, h.model)).toBe(h.score);
    }
  });
  test('scoreIndices(active_sigmoid) 가 같은 모델의 Python 점수와 일치', () => {
    const m = pinnedModel();
    const idx = { focusIndex: 1.0, relaxationIndex: 0.3, stressIndex: 0.5, totalNeuralActivity: 10, cognitiveLoad: 2.0, emotionalStability: 2.0, faa: 0.1 };
    const s = scoreIndices(idx, m);
    const by = (k: string, x: number) => exp.sigmoid.vectors.find((v: any) => v.key === k && v.raw === x)?.score;
    expect(s.focusIndex).toBe(by('focusIndex', 1.0));
    // 이완도 = 두뇌 휴식: TNA params + direction -1 강제 (신경 활동↓ = 휴식↑)
    const rest = sigmoidScore('totalNeuralActivity', 10, { ...(m.params.totalNeuralActivity as any), direction: -1 });
    expect(s.relaxationIndex).toBe(rest);
    expect(s.totalPower).toBe(by('totalNeuralActivity', 10.0));
    expect(s.cognitiveLoad).toBe(by('cognitiveLoad', 2.0));
    expect(s.hemisphericBalance).toBe(by('faa', 0.1));
  });
  test('NaN/null 입력은 0 으로 대체되지 않고 sigmoid 는 null → 코호트 fallback 경로만 존재(문서화)', () => {
    const nulls = exp.sigmoid.vectors.filter((v: any) => v.raw === null || (v.raw < 0 && v.key !== 'faa')).map((v: any) => v.score);
    expect(nulls.every((s: unknown) => s === null)).toBe(true);
  });
});
