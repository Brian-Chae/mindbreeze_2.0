/**
 * 규칙 기반 리포트 서사 생성 (AI/LLM 호출 없음).
 * 동일 입력 → 동일 문장 (결정론적).
 */

export type MetricId =
  | 'respiratory_rate'
  | 'heart_rate'
  | 'hrv'
  | 'focus'
  | 'relaxation'
  | 'emotional_stability';

export type Direction = 'up' | 'down' | 'stable';

export type BodyTrend = 'relax' | 'arouse' | 'stable';
export type MindTrend = 'calm' | 'scatter' | 'stable';

export interface MetricChangeInput {
  id: MetricId;
  /** 전반 평균 */
  early: number;
  /** 후반 평균 */
  late: number;
}

export interface MetricNarrative {
  id: MetricId;
  label: string;
  direction: Direction;
  /** 부호 있는 변화량(단위) 또는 변화율(%) */
  delta: number;
  /** 표시용 변화량 라벨 (단위/%만, 방향 기호 제외) */
  deltaLabel: string;
  /** 방향 기호 ↑/↓/→ */
  arrow: '↑' | '↓' | '→';
  sentence: string;
}

export interface ReportNarrative {
  journey: string;
  bodyTrend: BodyTrend;
  mindTrend: MindTrend;
  body: MetricNarrative[];
  mind: MetricNarrative[];
  closing: string;
}

const NORMALIZED_IDS: ReadonlySet<MetricId> = new Set([
  'focus',
  'relaxation',
  'emotional_stability',
]);

/** 정규화 지표: |변화율| ≥ 5% 이면 방향 있음 */
const NORMALIZED_THRESHOLD_PCT = 5;

/** 단위 지표 절대 변화량 임계 */
const UNIT_THRESHOLDS: Record<'respiratory_rate' | 'heart_rate' | 'hrv', number> = {
  respiratory_rate: 1.0, // 회/분
  heart_rate: 3, // bpm
  hrv: 5, // ms
};

const METRIC_LABELS: Record<MetricId, string> = {
  respiratory_rate: '호흡수',
  heart_rate: '심박수',
  hrv: 'HRV',
  focus: '집중도',
  relaxation: '이완도',
  emotional_stability: '감정안정도',
};

const SENTENCE_TEMPLATES: Record<MetricId, Record<Direction, string>> = {
  respiratory_rate: {
    down: '호흡이 깊고 느려졌어요',
    stable: '호흡이 고르게 유지됐어요',
    up: '호흡이 빨라졌어요',
  },
  heart_rate: {
    down: '심장이 차분해졌어요',
    stable: '심박이 일정했어요',
    up: '심박이 빨라졌어요',
  },
  hrv: {
    down: '자율신경이 긴장 상태였어요',
    stable: '자율신경이 유지됐어요',
    up: '자율신경 회복이 좋았어요',
  },
  focus: {
    down: '집중이 흔들렸어요',
    stable: '집중이 유지됐어요',
    up: '집중이 깊어졌어요',
  },
  relaxation: {
    down: '긴장이 남아 있었어요',
    stable: '이완이 유지됐어요',
    up: '이완이 깊어졌어요',
  },
  emotional_stability: {
    down: '감정 기복이 있었어요',
    stable: '감정이 유지됐어요',
    up: '감정이 평온해졌어요',
  },
};

/** 몸(이완/각성/유지) × 마음(안정/산만/유지) 종합 여정 */
const JOURNEY_TEMPLATES: Record<BodyTrend, Record<MindTrend, string>> = {
  relax: {
    calm: '몸은 점차 이완으로, 마음은 차분한 안정으로 흘렀습니다.',
    scatter: '몸은 점차 이완으로, 마음은 산만함과 함께 흘렀습니다.',
    stable: '몸은 점차 이완으로, 마음은 고르게 유지되었습니다.',
  },
  arouse: {
    calm: '몸은 각성 쪽으로, 마음은 차분한 안정으로 흘렀습니다.',
    scatter: '몸은 각성 쪽으로, 마음은 산만함과 함께 흘렀습니다.',
    stable: '몸은 각성 쪽으로, 마음은 고르게 유지되었습니다.',
  },
  stable: {
    calm: '몸은 고르게 유지되며, 마음은 차분한 안정으로 흘렀습니다.',
    scatter: '몸은 고르게 유지되며, 마음은 산만함과 함께 흘렀습니다.',
    stable: '몸과 마음 모두 고르게 유지되었습니다.',
  },
};

const CLOSING_TEMPLATES: Record<BodyTrend, Record<MindTrend, string>> = {
  relax: {
    calm: '오늘의 작은 쉼을 마음에 담고, 내일의 나에게도 같은 여유를 허락해 보세요.',
    scatter: '몸이 느려진 감각을 기억하며, 마음이 흔들릴 때 호흡으로 돌아와 보세요.',
    stable: '몸이 이완된 흐름을 기억하며, 일상에서도 짧은 멈춤을 이어가 보세요.',
  },
  arouse: {
    calm: '마음이 차분해진 감각을 붙잡고, 몸의 리듬도 천천히 맞춰 보세요.',
    scatter: '오늘의 흐름을 있는 그대로 두고, 다음엔 호흡에 조금 더 머물러 보세요.',
    stable: '몸의 각성을 부드럽게 내려놓고, 호흡의 속도에 주의를 두어 보세요.',
  },
  stable: {
    calm: '마음이 안정된 감각을 내일에도 이어가며, 짧은 호흡 명상을 이어가 보세요.',
    scatter: '몸의 리듬은 유지됐으니, 다음에는 마음에 머무는 시간을 조금 더 가져 보세요.',
    stable: '오늘처럼 고른 흐름을 기억하며, 짧은 쉼을 일상에 남겨 두세요.',
  },
};

const BODY_ORDER: MetricId[] = ['respiratory_rate', 'heart_rate', 'hrv'];
const MIND_ORDER: MetricId[] = ['focus', 'relaxation', 'emotional_stability'];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatUnitDelta(id: 'respiratory_rate' | 'heart_rate' | 'hrv', absDelta: number): string {
  const v = Number.isInteger(absDelta) ? String(absDelta) : String(round1(absDelta));
  if (id === 'respiratory_rate') return `${v}회/분`;
  if (id === 'heart_rate') return `${v}bpm`;
  return `${v}ms`;
}

/**
 * 변화량/변화율 → 방향성 판단.
 * - 정규화: |변화율| ≥ 5%
 * - 단위: |변화량| ≥ 지표별 임계
 */
export function resolveDirection(input: MetricChangeInput): Direction {
  const rawDelta = input.late - input.early;

  if (NORMALIZED_IDS.has(input.id)) {
    if (input.early === 0) {
      if (rawDelta === 0) return 'stable';
      return rawDelta > 0 ? 'up' : 'down';
    }
    const ratePct = (rawDelta / Math.abs(input.early)) * 100;
    if (Math.abs(ratePct) < NORMALIZED_THRESHOLD_PCT) return 'stable';
    return ratePct > 0 ? 'up' : 'down';
  }

  const threshold = UNIT_THRESHOLDS[input.id as 'respiratory_rate' | 'heart_rate' | 'hrv'];
  if (Math.abs(rawDelta) < threshold) return 'stable';
  return rawDelta > 0 ? 'up' : 'down';
}

export function arrowFor(direction: Direction): '↑' | '↓' | '→' {
  if (direction === 'up') return '↑';
  if (direction === 'down') return '↓';
  return '→';
}

export function sentenceFor(id: MetricId, direction: Direction): string {
  return SENTENCE_TEMPLATES[id][direction];
}

function buildMetricNarrative(input: MetricChangeInput): MetricNarrative {
  const direction = resolveDirection(input);
  const rawDelta = input.late - input.early;
  const isNormalized = NORMALIZED_IDS.has(input.id);

  let delta: number;
  let deltaLabel: string;

  if (isNormalized) {
    const ratePct =
      input.early === 0
        ? rawDelta === 0
          ? 0
          : rawDelta > 0
            ? 100
            : -100
        : (rawDelta / Math.abs(input.early)) * 100;
    delta = round1(ratePct);
    deltaLabel = `${Math.abs(Math.round(ratePct))}%`;
  } else {
    const unitId = input.id as 'respiratory_rate' | 'heart_rate' | 'hrv';
    delta = round1(rawDelta);
    deltaLabel = formatUnitDelta(unitId, Math.abs(delta));
  }

  return {
    id: input.id,
    label: METRIC_LABELS[input.id],
    direction,
    delta,
    deltaLabel,
    arrow: arrowFor(direction),
    sentence: sentenceFor(input.id, direction),
  };
}

/** 몸 대표 방향: 호흡↓·심박↓·HRV↑ → 이완, 반대 → 각성 */
export function resolveBodyTrend(
  metrics: Pick<MetricNarrative, 'id' | 'direction'>[],
): BodyTrend {
  let relax = 0;
  let arouse = 0;

  for (const m of metrics) {
    if (m.id === 'respiratory_rate' || m.id === 'heart_rate') {
      if (m.direction === 'down') relax += 1;
      else if (m.direction === 'up') arouse += 1;
    } else if (m.id === 'hrv') {
      if (m.direction === 'up') relax += 1;
      else if (m.direction === 'down') arouse += 1;
    }
  }

  if (relax > arouse) return 'relax';
  if (arouse > relax) return 'arouse';
  return 'stable';
}

/** 마음 대표 방향: 집중·이완·감정 ↑ → 안정, ↓ → 산만 */
export function resolveMindTrend(
  metrics: Pick<MetricNarrative, 'id' | 'direction'>[],
): MindTrend {
  let calm = 0;
  let scatter = 0;

  for (const m of metrics) {
    if (m.id !== 'focus' && m.id !== 'relaxation' && m.id !== 'emotional_stability') {
      continue;
    }
    if (m.direction === 'up') calm += 1;
    else if (m.direction === 'down') scatter += 1;
  }

  if (calm > scatter) return 'calm';
  if (scatter > calm) return 'scatter';
  return 'stable';
}

export function journeySentence(body: BodyTrend, mind: MindTrend): string {
  return JOURNEY_TEMPLATES[body][mind];
}

export function closingSentence(body: BodyTrend, mind: MindTrend): string {
  return CLOSING_TEMPLATES[body][mind];
}

/**
 * 전반/후반 평균 입력 → 지표 서사 + 종합 여정 + 마무리.
 * 외부 API/LLM 호출 없음.
 */
export function buildReportNarrative(inputs: MetricChangeInput[]): ReportNarrative {
  const byId = new Map(inputs.map((i) => [i.id, i]));

  const body = BODY_ORDER.map((id) => {
    const input = byId.get(id);
    if (!input) {
      throw new Error(`narrative: missing body metric "${id}"`);
    }
    return buildMetricNarrative(input);
  });

  const mind = MIND_ORDER.map((id) => {
    const input = byId.get(id);
    if (!input) {
      throw new Error(`narrative: missing mind metric "${id}"`);
    }
    return buildMetricNarrative(input);
  });

  const bodyTrend = resolveBodyTrend(body);
  const mindTrend = resolveMindTrend(mind);

  return {
    journey: journeySentence(bodyTrend, mindTrend),
    bodyTrend,
    mindTrend,
    body,
    mind,
    closing: closingSentence(bodyTrend, mindTrend),
  };
}
