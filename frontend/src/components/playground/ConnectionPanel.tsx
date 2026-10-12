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
  good: 'bg-emerald-500',
  bad: 'bg-red-500',
  loading: 'bg-[#9A9BA8]',
};

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface Props {
  band: UseBandResult;
  useMock: boolean;
  onToggleMock: () => void;
}

export function ConnectionPanel({ band, useMock, onToggleMock }: Props) {
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMock}
            className="rounded-lg border border-[#C9B0E8] bg-[#F5EDFC] px-3 py-1.5 text-xs font-medium text-[#5F0080] hover:bg-[#EBDEF7]"
          >
            {useMock ? '실기기로 전환' : 'Mock으로 전환'}
          </button>
          <span className="rounded-full bg-[#F5EDFC] px-2 py-0.5 text-[11px] text-[#5F0080]">
            {connected ? formatElapsed(band.connectedElapsedSec) : '--:--'}
          </span>
        </div>
      }
    >
      {browserHint && (
        <div className="mb-3 rounded-xl border border-[#F5D0A9] bg-[#FFF4DC] p-3 text-xs text-[#8A6B1F]">
          {browserHint}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void band.connect()}
          disabled={!band.isSupported || isBusy || connected}
          className="rounded-lg bg-[#5F0080] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#4B0066] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isBusy ? '연결 중…' : band.isMock ? 'Mock 연결' : '스캔 및 연결'}
        </button>
        <button
          type="button"
          onClick={() => void band.disconnect()}
          disabled={!connected}
          className="rounded-lg border border-[#DDDEE7] px-3 py-1.5 text-xs font-medium text-[#6F6F6F] hover:bg-[#EFE3FA] hover:text-[#5F0080] disabled:cursor-not-allowed disabled:opacity-40"
        >
          연결 해제
        </button>
        <button
          type="button"
          onClick={band.clearBuffers}
          disabled={!connected}
          className="rounded-lg border border-[#DDDEE7] px-3 py-1.5 text-xs font-medium text-[#6F6F6F] hover:bg-[#EFE3FA] hover:text-[#5F0080] disabled:cursor-not-allowed disabled:opacity-40"
        >
          버퍼 초기화
        </button>
      </div>

      {band.error && (
        <p className="mt-3 rounded-xl border border-[#F5C2C0] bg-[#FDECEC] p-2 text-xs text-[#B3261E]">
          {band.error}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-[#6F6F6F]">모드</dt>
          <dd className="mt-0.5 text-[#1F1F1F]">{band.isMock ? 'Mock' : 'BLE'}</dd>
        </div>
        <div>
          <dt className="text-[#6F6F6F]">상태</dt>
          <dd className="mt-0.5 text-[#1F1F1F]">{band.connectionState}</dd>
        </div>
        <div>
          <dt className="text-[#6F6F6F]">배터리</dt>
          <dd className="mt-0.5 text-[#1F1F1F]">
            {band.battery === null ? '--' : `${Math.round(band.battery)}%`}
          </dd>
        </div>
        <div>
          <dt className="text-[#6F6F6F]">SQI</dt>
          <dd className="mt-0.5 text-[#1F1F1F]">
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
            className="flex items-center gap-2 rounded-xl border border-[#EFEFEF] bg-[#F8FAFC] px-3 py-2"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${SENSOR_DOT[band.sensors[key]]}`} />
            <span className="truncate text-xs text-[#1F1F1F]">{SENSOR_LABEL[key]}</span>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}
