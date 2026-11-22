/**
 * SDD-328 T0 — 회원 개인 명상 리포트 v2(범용·실측 기반·쉬운 말) 데이터 계약 (FE 사본).
 * BE 정본: backend/app/schemas/member_report_v2.py. 골든 픽스처: ./__fixtures__/v2/*.json (BE tests/fixtures/member_report_v2 와 동일 바이트).
 * JSON Schema 사본: ./__fixtures__/v2/member-report-v2.schema.json (BE 에서 생성, 드리프트 테스트가 키 집합을 대조).
 *
 * 표기 규칙: 모든 "분"은 수업 시작 기준 1부터 시작하는 표기 분. 안착 제외 = 표기 1·2분.
 * 결측(0으로 채우지 않고 보간하지 않는다):
 * - 미착용 → meta.band_status === 'not_worn', 모든 지표 state='missing'(band_not_worn)
 * - 신호 부족·상대 변화 기준값 결측/0 이하 → state='missing', missing_reason='poor_signal'
 * - 그룹 유효 인원 < MIN_GROUP_N → 그 분의 mean·sd = null (선·띠 끊김). 전체가 숨김이면 group=null + group_hidden_reason='min_n'
 * - 시계열 결측 분 → 배열 원소 null
 * - 10분 미만 측정(short_measure) → first_window·last_window·change 없음
 * 큰 글씨에는 전문 용어(RMSSD·SDNN·HRV·LF/HF·PRV·심박수)를 쓰지 않는다. 원어는 footnote 필드에만 허용.
 * 키 이름은 서버 JSON 그대로(snake_case).
 */

export const MEMBER_REPORT_V2_SCHEMA_VERSION = 'member_report.v2' as const;
export const SETTLE_MINUTES = 2;
export const WINDOW_MINUTES = 5;
/** 그룹 비교(띠·분포) 표시 최소 유효 인원 / 개인 유효 시간(분) */
export const MIN_GROUP_N = 10;
export const MIN_VALID_MINUTES = 10;

export type MetricKeyV2 =
  | 'motion' | 'heart_rate' | 'rmssd' | 'lf_hf' | 'focus' | 'relaxation' | 'emotional_balance' | 'aperiodic';
export type DirectionV2 = 'up' | 'down' | 'stable';
export type BandStatusV2 = 'worn' | 'not_worn';
export type MetricStateV2 = 'ok' | 'missing';
export type MissingReasonV2 = 'band_not_worn' | 'poor_signal' | 'no_raw' | 'insufficient_window' | 'poor_fit';
export type ToneV2 = 'calm' | 'neutral';
export type ValueTransform = 'linear' | 'log1p' | 'pct_vs_first5';
export type ChangeKind = 'abs' | 'pct' | 'flow';
export type WhenLabel = '수업 초반에' | '수업 중간에' | '수업이 끝나갈 무렵';
export type PageKeyV2 =
  | 'cover' | 'toc' | 'summary' | 'opinion' | 'journey' | 'motion' | 'quiet5' | 'heart_rate' | 'rmssd'
  | 'lf_hf' | 'focus' | 'relaxation' | 'emotional_balance' | 'aperiodic' | 'next_steps' | 'memo' | 'method' | 'back' | 'group_story';

/** 표기 분(1부터), 양끝 포함, 길이 5 */
export interface WindowV2 { start: number; end: number }

export interface MemberMetaV2 {
  member_code: string; // 실명 금지
  program_label: string; // 라벨로만 사용(구성 분기 없음)
  chapter_label: string;
  session_date: string; // YYYY-MM-DD
  start_clock: string; // HH:MM
  device_text: string;
  basis_text: string;
  reference_group_text: string | null;
  issued_on: string;
  volume_label: string;
  band_status: BandStatusV2;
  settle_minutes: number; // 2
  first_minute: number; // 1
  last_minute: number; // 유효 측정 길이 n(표기 분)
  valid_minutes: number;
  first_window: WindowV2 | null; // short_measure 면 null
  last_window: WindowV2 | null;
  short_measure: boolean;
  group_n: number | null; // 본인 제외
}

export interface EffectPairV2 {
  key: 'heart_rate' | 'relaxation' | 'motion' | 'focus';
  name: string; unit: string; before: string; after: string; change_text: string;
  direction: DirectionV2; tone: ToneV2;
}
export interface QuietHighlight { text: string; note: string }
export interface HeroV2 {
  kicker: string; headline: string; lead: string;
  pair_caption_before: string | null; pair_caption_after: string | null;
  pairs: EffectPairV2[]; // 짧은 측정·미착용이면 빈 배열
  caution: string | null; other_directions: string | null;
  quiet_highlight: QuietHighlight | null; note: string | null;
}
export interface NarrativeV2 { eyebrow: string; title: string; body: string; source: 'rule' | 'ai' }
export interface Observation { title: string; body: string }
export interface OpinionV2 {
  narrative: NarrativeV2; observations: Observation[]; interpret_title: string; interpret_body: string;
  chart_keys: MetricKeyV2[]; legend_note: string; footnote: string | null;
}
export interface TimelineItem { label: string; value: string }
export interface JourneyV2 {
  eyebrow: string; title: string; timeline: TimelineItem[]; chart_keys: MetricKeyV2[];
  legend_note: string; interpret_title: string; interpret_body: string;
}

export interface QuietDeltas { heart_rate: number | null; rmssd_pct: number | null; sdnn_pct: number | null }
export interface QuietItem { title: string; value_text: string; body: string; footnote: string | null }
export interface Quiet5 {
  start_min: number; end_min: number; when_label: WhenLabel; eyebrow: string; title: string; note: string;
  hr_median: number; deltas: QuietDeltas; items: QuietItem[]; reading_title: string; reading_body: string;
}

/** 분별 그룹 평균 ± 1 표준편차(모집단 SD). n < MIN_GROUP_N 인 분은 mean·sd = null */
export interface GroupBandV2 { mean: (number | null)[]; sd: (number | null)[]; n: number[] }
export interface SeriesV2 {
  minutes: number[]; // 표기 분 1..last_minute
  values: (number | null)[] | null; // lf_hf 는 null 이고 norm 사용
  norm: (number | null)[] | null; // 0~1 축 높이(lf_hf log1p)
  value_transform: ValueTransform;
  axis_min: number | null; axis_max: number | null; axis_unit: string;
  settle_shade: boolean; // 첫 2분 회색 배경
  group_band: GroupBandV2 | null;
}
export interface ChangeV2 {
  kind: ChangeKind; direction: DirectionV2; label: string; unit: string; decimals: number;
  before: number | null; after: number | null; delta: number | null; pct: number | null;
}
export interface DistributionV2 {
  lo: number; hi: number; axis_ticks: number[]; mean_me: number; mean_group: number; sd_group: number;
  n_people: number; n_person_minutes: number; my_minutes: number;
  density: number[]; // 81점 KDE, 공통 최대값으로 0~1 정규화
  my_bars: number[]; // 24구간 히스토그램, density 와 같은 정규화
}
export interface GroupBlockV2 {
  title: string; paragraphs: string[]; distribution: DistributionV2; legend: string; footnote: string | null;
}
export interface Companion { title: string; body: string }
export interface MetricBodyV2 {
  eyebrow: string; conclusion: string; bridge: string | null; comparison_text: string | null;
  first: number | null; last: number | null; quiet: number | null;
  change: ChangeV2 | null; // short_measure 이면 null
  overall_mean: number | null; decimals: number | null;
  series: SeriesV2; series_legend: string; interpret: string; reading: string | null;
  group: GroupBlockV2 | null; group_hidden_reason: 'min_n' | null;
  companion: Companion | null;
  footnote: string | null; // 원어(RMSSD·SDNN·LF/HF)·산출 근거 허용 위치
}
export interface MetricSectionV2 {
  key: MetricKeyV2; title: string; chapter: 'body' | 'mind'; state: MetricStateV2;
  missing_reason: MissingReasonV2 | null; body: MetricBodyV2 | null; // ok ⇔ body 있음
}

export interface NextStepV2 { title: string; body: string }
export interface NextStepsV2 { eyebrow: string; title: string; body: string; items: NextStepV2[] }
export interface MemoPageV2 { eyebrow: string; title: string; prompt: string; labels: string[] }
export interface MethodV2 {
  eyebrow: string; title: string; body: string; reading_title: string; paragraphs: string[]; footnote: string;
  references_title: string; references: { text: string }[]; references_checked: string;
  contact_title: string; contact_body: string; // "문의: 담당 클래스 코치"
}
export interface BackCoverV2 { kicker: string; title: string; subtitle: string; brand: string; note: string; contact: string }
export interface CoverV2 {
  kicker: string; title: string; tagline: string; rows: [string, string][]; brand: string; footer: string; issued_note: string;
}
export interface TocV2 { heading: string; chapter_title: string; chapter_subtitle: string; next_chapter_note: string; guide: string }

/** SDD-329 D — 미측정 회원용 그룹 기록 서사(집계만, 개인 값 없음) */
export interface GroupStoryChartV2 {
  key: 'heart_rate' | 'relaxation' | 'focus'; title: string; unit_label: string;
  minutes: number[]; values: (number | null)[]; axis_min: number; axis_max: number;
}
export interface GroupStoryV2 {
  label: string; title: string; paragraphs: string[]; n_people: number | null;
  charts: GroupStoryChartV2[]; chart_hidden_reason: 'min_n' | null; chart_note: string | null;
}

export interface MemberReportV2 {
  schema_version: typeof MEMBER_REPORT_V2_SCHEMA_VERSION;
  meta: MemberMetaV2; cover: CoverV2; toc: TocV2; hero: HeroV2; opinion: OpinionV2;
  journey: JourneyV2 | null; // 미착용이면 null
  quiet5: Quiet5 | null; // 후보 없음·결측이면 null → 쪽 생략
  metrics: Partial<Record<MetricKeyV2, MetricSectionV2>>; // aperiodic 키 없음 허용
  next_steps: NextStepsV2; memo: MemoPageV2; method: MethodV2; back: BackCoverV2;
  group_story?: GroupStoryV2 | null; // 본인 측정이 없는 리포트에만
  forbidden_words_checked: boolean;
}

// ── 책 쪽 구성(파생 규칙) — BE expected_book_pages_v2 와 동일 ─────────────
export interface BookPageV2 { page: number; key: PageKeyV2; title: string }
export interface TocEntryV2 { label: string; start: number; end: number }
export interface BookPageMapV2 { total: number; pages: BookPageV2[]; toc: TocEntryV2[] }

const BODY_ORDER: [PageKeyV2, string][] = [
  ['journey', '몸의 변화 · 수업 여정'], ['motion', '몸이 움직인 정도'], ['quiet5', '가장 편안했던 5분'],
  ['heart_rate', '1분 동안 뛴 횟수'], ['rmssd', '심장 리듬의 여유'], ['lf_hf', '긴장과 휴식의 균형'],
];
const MIND_ORDER: [PageKeyV2, string][] = [
  ['focus', '마음의 변화 · 집중도'], ['relaxation', '이완도'], ['emotional_balance', '감정 균형도'],
  ['aperiodic', '뇌파 1/f 기울기'],
];
const NUM_KO = ['', '하나', '두', '세', '네', '다섯', '여섯'];

function pagePresent(report: MemberReportV2, key: PageKeyV2): boolean {
  if (key === 'journey') return report.journey !== null;
  if (key === 'quiet5') return report.quiet5 !== null;
  const sec = report.metrics[key as MetricKeyV2];
  return sec !== undefined && sec.state === 'ok';
}

/** 결측 쪽을 생략하고 쪽번호·목차를 재계산한다(화면 목차·책 PDF 공용 기준). */
export function expectedBookPagesV2(report: MemberReportV2): BookPageMapV2 {
  const head: [PageKeyV2, string][] = [
    ['cover', '표지'], ['toc', '목차'], ['summary', '요약 카드 · 지금 나의 변화'], ['opinion', '종합 의견'],
  ];
  const body = BODY_ORDER.filter(([k]) => pagePresent(report, k));
  const mind = MIND_ORDER.filter(([k]) => pagePresent(report, k));
  const tail: [PageKeyV2, string][] = [
    ['next_steps', '다음 걸음'], ['memo', '손글씨 메모'], ['method', '방법 · 참고문헌 · 문의'], ['back', '뒷표지'],
  ];
  const gs: [PageKeyV2, string][] = report.group_story ? [['group_story', '그룹 기록으로 돌아보는 수업']] : [];
  const pages: BookPageV2[] = [...head, ...gs, ...body, ...mind, ...tail].map(([key, title], i) => ({ page: i + 1, key, title }));
  const pos = (k: PageKeyV2): number => pages.find((p) => p.key === k)?.page ?? 0;
  const toc: TocEntryV2[] = [
    { label: '요약 카드 · 지금 나의 변화', start: pos('summary'), end: pos('summary') },
    { label: '종합 의견', start: pos('opinion'), end: pos('opinion') },
  ];
  if (report.group_story) toc.push({ label: '그룹 기록으로 돌아보는 수업', start: pos('group_story'), end: pos('group_story') });
  if (body.length > 0) {
    const n = body.filter(([k]) => k !== 'journey').length;
    toc.push({
      label: `몸의 변화 · 수업 여정${n > 0 ? `과 ${NUM_KO[n]} 지표` : ''}`,
      start: pos(body[0][0]), end: pos(body[body.length - 1][0]),
    });
  }
  if (mind.length > 0) {
    toc.push({ label: `마음의 변화 · ${NUM_KO[mind.length]} 지표`, start: pos(mind[0][0]), end: pos(mind[mind.length - 1][0]) });
  }
  for (const [k, label] of tail) toc.push({ label, start: pos(k), end: pos(k) });
  return { total: pages.length, pages, toc };
}
