/**
 * SDD-034 — 명상 지표 게이지 / 수치 카드.
 * Tailwind만 사용 (인라인 스타일 금지).
 */

export interface MetricView {
  key: string;
  label: string;
  unit: string;
  range: [number, number];
  value: number;
  stale?: boolean;
}

interface MetricGaugeProps {
  metric: MetricView;
  /** 값이 아직 계산되지 않았으면 '--'로 표시해 실제 0과 구분 */
  pending?: boolean;
  /** 트렌드(P5) 표시 대상 여부 */
  selected?: boolean;
  onToggle?: (key: string) => void;
  /** 중앙 기준 양방향 바 (hemisphericBalance 등) */
  bidirectional?: boolean;
}

/** 0~1 진행률 → 고정 클래스 (5% 단위 스냅) */
const WIDTH_CLASS = [
  'w-0',
  'w-1/12',
  'w-1/6',
  'w-1/4',
  'w-1/3',
  'w-5/12',
  'w-1/2',
  'w-7/12',
  'w-2/3',
  'w-3/4',
  'w-5/6',
  'w-11/12',
  'w-full',
] as const;

function widthClass(ratio: number): string {
  const idx = Math.max(0, Math.min(WIDTH_CLASS.length - 1, Math.round(ratio * 12)));
  return WIDTH_CLASS[idx];
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '--';
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

export function MetricGauge({
  metric,
  pending = false,
  selected = false,
  onToggle,
  bidirectional = false,
}: MetricGaugeProps) {
  const [min, max] = metric.range;
  const ratio = max > min ? Math.min(1, Math.max(0, (metric.value - min) / (max - min))) : 0;
  const interactive = typeof onToggle === 'function';

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-gray-400">{metric.label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={[
            'text-xl font-bold tabular-nums',
            pending ? 'text-gray-600' : metric.stale ? 'text-gray-500' : 'text-gray-100',
          ].join(' ')}
        >
          {pending ? '--' : formatValue(metric.value)}
        </span>
        {metric.unit && !pending && (
          <span className="text-xs text-gray-500">{metric.unit}</span>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-800">
        {!pending && (
          <div
            className={[
              'h-full rounded-full',
              bidirectional ? 'bg-violet-400' : 'bg-[#5F0080]',
              metric.stale ? 'opacity-40' : '',
              widthClass(ratio),
            ].join(' ')}
          />
        )}
      </div>
      {bidirectional ? (
        <p className="mt-1 text-[10px] text-gray-600">중앙 50 = 좌우 균형</p>
      ) : null}
    </>
  );

  const base = [
    'rounded-lg border p-3 text-left transition-colors',
    selected ? 'border-[#5F0080] bg-[#5F0080]/10' : 'border-gray-800 bg-gray-950',
    interactive ? 'hover:border-gray-700' : '',
  ].join(' ');

  if (!interactive) {
    return <div className={base}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onToggle?.(metric.key)}
      aria-pressed={selected}
      className={`${base} w-full`}
    >
      {body}
    </button>
  );
}

interface ValueCardProps {
  label: string;
  value: number | string;
  unit?: string;
  pending?: boolean;
}

export function ValueCard({ label, value, unit, pending = false }: ValueCardProps) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
      <div className="truncate text-xs text-gray-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={[
            'text-lg font-semibold tabular-nums',
            pending ? 'text-gray-600' : 'text-gray-100',
          ].join(' ')}
        >
          {pending ? '--' : typeof value === 'number' ? formatValue(value) : value}
        </span>
        {unit && !pending && <span className="text-xs text-gray-500">{unit}</span>}
      </div>
    </div>
  );
}
