// SDD-209 H5 — FH06 하니스 입력(시안 host-b.html LOBBY 표 이식). 키 → 초대 명단·대기실 presence·맥락.
// 서버·소켓 없이 같은 모델(deriveLobby)을 통과시켜 화면과 로직이 같은 경로로 검증된다.
import type { LinkbandMode } from '../../api/session';
import { deriveLobby, type LobbyContext, type LobbyModel, type LobbyPresenceEntry, type LobbyRosterEntry } from './host-lobby-model';
import type { FlowPlace, FlowSize } from './types';

export const LOBBY_NAMES = ['서연', '민준', '지우', '하준', '서아', '도윤', '예린', '시우', '지호', '수아', '현우', '하은'] as const;
export const LOBBY_TITLE = '마음챙김 명상 · 4회차';
export const LOBBY_ADDRESS = '서울 강남구 테헤란로 123 · 4층 명상실';
export const LOBBY_START_TEXT = '오늘 오후 3:00';
export const LOBBY_CODE = '4829';

type Fill = 'part' | 'all' | 'mix' | 'none' | 'many';
type Raw = 'ok' | 'wait' | 'skip' | 'bad';

interface LobbyCfg {
  place: FlowPlace;
  /** 시안의 grp 값. FH06 `g-off-0-inv0` 만 키 접두(g=그룹)와 시안(grp:false=1:1)이 다르다 — 시안이 정본이라 그대로 따른다 */
  size: FlowSize;
  n: number;
  fill: Fill;
  band: LinkbandMode;
  inv: number;
  /** 회원 index → 접촉 불량 전극 */
  contact?: Readonly<Record<number, 'L' | 'R' | 'LR'>>;
}

const cfg = (place: FlowPlace, size: FlowSize, n: number, fill: Fill, band: LinkbandMode, inv: number, contact?: LobbyCfg['contact']): LobbyCfg => ({ place, size, n, fill, band, inv, contact });

export const LOBBY_CASES: Readonly<Record<string, LobbyCfg>> = {
  'g-on-0': cfg('online', 'group', 0, 'part', 'optional', 6),
  'g-on-3': cfg('online', 'group', 3, 'part', 'optional', 6),
  'g-on-8': cfg('online', 'group', 8, 'all', 'optional', 8),
  'g-on-12': cfg('online', 'group', 12, 'mix', 'optional', 14),
  'g-off-0': cfg('offline', 'group', 0, 'part', 'optional', 6),
  'g-off-3': cfg('offline', 'group', 3, 'part', 'optional', 6),
  'g-off-8': cfg('offline', 'group', 8, 'all', 'optional', 8),
  'g-off-12': cfg('offline', 'group', 12, 'mix', 'optional', 14),
  'o-on-0': cfg('online', 'solo', 0, 'part', 'optional', 1),
  'o-on-1': cfg('online', 'solo', 1, 'part', 'optional', 1),
  'o-on-1r': cfg('online', 'solo', 1, 'all', 'optional', 1),
  'o-off-0': cfg('offline', 'solo', 0, 'part', 'optional', 1),
  'o-off-1': cfg('offline', 'solo', 1, 'part', 'optional', 1),
  'o-off-1r': cfg('offline', 'solo', 1, 'all', 'optional', 1),
  'g-on-3-req': cfg('online', 'group', 3, 'part', 'required', 6),
  'g-off-3-none': cfg('offline', 'group', 3, 'part', 'none', 6),
  'o-off-1r-none': cfg('offline', 'solo', 1, 'all', 'none', 1),
  'g-on-8-none': cfg('online', 'group', 8, 'all', 'none', 8),
  'g-on-0-inv0': cfg('online', 'group', 0, 'part', 'optional', 0),
  'g-off-0-inv0': cfg('offline', 'solo', 0, 'part', 'optional', 0),
  'g-on-3-wait': cfg('online', 'group', 3, 'none', 'optional', 6),
  'g-off-3-wait': cfg('offline', 'group', 3, 'none', 'optional', 6),
  'g-on-12-many': cfg('online', 'group', 12, 'many', 'optional', 14),
  'g-on-3-contact': cfg('online', 'group', 3, 'all', 'optional', 6, { 0: 'L', 1: 'R', 2: 'LR' }),
  'g-on-8-contact': cfg('online', 'group', 8, 'all', 'optional', 8, { 3: 'L' }),
};

export const LOBBY_DESC: Readonly<Record<string, string>> = {
  'g-on-0': '온라인·그룹·초대 6명, 대기 0명 (시작 가능, 상태줄 안내)', 'g-on-3': '온라인·그룹·초대 6명, 대기 3명 (일부 준비 중, 시작 가능)',
  'g-on-8': '온라인·그룹·8명 전원 입장·준비 완료', 'g-on-12': '온라인·그룹·초대 14명, 대기 12명 (목록 내부 스크롤)',
  'g-off-0': '오프라인·그룹·대기 0명 (시작 가능)', 'g-off-3': '오프라인·그룹·대기 3명', 'g-off-8': '오프라인·그룹·8명 전원 완료', 'g-off-12': '오프라인·그룹·대기 12명',
  'o-on-0': '온라인·1:1·대기 0명 (시작 가능)', 'o-on-1': '온라인·1:1·1명 준비 중 (시작 가능)', 'o-on-1r': '온라인·1:1·1명 준비 완료',
  'o-off-0': '오프라인·1:1·대기 0명 (시작 가능)', 'o-off-1': '오프라인·1:1·1명 준비 중', 'o-off-1r': '오프라인·1:1·1명 준비 완료',
  'g-on-3-req': 'LINK BAND 필수 — 밴드 연결 전인 회원도 대기실 행·시작 판정에 그대로 포함(참가 조건 아님)', 'g-off-3-none': '오프라인·밴드 사용 안 함·대기 3명',
  'o-off-1r-none': '오프라인·1:1·밴드 없음 (가장 비어 보이는 조합)', 'g-on-8-none': '온라인·밴드 사용 안 함·8명',
  'g-on-0-inv0': '온라인·그룹·초대 0명·대기 0명 (시작 가능)', 'g-off-0-inv0': '오프라인·1:1·초대 0명·대기 0명 (시작 가능)',
  'g-on-3-wait': '온라인·그룹·3명 모두 준비 중 (준비 완료 0명, 시작 가능)', 'g-off-3-wait': '오프라인·그룹·3명 모두 준비 중 (시작 가능)', 'g-on-12-many': '온라인·그룹·12명 중 8명 준비 중',
  'g-on-3-contact': '전극 접촉 불량 3종 — L만 / R만 / 둘 다 (회원 행에 소형 LED)', 'g-on-8-contact': '8명 중 1명 L 접촉 불량 (2열 목록)',
};

interface RawCells {
  s: Raw;
  b: Raw;
  d: Raw;
}

/** 시안 members(cfg) 의 단계 채움 규칙 그대로 */
function rawCells(c: LobbyCfg, i: number): RawCells {
  let s: Raw = 'ok';
  let b: Raw = 'ok';
  let d: Raw = 'ok';
  if (c.fill === 'part') {
    if (c.n === 1) {
      d = 'wait';
      if (c.place === 'offline') {
        d = 'ok';
        b = 'wait';
        if (c.band === 'none') s = 'wait';
      }
    } else {
      if (i === 1) { b = 'wait'; d = 'wait'; }
      if (i === 2) { s = 'wait'; b = 'wait'; d = 'wait'; }
    }
  } else if (c.fill === 'none') {
    s = 'wait'; b = 'wait'; d = 'wait';
    if (i === 0) s = 'ok';
  } else if (c.fill === 'many') {
    if (i >= 4) { s = i % 3 === 0 ? 'ok' : 'wait'; b = 'wait'; d = 'wait'; }
  } else if (c.fill === 'mix') {
    if (i === 7) d = 'wait';
    if (i >= 9) { s = i === 9 ? 'ok' : 'wait'; b = 'wait'; d = 'wait'; }
  }
  if (c.fill !== 'part' && c.fill !== 'none' && c.band === 'optional' && b === 'ok' && i % 4 === 2) b = 'skip';
  if (c.contact?.[i]) b = 'bad';
  return { s, b, d };
}

function presenceOf(c: LobbyCfg, i: number, id: string): LobbyPresenceEntry {
  const cells = rawCells(c, i);
  const lead = c.contact?.[i];
  return {
    participantId: id,
    nickname: LOBBY_NAMES[i] ?? `회원${i + 1}`,
    readiness: {
      surveyDone: cells.s !== 'wait', surveySkipped: cells.s === 'skip',
      bandDone: cells.b !== 'wait', bandSkipped: cells.b === 'skip',
      deviceDone: cells.d !== 'wait', deviceSkipped: cells.d === 'skip',
    },
    leadOff: lead ? { ch1: lead.includes('L'), ch2: lead.includes('R') } : null,
  };
}

export interface LobbyFixture {
  ctx: LobbyContext;
  roster: LobbyRosterEntry[];
  presence: LobbyPresenceEntry[];
  model: LobbyModel;
}

export function buildLobbyFixture(key: string, nOverride?: number): LobbyFixture {
  const base = LOBBY_CASES[key];
  if (!base) throw new Error(`알 수 없는 로비 케이스: ${key}`);
  const c: LobbyCfg = nOverride === undefined ? base : { ...base, n: nOverride, inv: Math.max(base.inv, nOverride) };
  const roster: LobbyRosterEntry[] = Array.from({ length: c.inv }, (_, i) => ({ participantId: `p${i}`, name: LOBBY_NAMES[i] ?? `회원${i + 1}` }));
  const presence = Array.from({ length: c.n }, (_, i) => presenceOf(c, i, `p${i}`));
  const ctx: LobbyContext = { place: c.place, size: c.size, band: c.band };
  return { ctx, roster, presence, model: deriveLobby(roster, presence, ctx) };
}
