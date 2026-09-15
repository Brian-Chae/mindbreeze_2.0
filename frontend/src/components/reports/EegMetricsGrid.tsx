// EEG 7지표 카드 그리드 — mindbreeze 라이트 토큰 (보조·축소 표시)
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
  /** SDD-045: 서사 우선 시 보조 그리드 축소 */
  compact?: boolean;
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
      className={`rounded-xl border border-[#EFEFEF] bg-white ${
        dense ? 'px-3 py-2.5' : 'px-4 py-3'
      }`}
    >
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-[#9B9B9B]">
        {label}
      </div>
      <div
        className={`font-bold tracking-tight ${
          value === null
            ? 'text-[13px] text-[#9B9B9B]'
            : dense
              ? 'text-[16px] text-[#5F0080]'
              : 'text-[18px] text-[#5F0080]'
        }`}
      >
        {display}
      </div>
      {value !== null && (
        <div className="mt-0.5 font-mono text-[10px] text-[#B0B0B0]">/ 100</div>
      )}
    </div>
  );
}

export default function EegMetricsGrid({
  eeg,
  reportType,
  compact = false,
}: EegMetricsGridProps) {
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
    <section className="rounded-2xl border border-[#EFEFEF] bg-white p-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-[#5F0080]/70">
            eeg metrics
          </p>
          <h3 className="mt-1 text-[14px] font-bold text-[#1F1F1F]">
            {isCounselor ? '7지표 참고' : '뇌파 지표 참고'}
          </h3>
          {compact && (
            <p className="mt-0.5 text-[11px] text-[#9B9B9B]">
              서사·변화량이 우선이며, 점수는 보조 참고용입니다.
            </p>
          )}
        </div>
        {isCounselor && eeg.reliability !== null && (
          <span className="font-mono text-[11px] text-[#26724B]">
            reliability {eeg.reliability.toFixed(2)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {visibleKeys.map((key) => (
          <MetricCard
            key={key}
            label={resolveMetricLabel(key, reportType, eeg.summary_labels)}
            value={eeg.metrics[key]}
            dense={compact || !isCounselor}
          />
        ))}
      </div>

      {!isCounselor && secondaryKeys.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 w-full rounded-lg border border-[#EFEFEF] bg-[#F5EDFC]/60 px-3 py-2 text-[12px] font-medium text-[#5F0080] transition-colors hover:bg-[#F5EDFC]"
        >
          {expanded ? '간단히 보기' : '더보기'}
        </button>
      )}
    </section>
  );
}
