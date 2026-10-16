// SDD-208 — 케이스 하니스(/design/class-player) 계약.
// fixtures/*.ts 모듈이 `export const playerCases: Record<string, PlayerCaseEntry>` 를 내보내면 하니스가 자동 수집한다.
// 회원·상담사 트랙은 각자 fixtures 파일만 추가하면 되고, 하니스 페이지는 수정하지 않는다.
import type { ReactNode } from 'react';

export type PlayerRole = 'member' | 'host';

/** 측정·스크린샷이 결정적이도록 쓰는 정지 배경(시안 member.html 과 같은 background8) */
export const HARNESS_BACKDROP_SRC = '/images/background8.webp';

export interface PlayerCaseContext {
  /** 열려 있어야 할 시트 이름(쿼리 sheet=). 없으면 null */
  sheet: string | null;
  /** 참가자 상세 등 보조 선택(쿼리 detail=). 없으면 null */
  detail: string | null;
  /** 뷰는 PlayerBackdrop 의 imageSrc 로 넘겨 배경을 고정한다 */
  backdropSrc: string;
  /** 그 외 쿼리 전체(n=12, metric=relax, cam=big 등 케이스별 변형) */
  params: URLSearchParams;
}

export interface PlayerCaseEntry {
  role: PlayerRole;
  render: (ctx: PlayerCaseContext) => ReactNode;
}

export type PlayerCaseMap = Record<string, PlayerCaseEntry>;

function isCaseEntry(value: unknown): value is PlayerCaseEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { role?: unknown; render?: unknown };
  return (candidate.role === 'member' || candidate.role === 'host') && typeof candidate.render === 'function';
}

/** import.meta.glob 결과(모듈 경로 → 모듈)에서 playerCases 를 모은다. 경로 순으로 병합해 결과가 결정적이다 */
export function collectPlayerCases(modules: Record<string, unknown>): PlayerCaseMap {
  const collected: PlayerCaseMap = {};
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path];
    if (typeof mod !== 'object' || mod === null || !('playerCases' in mod)) continue;
    const cases = (mod as { playerCases: unknown }).playerCases;
    if (typeof cases !== 'object' || cases === null) continue;
    for (const [id, entry] of Object.entries(cases)) {
      if (isCaseEntry(entry)) collected[id] = entry;
    }
  }
  return collected;
}

const MAX_VIEWPORT_PX = 8000;

/** "390x844" 형태의 뷰포트 문자열 해석. 형식이 아니거나 범위를 벗어나면 null */
export function parseViewport(raw: string | null): { width: number; height: number } | null {
  const match = /^(\d{2,5})[xX](\d{2,5})$/.exec(raw ?? '');
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width > MAX_VIEWPORT_PX || height > MAX_VIEWPORT_PX) return null;
  return { width, height };
}
