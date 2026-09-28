// 개선 7: 진행 큐시트(타임라인 대본) — 순수 로직.
//
// 상담사가 명상 클래스 흐름(도입 호흡 → 바디스캔 → 마무리 등)을 단계별 라벨·목표시간(분)·메모로
// 미리 적어 두면, 상담사 플레이어가 클래스 경과 시간(기존 하단 진행시간 지표와 동일한
// started_at 기준 초)에 맞춰 "현재 단계"를 하이라이트하고 단계별 남은 시간 진행바를 보여 준다.
// 회원 화면에는 노출하지 않는다(선택적으로 현재 단계명만) — 이 모듈은 상담사 플레이어 전용.
//
// 컴포넌트·테스트가 함께 쓰는 단일 출처. 단계 스키마는 백엔드 CuesheetStep 과 동일하다.
import type { CuesheetStep } from '../api/session';
import { CUESHEET_MAX_STEPS } from '../api/session';

export { CUESHEET_MAX_STEPS };

/** 단계 목표 시간(분) 허용 범위 — 백엔드 CuesheetStep(duration_min) 과 동일 */
export const CUE_MIN_DURATION_MIN = 1;
export const CUE_MAX_DURATION_MIN = 600;

/** 라벨/메모 최대 길이 — 백엔드 Field(max_length) 와 동일 */
export const CUE_LABEL_MAX_LEN = 80;
export const CUE_NOTE_MAX_LEN = 500;

/** 단계 전환 시 상담사에게 조용히 보여 주는 안내 유지 시간(ms) — 소리·팝업 없음 */
export const CUE_TRANSITION_FLASH_MS = 6000;

/** 타임라인에 배치된 단계 1개 — 누적 시작/끝(초) 포함 */
export interface CueTimelineEntry {
  index: number;
  label: string;
  note: string | null;
  durationMin: number;
  durationSec: number;
  /** 클래스 시작 기준 누적 시작 초 */
  startSec: number;
  /** 클래스 시작 기준 누적 끝 초 */
  endSec: number;
}

/** 경과 초 기준 현재 단계 진행 상태 */
export interface CueProgress {
  timeline: CueTimelineEntry[];
  /** 현재 단계 index. 큐시트가 없거나 진행 전이면 -1 */
  index: number;
  current: CueTimelineEntry | null;
  next: CueTimelineEntry | null;
  /** 현재 단계 남은 초(음수 없음). 큐시트가 없으면 null */
  remainingSec: number | null;
  /** 현재 단계 내 경과 초 */
  elapsedInStepSec: number;
  /** 현재 단계 진행률 0~1 */
  ratio: number;
  /** 마지막 단계까지 모두 지났는지 */
  finished: boolean;
  /** 큐시트 총 길이(초) */
  totalSec: number;
}

function clampDurationMin(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return CUE_MIN_DURATION_MIN;
  return Math.min(CUE_MAX_DURATION_MIN, Math.max(CUE_MIN_DURATION_MIN, n));
}

function clampText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

/**
 * 외부 입력(템플릿·서버 응답·폼 상태)을 저장 가능한 큐시트로 정규화한다.
 * - 라벨이 비어 있는 단계는 버린다(서버 검증과 동일 기준).
 * - 목표 시간은 1~600분 정수로 클램프.
 * - 메모는 trim 후 비면 null.
 * - 최대 단계 수를 넘으면 뒤에서 자른다.
 */
export function normalizeCuesheet(steps: CuesheetStep[] | null | undefined): CuesheetStep[] {
  if (!Array.isArray(steps)) return [];
  const out: CuesheetStep[] = [];
  for (const raw of steps) {
    if (!raw) continue;
    const label = clampText(raw.label, CUE_LABEL_MAX_LEN);
    if (!label) continue;
    const note = clampText(raw.note ?? '', CUE_NOTE_MAX_LEN);
    out.push({
      label,
      duration_min: clampDurationMin(raw.duration_min),
      note: note || null,
    });
    if (out.length >= CUESHEET_MAX_STEPS) break;
  }
  return out;
}

/** 큐시트 총 길이(분) — 서버 전송 없이 합계만 필요할 때 */
export function cuesheetTotalMin(steps: CuesheetStep[] | null | undefined): number {
  return normalizeCuesheet(steps).reduce((sum, step) => sum + step.duration_min, 0);
}

/** 큐시트를 누적 오프셋이 붙은 타임라인으로 변환한다 */
export function buildCueTimeline(steps: CuesheetStep[] | null | undefined): CueTimelineEntry[] {
  let cursor = 0;
  return normalizeCuesheet(steps).map((step, index) => {
    const durationSec = step.duration_min * 60;
    const entry: CueTimelineEntry = {
      index,
      label: step.label,
      note: step.note ?? null,
      durationMin: step.duration_min,
      durationSec,
      startSec: cursor,
      endSec: cursor + durationSec,
    };
    cursor += durationSec;
    return entry;
  });
}

/**
 * 클래스 경과 초로 현재 단계를 판정한다.
 * 경과 초는 플레이어의 기존 진행시간 지표(classElapsedSec: started_at 경과)와 같은 값을 넘긴다.
 */
export function computeCueProgress(
  steps: CuesheetStep[] | null | undefined,
  elapsedSec: number,
): CueProgress {
  const timeline = buildCueTimeline(steps);
  const totalSec = timeline.reduce((sum, entry) => sum + entry.durationSec, 0);
  const elapsed = Number.isFinite(elapsedSec) ? Math.max(0, Math.floor(elapsedSec)) : 0;

  if (timeline.length === 0) {
    return {
      timeline,
      index: -1,
      current: null,
      next: null,
      remainingSec: null,
      elapsedInStepSec: 0,
      ratio: 0,
      finished: false,
      totalSec: 0,
    };
  }

  const current = timeline.find((entry) => elapsed < entry.endSec) ?? timeline[timeline.length - 1];
  const finished = elapsed >= totalSec;
  const elapsedInStepSec = Math.max(0, Math.min(current.durationSec, elapsed - current.startSec));
  const ratio = current.durationSec > 0 ? elapsedInStepSec / current.durationSec : 1;

  return {
    timeline,
    index: current.index,
    current,
    next: timeline[current.index + 1] ?? null,
    remainingSec: Math.max(0, current.endSec - elapsed),
    elapsedInStepSec,
    ratio: Math.min(1, ratio),
    finished,
    totalSec,
  };
}

/** 남은/경과 초를 플레이어 타이머와 같은 00분 00초 형식으로 표시한다 */
export function formatCueClock(sec: number): string {
  const safe = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0;
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}분 ${ss}초`;
}
