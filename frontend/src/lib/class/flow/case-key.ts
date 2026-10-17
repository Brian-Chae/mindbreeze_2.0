// SDD-209 T1 — 시안 케이스 키 파서(순수 함수). 키 문법은 designs/class-flow-redesign/case-keys.json 과 같다.
import {
  FLOW_SCREEN_IDS,
  type FlowBandMode,
  type FlowCaseKey,
  type FlowLobbyCaseKey,
  type FlowPlace,
  type FlowPrepCaseKey,
  type FlowScreenId,
  type FlowSize,
} from './types';

/** 회원 사전 흐름 화면별로 허용되는 상태 토큰(`member` 뒤, `started` 제외). 빈 문자열 = 상태 없음 */
const PREP_STATES: Partial<Record<FlowScreenId, readonly string[]>> = {
  FM06a: ['', 'empty', 'included', 'research-agree', 'research-fail'],
  FM06b: ['q1', 'q2', 'q3', 'q4'],
  FM06c: ['idle', 'connecting', 'connected', 'leadoffl', 'leadoffr', 'leadoff', 'unsupported'],
  FM06d: [
    'mic', 'camon', 'micdenied', 'micnodev', 'camdenied', 'unsupported', 'micdenied-sheet',
    'camon-micdenied', 'camon-spk', 'camon-quiet',
  ],
  FM06e: ['', 'skip', 'noband', 'nomic'],
  FM07: ['', 'bgmoff'],
  FM08: ['', 'cancel-sheet'],
  FM09: ['', 'checked', 'report', 'reportsent', 'checkin', 'checkinempty', 'excluded', 'guest-report'],
};

/** 키에 밴드 모드 토큰이 없는 화면 */
const NO_BAND_SEGMENT: ReadonlySet<FlowScreenId> = new Set<FlowScreenId>(['FM08', 'FM09']);

/** `-started`(시작 후 입장) 변형을 가질 수 있는 화면 */
const STARTED_SCREENS: ReadonlySet<FlowScreenId> = new Set<FlowScreenId>(['FM06b', 'FM06c', 'FM06d']);

/** 고정 키 화면의 허용 어휘 */
const SIMPLE_KEYS: Partial<Record<FlowScreenId, readonly string[]>> = {
  FM01: ['upcoming', 'soon', 'open', 'live', 'empty'],
  FM02: ['list', 'invited', 'apply'],
  FM03: ['scheduled', 'scheduled-offline', 'open', 'open-offline', 'open-1on1', 'done', 'cancelled'],
  FM04: ['default', 'filled', 'leading-zero', 'error', 'throttled', 'member'],
  FM04b: ['default', 'filled', 'error', 'mismatch', 'member'],
  FM05: ['member', 'guest-name', 'member-wait', 'member-offline'],
  FM10: ['cancelled', 'closed', 'notyet', 'error', 'offline', 'entry-expired'],
  FH01: ['open', 'open-offline', 'progress', 'idle', 'empty', 'past', 'net'],
  FH02a: ['online-group', 'online-1to1', 'offline-group', 'offline-1to1', 'online-group-max', 'custom', 'leave'],
  FH02b: ['none', 'optional', 'required', 'offline'],
  FH02c: ['now', 'later', 'conflict', 'long'],
  FH02d: ['empty', 'picked', 'solo', 'search', 'email'],
  FH02e: ['online', 'offline'],
  FH03: ['online', 'offline', 'partial', 'scheduled', 'none', 'email', 'email-partial'],
  FH04: [
    'ready', 'scheduled', 'open', 'progress', 'completed', 'cancelled', 'offline', 'menu', 'cancel',
    'close', 'delete', 'net', 'email-invites',
  ],
  FH05: ['ok', 'quiet', 'cam-off', 'mic-off', 'mic-off-warn', 'mic-denied', 'cam-denied', 'nodevice', 'unsupported', 'offline'],
  FH06a: ['invite', 'invite-all', 'bgm', 'band', 'band-on', 'band-bad-l', 'band-bad-r', 'band-bad-lr', 'speak', 'chat', 'chat-off'],
  FH07: [
    'ok', 'pending', 'all-wait', 'many-wait', 'mic-off', 'no-consent', 'offline', 'one', 'one-wait',
    'empty-wait', 'empty-wait-offline', 'empty-wait-one',
  ],
  FH08: ['choose', 'choose-0', 'confirm'],
  FH09: ['confirm', 'confirm-busy', 'end-saving', 'end-stt', 'end-ai', 'end-done', 'manual-ing', 'manual-done', 'excluded-common'],
  FH10: ['closed', 'closed-0', 'closed-revisit', 'error', 'error-notfound', 'error-forbidden', 'error-network'],
};

export function isFlowScreenId(value: string): value is FlowScreenId {
  return (FLOW_SCREEN_IDS as readonly string[]).includes(value);
}

const PREP_RE = /^(on|off)-(group|solo)-(?:(opt|req|none)-)?member(?:-(.+))?$/;

function parsePrep(screen: FlowScreenId, key: string): FlowPrepCaseKey | null {
  const m = PREP_RE.exec(key);
  if (!m) return null;
  const hasBand = m[3] !== undefined;
  if (NO_BAND_SEGMENT.has(screen) === hasBand) return null;
  let rest = m[4] ?? '';
  let started = false;
  if (STARTED_SCREENS.has(screen) && (rest === 'started' || rest.endsWith('-started'))) {
    started = true;
    rest = rest === 'started' ? '' : rest.slice(0, -'-started'.length);
  }
  const allowed = PREP_STATES[screen];
  if (!allowed?.includes(rest)) return null;
  return {
    kind: 'prep',
    screen,
    key,
    place: m[1] === 'on' ? 'online' : 'offline',
    size: m[2] as FlowSize,
    bandMode: hasBand ? (m[3] as FlowBandMode) : null,
    state: rest,
    started,
  };
}

const LOBBY_RE = /^(g|o)-(on|off)-(\d{1,2})(r)?(?:-(req|none|wait|contact|inv0|many))?$/;

function parseLobby(key: string): FlowLobbyCaseKey | null {
  const m = LOBBY_RE.exec(key);
  if (!m) return null;
  return {
    kind: 'lobby',
    screen: 'FH06',
    key,
    size: m[1] === 'g' ? 'group' : 'solo',
    place: m[2] === 'on' ? 'online' : 'offline',
    count: Number(m[3]),
    allReady: m[4] !== undefined,
    variant: (m[5] as FlowLobbyCaseKey['variant']) ?? null,
  };
}

/** 화면 ID + 케이스 키를 해석한다. 문법이나 어휘가 맞지 않으면 null */
export function parseFlowCaseKey(screen: string, key: string): FlowCaseKey | null {
  if (!isFlowScreenId(screen)) return null;
  if (screen === 'FH06') return parseLobby(key);
  if (PREP_STATES[screen]) return parsePrep(screen, key);
  const vocabulary = SIMPLE_KEYS[screen];
  if (!vocabulary?.includes(key)) return null;
  return { kind: 'simple', screen, key };
}

/** `FM06c:on-group-opt-member-idle` 형태의 참조(case-keys.json 의 cases 항목) 해석 */
export function parseFlowCaseRef(ref: string): FlowCaseKey | null {
  const at = ref.indexOf(':');
  if (at < 1) return null;
  return parseFlowCaseKey(ref.slice(0, at), ref.slice(at + 1));
}

/** 키에서 장소를 안전하게 꺼낸다(prep·lobby 만 의미가 있다) */
export function placeOfCaseKey(parsed: FlowCaseKey): FlowPlace | null {
  return parsed.kind === 'simple' ? null : parsed.place;
}

/** 마법사(FM06a~e) 진행 점 개수: 온라인 5 · 오프라인 4(기기 점검 없음) · 밴드 사용 안 함이면 −1(밴드 단계 없음) */
export function expectedWizardSteps(parsed: FlowCaseKey): number | null {
  if (parsed.kind !== 'prep') return null;
  if (!/^FM06[a-e]$/.test(parsed.screen)) return null;
  return (parsed.place === 'online' ? 5 : 4) - (parsed.bandMode === 'none' ? 1 : 0);
}

/** FR5 상태 의존 요소 기대값. null = 해당 없음 */
export interface ExpectedFlowState {
  /** 전극 트래커(288×64)가 보여야 하는가 */
  tracker: boolean | null;
  /** 내 영상·소리 형태: video(카메라 켜짐) / bar(가로 막대) / none(마이크 사용 불가) */
  avMode: 'video' | 'bar' | 'none' | null;
}

export function expectedFlowState(parsed: FlowCaseKey): ExpectedFlowState {
  const none: ExpectedFlowState = { tracker: null, avMode: null };
  if (parsed.kind !== 'prep') return none;
  if (parsed.screen === 'FM06c') return { tracker: parsed.state.startsWith('leadoff'), avMode: null };
  if (parsed.screen === 'FM06d') {
    const avMode = parsed.state.startsWith('camon') ? 'video' : ['mic', 'camdenied'].includes(parsed.state) ? 'bar' : 'none';
    return { tracker: null, avMode };
  }
  return none;
}
