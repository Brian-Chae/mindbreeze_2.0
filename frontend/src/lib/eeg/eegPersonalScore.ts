/**
 * EEG 정규화 점수 — SDD-036
 *
 * 우선순위: 서버 활성 표준 모델 > 코호트 상수(B0)
 */
import {
  scoreCognitiveLoadRealtime,
  scoreEmotionalStability,
  scoreFocusIndexRealtime,
  scoreHemisphericBalance,
  scoreRelaxationIndex,
  scoreStressIndex,
  scoreTotalNeuralActivity,
} from './eegScore';
import {
  CALIBRATION_METRIC_KEYS,
  sigmoidScore,
  type CalibrationMetricKey,
  type ScoreDirection,
  type SigmoidParams,
} from './eegSigmoidScore';
import {
  getActiveModel,
  type NormalizationModelDto,
} from '../api/normalization-api';

export {
  CALIBRATION_METRIC_KEYS,
  type CalibrationBaseline,
  type CalibrationMetricKey,
} from './eegSigmoidScore';

/** StreamProcessor / useBand 가 표시용으로 쓰는 0~100 점수 묶음 */
export interface EEGScoreSet {
  focusIndex: number;
  relaxationIndex: number;
  stressIndex: number;
  totalPower: number;
  hemisphericBalance: number;
  cognitiveLoad: number;
  emotionalStability: number;
}

/** 점수 산출 입력 — mindbreeze BandRawIndices + 선택 faa */
export interface RawIndexInput {
  focusIndex?: number;
  relaxationIndex?: number;
  stressIndex?: number;
  totalNeuralActivity?: number;
  cognitiveLoad?: number;
  emotionalStability?: number;
  hemisphericBalance?: number;
  /** FAA = ln(α_fp2)−ln(α_fp1). 없으면 hemisphericBalance 를 대리로 사용 */
  faa?: number | null;
}

// ── 활성 표준 모델 캐시 ──────────────────────────────────────────

let activeModelCache: NormalizationModelDto | null = null;
let fetchPromise: Promise<NormalizationModelDto | null> | null = null;

function normalizeDirection(value: unknown): ScoreDirection | null {
  if (value === 1 || value === -1) return value;
  if (value === '1') return 1;
  if (value === '-1') return -1;
  return null;
}

/** 서버 표준 모델 params 1건 → SigmoidParams (형식 불일치 시 null) */
export function parseModelParams(
  _key: CalibrationMetricKey,
  raw: unknown,
): SigmoidParams | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const m = record.m;
  const s = record.s;
  const direction = normalizeDirection(record.direction);
  if (typeof m !== 'number' || typeof s !== 'number' || direction === null) return null;
  if (!(s > 0) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  return { m, s, direction };
}

function isValidModel(dto: NormalizationModelDto | null): dto is NormalizationModelDto {
  return dto !== null && typeof dto === 'object' && typeof dto.params === 'object' && dto.params !== null;
}

/** 서버 활성 표준 모델을 조회해 캐시한다. */
export async function refreshActiveModel(): Promise<NormalizationModelDto | null> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    try {
      const dto = await getActiveModel();
      if (!isValidModel(dto)) {
        activeModelCache = null;
        return null;
      }
      activeModelCache = dto;
      return activeModelCache;
    } catch {
      // 네트워크/401 등은 코호트 fallback 유지 (기존 캐시 보존)
      return activeModelCache;
    } finally {
      fetchPromise = null;
    }
  })();
  return fetchPromise;
}

/** 현재 활성 표준 모델 캐시 (동기) */
export function getActiveModelCache(): NormalizationModelDto | null {
  return activeModelCache;
}

/** activate 직후 등 — 캐시 직접 설정 */
export function setActiveModelFromDto(dto: NormalizationModelDto | null): void {
  activeModelCache = isValidModel(dto) ? dto : null;
}

// ── 점수 ──────────────────────────────────────────────────────────

/** 코호트 상수 기반 점수 (fallback) */
function cohortScores(idx: RawIndexInput): EEGScoreSet {
  const faa =
    idx.faa !== undefined
      ? idx.faa
      : idx.hemisphericBalance !== undefined
        ? idx.hemisphericBalance
        : null;
  return {
    focusIndex: scoreFocusIndexRealtime(idx.focusIndex ?? 0),
    relaxationIndex: scoreRelaxationIndex(idx.relaxationIndex ?? 0),
    stressIndex: scoreStressIndex(idx.stressIndex ?? 0),
    totalPower: scoreTotalNeuralActivity(idx.totalNeuralActivity ?? 0),
    hemisphericBalance: scoreHemisphericBalance(faa),
    cognitiveLoad: scoreCognitiveLoadRealtime(idx.cognitiveLoad ?? 0),
    emotionalStability: scoreEmotionalStability(idx.emotionalStability ?? 0),
  };
}

function scoreWithModel(
  key: CalibrationMetricKey,
  raw: number,
  model: NormalizationModelDto,
): number | null {
  const params = parseModelParams(key, model.params[key]);
  if (!params) return null;
  return sigmoidScore(key, raw, params);
}

/**
 * raw indices → 0~100 점수.
 * 서버 활성 표준 모델 > 코호트(B0). params 없는 지표는 코호트 fallback.
 */
export function scoreIndices(idx: RawIndexInput): EEGScoreSet {
  const cohort = cohortScores(idx);
  const model = activeModelCache;
  if (!model) return cohort;

  const faaRaw =
    idx.faa !== undefined && idx.faa !== null
      ? idx.faa
      : (idx.hemisphericBalance ?? Number.NaN);

  return {
    focusIndex:
      scoreWithModel('focusIndex', idx.focusIndex ?? Number.NaN, model) ?? cohort.focusIndex,
    relaxationIndex:
      scoreWithModel('relaxationIndex', idx.relaxationIndex ?? Number.NaN, model) ??
      cohort.relaxationIndex,
    stressIndex:
      scoreWithModel('stressIndex', idx.stressIndex ?? Number.NaN, model) ?? cohort.stressIndex,
    totalPower:
      scoreWithModel('totalNeuralActivity', idx.totalNeuralActivity ?? Number.NaN, model) ??
      cohort.totalPower,
    hemisphericBalance: scoreWithModel('faa', faaRaw, model) ?? cohort.hemisphericBalance,
    cognitiveLoad:
      scoreWithModel('cognitiveLoad', idx.cognitiveLoad ?? Number.NaN, model) ??
      cohort.cognitiveLoad,
    emotionalStability:
      scoreWithModel('emotionalStability', idx.emotionalStability ?? Number.NaN, model) ??
      cohort.emotionalStability,
  };
}

/** 디버그/패널용 — 현재 모델에 포함된 지표 수 */
export function countModelMetrics(model: NormalizationModelDto | null): number {
  if (!model) return 0;
  return CALIBRATION_METRIC_KEYS.filter((k) => parseModelParams(k, model.params[k]) !== null)
    .length;
}
