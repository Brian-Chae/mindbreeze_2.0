// 개선 5: 무음 시그널(비언어적 리액션·상태 신호) — 순수 로직 + 표시 메타.
//
// 기본 뮤트 1:N 수업에서 회원은 발언권(손들기) 없이는 상태를 전달할 방법이 없다.
// 회원이 3버튼(잘 따라가요 / 조금 어려워요 / 잠시 쉴게요)으로 조용히 신호를 보내면
// 상담사 화면의 참여자 카드에 은은한 배지가 몇 초 표시된 뒤 사라지고,
// 상단에는 유형별 집계 카운트만 남는다(소리·팝업 없음, 발언권과 독립).
//
// 컴포넌트·훅·테스트가 함께 쓰는 단일 출처 — 여기 값은 백엔드 `class:signal` 계약과 동일하다.

/** WS 이벤트명 — 백엔드 `/session-live` 네임스페이스와 동일 계약 */
export const CLASS_SIGNAL_EVENT = 'class:signal';

export type ClassSignalType = 'following' | 'difficult' | 'resting';

/** 신호 유형 화이트리스트 — 미정의 값은 서버가 무시한다(클라이언트도 선검증) */
export const CLASS_SIGNAL_TYPES: readonly ClassSignalType[] = [
  'following',
  'difficult',
  'resting',
] as const;

/** 상담사 카드에 신호를 보여 주는 시간(ms) — 이후 CSS 페이드로 사라진다 */
export const SIGNAL_FLASH_MS = 6000;

/** 활성 신호(집계 카운트) 유지 시간(ms) — 백엔드 TTL(10초)과 동일 창 */
export const SIGNAL_ACTIVE_MS = 10_000;

/** 유형별 집계 카운트 — 서버 payload counts 와 동일 shape */
export interface ClassSignalCounts {
  following: number;
  difficult: number;
  resting: number;
  total: number;
}

export const EMPTY_SIGNAL_COUNTS: ClassSignalCounts = {
  following: 0,
  difficult: 0,
  resting: 0,
  total: 0,
};

export interface ClassSignalMeta {
  /** 조용한 표시용 아이콘(이모지) */
  icon: string;
  /** 버튼·배지 라벨 */
  label: string;
  /** 회원 버튼 보조 문구(툴팁) */
  hint: string;
  /** 상담사 카드 배지 색조 — 은은한 톤(알림 강조색 금지) */
  badgeClass: string;
  /** 회원 버튼 아이콘 색조 */
  buttonClass: string;
}

export const CLASS_SIGNAL_META: Record<ClassSignalType, ClassSignalMeta> = {
  following: {
    icon: '🌿',
    label: '잘 따라가요',
    hint: '지금 흐름이 편안해요',
    badgeClass: 'bg-[#59CE9026] text-[#2F9E68]',
    buttonClass: 'text-[#9BE7C4]',
  },
  difficult: {
    icon: '💧',
    label: '조금 어려워요',
    hint: '속도나 안내가 어려워요',
    badgeClass: 'bg-[#F5E2B8] text-[#8A6B1F]',
    buttonClass: 'text-[#F5D48B]',
  },
  resting: {
    icon: '🌙',
    label: '잠시 쉴게요',
    hint: '잠깐 쉬어갈게요',
    badgeClass: 'bg-[#E5E0F5] text-[#5F4B8B]',
    buttonClass: 'text-[#CFC3F5]',
  },
};

/** 서버·외부 입력 검증용 타입 가드 */
export function isClassSignalType(value: unknown): value is ClassSignalType {
  return typeof value === 'string' && (CLASS_SIGNAL_TYPES as readonly string[]).includes(value);
}

/** 참여자별 활성 신호 — 마지막으로 받은 신호 1건만 유지한다 */
export interface ActiveSignal {
  type: ClassSignalType;
  /** 수신 시각(epoch ms) — 카드 표시·집계 TTL 판정 기준 */
  at: number;
}

export type SignalMap = Readonly<Record<string, ActiveSignal>>;

/**
 * 참여자 신호 기록(참여자당 최신 1건).
 * 불변 갱신 — 기존 맵을 변경하지 않고 새 객체를 만든다(변화 없으면 동일 참조).
 */
export function recordSignal(
  map: SignalMap,
  participantId: string,
  type: ClassSignalType,
  at: number,
): SignalMap {
  if (!participantId) return map;
  const previous = map[participantId];
  if (previous && previous.type === type && previous.at === at) return map;
  return { ...map, [participantId]: { type, at } };
}

/** TTL 이 지난 신호 제거 — 남길 게 없으면 동일 참조를 돌려 불필요한 리렌더를 막는다 */
export function pruneSignals(
  map: SignalMap,
  now: number,
  ttl: number = SIGNAL_ACTIVE_MS,
): SignalMap {
  const entries = Object.entries(map);
  const kept = entries.filter(([, signal]) => now - signal.at < ttl);
  if (kept.length === entries.length) return map;
  const next: Record<string, ActiveSignal> = {};
  for (const [participantId, signal] of kept) {
    next[participantId] = signal;
  }
  return next;
}

/** 활성 신호 유형별 집계 — 상단 카운트 표시용 */
export function countSignals(
  map: SignalMap,
  now: number,
  ttl: number = SIGNAL_ACTIVE_MS,
): ClassSignalCounts {
  const counts: ClassSignalCounts = { ...EMPTY_SIGNAL_COUNTS };
  for (const signal of Object.values(map)) {
    if (now - signal.at >= ttl) continue;
    counts[signal.type] += 1;
    counts.total += 1;
  }
  return counts;
}

/** 상단 요약 조각 — 카운트가 있는 유형만 ("🌿 잘 따라가요 3") */
export function signalCountParts(counts: ClassSignalCounts): string[] {
  return CLASS_SIGNAL_TYPES.filter((type) => counts[type] > 0).map(
    (type) => `${CLASS_SIGNAL_META[type].icon} ${CLASS_SIGNAL_META[type].label} ${counts[type]}`,
  );
}
