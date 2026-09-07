// 호스트 참가자 모니터링 테이블 — 뇌파 값은 null이면 '-' placeholder
// SDD-026: 접촉(LeadOff) / 신호품질(SQI) 분리, unknown을 정상으로 표시하지 않음

import type { SessionLiveMetric } from '../../lib/api/session';
import {
  contactStatusLabel,
  isEegStale,
  signalQualityLevelLabel,
  type SignalQualityLevel,
} from '../../lib/session-live/signal-status';
import type { MonitorSummaryCounts } from './SessionMonitorSummary';

interface SessionMonitorTableProps {
  participants: SessionLiveMetric[];
  filter: keyof MonitorSummaryCounts | null;
}

/** null/undefined 뇌파·배터리 값을 '-'로 표시 */
function formatMetric(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return '-';
  return `${value}${suffix}`;
}

function uploadLabel(status: SessionLiveMetric['upload_status']): string {
  if (status === 'completed') return '완료';
  if (status === 'streaming') return '전송 중';
  if (status === 'delayed') return '지연';
  if (status === 'failed') return '실패';
  if (status === 'idle') return '대기';
  return '-';
}

function qualityLabel(row: SessionLiveMetric): string {
  const level = (row.signal_quality_level ?? null) as SignalQualityLevel | null;
  if (level) return signalQualityLevelLabel(level);
  if (row.signal_quality == null) return '—';
  // level 미수신 시 값만 표시 (ok 승격 금지)
  return `${Math.round(row.signal_quality * 100)}%`;
}

function matchesFilter(
  row: SessionLiveMetric,
  filter: keyof MonitorSummaryCounts | null,
): boolean {
  if (!filter || filter === 'participants') return true;
  if (filter === 'leadOff') return row.device_status === 'lead_off';
  if (filter === 'connectionFailed') {
    if (row.device_status === 'disconnected') return true;
    // 밴드 미사용은 제외
    if (row.last_eeg_at == null && !row.band_connected) return false;
    if (!row.band_connected) return true;
    return isEegStale(row.last_eeg_at);
  }
  if (filter === 'lowBattery') {
    return row.band_battery !== null && row.band_battery < 20;
  }
  return true;
}

export function SessionMonitorTable({ participants, filter }: SessionMonitorTableProps) {
  const rows = participants.filter((p) => matchesFilter(p, filter));

  if (participants.length === 0) {
    return (
      <div className="rounded-[20px] border border-dashed border-[#E5E5E5] bg-white p-10 text-center text-sm text-[#6F6F6F]">
        아직 입장한 참가자가 없습니다
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[20px] border border-[#EFEFEF] bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 bg-[#FAFAFA] text-[12px] font-medium uppercase tracking-wide text-[#6F6F6F]">
          <tr>
            <th className="px-4 py-3 font-medium">이름</th>
            <th className="px-4 py-3 font-medium">접촉</th>
            <th className="px-4 py-3 font-medium">신호</th>
            <th className="px-4 py-3 font-medium">연결</th>
            <th className="px-4 py-3 font-medium">배터리</th>
            <th className="px-4 py-3 font-medium">평균 두뇌휴식도</th>
            <th className="px-4 py-3 font-medium">현재 두뇌휴식도</th>
            <th className="px-4 py-3 font-medium">업로드</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const leadOff = row.device_status === 'lead_off';
            const stale = isEegStale(row.last_eeg_at);
            const connected = row.band_connected && !stale;
            return (
              <tr
                key={row.participant_id}
                className={`border-t border-[#F0F0F0] ${
                  leadOff || stale
                    ? 'bg-[#FDECEC]'
                    : index % 2 === 1
                      ? 'bg-[#FAFAFA]'
                      : 'bg-white'
                }`}
              >
                <td className="px-4 py-3 font-medium text-[#1F1F1F]">
                  {row.display_name || (row.is_guest ? '게스트' : '참가자')}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      leadOff
                        ? 'font-medium text-[#B3261E]'
                        : row.device_status === 'ok'
                          ? 'text-emerald-700'
                          : 'text-[#6F6F6F]'
                    }
                  >
                    {contactStatusLabel(row.device_status)}
                  </span>
                </td>
                <td className="px-4 py-3 text-[#6F6F6F]">{qualityLabel(row)}</td>
                <td className="px-4 py-3">
                  {connected ? (
                    <span className="font-medium text-[#5F0080]">연결됨</span>
                  ) : stale && row.band_connected ? (
                    <span className="font-medium text-amber-700">전송중단</span>
                  ) : (
                    <span className="text-[#9CA3AF]">미연결</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums text-[#1F1F1F]">
                  {formatMetric(row.band_battery, '%')}
                </td>
                <td className="px-4 py-3 tabular-nums font-semibold text-[#5F0080]">
                  {formatMetric(row.avg_efficiency, '%')}
                </td>
                <td className="px-4 py-3 tabular-nums font-semibold text-[#5F0080]">
                  {leadOff || stale ? '-' : formatMetric(row.current_efficiency, '%')}
                </td>
                <td className="px-4 py-3 text-[#6F6F6F]">{uploadLabel(row.upload_status)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="border-t border-[#F0F0F0] px-4 py-6 text-center text-sm text-[#6F6F6F]">
          필터 조건에 맞는 참가자가 없습니다
        </p>
      )}
    </div>
  );
}
