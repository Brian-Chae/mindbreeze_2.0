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
      ? '밴드 연결을 지원하지 않는 브라우저입니다. Chrome/Edge를 사용하거나 체험 모드를 시작하세요.'
      : null;

  return (
    <PanelShell
      title="밴드 연결 및 체험"
      subtitle={
        band.isMock
          ? '체험 모드(예시 데이터) · 기록에 저장되지 않습니다'
          : '밴드 신호 보기 · 기록에 저장되지 않습니다'
      }
      state={panelState}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMock}
            className="rounded-lg border border-[#C9B0E8] bg-[#F5EDFC] px-3 py-1.5 text-xs font-medium text-[#5F0080] hover:bg-[#EBDEF7]"
          >
            {useMock ? '체험 종료' : '체험 모드(예시 데이터)'}
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
          onClick={() => void (band.isReconnecting ? band.disconnect().then(() => band.connect()) : band.connect())}
          disabled={!band.isSupported || isBusy || connected}
          className="rounded-lg bg-[#5F0080] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#4B0066] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isBusy ? '연결 중…' : band.isReconnecting ? '다시 연결' : band.isMock ? '체험 다시 시작' : '밴드 연결'}
        </button>
        {(isBusy || band.isReconnecting) && !band.isMock && (
          <button
            type="button"
            onClick={() => void band.disconnect()}
            className="rounded-lg border border-[#F5C2C0] bg-[#FDECEC] px-3 py-1.5 text-xs font-medium text-[#B3261E] hover:bg-[#FADBD9]"
          >
            {band.isReconnecting ? '재연결 취소' : '연결 취소'}
          </button>
        )}
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
          화면 초기화
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
          <dd className="mt-0.5 text-[#1F1F1F]">{band.isMock ? '예시 데이터' : '실제 밴드'}</dd>
        </div>
        <div>
          <dt className="text-[#6F6F6F]">상태</dt>
          <dd className="mt-0.5 text-[#1F1F1F]">{{ unsupported: '연결 미지원', disconnected: '미연결', connecting: '연결 중', connected: '연결됨', error: '연결 오류' }[band.connectionState]}</dd>
        </div>
        <div>
          <dt className="text-[#6F6F6F]">배터리</dt>
          <dd className="mt-0.5 text-[#1F1F1F]">
            {band.battery === null ? '--' : `${Math.round(band.battery)}%`}
          </dd>
        </div>
        <div>
          <dt className="text-[#6F6F6F]">신호 품질</dt>
          <dd className="mt-0.5 text-[#1F1F1F]">
            {band.signalQuality === null
              ? '--'
              : `${band.signalQuality.toFixed(0)} · ${{ ok: '양호', degraded: '주의', invalid: '불안정', unknown: '확인 중' }[band.signalQualityLevel]}`}
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
