// 지표 바차트 — 1.0 BrainChart 패리티 (SDD-040: maxValue로 몸 지표 스케일)
// bar 14px / gap 12px / threshold = maxValue * 0.4 / 고 #D9D9D9CC · 저 #D9D9D933

interface BrainChartProps {
  /** 지표 시계열 */
  values: number[];
  className?: string;
  /** 차트 높이(px). 기본 248 */
  height?: number;
  /** Y축 상한. 기본 100 (마음 지표). BPM/호흡/HRV는 호출측에서 지정 */
  maxValue?: number;
  /** 접근성 라벨 */
  ariaLabel?: string;
}

const BAR_WIDTH = 14;
const BAR_GAP = 12;
const COLOR_HIGH = '#D9D9D9CC';
const COLOR_LOW = '#D9D9D933';

export function BrainChart({
  values,
  className = '',
  height = 248,
  maxValue = 100,
  ariaLabel = '실시간 지표 바차트',
}: BrainChartProps) {
  const count = Math.max(values.length, 1);
  const width = count * BAR_WIDTH + Math.max(0, count - 1) * BAR_GAP;
  const viewHeight = height;
  const ceiling = maxValue > 0 ? maxValue : 100;
  const threshold = ceiling * 0.4;

  return (
    <svg
      className={className}
      width="100%"
      height={height}
      viewBox={`0 0 ${Math.max(width, BAR_WIDTH)} ${viewHeight}`}
      preserveAspectRatio="xMidYMax meet"
      role="img"
      aria-label={ariaLabel}
    >
      {values.length === 0 ? (
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          fill="#FFFFFF99"
          fontSize="14"
        >
          —
        </text>
      ) : (
        values.map((raw, index) => {
          const value = Math.max(0, Math.min(ceiling, raw));
          const barH = Math.max(4, (value / ceiling) * viewHeight);
          const x = index * (BAR_WIDTH + BAR_GAP);
          const y = viewHeight - barH;
          const fill = value > threshold ? COLOR_HIGH : COLOR_LOW;
          return (
            <rect
              key={`bar-${index}`}
              x={x}
              y={y}
              width={BAR_WIDTH}
              height={barH}
              rx={BAR_WIDTH / 2}
              ry={BAR_WIDTH / 2}
              fill={fill}
            />
          );
        })
      )}
    </svg>
  );
}
