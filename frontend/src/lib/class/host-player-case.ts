// SDD-208 H1 — 상담사 클래스 진행 화면 케이스 모델.
// 케이스를 저장하지 않고 입력(HostCaseInput)에서 순수함수로 파생한다. 키 이름은 시안(counselor.html)의 scn/state 와 같다.
// 지표 정의는 T1 의 PLAYER_METRICS 를 그대로 쓰고, 현행 ClassPlayerPage 의 HostMetricKey 는 키 매핑만 둔다.

import { PLAYER_METRICS, type CamUi, type MicUi, type NetUi, type PlayerMetric, type PlayerMetricKey } from './player-case';

export type HostBand = 'on' | 'off' | 'lost' | 'leadoff';
export type HostLoc = 'online' | 'offline';
export type HostRec = 'rec' | 'paused';
export type HostPhase = 'live' | 'confirm' | 'ending';
export type HostSort = 'join' | 'low' | 'high';

export const HOST_SHEET_KEYS = [
  'metric', 'chat', 'media', 'checkin', 'tools', 'hands', 'actions', 'queue', 'alerts', 'myband', 'permcam', 'permmic', 'detail',
] as const;
export type HostSheetKey = (typeof HOST_SHEET_KEYS)[number];

export function isHostSheetKey(value: string | null | undefined): value is HostSheetKey {
  return HOST_SHEET_KEYS.some((key) => key === value);
}

/** [질문, 응답] — 체크인 응답 한 줄 */
export type HostCheckinAnswer = readonly [question: string, answer: string];
export type HostMetricValues = Readonly<Record<PlayerMetricKey, number | null>>;

export interface HostParticipant {
  id: string;
  name: string;
  band: HostBand;
  /** band 가 on 이 아니면 전부 null 이어야 한다(화면은 band 로 먼저 분기한다) */
  values: HostMetricValues;
  lowBattery: boolean;
  hand: boolean;
  speaking: boolean;
  /** 끊김 상태일 때 "2분 전" 같은 마지막 수신 경과 */
  agoLabel: string | null;
  checkin: readonly HostCheckinAnswer[];
  /** 체크인 응답 중 상담사가 살펴볼 만한 한 줄(없으면 null) */
  attention: string | null;
}

/* ───────── 지표 ───────── */

/** 현행 ClassPlayerPage 의 HostMetricKey → PLAYER_METRICS 키 */
export const LEGACY_HOST_METRIC_KEY_MAP = {
  focus: 'focus',
  relaxation: 'relaxation',
  emotionalStability: 'emotional',
  heartRate: 'bpm',
  respiratoryRate: 'respiration',
  hrv: 'hrv',
} as const satisfies Record<string, PlayerMetricKey>;

export type LegacyHostMetricKey = keyof typeof LEGACY_HOST_METRIC_KEY_MAP;

export function toHostMetricValues(legacy: Readonly<Record<LegacyHostMetricKey, number | null>>): HostMetricValues {
  return {
    focus: legacy.focus,
    relaxation: legacy.relaxation,
    emotional: legacy.emotionalStability,
    bpm: legacy.heartRate,
    respiration: legacy.respiratoryRate,
    hrv: legacy.hrv,
  };
}

export const EMPTY_HOST_VALUES: HostMetricValues = {
  focus: null, relaxation: null, emotional: null, bpm: null, respiration: null, hrv: null,
};

export function metricByKey(key: PlayerMetricKey): PlayerMetric {
  return PLAYER_METRICS.find((m) => m.key === key) ?? PLAYER_METRICS[1];
}

export function nextMetricKey(key: PlayerMetricKey): PlayerMetricKey {
  const index = PLAYER_METRICS.findIndex((m) => m.key === key);
  return PLAYER_METRICS[(index + 1) % PLAYER_METRICS.length].key;
}

/** 값이 있는 연결 참가자만 반올림 평균 — 그룹 평균은 상담사 화면에서만 쓴다 */
export function groupAverage(participants: readonly HostParticipant[], metric: PlayerMetricKey): number | null {
  const values = participants
    .map((p) => (p.band === 'on' ? p.values[metric] : null))
    .filter((v): v is number => v !== null);
  if (!values.length) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

export function hostValueOf(participant: HostParticipant, metric: PlayerMetricKey): number | null {
  return participant.band === 'on' ? participant.values[metric] : null;
}

/** 링 호 길이(0.03~1). 표시 범위는 PLAYER_METRICS 의 host 스케일 */
export function metricFraction(metric: PlayerMetric, value: number): number {
  const [min, max] = metric.scale.host;
  return Math.max(0.03, Math.min(1, (value - min) / (max - min)));
}

/* ───────── 시간 ───────── */

export function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

/* ───────── 정렬 ───────── */

export interface HostSortOptions {
  metric: PlayerMetricKey;
  sort: HostSort;
  handsFirst: boolean;
}

export function sortHostParticipants(list: readonly HostParticipant[], options: HostSortOptions): HostParticipant[] {
  let out: HostParticipant[] = [...list];
  if (options.sort !== 'join') {
    const dir = options.sort === 'low' ? 1 : -1;
    const withValue = out
      .filter((p) => hostValueOf(p, options.metric) !== null)
      .sort((a, b) => dir * ((hostValueOf(a, options.metric) ?? 0) - (hostValueOf(b, options.metric) ?? 0)));
    out = [...withValue, ...out.filter((p) => hostValueOf(p, options.metric) === null)];
  }
  if (options.handsFirst) {
    out = [...out.filter((p) => p.speaking || p.hand), ...out.filter((p) => !(p.speaking || p.hand))];
  }
  return out;
}

/* ───────── 그리드 레이아웃(균형.md CS1·CS2) ───────── */

/** 열 수: 인원을 균등히 나누는 값을 큰 쪽부터 우선하고, 없으면 마지막 행이 가장 덜 비는 값 */
export function pickGridColumns(count: number, fit: number): number {
  const max = Math.max(2, fit);
  for (let c = max; c >= 2; c -= 1) {
    if (count % c === 0) return c;
  }
  let best = -1;
  let cols = 2;
  for (let c = max; c >= 2; c -= 1) {
    const fill = (count % c || c) / c;
    if (fill > best) {
      best = fill;
      cols = c;
    }
  }
  return cols;
}

export interface HostGridInput {
  /** 그리드 스크롤 영역 안쪽 가용 폭·높이(px). 아직 측정 전이면 0 */
  width: number;
  height: number;
  viewportWidth: number;
  count: number;
}

export interface HostGridLayout {
  cols: number;
  tileWidth: number;
  tileHeight: number;
  ringSize: number;
  gap: number;
  maxWidth: number;
  largeNumber: boolean;
}

export function computeHostGrid({ width, height, viewportWidth, count }: HostGridInput): HostGridLayout {
  const mobile = viewportWidth < 600;
  const baseCols = mobile ? 2 : viewportWidth < 1000 ? 4 : 5;
  const gap = mobile ? 8 : 16;
  const minW = mobile ? 140 : 170;
  const known = width > 0 && height > 0;
  const fit = Math.max(2, Math.min(baseCols, Math.floor((width + gap) / (minW + gap))));
  const cols = pickGridColumns(count, known ? fit : baseCols);
  const designRows = Math.ceil(Math.min(count, 8) / cols);
  const minH = mobile ? 112 : 150;
  const maxH = mobile ? 150 : 240;
  const tileHeight = known
    ? Math.max(minH, Math.min(maxH, Math.floor((height - (designRows - 1) * gap) / designRows)))
    : minH;
  const maxW = mobile ? 400 : 240;
  const tileWidth = known ? Math.max(0, Math.min(maxW, Math.floor((width - (cols - 1) * gap) / cols))) : minW;
  const ringSize = Math.max(56, Math.min(112, tileHeight - 68, tileWidth - 32));
  return {
    cols, tileWidth, tileHeight, ringSize, gap,
    maxWidth: cols * tileWidth + (cols - 1) * gap + 1,
    largeNumber: ringSize >= 100,
  };
}

/* ───────── 칩 줄 넘침(CS4) ───────── */

export interface FitChipInput {
  widths: readonly number[];
  /** 선택 칩(범위 등) — 넘치면 가장 먼저 생략한다 */
  optional: readonly boolean[];
  avail: number;
  gap: number;
  /** "+N" 더보기 칩의 폭 */
  moreWidth: number;
}

export interface FitChipResult {
  visible: number[];
  /** 선택 칩을 뺀 뒤에도 못 들어가 "+N" 으로 접힌 칩 수 */
  hidden: number;
}

export function fitChipCount({ widths, optional, avail, gap, moreWidth }: FitChipInput): FitChipResult {
  const sum = (indexes: readonly number[]): number =>
    indexes.reduce((acc, i) => acc + widths[i], 0) + gap * Math.max(0, indexes.length - 1);
  let kids = widths.map((_, i) => i);
  if (sum(kids) > avail) kids = kids.filter((i) => !optional[i]);
  if (sum(kids) <= avail) return { visible: kids, hidden: 0 };
  let n = kids.length;
  while (n > 1 && sum(kids.slice(0, n)) + gap + moreWidth > avail) n -= 1;
  return { visible: kids.slice(0, n), hidden: kids.length - n };
}

/* ───────── 케이스 파생 ───────── */

/** 상담사 본인 LINK BAND — 선택 사항이라 null(밴드 UI 자체를 쓰지 않음)이 정상 */
export interface HostSelfBand {
  connected: boolean;
  relaxation: number | null;
  battery: number | null;
  signalLabel: string | null;
}

export interface HostCaseInput {
  loc: HostLoc;
  /** 온라인·오프라인 1:1 — 그리드 대신 큰 회원 카드 */
  solo: boolean;
  participants: readonly HostParticipant[];
  cam: CamUi;
  mic: MicUi;
  rec: HostRec | null;
  recElapsedSec: number;
  net: NetUi;
  phase: HostPhase;
  queueCount: number;
  selfBand: HostSelfBand | null;
  handsFirst: boolean;
  /** 최근 10초 조용한 신호 응답 수(0이면 칩을 두지 않는다) */
  quietSignalCount: number;
}

export type HostIconKey = 'wifioff' | 'micoff';

export interface HostBanner {
  tone: 'info' | 'coral';
  icon: HostIconKey;
  title: string;
  detail: string;
  action: { kind: 'sheet'; sheet: HostSheetKey; label: string } | { kind: 'act'; act: 'mic' | 'retry'; label: string } | null;
}

export type HostChip =
  | { key: 'band'; label: string; solo: boolean; on: number; off: number; lost: number; soloBand: HostBand | null }
  | { key: 'checkin'; label: string; done: number; total: number };

export interface HostSummary {
  /** 녹음 줄 — paused 면 "정지됨", 아니면 경과 mm:ss */
  recLabel: string;
  recPaused: boolean;
  checkinDone: number;
  checkinTotal: number;
  bandOn: number;
  bandTotal: number;
}

export interface HostCase {
  loc: HostLoc;
  solo: boolean;
  allOff: boolean;
  /** 오프라인은 셀프뷰를 두지 않고 요약 패널로 채운다(CS3) */
  headSlot: 'selfview' | 'summary';
  /** 도크 세 번째 항목 라벨 — 오프라인은 "녹음" */
  mediaDockLabel: '미디어' | '녹음';
  banner: HostBanner | null;
  chips: HostChip[];
  stats: { joined: number; total: number };
  summary: HostSummary | null;
  cam: CamUi;
  mic: MicUi;
  rec: HostRec | null;
  net: NetUi;
  phase: HostPhase;
}

function countBand(list: readonly HostParticipant[], band: HostBand): number {
  return list.filter((p) => p.band === band).length;
}

function deriveBanner(input: HostCaseInput): HostBanner | null {
  if (input.net === 'down') {
    return {
      tone: 'coral', icon: 'wifioff', title: '연결이 끊겼어요',
      detail: '밴드 데이터는 기기에 보관 중이에요. 복구되면 이어서 기록돼요.',
      action: { kind: 'act', act: 'retry', label: '다시 연결' },
    };
  }
  if (input.net === 'reconnecting') {
    return {
      tone: 'coral', icon: 'wifioff', title: '연결이 불안정해요',
      detail: '데이터 수신이 잠시 중단됐어요. 복구되면 이어서 기록돼요.',
      action: null,
    };
  }
  if (input.loc === 'online' && input.mic === 'denied') {
    return {
      tone: 'coral', icon: 'micoff', title: '마이크를 쓸 수 없어요',
      detail: '허용하면 AI 기록이 시작돼요. 허용하지 않아도 수업은 계속돼요.',
      action: { kind: 'sheet', sheet: 'permmic', label: '허용 방법' },
    };
  }
  if (input.loc === 'online' && input.mic === 'off') {
    return {
      tone: 'info', icon: 'micoff', title: '마이크 꺼짐',
      detail: '이 구간은 AI 기록에서 빠져요. 뇌파는 계속 기록돼요.',
      action: { kind: 'act', act: 'mic', label: '마이크 켜기' },
    };
  }
  return null;
}

export function deriveHostCase(input: HostCaseInput): HostCase {
  const list = input.participants;
  const online = input.loc === 'online';
  const allOff = list.length > 0 && list.every((p) => p.band === 'off');
  const joinedList = list.filter((p) => p.band !== 'lost');
  const chips: HostChip[] = [];

  if (allOff) {
    const done = list.filter((p) => p.checkin.length > 0).length;
    chips.push({ key: 'checkin', label: `체크인 ${done}/${list.length}`, done, total: list.length });
  }
  // 접촉 불량은 밴드가 연결된 상태라 "연결"에 센다(요약 세 값의 합 = 전체 인원)
  const on = countBand(list, 'on') + countBand(list, 'leadoff');
  const off = countBand(list, 'off');
  const lost = countBand(list, 'lost');
  chips.push({
    key: 'band',
    label: `연결 ${on} · 미착용 ${off} · 끊김 ${lost}`,
    solo: input.solo,
    on, off, lost,
    soloBand: input.solo && list[0] ? list[0].band : null,
  });

  const summary: HostSummary | null = online
    ? null
    : {
      recLabel: input.rec === 'paused' ? '정지됨' : formatClock(input.recElapsedSec),
      recPaused: input.rec === 'paused',
      checkinDone: joinedList.filter((p) => p.checkin.length > 0).length,
      checkinTotal: joinedList.length,
      bandOn: on,
      bandTotal: list.length,
    };

  return {
    loc: input.loc,
    solo: input.solo,
    allOff,
    headSlot: online ? 'selfview' : 'summary',
    mediaDockLabel: online ? '미디어' : '녹음',
    banner: deriveBanner(input),
    chips,
    stats: { joined: joinedList.length, total: list.length },
    summary,
    cam: online ? input.cam : 'none',
    mic: online ? input.mic : 'none',
    rec: input.rec,
    net: input.net,
    phase: input.phase,
  };
}

/* ───────── 체크인 요약 ───────── */

export interface HostCheckinQuestionSummary {
  question: string;
  buckets: readonly { label: string; count: number }[];
}

export interface HostCheckinSummary {
  responded: number;
  total: number;
  questions: readonly HostCheckinQuestionSummary[];
  attention: readonly { id: string; name: string; text: string }[];
}

/** 질문별 응답 분포(질문 등장 순서 유지) + 살펴볼 응답 목록 */
export function summarizeCheckins(participants: readonly HostParticipant[]): HostCheckinSummary {
  const order: string[] = [];
  const counts = new Map<string, Map<string, number>>();
  for (const p of participants) {
    for (const [question, answer] of p.checkin) {
      if (!counts.has(question)) {
        counts.set(question, new Map());
        order.push(question);
      }
      const byAnswer = counts.get(question);
      byAnswer?.set(answer, (byAnswer.get(answer) ?? 0) + 1);
    }
  }
  return {
    responded: participants.filter((p) => p.checkin.length > 0).length,
    total: participants.length,
    questions: order.map((question) => ({
      question,
      buckets: [...(counts.get(question)?.entries() ?? [])].map(([label, count]) => ({ label, count })),
    })),
    attention: participants.filter((p) => p.attention).map((p) => ({ id: p.id, name: p.name, text: p.attention ?? '' })),
  };
}

/* ───────── 하니스 픽스처 ───────── */

export interface HostChatMessage {
  who: string;
  me?: boolean;
  time: string;
  text: string;
}

export interface HostCaseMeta {
  title: string;
  elapsedSec: number;
  durationMin: number;
  accessCode: string;
  chat: readonly HostChatMessage[];
  unread: number;
}

export interface HostCaseSpec {
  id: string;
  input: HostCaseInput;
  ui: HostUiInitial;
  meta: HostCaseMeta;
}

/* ───────── UI 상태 초기값(픽스처·하니스가 쓴다) ───────── */

export interface HostUiInitial {
  metric: PlayerMetricKey;
  rotate: boolean;
  sort: HostSort;
  handsFirst: boolean;
  table: boolean;
  sheet: HostSheetKey | null;
  detailId: string | null;
  camBig: boolean;
}
