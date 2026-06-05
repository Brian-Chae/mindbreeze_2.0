// LINK BAND 실시간 EEG 대시보드 — 게이지 카드 + 시계열 차트

import { useMemo, useState } from 'react';
import { useEEGSocket, type EEGAlert } from '../../hooks/useEEGSocket';

interface Props {
  sessionId: string;
}

// ── 미터 카드 컴포넌트 ─────────────────────────────────────────

function GaugeCard({ label, value, unit, color, warning }: {
  label: string; value: number | null; unit: string; color: string; warning?: boolean;
}) {
  const display = value != null ? (Number.isInteger(value) ? value : value.toFixed(1)) : '--';
  return (
    <div className={`rounded-xl border p-3 flex flex-col gap-1 min-w-[100px] ${warning ? 'border-amber-400 bg-amber-50' : 'border-[#EFEFEF] bg-white'}`}>
      <span className="text-[10px] font-mono text-[#6F6F6F] uppercase tracking-wider">{label}</span>
      <span className="text-xl font-bold" style={{ color }}>{display}</span>
      <span className="text-[10px] text-[#9F9F9F]">{unit}</span>
    </div>
  );
}

// ── SQI 인디케이터 ─────────────────────────────────────────────

function SQIIndicator({ sqi, label }: { sqi: number | null; label: string }) {
  if (sqi == null) return null;
  const color = sqi >= 70 ? '#22C55E' : sqi >= 30 ? '#F59E0B' : '#EF4444';
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[11px] text-[#6F6F6F]">{label}:</span>
      <span className="text-[12px] font-semibold">{sqi}</span>
    </div>
  );
}

// ── 알림 배너 ──────────────────────────────────────────────────

function AlertBanner({ alerts, onClear }: { alerts: EEGAlert[]; onClear: () => void }) {
  if (alerts.length === 0) return null;
  const latest = alerts[alerts.length - 1];
  const bg = latest.level === 'critical' ? 'bg-[#FDECEC] border-[#F5C2C0]' : 'bg-[#FFF8E1] border-[#FFE082]';
  const text = latest.level === 'critical' ? 'text-[#B3261E]' : 'text-[#8D6E00]';

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs flex items-center justify-between ${bg} ${text}`}>
      <span>
        {latest.level === 'critical' ? '⚠️' : '⚡'} {latest.message}
        {latest.sqi_fp1 != null && ` (Fp1:${latest.sqi_fp1} Fp2:${latest.sqi_fp2})`}
      </span>
      <button onClick={onClear} className="ml-2 text-[10px] underline">닫기</button>
    </div>
  );
}

// ── 메인 대시보드 ──────────────────────────────────────────────

export default function EEGLiveDashboard({ sessionId }: Props) {
  const { connected, participants, latestMetrics, alerts, clearAlerts } = useEEGSocket(sessionId);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  // 전체 참여자 중 선택된 참여자의 최신 메트릭
  const metrics = useMemo(() => {
    const target = selectedUser || (participants.length > 0 ? participants[0].user_id : null);
    if (!target) return null;
    return latestMetrics.get(target) ?? null;
  }, [latestMetrics, participants, selectedUser]);

  const m = metrics?.metrics;

  // 참여자 선택 UI가 필요하면 multiple participants 대응
  const userList = useMemo(() => {
    return [...latestMetrics.keys()].map((uid) => ({
      user_id: uid,
      metrics: latestMetrics.get(uid)?.metrics,
    }));
  }, [latestMetrics]);

  if (!connected) {
    return (
      <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-6">
        <div className="text-[12px] font-mono text-[#6F6F6F] uppercase tracking-wider mb-3">
          LINK BAND
        </div>
        <p className="text-sm text-[#9F9F9F]">LINK BAND 연결 대기 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 알림 */}
      <AlertBanner alerts={alerts} onClear={clearAlerts} />

      {/* 참여자 선택 (그룹) */}
      {userList.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {userList.map((u) => (
            <button
              key={u.user_id}
              onClick={() => setSelectedUser(u.user_id)}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                selectedUser === u.user_id || (!selectedUser && u === userList[0])
                  ? 'bg-indigo-100 border-indigo-300 text-indigo-800'
                  : 'bg-white border-[#EFEFEF] text-[#6F6F6F]'
              }`}
            >
              {u.user_id.slice(0, 8)}
            </button>
          ))}
        </div>
      )}

      {/* 10종 지표 카드 */}
      {m && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          <GaugeCard label="신경활성도" value={m.neural_activity} unit="/100" color="#6366F1" />
          <GaugeCard label="집중도" value={m.concentration} unit="/100" color="#22C55E" />
          <GaugeCard label="이완도" value={m.relaxation} unit="/100" color="#3B82F6" />
          <GaugeCard label="스트레스(인지)" value={m.cognitive_stress} unit="/100"
            color={m.cognitive_stress > 60 ? '#EF4444' : '#F59E0B'}
            warning={m.cognitive_stress > 60} />
          <GaugeCard label="스트레스(뇌파)" value={m.eeg_stress} unit="/100"
            color={m.eeg_stress > 60 ? '#EF4444' : '#F59E0B'}
            warning={m.eeg_stress > 60} />
          <GaugeCard label="감정균형도" value={m.emotional_balance} unit="/100" color="#8B5CF6" />
          <GaugeCard label="심박수" value={m.heart_rate} unit="BPM" color="#EC4899" />
          <GaugeCard label="움직임" value={m.total_movement} unit="mG" color="#6B7280" />
          <GaugeCard label="센서부착" value={m.sensor_attached} unit={m.sensor_attached ? '● 정상' : '○ 분리'}
            color={m.sensor_attached ? '#22C55E' : '#EF4444'}
            warning={!m.sensor_attached} />
        </div>
      )}

      {/* SQI 인디케이터 */}
      {m && (
        <div className="flex gap-4 bg-white rounded-xl border border-[#EFEFEF] p-3">
          <SQIIndicator sqi={m.sqi_fp1} label="Fp1 SQI" />
          <SQIIndicator sqi={m.sqi_fp2} label="Fp2 SQI" />
        </div>
      )}

      {/* 그룹 요약 (참여자별 미니 카드) */}
      {userList.length > 0 && !m && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {userList.map((u) => (
            <button
              key={u.user_id}
              onClick={() => setSelectedUser(u.user_id)}
              className="bg-white rounded-xl border border-[#EFEFEF] p-3 text-left hover:border-indigo-300"
            >
              <div className="text-[10px] font-mono text-[#6F6F6F]">{u.user_id.slice(0, 8)}</div>
              {u.metrics ? (
                <div className="flex gap-2 mt-1 text-xs">
                  <span className="text-green-600">집중 {u.metrics.concentration}</span>
                  <span className="text-blue-600">이완 {u.metrics.relaxation}</span>
                  <span className="text-pink-600">♥{u.metrics.heart_rate}</span>
                </div>
              ) : (
                <span className="text-[10px] text-[#9F9F9F]">데이터 없음</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
