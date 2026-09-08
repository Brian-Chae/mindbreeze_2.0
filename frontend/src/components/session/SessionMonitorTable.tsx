// 호스트 참가자 모니터링 테이블 — 1.0 평평한 8컬럼 패리티 (SDD-029)
// 자리/이름/접촉/기기/배터리/평균·현재두뇌휴식도/업로드
// 헤더·교차행 #F2F3F8, 빨강 행(접촉불량/연결실패/무응답)

import { memo } from 'react';
import type { SessionLiveMetric } from '../../lib/api/session';
import {
  isEegStale,
  isLowBattery,
} from '../../lib/session-live/signal-status';
import type { MonitorSummaryCounts } from './SessionMonitorSummary';

interface SessionMonitorTableProps {
  participants: SessionLiveMetric[];
  filter: keyof MonitorSummaryCounts | null;
}

/** null/undefined 뇌파·배터리 값을 '-'로 표시. 0은 유효값 */
function formatMetric(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return '-';
  return `${Math.round(value)}${suffix}`;
}

function uploadLabel(status: SessionLiveMetric['upload_status']): string {
  if (status === 'completed') return '완료';
  if (status === 'streaming') return '전송 중';
  if (status === 'delayed') return '지연';
  if (status === 'failed') return '실패';
  if (status === 'idle') return '대기';
  return '-';
}

/** 1.0 접촉 문구 패리티 */
function contactCellLabel(status: SessionLiveMetric['device_status']): string {
  if (status === 'ok') return '접촉됨';
  if (status === 'lead_off') return '접촉안됨';
  if (status === 'disconnected') return '-';
  if (status === 'unsupported') return '미지원';
  if (status === 'unknown') return '미확인';
  return '-';
}

function deviceCellLabel(row: SessionLiveMetric): string {
  if (row.device_status === 'disconnected') return '연결끊김';
  // 밴드 미사용(이력 없음)
  if (row.last_eeg_at == null && !row.band_connected) return '미사용';
  if (!row.band_connected) return '연결끊김';
  if (isEegStale(row.last_eeg_at)) return '전송중단';
  return '연결됨';
}

function isConnectionFailed(row: SessionLiveMetric): boolean {
  if (row.device_status === 'disconnected') return true;
  if (row.last_eeg_at == null && !row.band_connected) return false;
  if (!row.band_connected) return true;
  return isEegStale(row.last_eeg_at);
}

/** 행 전체 빨강 — 접촉불량 / 연결실패 / 무응답(stale) */
function isAlertRow(row: SessionLiveMetric): boolean {
  if (row.device_status === 'lead_off') return true;
  return isConnectionFailed(row);
}

function matchesFilter(
  row: SessionLiveMetric,
  filter: keyof MonitorSummaryCounts | null,
): boolean {
  if (!filter || filter === 'participants') return true;
  if (filter === 'leadOff') return row.device_status === 'lead_off';
  if (filter === 'connectionFailed') return isConnectionFailed(row);
  if (filter === 'lowBattery') return isLowBattery(row.band_battery);
  return true;
}

interface MonitorRowProps {
  row: SessionLiveMetric;
  zebra: boolean;
}

const cellBase = 'px-4 py-2 text-sm font-medium leading-[22px]';
const cellCenter = `${cellBase} text-center`;

const SessionMonitorRow = memo(function SessionMonitorRow({
  row,
  zebra,
}: MonitorRowProps) {
  const alert = isAlertRow(row);
  const leadOff = row.device_status === 'lead_off';
  const stale = isEegStale(row.last_eeg_at);
  const lowBat = isLowBattery(row.band_battery);
  const showCurrent = !leadOff && !stale && row.device_status === 'ok';

  return (
    <tr
      className={
        alert
          ? 'bg-[#F2212133] text-[#F22121B2]'
          : zebra
            ? 'bg-[#F2F3F8] text-[#1F1F1F]'
            : 'bg-white text-[#1F1F1F]'
      }
    >
      <td className={cellCenter}>—</td>
      <td className={`${cellBase} text-left`}>
        {row.display_name || (row.is_guest ? '게스트' : '참가자')}
      </td>
      <td className={cellCenter}>{contactCellLabel(row.device_status)}</td>
      <td className={cellCenter}>{deviceCellLabel(row)}</td>
      <td
        className={`${cellCenter} tabular-nums ${
          lowBat && !alert ? 'text-[#F22121B2]' : ''
        }`}
      >
        {formatMetric(row.band_battery, '%')}
      </td>
      <td className={`${cellCenter} tabular-nums`}>
        {formatMetric(row.avg_efficiency, '%')}
      </td>
      <td className={`${cellCenter} tabular-nums`}>
        {showCurrent ? formatMetric(row.current_efficiency, '%') : '-'}
      </td>
      <td className={cellCenter}>{uploadLabel(row.upload_status)}</td>
    </tr>
  );
});

export function SessionMonitorTable({ participants, filter }: SessionMonitorTableProps) {
  const rows = participants.filter((p) => matchesFilter(p, filter));

  if (participants.length === 0) {
    return (
      <div className="bg-white p-10 text-center text-sm text-[#6F6F6F]">
        참석한 인원이 없습니다.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-white">
      <table className="min-w-[960px] w-full text-sm">
        <thead className="bg-[#F2F3F8] text-sm font-medium text-[#1F1F1F]">
          <tr>
            <th className={`${cellCenter} font-medium`}>자리</th>
            <th className={`${cellBase} text-left font-medium`}>이름</th>
            <th className={`${cellCenter} font-medium`}>접촉</th>
            <th className={`${cellCenter} font-medium`}>기기</th>
            <th className={`${cellCenter} font-medium`}>배터리</th>
            <th className={`${cellCenter} font-medium`}>평균 두뇌휴식도</th>
            <th className={`${cellCenter} font-medium`}>현재 두뇌휴식도</th>
            <th className={`${cellCenter} font-medium`}>업로드</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <SessionMonitorRow
              key={row.participant_id}
              row={row}
              zebra={index % 2 === 1}
            />
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="border-t border-[#EFEFEF] px-4 py-6 text-center text-sm text-[#6F6F6F]">
          필터 조건에 맞는 참가자가 없습니다
        </p>
      )}
    </div>
  );
}
