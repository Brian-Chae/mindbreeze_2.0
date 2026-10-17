// SDD-208 — 시트 분기 판정(균형.md S5). CSS 미디어쿼리가 아니라 이 함수 한 곳에서만 결정한다.
import { useSyncExternalStore } from 'react';

/** 사이드 시트가 허용되는 최소 폭(px) */
export const SIDE_SHEET_MIN_WIDTH = 1000;

export type SheetMode = 'side' | 'bottom';

/** 가로형(폭 > 높이)이면서 폭 ≥ 1000 일 때만 우측 사이드 시트. 태블릿 세로(834×1194)는 바텀 */
export function isSideSheet(vw: number, vh: number): boolean {
  return vw >= SIDE_SHEET_MIN_WIDTH && vw > vh;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}

function getMode(): SheetMode {
  return isSideSheet(window.innerWidth, window.innerHeight) ? 'side' : 'bottom';
}

export function useSheetMode(): SheetMode {
  return useSyncExternalStore(subscribe, getMode, () => 'bottom');
}
