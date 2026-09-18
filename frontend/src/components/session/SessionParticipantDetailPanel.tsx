// SDD-083 T3 — 내담자 카드 상세 패널 (현재 상태 + 세션 동안 상태 변화 시계열)
// 시계열은 라이브 페이지가 3초 평균으로 누적한 클라이언트 버퍼를 사용 (Recharts)

import { useEffect, useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SessionLiveMetric } from '../../lib/api/session';
import {
  contactStatusLabel,
  isLowBattery,
  signalQualityLevel,
  signalQualityLevelLabel,
} from '../../lib/session-live/signal-status';
import {
  bandCardState,
  bandCardStateLabel,
  canShowCurrentMetrics,
  formatMetric,
  type ParticipantHistoryPoint,
} from '../../lib/session-live/metric-display';

interface SessionParticipantDetailPanelProps {
  row: SessionLiveMetric;
  history: ParticipantHistoryPoint[];
  /** 세션 시작 시각 — 시계열 X축(경과 분) 기준. 없으면 첫 포인트 기준 */
  sessionStartedAt: string | null;
  onClose: () => void;
}

const SERIES = [
  { key: 'efficiency' as const, label: '두뇌휴식도', stroke: '#5F0080' },
  { key: 'heartRate' as const, label: 'BPM', stroke: '#F9746B' },
  { key: 'respiratoryRate' as const, label: '호흡수', stroke: '#59CE90' },
];

export function SessionParticipantDetailPanel({
  row,
  history,
  sessionStartedAt,
  onClose,
}: SessionParticipantDetailPanelProps) {
  const bandState = bandCardState(row);
  const showCurrent = canShowCurrentMetrics(row);
  const sqLevel =
    row.signal_quality_level ?? signalQualityLevel(row.signal_quality);

  // ESC로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chartData = useMemo(() => {
    if (history.length === 0) return [];
    const baseMs = sessionStartedAt
      ? new Date(sessionStartedAt).getTime()
      : history[0].t;
    return history.map((p) => ({
      min: Math.max(0, (p.t - baseMs) / 60000),
      efficiency: p.efficiency,
      heartRate: p.heartRate,
      respiratoryRate: p.respiratoryRate,
    }));
  }, [history, sessionStartedAt]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-widest text-[#5F0080]/70">
              participant detail
            </p>
            <h3 className="mt-1 truncate text-[17px] font-bold text-[#1F1F1F]">
              {row.display_name || (row.is_guest ? '게스트' : '참가자')}
              {row.is_guest && (
                <span className="ml-2 align-middle rounded-full bg-[#F2F3F8] px-2 py-0.5 text-[10px] font-medium text-[#6F6F6F]">
                  게스트
                </span>
              )}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mb-btn mb-btn--ghost shrink-0"
          >
            닫기
          </button>
        </div>

        {/* 현재 상태 */}
        <section className="rounded-2xl bg-[#F2F3F8] p-4">
          <p className="text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
            현재 상태
          </p>
          {bandState === 'none' ? (
            <p className="mt-2 text-sm text-[#6F6F6F]">
              LINK BAND 미착용 — 뇌파·심박 지표 없이 세션에 참여 중입니다.
            </p>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
                <span
                  className={`rounded-full px-2.5 py-1 font-semibold ${
                    bandState === 'connected'
                      ? 'bg-[#59CE9026] text-[#2F9E68]'
                      : 'bg-[#F2212133] text-[#F22121B2]'
                  }`}
                >
                  {bandCardStateLabel(bandState)}
                </span>
                <span className="rounded-full bg-white px-2.5 py-1 font-medium text-[#1F1F1F]">
                  접촉 {contactStatusLabel(row.device_status)}
                </span>
                <span className="rounded-full bg-white px-2.5 py-1 font-medium text-[#1F1F1F]">
                  신호 {signalQualityLevelLabel(sqLevel ?? 'unknown')}
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 font-medium tabular-nums ${
                    isLowBattery(row.band_battery)
                      ? 'bg-[#F2212133] text-[#F22121B2]'
                      : 'bg-white text-[#1F1F1F]'
                  }`}
                >
                  배터리 {formatMetric(row.band_battery, '%')}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  {
                    label: '현재 두뇌휴식도',
                    value: showCurrent
                      ? formatMetric(row.current_efficiency, '%')
                      : '-',
                  },
                  {
                    label: '평균 두뇌휴식도',
                    value: formatMetric(row.avg_efficiency, '%'),
                  },
                  {
                    label: 'BPM',
                    value: showCurrent ? formatMetric(row.heart_rate) : '-',
                  },
                  {
                    label: '호흡수',
                    value: showCurrent
                      ? formatMetric(row.respiratory_rate)
                      : '-',
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl bg-white px-3 py-2.5 text-center"
                  >
                    <p className="text-[10px] font-medium text-[#6F6F6F]">
                      {item.label}
                    </p>
                    <p className="mt-0.5 text-[16px] font-bold tabular-nums text-[#1F1F1F]">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* 세션 동안 상태 변화 */}
        <section className="mt-4 rounded-2xl border border-[#EFEFEF] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
              세션 동안 상태 변화
            </p>
            <div className="flex gap-3">
              {SERIES.map((s) => (
                <span
                  key={s.key}
                  className="flex items-center gap-1 text-[11px] text-[#6F6F6F]"
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: s.stroke }}
                  />
                  {s.label}
                </span>
              ))}
            </div>
          </div>
          {chartData.length < 2 ? (
            <p className="py-8 text-center text-sm text-[#6F6F6F]">
              {bandState === 'none'
                ? 'LINK BAND 미착용 참가자는 상태 변화 데이터가 없습니다.'
                : '아직 수집된 상태 변화 데이터가 부족합니다. 세션이 진행되면 표시됩니다.'}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart
                data={chartData}
                margin={{ top: 5, right: 16, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#EFEFEF" />
                <XAxis
                  dataKey="min"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v: number) => `${Math.round(v)}분`}
                  tick={{ fontSize: 11, fill: '#6F6F6F' }}
                  axisLine={{ stroke: '#EFEFEF' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6F6F6F' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(v) => `${Number(v).toFixed(1)}분`}
                  formatter={(value, name) => [
                    typeof value === 'number' ? Math.round(value) : '-',
                    SERIES.find((s) => s.key === name)?.label ?? String(name),
                  ]}
                  contentStyle={{
                    borderRadius: 8,
                    border: '1px solid #EFEFEF',
                    background: '#FFFFFF',
                    fontSize: 12,
                    color: '#1F1F1F',
                  }}
                />
                {SERIES.map((s) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    stroke={s.stroke}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </section>
      </div>
    </div>
  );
}
