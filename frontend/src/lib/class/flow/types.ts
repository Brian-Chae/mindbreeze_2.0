// SDD-209 T1 — 사전·사후 흐름(회원 FM*, 상담사 FH*) 공용 타입.
// 케이스 키 정본: designs/class-flow-redesign/case-keys.json (232개).

export const FLOW_MEMBER_SCREENS = [
  'FM01', 'FM02', 'FM03', 'FM04', 'FM04b', 'FM05', 'FM10',
  'FM06a', 'FM06b', 'FM06c', 'FM06d', 'FM06e', 'FM07', 'FM08', 'FM09',
] as const;

export const FLOW_HOST_SCREENS = [
  'FH01', 'FH02a', 'FH02b', 'FH02c', 'FH02d', 'FH02e', 'FH03', 'FH04',
  'FH05', 'FH06', 'FH06a', 'FH07', 'FH08', 'FH09', 'FH10',
] as const;

export const FLOW_SCREEN_IDS = [...FLOW_MEMBER_SCREENS, ...FLOW_HOST_SCREENS] as const;

export type FlowMemberScreenId = (typeof FLOW_MEMBER_SCREENS)[number];
export type FlowHostScreenId = (typeof FLOW_HOST_SCREENS)[number];
export type FlowScreenId = (typeof FLOW_SCREEN_IDS)[number];
export type FlowRole = 'member' | 'host';

/** 장소: 온라인(on) / 오프라인(off) */
export type FlowPlace = 'online' | 'offline';
/** 인원: 그룹 / 1:1 */
export type FlowSize = 'group' | 'solo';
/** 밴드 모드: 선택(opt) / 필수 안내(req) / 사용 안 함(none) — 어느 모드든 참가는 막지 않는다 */
export type FlowBandMode = 'opt' | 'req' | 'none';

/** 화면 ID 가 속한 역할(FM=회원, FH=상담사) */
export function roleOfScreen(screen: FlowScreenId): FlowRole {
  return screen.startsWith('FM') ? 'member' : 'host';
}

/** 회원 사전 흐름 케이스: `{on|off}-{group|solo}[-{opt|req|none}]-member[-상태]` */
export interface FlowPrepCaseKey {
  kind: 'prep';
  screen: FlowScreenId;
  key: string;
  place: FlowPlace;
  size: FlowSize;
  /** FM08·FM09 는 키에 밴드 모드가 없다 */
  bandMode: FlowBandMode | null;
  /** `member` 뒤 상태 토큰(없으면 빈 문자열). `-started` 는 제외된다 */
  state: string;
  /** 시작 후 입장 변형(`-started`) */
  started: boolean;
}

/** FH06 로비 케이스: `{g|o}-{on|off}-{N}[r][-req|-none|-wait|-contact|-inv0|-many]` */
export interface FlowLobbyCaseKey {
  kind: 'lobby';
  screen: 'FH06';
  key: string;
  size: FlowSize;
  place: FlowPlace;
  /** 대기실 인원 */
  count: number;
  /** `r` 접미 — 전원 준비 완료 */
  allReady: boolean;
  variant: 'req' | 'none' | 'wait' | 'contact' | 'inv0' | 'many' | null;
}

/** 그 외 화면 케이스: 화면별 고정 키(어휘는 FLOW_SIMPLE_KEYS) */
export interface FlowSimpleCaseKey {
  kind: 'simple';
  screen: FlowScreenId;
  key: string;
}

export type FlowCaseKey = FlowPrepCaseKey | FlowLobbyCaseKey | FlowSimpleCaseKey;

/** 하니스 쿼리로 넘어오는 케이스 변형 값 */
export interface FlowCaseContext {
  /** 화면 ID(자가검증 픽스처는 `__selftest`) */
  screen: string;
  caseKey: string;
  /** 열려 있어야 할 시트 이름(쿼리 sheet=) */
  sheet: string | null;
  /** 인원 변형(쿼리 n=) */
  n: number | null;
  /** 마이크 레벨 0~1(쿼리 level=) */
  level: number | null;
  /** 전극 상태 오버라이드(쿼리 ch1=, ch2=): good | bad | unknown */
  ch1: string | null;
  ch2: string | null;
  /** 측정·스크린샷이 결정적이도록 고정한 배경 */
  backdropSrc: string;
  params: URLSearchParams;
}

export interface FlowCaseEntry {
  /** 케이스 설명(인덱스 표용) */
  description: string;
  render: (ctx: FlowCaseContext) => import('react').ReactNode;
}
