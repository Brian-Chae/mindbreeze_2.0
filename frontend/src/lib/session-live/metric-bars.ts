// SDD-246 T06 — 내 metric 을 5분 막대로 모으는 로직(컴포넌트 파일과 분리: fast refresh 규칙).
import { useEffect, useRef, useState } from 'react';
import { BarAggregator, freshnessOf, type Bar } from './live-view';
import type { LiveState } from './live-state';

/** LiveState 의 내 metric 한 점을 집계기에 넣는다. 지연/stale/무효는 평균에서 제외(0 취급 금지), 같은 sequence 는 한 번만. */
export function collectBars(agg: BarAggregator, state: LiveState, participantId: string, key: string, nowMs: number): void {
  const m = state.metrics[participantId]?.data;
  if (!m || m.observed_at_ms == null) return;
  const v = m.metrics[key];
  const fresh = freshnessOf(m.observed_at_ms, nowMs, m.freshness) === 'fresh';
  agg.add(participantId, m.sequence, m.observed_at_ms, v?.value ?? null, fresh && v?.validity === 'valid');
}

/** 내 metric 이 바뀔 때마다 막대를 갱신하는 훅 — 집계기는 ref 로 들고 시리즈만 state 로 내보낸다. */
export function useMetricBars(state: LiveState | null, participantId: string | null, key: string, nowMs: number): Bar[] {
  const aggRef = useRef(new BarAggregator());
  const [bars, setBars] = useState<Bar[]>([]);
  const m = participantId && state ? state.metrics[participantId]?.data : undefined;
  useEffect(() => {
    if (!state || !participantId || !m) return;
    collectBars(aggRef.current, state, participantId, key, nowMs);
    setBars(aggRef.current.series());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 새 sequence 가 도착할 때만 집계한다(nowMs 변화로 재집계 금지)
  }, [m?.sequence, key]);
  return bars;
}

