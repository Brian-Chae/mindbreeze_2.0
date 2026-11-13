/**
 * SDD-327 T0 — 회원 개인 명상 리포트(v11) 데이터 계약 (FE 사본).
 * BE 정본: backend/app/schemas/member_report.py. 골든 픽스처: ./__fixtures__/*.json (BE tests/fixtures 와 동일 바이트).
 *
 * 결측 표현(0으로 채우지 않는다):
 * - 밴드 미착용 → meta.bandStatus 가 아니라 `band_status === "not_worn"`, 모든 지표 state="missing"(band_not_worn)
 * - 지표 신호 부족 → state="missing", missing_reason="poor_signal"
 * - 1/f 산출 불가 → metrics.aperiodic.state="missing" + no_raw|insufficient_window|poor_fit (키 없음도 동일 취급)
 * - 그룹 유효 인원 < MIN_GROUP_N → body.group=null, group_hidden_reason="min_n", series.group_band=null
 * - 시계열 결측 분 → 배열 원소 null(선을 끊는다)
 * 키 이름은 서버 JSON 그대로(snake_case)이다.
 */

export const MEMBER_REPORT_SCHEMA_VERSION = 'member_report.v1' as const;
/** 그룹 비교 표시 최소 유효 인원 / 매분 그룹 띠 최소 인원 / 개인 유효 시간(분) */
export const MIN_GROUP_N = 10;
export const MIN_BAND_N = 5;
export const MIN_VALID_MINUTES = 10;

export type MetricKey =
  | 'motion' | 'heart_rate' | 'rmssd' | 'lf_hf' | 'focus' | 'relaxation' | 'emotional_balance' | 'aperiodic';
export type SegmentKey = 'prep' | 'move' | 'first_half' | 'second_half';
export type Direction = 'up' | 'down' | 'stable';
export type BandStatus = 'worn' | 'not_worn';
export type MetricState = 'ok' | 'missing';
export type MissingReason = 'band_not_worn' | 'poor_signal' | 'no_raw' | 'insufficient_window' | 'poor_fit';
export type Tone = 'calm' | 'neutral';
export type ScaleSide = 'below' | 'within' | 'above';
export type NarrativeSource = 'rule' | 'ai';
export type PageKey =
  | 'cover' | 'toc' | 'summary' | 'opinion' | 'journey' | 'motion' | 'stable5' | 'heart_rate' | 'rmssd'
  | 'lf_hf' | 'focus' | 'relaxation' | 'emotional_balance' | 'aperiodic' | 'next_steps' | 'memo' | 'method' | 'back';

export interface Segment { key: SegmentKey; label: string; start_min: number; end_min: number }

export interface MemberMeta {
  member_code: string; // `B{클래스}-{순번}` — 실명 금지
  program_label: string;
  chapter_label: string;
  session_date: string; // YYYY-MM-DD
  start_clock: string; // HH:MM
  device_text: string;
  basis_text: string;
  reference_group_text: string | null;
  issued_on: string;
  volume_label: string;
  band_status: BandStatus;
  segments: Segment[];
  first_minute: number;
  last_minute: number;
}

export interface EffectPair {
  key: 'heart_rate' | 'relaxation' | 'motion' | 'focus';
  name: string; unit: string; before: string; after: string; change_text: string;
  direction: Direction; tone: Tone;
}
export interface StableSummary { title: string; lines: string[]; note: string }
export interface Hero {
  kicker: string; headline: string; lead: string;
  pair_caption_before: string | null; pair_caption_after: string | null;
  pairs: EffectPair[]; // 미착용·결측이면 가용 지표만(빈 배열 가능)
  caution: string | null; other_directions: string | null; stable_summary: StableSummary | null;
}
export interface Narrative { eyebrow: string; title: string; body: string; source: NarrativeSource }

export interface ReferenceScale {
  key: 'heart_rate' | 'rmssd' | 'sdnn';
  title: string; value: number; decimals: number; unit: string; pill: string; overview_position: string;
  side: ScaleSide; range_note: string; band_lo: number; band_hi: number; axis_min: number; axis_max: number;
  group_median: number | null; group_n: number | null; meaning: string[]; explain: string; note: string;
  overview_line: string;
}
export interface Stable5 {
  window_label: string; eyebrow: string; title: string; narrative: string; scales: ReferenceScale[];
  reading: string; callout_title: string; callout_body: string; contaminated: boolean;
}
export interface Opinion {
  narrative: Narrative; table_title: string; interpret_title: string; interpret_body: string;
  reading: string; footnote: string; legend_note: string;
}
export interface Journey {
  eyebrow: string; title: string; body: string; chart_keys: MetricKey[]; stable_basis_note: string; footer_note: string;
}

export interface Change {
  before: number; after: number; delta: number; direction: Direction; decimals: number; unit: string; label: string;
}
/** 매분 그룹 분포 띠(집계만). 인원 < MIN_BAND_N 인 분은 모두 null */
export interface GroupBand {
  p10: (number | null)[]; p25: (number | null)[]; p50: (number | null)[]; p75: (number | null)[]; p90: (number | null)[];
}
export interface MetricSeries {
  minutes: number[]; // first_minute..last_minute
  values: (number | null)[] | null; // 나의 매분 값 — LF/HF 는 null 이고 norm 사용
  norm: (number | null)[] | null; // 0~1 축 높이(LF/HF log1p)
  value_transform: 'linear' | 'log1p';
  axis_min: number | null; axis_max: number | null; axis_unit: string;
  group_band: GroupBand | null; // 그룹 숨김이면 null
}
export interface SegmentValue { segment_key: SegmentKey; value: number | null }
export interface SegmentCompareRow {
  segment_key: SegmentKey; mine: number | null; group: number | null; diff: number | null; compared_minutes: number;
}
export interface Distribution {
  axis_ticks: number[]; mean_me: number; mean_group: number; sd_group: number; n_people: number;
  n_person_minutes: number; my_minutes: number; density: number[]; my_bars: number[];
}
export interface GroupBlock {
  title: string; explain: string; distribution: Distribution; rows: SegmentCompareRow[]; table_note: string; legend: string;
}
export interface MetricBody {
  eyebrow: string; conclusion: string; bridge: string | null; change: Change; series: MetricSeries;
  series_legend: string; my_segments: SegmentValue[]; interpretation: string; reading: string | null;
  result_note: string | null; source_note: string | null; group: GroupBlock | null; group_hidden_reason: 'min_n' | null;
}
export interface MetricSection {
  key: MetricKey; title: string; chapter: 'body' | 'mind'; state: MetricState;
  missing_reason: MissingReason | null; body: MetricBody | null; // ok ⇔ body 있음
}

export interface NextStep { title: string; body: string }
export interface NextSteps { eyebrow: string; title: string; body: string; items: NextStep[] }
export interface MemoPage { eyebrow: string; title: string; prompt: string; labels: string[] }
export interface Method {
  eyebrow: string; title: string; body: string; reading_title: string; paragraphs: string[]; footnote: string;
  references_title: string; references: { text: string }[]; references_checked: string;
  contact_title: string; contact_body: string; // "문의: 담당 클래스 코치"
}
export interface BackCover { kicker: string; title: string; subtitle: string; brand: string; note: string; contact: string }
export interface Cover {
  kicker: string; title: string; tagline: string; rows: [string, string][]; brand: string; footer: string; issued_note: string;
}
export interface Toc { heading: string; chapter_title: string; chapter_subtitle: string; next_chapter_note: string; guide: string }

export interface MemberReport {
  schema_version: typeof MEMBER_REPORT_SCHEMA_VERSION;
  meta: MemberMeta; cover: Cover; toc: Toc; hero: Hero; opinion: Opinion;
  journey: Journey | null; // 미착용이면 null
  stable5: Stable5 | null; // 결측이면 null → 7쪽 생략
  metrics: Partial<Record<MetricKey, MetricSection>>; // aperiodic 키 없음 허용
  next_steps: NextSteps; memo: MemoPage; method: Method; back: BackCover;
  forbidden_words_checked: boolean;
}

// ── 책 쪽 구성(파생 규칙) — BE expected_book_pages 와 동일 ─────────────
export interface BookPage { page: number; key: PageKey; title: string }
export interface TocEntry { label: string; start: number; end: number }
export interface BookPageMap { total: number; pages: BookPage[]; toc: TocEntry[] }

const BODY_ORDER: [PageKey, string][] = [
  ['journey', '몸의 변화 · 수업 여정'], ['motion', '몸의 움직임'], ['stable5', '안정된 5분'],
  ['heart_rate', '심박수'], ['rmssd', 'RMSSD'], ['lf_hf', 'LF/HF 흐름'],
];
const MIND_ORDER: [PageKey, string][] = [
  ['focus', '마음의 변화 · 집중도'], ['relaxation', '이완도'], ['emotional_balance', '감정 균형도'],
  ['aperiodic', '뇌파 1/f 기울기'],
];
const NUM_KO = ['', '하나', '두', '세', '네', '다섯', '여섯'];

function pagePresent(report: MemberReport, key: PageKey): boolean {
  if (key === 'journey') return report.journey !== null;
  if (key === 'stable5') return report.stable5 !== null;
  const sec = report.metrics[key as MetricKey];
  return sec !== undefined && sec.state === 'ok';
}

/** 결측 지표 쪽을 생략하고 쪽번호·목차를 재계산한다(화면 목차·책 PDF 공용 기준). */
export function expectedBookPages(report: MemberReport): BookPageMap {
  const fixedHead: [PageKey, string][] = [
    ['cover', '표지'], ['toc', '목차'], ['summary', '요약 카드 · 지금 나의 상태'], ['opinion', '종합 의견'],
  ];
  const body = BODY_ORDER.filter(([k]) => pagePresent(report, k));
  const mind = MIND_ORDER.filter(([k]) => pagePresent(report, k));
  const tail: [PageKey, string][] = [
    ['next_steps', '다음 걸음'], ['memo', '손글씨 메모'], ['method', '방법 · 참고문헌 · 문의'], ['back', '뒷표지'],
  ];
  const pages: BookPage[] = [...fixedHead, ...body, ...mind, ...tail].map(([key, title], i) => ({
    page: i + 1, key, title,
  }));
  const pos = (k: PageKey): number => pages.find((p) => p.key === k)?.page ?? 0;
  const toc: TocEntry[] = [
    { label: '요약 카드 · 지금 나의 상태', start: pos('summary'), end: pos('summary') },
    { label: '종합 의견', start: pos('opinion'), end: pos('opinion') },
  ];
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
  for (const [k, label] of tail) toc.push({ label: k === 'back' ? '뒷표지' : label, start: pos(k), end: pos(k) });
  return { total: pages.length, pages, toc };
}
