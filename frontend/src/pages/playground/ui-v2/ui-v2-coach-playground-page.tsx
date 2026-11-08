/**
 * SDD-320 G — 코치 플레이그라운드(D안). 바깥 레이아웃·제목·카드·버튼만 새 디자인이고, 측정·데모 로직과 패널 컴포넌트는 기존 PlaygroundPage 와 같다.
 * 순서: 연결 → 캘리브 → 파형/스펙트럼 → PPG/ACC → 지표 → 트렌드 → 명상 → 디버그.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AppShell from '../../../components/layout/AppShell';
import { Link } from 'react-router-dom';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-brand.css';
import '../../../styles/ui-v2-coach-pc.css';
import '../../../styles/ui-v2-coach-noti-pg.css';
import { AccPanel } from '../../../components/playground/AccPanel';
import { CalibrationPanel } from '../../../components/playground/CalibrationPanel';
import { ConnectionPanel } from '../../../components/playground/ConnectionPanel';
import { DebugPanel } from '../../../components/playground/DebugPanel';
import { EegWaveformPanel } from '../../../components/playground/EegWaveformPanel';
import { MetricsPanel } from '../../../components/playground/MetricsPanel';
import { NormalizationPanel } from '../../../components/playground/NormalizationPanel';
import { PlaygroundMeditationSimulator } from '../../../components/playground/PlaygroundMeditationSimulator';
import { PpgPanel } from '../../../components/playground/PpgPanel';
import { SpectrumPanel } from '../../../components/playground/SpectrumPanel';
import { TrendPanel } from '../../../components/playground/TrendPanel';
import {
  EEG_TREND_KEYS,
  MAX_EEG_TREND,
  MAX_PPG_TREND,
  PPG_TREND_KEYS,
} from '../../../components/playground/trend-metric-keys';
import { useBand } from '../../../hooks/useBand';
import { getActiveModelCache, refreshActiveModel } from '../../../lib/eeg/eegPersonalScore';
import { useAuthStore } from '../../../stores/authStore';
import { useMeditationSessionStore } from '../../../stores/useMeditationSessionStore';
import type { PlaygroundLogEntry } from '../../../types/playground';

const DEFAULT_TREND_METRICS = ['focusIndex', 'relaxationIndex', 'stressIndex'];
const MAX_LOGS = 500;

export function UiV2CoachPlaygroundPage() {
  const [useMock, setUseMock] = useState(false);
  return <PlaygroundView key={String(useMock)} useMock={useMock} onToggleMock={() => setUseMock((value) => !value)} />;
}

function PlaygroundView({ useMock, onToggleMock }: { useMock: boolean; onToggleMock: () => void }) {
  const user = useAuthStore((s) => s.user);
  const settingsPath = '/settings';
  const isPlatformAdmin = import.meta.env.DEV && user?.role === 'platform_admin';
  const band = useBand({
    sessionId: 'playground-observation',
    participantId: null,
    observationOnly: true,
    forceMock: useMock,
  });

  const initialConnect = useRef(band.connect);
  useEffect(() => {
    useMeditationSessionStore.getState().reset();
    if (useMock) void initialConnect.current().then(() => useMeditationSessionStore.getState().start());
    return () => useMeditationSessionStore.getState().reset();
  }, [useMock]);

  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(DEFAULT_TREND_METRICS);
  const [debugPaused, setDebugPaused] = useState(false);
  const [logs, setLogs] = useState<PlaygroundLogEntry[]>([]);
  const [activeModel, setActiveModel] = useState<ReturnType<typeof getActiveModelCache>>(null);
  const prevStatusRef = useRef(band.connectionState);

  // 활성 표준 모델 프리페치 (지표 정규화 레이어 + 현재 적용 모델 표시)
  useEffect(() => {
    void refreshActiveModel().then(() => setActiveModel(getActiveModelCache()));
  }, []);

  const appendLog = useCallback(
    (level: PlaygroundLogEntry['level'], message: string, source: PlaygroundLogEntry['source'] = 'ble') => {
      if (debugPaused) return;
      setLogs((prev) => {
        const next: PlaygroundLogEntry[] = [
          ...prev,
          { ts: Date.now(), level, source, message },
        ];
        return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
      });
    },
    [debugPaused],
  );

  useEffect(() => {
    if (band.connectionState === prevStatusRef.current) return;
    prevStatusRef.current = band.connectionState;
    appendLog(
      band.connectionState === 'error' ? 'error' : 'info',
      `연결 상태: ${band.connectionState}${band.error ? ` — ${band.error}` : ''}`,
    );
  }, [appendLog, band.connectionState, band.error]);

  const toggleMetric = useCallback((key: string) => {
    setSelectedMetrics((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (EEG_TREND_KEYS.has(key)) {
        const eegCount = prev.filter((k) => EEG_TREND_KEYS.has(k)).length;
        if (eegCount >= MAX_EEG_TREND) return prev;
      } else if (PPG_TREND_KEYS.has(key)) {
        const ppgCount = prev.filter((k) => PPG_TREND_KEYS.has(k)).length;
        if (ppgCount >= MAX_PPG_TREND) return prev;
      } else {
        return prev;
      }
      return [...prev, key];
    });
  }, []);

  const connected = band.connectionState === 'connected';
  const snapshot =
    connected && band.rawIndices
      ? {
          connectionState: band.connectionState,
          battery: band.battery,
          signalQuality: band.signalQuality,
          rawIndices: band.rawIndices,
          heartRate: band.heartRate,
          sdnn: band.sdnn,
          rmssd: band.rmssd,
          acc: {
            activityType: band.acc.activityType,
            intensity: band.acc.intensity,
            stability: band.acc.stability,
          },
          spectrumDominant: band.spectrum?.dominantFrequency ?? null,
        }
      : null;

  return (
    <AppShell title="내 마음의 신호를 만나보세요">
      <div className="ui-v2 u2f u2g-pg">
        <div className="u2g-stack">
          <Link to={settingsPath} className="u2g-back">← 설정으로 돌아가기</Link>
          <p className="u2f-lead">밴드를 연결하거나 예시 데이터로 가볍게 체험할 수 있어요.</p>
          {import.meta.env.DEV && !isPlatformAdmin && (
            <div className="u2g-notice">
              현재 적용된 표준 모델:{' '}
              {activeModel ? (
                <b>v{activeModel.version} (n={activeModel.n_samples} 표본)</b>
              ) : (
                <b>코호트 상수 (B0)</b>
              )}
            </div>
          )}

          {band.isMock && <div role="status" className="u2g-mock">예시 데이터입니다 · 실제 측정값이 아닙니다</div>}
          <p className="u2g-notice">추정 참고 지표 · <a href="/measurement-guide" className="u2-textlink">측정 방법 안내</a></p>
          <ConnectionPanel band={band} useMock={band.isMock} onToggleMock={() => { void band.disconnect().then(onToggleMock); }} />

          {import.meta.env.DEV && <CalibrationPanel connected={connected} rawIndices={band.rawIndices} />}

          {isPlatformAdmin && (
            <NormalizationPanel
              connected={connected}
              rawIndices={band.rawIndices}
              heartRate={band.heartRate}
              sdnn={band.sdnn}
              rmssd={band.rmssd}
            />
          )}

          <div className="u2g-grid">
            <EegWaveformPanel connected={connected} eegWaveform={band.eegWaveform} getSamples={band.getEegWaveformSamples} />
            <SpectrumPanel connected={connected} bandPowers={band.bandPowers} spectrum={band.spectrum} />
          </div>

          <div className="u2g-grid">
            <PpgPanel
              connected={connected}
              ppgWaveform={band.ppgWaveform}
              getSamples={band.getPpgWaveformSamples}
              heartRate={band.heartRate}
              sdnn={band.sdnn}
              rmssd={band.rmssd}
            />
            <AccPanel connected={connected} acc={band.acc} />
          </div>

          <MetricsPanel
            connected={connected}
            rawIndices={band.scoredIndices ?? band.rawIndices}
            heartRate={band.heartRate}
            sdnn={band.sdnn}
            rmssd={band.rmssd}
            acc={band.acc}
            selectedMetrics={selectedMetrics}
            onToggleMetric={toggleMetric}
          />

          <TrendPanel
            connected={connected}
            selectedMetrics={selectedMetrics}
            rawIndices={band.scoredIndices ?? band.rawIndices}
            heartRate={band.heartRate}
            sdnn={band.sdnn}
            rmssd={band.rmssd}
          />

          <PlaygroundMeditationSimulator band={band} connected={connected} />

          {import.meta.env.DEV && <DebugPanel
            logs={logs}
            snapshot={snapshot}
            onClearLogs={() => setLogs([])}
            paused={debugPaused}
            onTogglePause={() => setDebugPaused((v) => !v)}
          />}
        </div>
      </div>
    </AppShell>
  );
}
