/**
 * SDD-034 — Playground 페이지.
 * haru AdminPlaygroundPage 순서: 연결 → 캘리브 → 파형/스펙트럼 → PPG/ACC → 지표 → 트렌드 → 명상 → 디버그.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import { AccPanel } from '../../components/playground/AccPanel';
import { CalibrationPanel } from '../../components/playground/CalibrationPanel';
import { ConnectionPanel } from '../../components/playground/ConnectionPanel';
import { DebugPanel } from '../../components/playground/DebugPanel';
import { EegWaveformPanel } from '../../components/playground/EegWaveformPanel';
import { MetricsPanel } from '../../components/playground/MetricsPanel';
import { PlaygroundMeditationSimulator } from '../../components/playground/PlaygroundMeditationSimulator';
import { PpgPanel } from '../../components/playground/PpgPanel';
import { SpectrumPanel } from '../../components/playground/SpectrumPanel';
import { TrendPanel } from '../../components/playground/TrendPanel';
import {
  EEG_TREND_KEYS,
  MAX_EEG_TREND,
  MAX_PPG_TREND,
  PPG_TREND_KEYS,
} from '../../components/playground/trend-metric-keys';
import { useBand } from '../../hooks/useBand';
import type { PlaygroundLogEntry } from '../../types/playground';

const DEFAULT_TREND_METRICS = ['focusIndex', 'relaxationIndex', 'stressIndex'];
const MAX_LOGS = 500;

export default function PlaygroundPage() {
  const [useMock, setUseMock] = useState(false);
  const band = useBand({
    sessionId: 'playground-observation',
    participantId: null,
    observationOnly: true,
    forceMock: useMock,
  });

  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(DEFAULT_TREND_METRICS);
  const [debugPaused, setDebugPaused] = useState(false);
  const [logs, setLogs] = useState<PlaygroundLogEntry[]>([]);
  const prevStatusRef = useRef(band.connectionState);

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
    <AppShell title="플레이그라운드">
      <div className="mx-auto max-w-6xl space-y-4">
        <ConnectionPanel band={band} useMock={useMock} onToggleMock={() => setUseMock((v) => !v)} />

        <CalibrationPanel connected={connected} rawIndices={band.rawIndices} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <EegWaveformPanel
            connected={connected}
            eegWaveform={band.eegWaveform}
            getSamples={band.getEegWaveformSamples}
          />
          <SpectrumPanel
            connected={connected}
            bandPowers={band.bandPowers}
            spectrum={band.spectrum}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
          rawIndices={band.rawIndices}
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
          rawIndices={band.rawIndices}
          heartRate={band.heartRate}
          sdnn={band.sdnn}
          rmssd={band.rmssd}
        />

        <PlaygroundMeditationSimulator />

        <DebugPanel
          logs={logs}
          snapshot={snapshot}
          onClearLogs={() => setLogs([])}
          paused={debugPaused}
          onTogglePause={() => setDebugPaused((v) => !v)}
        />
      </div>
    </AppShell>
  );
}
