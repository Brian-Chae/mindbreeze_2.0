// EEG 7지표 카드 그리드
// null → "산출 불가" (0 위장 금지)
// counselor=전체+reliability, client=상위 3~4 + 접힘

import { useState } from 'react';
import type { EegMetricKey, ReportEegContent } from '../../lib/api/report';
import {
  CLIENT_PRIMARY_METRIC_KEYS,
  EEG_METRIC_KEYS,
  resolveMetricLabel,
} from '../../lib/api/report';
import type { ReportType } from '../../lib/api/reports';

interface EegMetricsGridProps {
  eeg: ReportEegContent;
  reportType: ReportType;
}

function MetricCard({
  label,
  value,
  dense,
}: {
  label: string;
  value: number | null;
  dense: boolean;
}) {
  const display =
    value === null ? '산출 불가' : Number.isInteger(value) ? String(value) : value.toFixed(1);

  return (
    <div
      className={`rounded-xl border border-cyan-400/15 bg-black/40 ${
        dense ? 'px-3 py-3' : 'px-4 py-4'
      }`}
    >
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div
        className={`font-bold tracking-tight ${
          value === null ? 'text-[15px] text-slate-500' : 'text-[22px] text-cyan-200'
        }`}
      >
        {display}
      </div>
      {value !== null && (
        <div className="mt-0.5 font-mono text-[11px] text-slate-500">/ 100</div>
      )}
    </div>
  );
}

export default function EegMetricsGrid({ eeg, reportType }: EegMetricsGridProps) {
  const [expanded, setExpanded] = useState(false);
  const isCounselor = reportType === 'counselor';

  const primaryKeys: readonly EegMetricKey[] = isCounselor
    ? EEG_METRIC_KEYS
    : CLIENT_PRIMARY_METRIC_KEYS;

  const secondaryKeys: readonly EegMetricKey[] = isCounselor
    ? []
    : EEG_METRIC_KEYS.filter((k) => !CLIENT_PRIMARY_METRIC_KEYS.includes(k));

  const visibleKeys = isCounselor || expanded
    ? [...primaryKeys, ...secondaryKeys]
    : [...primaryKeys];

  return (
    <section className="rounded-2xl border border-cyan-400/20 bg-slate-950 p-5 text-slate-100">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-cyan-400/80">
            eeg metrics
          </p>
          <h3 className="mt-1 text-[15px] font-bold text-slate-100">
            {isCounselor ? '7지표 분석' : '오늘의 뇌파 지표'}
          </h3>
        </div>
        {isCounselor && eeg.reliability !== null && (
          <span className="font-mono text-[11px] text-emerald-300/90">
            reliability {eeg.reliability.toFixed(2)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {visibleKeys.map((key) => (
          <MetricCard
            key={key}
            label={resolveMetricLabel(key, reportType, eeg.summary_labels)}
            value={eeg.metrics[key]}
            dense={!isCounselor}
          />
        ))}
      </div>

      {!isCounselor && secondaryKeys.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-4 w-full rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-[12px] font-medium text-cyan-200 transition-colors hover:bg-cyan-400/10"
        >
          {expanded ? '간단히 보기' : '더보기'}
        </button>
      )}
    </section>
  );
}
