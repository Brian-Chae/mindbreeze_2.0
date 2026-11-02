// SDD-273 — 웹 WASM 코어에 서버 활성 표준 모델을 1회 pin 한다(네이티브 ModelPin.kt 와 같은 규칙).
// - 검증은 buildNativeModelPayload(= parseModelParams: s>0, direction ±1)를 재사용한다.
// - model_version = `sigmoid-<서버 version>`(서버 _VERSION_RE 통과 형태), model_hash = 정규화된 params JSON 의 sha256 hex.
// - 모델이 없거나 검증을 통과한 지표가 하나도 없으면 null → 호출자가 기존 legacy_cohort 설정을 그대로 쓴다.
import { buildNativeModelPayload } from '../native-measurement';
import { getActiveModelCache, refreshActiveModel } from '../eeg/eegPersonalScore';
import type { NormalizationModelDto } from '../api/normalization-api';
import { WEB_CORE_CONFIG } from './core-config';

export interface WebModelPin {
  /** 코어 set_model 에 넘기는 JSON({"focusIndex":{m,s,direction},...}) */
  paramsJson: string;
  modelVersion: string;
  modelHash: string;
}

export interface ResolvedWebCore {
  configJson: string;
  modelVersion: string;
  /** null 이면 legacy_cohort(모델 미적용) */
  modelJson: string | null;
}

const toHex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** 서버 `_VERSION_RE`(^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$) 를 항상 통과하는 model_version(ModelPin.versionOf 와 동일). */
export function webModelVersionOf(version: string | number | null | undefined): string {
  const clean = String(version ?? '').replace(/[^A-Za-z0-9._+-]/g, '');
  return `sigmoid-${clean === '' ? '0' : clean}`.slice(0, 64).replace(/-+$/, '');
}

/** 활성 모델 DTO → pin. 유효 지표가 없거나 sha256 을 쓸 수 없으면 null(legacy 유지). */
export async function buildWebModelPin(model: NormalizationModelDto | null | undefined): Promise<WebModelPin | null> {
  const payload = buildNativeModelPayload(model);
  if (!payload) return null;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(payload.modelParams));
  return { paramsJson: payload.modelParams, modelVersion: webModelVersionOf(payload.modelVersion), modelHash: toHex(digest) };
}

/** pin 이 있으면 active_sigmoid + 모델 버전·해시, 없으면 기존 WEB_CORE_CONFIG(legacy_cohort). */
export function resolveWebCore(pin: WebModelPin | null): ResolvedWebCore {
  if (!pin) return { configJson: JSON.stringify(WEB_CORE_CONFIG), modelVersion: WEB_CORE_CONFIG.model_version, modelJson: null };
  const cfg = { ...WEB_CORE_CONFIG, model_mode: 'active_sigmoid', model_version: pin.modelVersion, model_hash: pin.modelHash };
  return { configJson: JSON.stringify(cfg), modelVersion: pin.modelVersion, modelJson: pin.paramsJson };
}

export const MODEL_FETCH_RETRY_DELAYS_MS: readonly number[] = [400, 1_200];
export const MODEL_FETCH_TIMEOUT_MS = 3_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 시작 직전 활성 모델 조회. 캐시 우선, 없으면 조회하고 실패(null)면 짧게 재시도한다.
 * 끝내 못 받으면 null → legacy 로 시작하고 세션 중에는 교체하지 않는다(네이티브의 1회 pin 과 동일).
 */
export async function fetchActiveModelForStart(
  deps: { getCache?: () => NormalizationModelDto | null; refresh?: () => Promise<NormalizationModelDto | null>; delaysMs?: readonly number[]; timeoutMs?: number } = {},
): Promise<NormalizationModelDto | null> {
  const getCache = deps.getCache ?? getActiveModelCache;
  const refresh = deps.refresh ?? refreshActiveModel;
  const delays = deps.delaysMs ?? MODEL_FETCH_RETRY_DELAYS_MS;
  const timeoutMs = deps.timeoutMs ?? MODEL_FETCH_TIMEOUT_MS;
  const cached = getCache();
  if (cached) return cached;
  const deadline = Date.now() + timeoutMs;
  for (let i = 0; i <= delays.length; i += 1) {
    const left = deadline - Date.now();
    if (left <= 0) return null;
    const got = await Promise.race([refresh().catch(() => null), sleep(left).then(() => null)]);
    if (got) return got;
    if (i < delays.length) await sleep(Math.min(delays[i], Math.max(0, deadline - Date.now())));
  }
  return null;
}
