// SDD-208 — 상담사 진행 화면의 뷰 상태(지표·순환·정렬·표·시트·상세). 컨테이너와 하니스가 같은 훅을 쓴다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { nextMetricKey, type HostSheetKey, type HostSort, type HostUiInitial } from '../../../../lib/class/host-player-case';
import type { PlayerMetricKey } from '../../../../lib/class/player-case';

export const HOST_ROTATE_MS = 10_000;

export interface HostUiState {
  metric: PlayerMetricKey;
  rotate: boolean;
  sort: HostSort;
  handsFirst: boolean;
  table: boolean;
  sheet: HostSheetKey | null;
  detailId: string | null;
  camBig: boolean;
}

export interface HostUiActions {
  setMetric: (metric: PlayerMetricKey) => void;
  setRotate: (rotate: boolean) => void;
  setSort: (sort: HostSort) => void;
  setHandsFirst: (on: boolean) => void;
  setTable: (on: boolean) => void;
  /** 같은 시트를 다시 고르면 닫는다 */
  toggleSheet: (sheet: HostSheetKey) => void;
  openSheet: (sheet: HostSheetKey) => void;
  openDetail: (participantId: string) => void;
  closeSheet: () => void;
  toggleCamBig: () => void;
}

export function useHostUi(initial: HostUiInitial): { ui: HostUiState; actions: HostUiActions } {
  const [ui, setUi] = useState<HostUiState>(() => ({ ...initial }));

  // 10초 순환 — 표 보기·참가자 상세가 열려 있으면 멈춘다(기존 동작 계승)
  const rotating = ui.rotate && !ui.table && ui.sheet !== 'detail';
  useEffect(() => {
    if (!rotating) return undefined;
    const timer = window.setInterval(() => {
      setUi((prev) => ({ ...prev, metric: nextMetricKey(prev.metric) }));
    }, HOST_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [rotating]);

  const setMetric = useCallback((metric: PlayerMetricKey) => setUi((prev) => ({ ...prev, metric })), []);
  const setRotate = useCallback((rotate: boolean) => setUi((prev) => ({ ...prev, rotate })), []);
  const setSort = useCallback((sort: HostSort) => setUi((prev) => ({ ...prev, sort })), []);
  const setHandsFirst = useCallback((handsFirst: boolean) => setUi((prev) => ({ ...prev, handsFirst })), []);
  const setTable = useCallback((table: boolean) => setUi((prev) => ({ ...prev, table })), []);
  const toggleSheet = useCallback(
    (sheet: HostSheetKey) => setUi((prev) => ({ ...prev, sheet: prev.sheet === sheet ? null : sheet, detailId: null })),
    [],
  );
  const openSheet = useCallback((sheet: HostSheetKey) => setUi((prev) => ({ ...prev, sheet, detailId: null })), []);
  const openDetail = useCallback((participantId: string) => setUi((prev) => ({ ...prev, sheet: 'detail', detailId: participantId })), []);
  const closeSheet = useCallback(() => setUi((prev) => ({ ...prev, sheet: null, detailId: null })), []);
  const toggleCamBig = useCallback(() => setUi((prev) => ({ ...prev, camBig: !prev.camBig })), []);

  const actions = useMemo<HostUiActions>(
    () => ({ setMetric, setRotate, setSort, setHandsFirst, setTable, toggleSheet, openSheet, openDetail, closeSheet, toggleCamBig }),
    [setMetric, setRotate, setSort, setHandsFirst, setTable, toggleSheet, openSheet, openDetail, closeSheet, toggleCamBig],
  );
  return { ui, actions };
}
