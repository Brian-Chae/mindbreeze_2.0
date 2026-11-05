// SDD-293 — 네이티브가 밴드를 "보류(hold)"로 쥐고 있는지의 모듈 단위 상태.
// 밴드 단계 완료 직후 네이티브가 인계받아 쥐고, 클래스가 시작되면 새 연결 없이 그대로 측정을 시작한다.
// 화면은 이 값으로 인계 중·직후에도 밴드가 "연결됨"으로 이어져 보이게 한다(연결 중 표시 억제).
import { useSyncExternalStore } from 'react';

export interface BandHoldState { held: boolean; deviceId: string | null }

let state: BandHoldState = { held: false, deviceId: null };
const subs = new Set<() => void>();
const emit = (): void => { for (const f of [...subs]) f(); };

export const getBandHold = (): BandHoldState => state;
export function setBandHold(next: BandHoldState): void {
  if (next.held === state.held && next.deviceId === state.deviceId) return;
  state = next; emit();
}
export const clearBandHold = (): void => setBandHold({ held: false, deviceId: null });
export function subscribeBandHold(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
export function useBandHold(): BandHoldState { return useSyncExternalStore(subscribeBandHold, getBandHold, getBandHold); }
