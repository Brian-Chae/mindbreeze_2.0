// SDD-083 T2 — 내담자 상태 카드 그리드 (SessionMonitorTable 카드 뷰)
// 이름/게스트 + LINK BAND 연결 배지 + 배터리 + 현재 지표(두뇌휴식도·BPM·호흡수)
// 밴드 미착용 내담자도 정상 카드 표시 (밴드 미사용 배지)

import { memo } from 'react';
import type { SessionLiveMetric } from '../../lib/api/session';
import { isLowBattery } from '../../lib/session-live/signal-status';
import {
  bandCardState,
  bandCardStateLabel,
  canShowCurrentMetrics,
  formatMetric,
  isConnectionFailed,
  matchesMonitorFilter,
} from '../../lib/session-live/metric-display';
import type { MonitorSummaryCounts } from './SessionMonitorSummary';

interface SessionParticipantCardGridProps {
  participants: SessionLiveMetric[];
  filter: keyof MonitorSummaryCounts | null;
  selectedId: string | null;
  /** 카드 클릭 → 상세 패널 열기 */
  onSelect: (participantId: string) => void;
}

const BAND_BADGE_CLASS: Record<ReturnType<typeof bandCardState>, string> = {
  connected: 'bg-[#59CE9026] text-[#2F9E68]',
  disconnected: 'bg-[#F2212133] text-[#F22121B2]',
  none: 'bg-[#F2F3F8] text-[#6F6F6F]',
};

/** 실시간 수신 상태 점 — 초록(pulse)=스트리밍 중 / 빨강=끊김 / 회색=미사용 */
const BAND_DOT_CLASS: Record<ReturnType<typeof bandCardState>, string> = {
  connected: 'animate-pulse bg-[#2F9E68]',
  disconnected: 'bg-[#F22121]',
  none: 'bg-[#9B9B9B]',
};

interface ParticipantCardProps {
  row: SessionLiveMetric;
  selected: boolean;
  onSelect: (participantId: string) => void;
}

const ParticipantCard = memo(function ParticipantCard({
  row,
  selected,
  onSelect,
}: ParticipantCardProps) {
  const bandState = bandCardState(row);
  const leadOff = row.device_status === 'lead_off';
  const alert = leadOff || isConnectionFailed(row);
  const lowBat = isLowBattery(row.band_battery);
  const showCurrent = canShowCurrentMetrics(row);

  return (
    <button
      type="button"
      onClick={() => onSelect(row.participant_id)}
      aria-pressed={selected}
      className={`flex flex-col gap-3 rounded-2xl border p-4 text-left transition hover:shadow-md ${
        alert
          ? 'border-[#F5C2C0] bg-[#FDECEC]'
          : 'border-[#EFEFEF] bg-white'
      } ${selected ? 'outline outline-2 outline-[#5F0080] outline-offset-0' : ''}`}
    >
      {/* 이름 + 게스트 표시 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-[#1F1F1F]">
            {row.display_name || (row.is_guest ? '게스트' : '참가자')}
          </p>
          {row.is_guest && (
            <span className="mt-0.5 inline-block rounded-full bg-[#F2F3F8] px-2 py-0.5 text-[10px] font-medium text-[#6F6F6F]">
              게스트
            </span>
          )}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${BAND_BADGE_CLASS[bandState]}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${BAND_DOT_CLASS[bandState]}`}
          />
          {bandCardStateLabel(bandState)}
        </span>
      </div>

      {/* 접촉/배터리 — 밴드 사용 시에만 의미 */}
      {bandState !== 'none' && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          {leadOff && (
            <span className="rounded-full bg-[#F2212133] px-2 py-0.5 font-medium text-[#F22121B2]">
              접촉불량
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 font-medium tabular-nums ${
              lowBat
                ? 'bg-[#F2212133] text-[#F22121B2]'
                : 'bg-[#F2F3F8] text-[#1F1F1F]'
            }`}
          >
            배터리 {formatMetric(row.band_battery, '%')}
          </span>
        </div>
      )}

      {/* 현재 지표 3종 */}
      <div className="grid grid-cols-3 gap-2">
        {[
          {
            label: '두뇌휴식도',
            value: showCurrent ? formatMetric(row.current_efficiency, '%') : '-',
          },
          {
            label: 'BPM',
            value: showCurrent ? formatMetric(row.heart_rate) : '-',
          },
          {
            label: '호흡수',
            value: showCurrent ? formatMetric(row.respiratory_rate) : '-',
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl bg-[#F2F3F8] px-2 py-2 text-center"
          >
            <p className="text-[10px] font-medium text-[#6F6F6F]">{item.label}</p>
            <p className="mt-0.5 text-[15px] font-bold tabular-nums text-[#1F1F1F]">
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </button>
  );
});

export function SessionParticipantCardGrid({
  participants,
  filter,
  selectedId,
  onSelect,
}: SessionParticipantCardGridProps) {
  const rows = participants.filter((p) => matchesMonitorFilter(p, filter));

  if (participants.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-10 text-center text-sm text-[#6F6F6F]">
        참석한 인원이 없습니다.
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.map((row) => (
          <ParticipantCard
            key={row.participant_id}
            row={row}
            selected={selectedId === row.participant_id}
            onSelect={onSelect}
          />
        ))}
      </div>
      {rows.length === 0 && (
        <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm text-[#6F6F6F]">
          필터 조건에 맞는 참가자가 없습니다
        </p>
      )}
    </div>
  );
}
