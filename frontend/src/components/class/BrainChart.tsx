// 두뇌휴식도 바차트 — 1.0 BrainChart 패리티
// bar 14px / gap 12px / threshold 40 / 고 #D9D9D9CC · 저 #D9D9D933

interface BrainChartProps {
  /** 두뇌휴식도(0~100) 시계열 */
  values: number[];
  className?: string;
  /** 차트 높이(px). 기본 248 */
  height?: number;
}

const BAR_WIDTH = 14;
const BAR_GAP = 12;
const THRESHOLD = 40;
const COLOR_HIGH = '#D9D9D9CC';
const COLOR_LOW = '#D9D9D933';

export function BrainChart({
  values,
  className = '',
  height = 248,
}: BrainChartProps) {
  const count = Math.max(values.length, 1);
  const width = count * BAR_WIDTH + Math.max(0, count - 1) * BAR_GAP;
  const viewHeight = height;

  return (
    <svg
      className={className}
      width="100%"
      height={height}
      viewBox={`0 0 ${Math.max(width, BAR_WIDTH)} ${viewHeight}`}
      preserveAspectRatio="xMidYMax meet"
      role="img"
      aria-label="실시간 두뇌휴식도 바차트"
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
          const value = Math.max(0, Math.min(100, raw));
          const barH = Math.max(4, (value / 100) * viewHeight);
          const x = index * (BAR_WIDTH + BAR_GAP);
          const y = viewHeight - barH;
          const fill = value > THRESHOLD ? COLOR_HIGH : COLOR_LOW;
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
