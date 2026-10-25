// SDD-246 T06 후속 — 5분 막대: LiveState 의 내 metric 을 BarAggregator 로 모으고, 데스크톱에서만 막대, 모바일은 현재값만.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MetricBars } from '../../src/components/class/player/member/MetricBars';
import { collectBars } from '../../src/lib/session-live/metric-bars';
import { PID, metricsData, snapshot } from './fixtures';
import { applySnapshot, createLiveState } from '../../src/lib/session-live/live-state';
import { BarAggregator } from '../../src/lib/session-live/live-view';

function stateWith(seq: string, observed: number, focus: number | null) {
  const base = createLiveState({ sessionId: snapshot().session_id });
  const snap = snapshot({ metrics: { entities: { [PID]: { version: seq, data: metricsData(seq, observed, focus) } }, tombstones: [] } });
  const r = applySnapshot({ ...base, expected: { requestId: snap.request_id, generation: snap.connection_generation } }, snap);
  return r.state;
}

describe('collectBars', () => {
  it('같은 sequence 는 한 번만 세고, 무효값은 평균에 넣지 않는다', () => {
    const agg = new BarAggregator();
    const t = 1_760_000_000_000;
    collectBars(agg, stateWith('1', t, 60), PID, 'focus_display', t);
    collectBars(agg, stateWith('1', t, 60), PID, 'focus_display', t);
    collectBars(agg, stateWith('2', t + 1000, 80), PID, 'focus_display', t + 1000);
    collectBars(agg, stateWith('3', t + 2000, null), PID, 'focus_display', t + 2000);
    const s = agg.series();
    expect(s).toHaveLength(1);
    expect(s[0]!.validCount).toBe(2);
    expect(s[0]!.mean).toBe(70);
  });
});

describe('MetricBars 표시 정책', () => {
  const bars = [{ startMs: 0, mean: 62, validCount: 280 }, { startMs: 300_000, mean: null, validCount: 0 }];
  it('데스크톱은 5분 막대 + 현재값', () => {
    const html = renderToStaticMarkup(<MetricBars mode="desktop" label="집중" current={62} bars={bars} />);
    expect(html).toContain('data-testid="metric-bars"');
    expect(html).toContain('62');
  });
  it('모바일은 현재값만(막대 없음)', () => {
    const html = renderToStaticMarkup(<MetricBars mode="mobile" label="집중" current={62} bars={bars} />);
    expect(html).not.toContain('data-testid="metric-bars"');
    expect(html).toContain('62');
  });
  it('값 없음은 0 이 아니라 대시, 종합점수 문구 없음', () => {
    const html = renderToStaticMarkup(<MetricBars mode="desktop" label="집중" current={null} bars={bars} />);
    expect(html).toContain('—');
    expect(html).not.toContain('종합');
  });
});
