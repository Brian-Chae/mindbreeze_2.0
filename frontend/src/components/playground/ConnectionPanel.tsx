/**
 * P1 — 연결 패널. LINK BAND 연결·배터리·센서.
 */

import type { UseBandResult } from '../../hooks/useBand';
import type { BandSensors } from '../../types/playground';
import { PanelShell } from './PanelShell';

const SENSOR_LABEL: Record<keyof BandSensors, string> = {
  leftElectrode: 'FP1 전극',
  rightElectrode: 'FP2 전극',
  ppgSensor: 'PPG 센서',
  signalQuality: '신호 품질',
};

const SENSOR_DOT: Record<string, string> = {
  good: 'bg-emerald-400',
  bad: 'bg-red-400',
  loading: 'bg-gray-600',
};

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface Props {
  band: UseBandResult;
}

export function ConnectionPanel({ band }: Props) {
  const connected = band.connectionState === 'connected';
  const isBusy = band.connectionState === 'connecting';
  const panelState =
    band.connectionState === 'error'
      ? 'error'
      : connected
        ? 'ready'
        : 'disconnected';

  const browserHint =
    !band.isSupported && !band.isMock
      ? 'Web Bluetooth 미지원 브라우저입니다. Chrome/Edge를 사용하거나 Mock 모드(VITE_USE_MOCK_EEG)를 켜세요.'
      : null;

  return (
    <PanelShell
      title="P1 · 연결"
      subtitle={
        band.isMock
          ? '관찰 전용 · Mock EEG — 세션 저장 없이 스트리밍만'
          : '관찰 전용 모드 — 세션 저장 없이 스트리밍만'
      }
      state={panelState}
      actions={
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[11px] text-gray-400">
          {connected ? formatElapsed(band.connectedElapsedSec) : '--:--'}
        </span>
      }
    >
      {browserHint && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          {browserHint}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void band.connect()}
          disabled={!band.isSupported || isBusy || connected}
          className="rounded-lg bg-[#5F0080] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#4A0066] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isBusy ? '연결 중…' : band.isMock ? 'Mock 연결' : '스캔 및 연결'}
        </button>
        <button
          type="button"
          onClick={() => void band.disconnect()}
          disabled={!connected}
          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          연결 해제
        </button>
        <button
          type="button"
          onClick={band.clearBuffers}
          disabled={!connected}
          className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          버퍼 초기화
        </button>
      </div>

      {band.error && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
          {band.error}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-gray-500">모드</dt>
          <dd className="mt-0.5 text-gray-200">{band.isMock ? 'Mock' : 'BLE'}</dd>
        </div>
        <div>
          <dt className="text-gray-500">상태</dt>
          <dd className="mt-0.5 text-gray-200">{band.connectionState}</dd>
        </div>
        <div>
          <dt className="text-gray-500">배터리</dt>
          <dd className="mt-0.5 text-gray-200">
            {band.battery === null ? '--' : `${Math.round(band.battery)}%`}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">SQI</dt>
          <dd className="mt-0.5 text-gray-200">
            {band.signalQuality === null
              ? '--'
              : `${band.signalQuality.toFixed(0)} · ${band.signalQualityLevel}`}
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.keys(SENSOR_LABEL) as Array<keyof BandSensors>).map((key) => (
          <div
            key={key}
            className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${SENSOR_DOT[band.sensors[key]]}`} />
            <span className="truncate text-xs text-gray-300">{SENSOR_LABEL[key]}</span>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}
