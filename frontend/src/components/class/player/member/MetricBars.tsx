// SDD-246 T06 — 회원 화면 지표 표시: 현재값(매초) + 데스크톱 5분 막대. 모바일은 현재값만. 종합점수 없음.
import { metricPresentation, type Bar, type ViewMode } from '../../../../lib/session-live/live-view';

interface MetricBarsProps {
  mode: ViewMode;
  label: string;
  /** 현재값(매초 갱신). null 이면 값 없음 — 0 으로 그리지 않는다 */
  current: number | null;
  bars: readonly Bar[];
}

// 11/6 대표 지시: 상단 "이완 + 숫자" 줄은 보여 주지 않는다(앱·웹 공통). 숫자는 가운데 링이 이미 보여 준다.
// 데스크톱(≥768px)의 5분 막대만 유지하고, 모바일은 아무것도 그리지 않는다.
export function MetricBars({ mode, label, bars }: MetricBarsProps) {
  const policy = metricPresentation(mode);
  if (!policy.showBars) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="metric-current">
      {policy.showBars ? (
        <div className="flex h-16 items-end gap-1" data-testid="metric-bars" role="img" aria-label={`${label} 5분 평균 막대`}>
          {bars.map((b) => (
            <div
              key={b.startMs}
              className="w-3 rounded-t bg-current opacity-60"
              style={{ height: b.mean == null ? 2 : `${Math.max(4, Math.min(100, b.mean))}%` }}
              title={b.mean == null ? '유효 데이터 없음' : `평균 ${Math.round(b.mean)} · ${b.validCount}초`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
