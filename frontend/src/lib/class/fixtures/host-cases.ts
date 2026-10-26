// SDD-208 H1 — 상담사 케이스 C01~C18 입력 픽스처 + 하니스 등록.
// 시안(designs/class-player-redesign/counselor.html)의 CASE_DEF·BASE 를 그대로 옮겼고, 쿼리 변형(n·loc·cam·mic·net·…)도 같은 이름을 쓴다.
import { createElement as h } from 'react';
import { HostCaseHarness } from '../../../components/class/player/host/HostCaseHarness';
import { PLAYER_METRICS, type CamUi, type MicUi, type NetUi, type PlayerMetricKey } from '../player-case';
import {
  EMPTY_HOST_VALUES,
  HOST_SELF_BAND_NONE,
  isHostSheetKey,
  type HostBand,
  type HostCaseInput,
  type HostCaseMeta,
  type HostCaseSpec,
  type HostCheckinAnswer,
  type HostLoc,
  type HostMetricValues,
  type HostParticipant,
  type HostPhase,
  type HostRec,
  type HostSelfBand,
  type HostSort,
  type HostUiInitial,
} from '../host-player-case';
import type { PlayerCaseContext, PlayerCaseMap } from '../player-harness';

export const HOST_CASE_IDS: readonly string[] = Array.from({ length: 18 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`);

interface CaseDef {
  hands?: readonly number[];
  speaking?: number;
  loc?: HostLoc;
  solo?: boolean;
  cam?: 'off' | 'denied';
  mic?: 'off' | 'denied';
  rec?: HostRec;
  leadoff?: readonly number[];
  lowbat?: readonly number[];
  allOff?: boolean;
  queue?: number;
  selfBand?: 'on';
  net?: Exclude<NetUi, 'ok'>;
  phase?: HostPhase;
  n?: number;
  handsFirst?: boolean;
}

const CASE_DEFS: Record<string, CaseDef> = {
  C01: {}, C02: { hands: [2, 5] }, C03: { speaking: 3 },
  C04: { loc: 'offline' }, C05: { solo: true }, C06: { solo: true, loc: 'offline' },
  C07: { cam: 'off' }, C08: { cam: 'denied' }, C09: { mic: 'off' }, C10: { mic: 'denied' },
  C11: { rec: 'rec' }, C12: { leadoff: [2, 5, 8], lowbat: [3, 7] }, C13: { allOff: true },
  C14: { queue: 3 }, C15: { selfBand: 'on' }, C16: { net: 'reconnecting' }, C17: { phase: 'confirm' },
  C18: { n: 20, hands: [10, 13, 18], handsFirst: true },
};

type Seed = {
  id: number;
  name: string;
  band: 'on' | 'off' | 'lost';
  v: readonly [focus: number, relaxation: number, emotional: number, bpm: number, respiration: number, hrv: number] | null;
  ago?: string;
  presence?: 'connected' | 'disconnected';
  ci: readonly HostCheckinAnswer[];
  attention?: string;
};

const SEEDS: readonly Seed[] = [
  { id: 1, name: '서연', band: 'on', v: [68, 70, 74, 72, 14, 52], ci: [['마음의 날씨', '잔잔해요'], ['몸 상태', '편안해요'], ['수면', '7시간 · 푹 잤어요']] },
  { id: 2, name: '민준', band: 'on', v: [54, 58, 61, 78, 16, 41], ci: [['마음의 날씨', '조금 들떠 있어요'], ['몸 상태', '어깨에 힘이 들어가요'], ['수면', '6시간 · 보통']] },
  { id: 3, name: '지우', band: 'on', v: [79, 88, 85, 64, 10, 71], ci: [['마음의 날씨', '맑고 고요해요'], ['몸 상태', '가벼워요'], ['수면', '8시간 · 푹 잤어요']] },
  { id: 4, name: '하준', band: 'off', v: null, ci: [['마음의 날씨', '잔잔해요'], ['몸 상태', '편안해요'], ['수면', '7시간 · 보통']] },
  { id: 5, name: '서아', band: 'on', v: [38, 41, 45, 86, 18, 28], ci: [['몸 상태', '어깨가 많이 뻐근해요'], ['마음의 날씨', '조금 무거워요'], ['수면', '4시간 · 뒤척였어요']], attention: '어깨가 많이 뻐근해요' },
  { id: 6, name: '도윤', presence: 'disconnected', band: 'lost', v: [60, 64, 66, 75, 15, 44], ago: '2분 전', ci: [['수면', '거의 못 잤어요'], ['마음의 날씨', '무거워요'], ['몸 상태', '피곤해요']], attention: '거의 못 잤어요' },
  { id: 7, name: '예린', band: 'on', v: [62, 73, 70, 70, 12, 55], ci: [['마음의 날씨', '잔잔해요'], ['몸 상태', '편안해요'], ['수면', '7시간 · 보통']] },
  // 시우는 아직 체크인을 하지 않았다(체크인 요약 7/8 구성)
  { id: 8, name: '시우', band: 'off', v: null, ci: [] },
];

const WAIT_NAMES = ['가은', '윤우', '채아'];

const EXTRA_NAMES = ['하윤', '도현', '나은', '지안', '수호', '다온', '이서', '로하', '유진', '태오', '소이', '건우', '아린', '현서', '라온', '시현'];

function makeExtra(i: number): Seed {
  const band = i % 5 === 3 ? 'off' : 'on';
  const r = 48 + ((i * 13) % 40);
  return {
    id: i + 1,
    name: EXTRA_NAMES[(i - 8) % EXTRA_NAMES.length],
    band,
    v: band === 'off' ? null : [45 + ((i * 7) % 40), r, 50 + ((i * 11) % 38), 62 + ((i * 5) % 24), 10 + (i % 8), 30 + ((i * 9) % 40)],
    ci: [['마음의 날씨', '잔잔해요'], ['몸 상태', '편안해요'], ['수면', '7시간 · 보통']],
  };
}

function toValues(v: Seed['v']): HostMetricValues {
  if (!v) return EMPTY_HOST_VALUES;
  return { focus: v[0], relaxation: v[1], emotional: v[2], bpm: v[3], respiration: v[4], hrv: v[5] };
}

/** 하니스용 5분 추이(60점) — 마지막 값이 현재값에 수렴하도록 참가자별로 결정적으로 만든다 */
export function syntheticTrend(participant: HostParticipant, key: PlayerMetricKey): number[] {
  const metric = PLAYER_METRICS.find((m) => m.key === key) ?? PLAYER_METRICS[1];
  const [min, max] = metric.scale.host;
  const span = max - min;
  const seed = Number.parseInt(participant.id.replace(/\D/g, ''), 10) || 1;
  const end = participant.values[key] ?? 0;
  return Array.from({ length: 60 }, (_, i) => {
    if (i === 59) return end;
    const f = (59 - i) / 59;
    const wave = Math.sin(i / 5 + seed * 1.7) * span * 0.05 * (0.4 + f) + Math.sin(i / 11 + seed) * span * 0.03 + Math.sin(i * 1.9 + seed * 3) * span * 0.012;
    const drift = -(((seed * 3) % 7) - 3) * span * 0.018 * f;
    return Math.max(min, Math.min(max, end + wave + drift * 2));
  });
}

export function buildHostParticipants(count: number, def: CaseDef = {}): HostParticipant[] {
  return Array.from({ length: count }, (_, i) => {
    const seed = SEEDS[i] ?? makeExtra(i);
    let band: HostBand = def.allOff ? 'off' : seed.band;
    if (def.leadoff?.includes(seed.id)) band = 'leadoff';
    return {
      id: `p${seed.id}`,
      name: seed.name,
      band,
      values: band === 'on' ? toValues(seed.v) : EMPTY_HOST_VALUES,
      lowBattery: Boolean(def.lowbat?.includes(seed.id)) && band === 'on',
      hand: Boolean(def.hands?.includes(seed.id)),
      speaking: def.speaking === seed.id,
      agoLabel: band === 'lost' ? (seed.ago ?? '방금 전') : null,
      checkin: seed.ci,
      // 하니스는 실제 접속·저장 체크인 상태도 명시적으로 합성한다.
      presenceState: seed.presence ?? 'connected',
      checkinState: seed.ci.length ? 'completed' : 'not_completed',
      attention: seed.attention ?? null,
    };
  });
}

const MESSAGES: HostCaseMeta['chat'] = [
  { who: '서연', time: '12:18', text: '마음이 한결 편안해졌어요' },
  { who: '나', me: true, time: '12:19', text: '좋아요. 지금 편안한 속도 그대로 이어가 볼게요.' },
  { who: '민준', time: '12:24', text: '어깨에 힘이 자꾸 들어가요' },
  { who: '지우', time: '12:26', text: '배경 소리가 참 좋아요' },
  { who: '서아', time: '12:31', text: '어깨가 계속 뻐근해요' },
  { who: '나', me: true, time: '12:32', text: '서아님, 어깨에 힘이 들어가 있는지 한 번 살펴보세요.' },
  { who: '예린', time: '12:33', text: '네, 살펴볼게요' },
];

const METRIC_BY_PARAM: Record<string, PlayerMetricKey> = {
  focus: 'focus', relax: 'relaxation', balance: 'emotional', bpm: 'bpm', resp: 'respiration', hrv: 'hrv',
  relaxation: 'relaxation', emotional: 'emotional', respiration: 'respiration',
};

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find((a) => a === value) ?? fallback;
}

function parseCount(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? Math.min(24, Math.max(1, n)) : fallback;
}

/** 시안은 detail=3 처럼 숫자로 참가자를 가리킨다 — p3 형식으로 맞춘다 */
function parseDetail(value: string | null): string | null {
  if (!value) return null;
  return /^\d+$/.test(value) ? `p${value}` : value;
}

export function buildHostCaseInput(id: string, params: URLSearchParams = new URLSearchParams()): HostCaseSpec {
  const key = id.toUpperCase();
  const def = CASE_DEFS[key] ?? CASE_DEFS.C01;
  const loc = pick<HostLoc>(params.get('loc'), ['online', 'offline'], def.loc ?? 'online');
  const camParam = pick<'off' | 'big' | 'denied' | ''>(params.get('cam'), ['off', 'big', 'denied'], def.cam ?? '');
  const micParam = pick<'off' | 'denied' | ''>(params.get('mic'), ['off', 'denied'], def.mic ?? '');
  const net = pick<NetUi>(params.get('net'), ['reconnecting', 'down'], def.net ?? 'ok');
  const phase = pick<HostPhase>(params.get('phase'), ['confirm', 'ending'], def.phase ?? 'live');
  const recParam = pick<'rec' | 'paused' | 'none' | ''>(params.get('rec'), ['rec', 'paused', 'none'], loc === 'offline' ? 'rec' : (def.rec ?? ''));
  const selfBandParam = pick<'on' | 'off' | ''>(params.get('selfband'), ['on', 'off'], def.selfBand ?? '');
  const solo = Boolean(def.solo);
  const count = solo ? 1 : params.get('n') ? parseCount(params.get('n'), 8) : (def.n ?? 8);
  const online = loc === 'online';

  const cam: CamUi = !online ? 'none' : camParam === 'denied' ? 'denied' : camParam === 'off' ? 'off' : 'on';
  const mic: MicUi = !online ? 'none' : micParam === 'denied' ? 'denied' : micParam === 'off' ? 'off' : 'on';
  const selfBand: HostSelfBand | null = selfBandParam === 'on'
    ? { ...HOST_SELF_BAND_NONE, state: 'connected', relaxation: 72, battery: 78, signalLabel: '신호 좋음', contactLabel: '정상' }
    : selfBandParam === 'off' ? HOST_SELF_BAND_NONE : null;
  const rec: HostRec | null = recParam === 'none' || recParam === '' ? null : recParam;
  // 하니스 전용: ?soloband=off|lost|leadoff|waiting — 1:1 카드의 밴드 상태별 빈 추이를 재현한다(waiting = 착용했지만 추이가 아직 없음)
  const soloBandParam = solo ? pick<HostBand | 'waiting' | ''>(params.get('soloband'), ['off', 'lost', 'leadoff', 'waiting'], '') : '';
  const soloTrendWaiting = soloBandParam === 'waiting';
  // 하니스 전용: ?solocheckin=none — 체크인 응답이 아직 없는 1:1 카드(실제 앱의 첫 순간)
  const soloNoCheckin = solo && params.get('solocheckin') === 'none';
  const participants = buildHostParticipants(count, def)
    .map((p) => (online ? p : { ...p, hand: false, speaking: false }))
    .map((p) => (soloNoCheckin ? { ...p, checkin: [], attention: null } : p))
    .map((p) => (soloBandParam && soloBandParam !== 'waiting'
      ? { ...p, band: soloBandParam, values: EMPTY_HOST_VALUES, agoLabel: soloBandParam === 'lost' ? '2분 전' : null }
      : p));
  const sheetParam = params.get('sheet');
  const detailId = parseDetail(params.get('detail'));

  const input: HostCaseInput = {
    loc, solo, participants, cam, mic, rec, recElapsedSec: 492, net, phase,
    queue: WAIT_NAMES.slice(WAIT_NAMES.length - (def.queue ?? 0)).map((name, i) => ({ id: `q${i + 1}`, name })),
    selfBand,
    handsFirst: false,
    quietSignalCount: 0,
    filter: null,
  };
  const ui: HostUiInitial = {
    metric: METRIC_BY_PARAM[params.get('metric') ?? ''] ?? 'relaxation',
    rotate: params.get('rotate') === '1',
    sort: pick<HostSort>(params.get('sort'), ['join', 'low', 'high'], 'join'),
    handsFirst: online && Boolean(def.handsFirst),
    table: params.get('table') === '1',
    sheet: detailId ? 'detail' : isHostSheetKey(sheetParam) ? sheetParam : null,
    detailId,
    camBig: camParam === 'big',
  };
  const meta: HostCaseMeta = {
    title: solo ? '임상심리상담 · 3회차' : '마음챙김 명상수업 · 4회차',
    elapsedSec: 12 * 60 + 34,
    durationMin: 30,
    accessCode: '4829',
    chat: MESSAGES,
    unread: 3,
    preCheckins: [
      { id: 'p1', name: '서연', arousal: 4, valence: 4, emotion: 4, note: '오늘은 천천히 시작하고 싶어요' },
      { id: 'p5', name: '서아', arousal: 3, valence: 2, emotion: 3, note: null },
    ],
  };
  return {
    id: key, input, ui, meta,
    trendOf: (participantId, metric) => {
      const person = participants.find((p) => p.id === participantId);
      return person && person.band === 'on' && !soloTrendWaiting ? syntheticTrend(person, metric) : [];
    },
    memberVideo: params.get('member') === 'video',
  };
}

export const playerCases: PlayerCaseMap = Object.fromEntries(
  HOST_CASE_IDS.map((id) => [
    id,
    { role: 'host' as const, render: (ctx: PlayerCaseContext) => h(HostCaseHarness, { spec: buildHostCaseInput(id, ctx.params), ctx }) },
  ]),
);
