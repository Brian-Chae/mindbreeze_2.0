// 개선 3: 대기실 LINK BAND 확인 카드 — 선택(opt-in).
//
// 연결 여부와 무관하게 입장은 항상 가능하다(게이트에 포함되지 않는다).
// 여기서 연결하면 전역(singleton) BLE 연결이 유지되어 다음 단계(착용 가이드)에서
// 센서 접촉 확인으로 이어진다 — 별도 재연결이 필요 없다.

import { useBand } from '../../hooks/useBand';
import { useAuthStore } from '../../stores/authStore';
import { isBluetoothSupported } from '../../lib/class/class-waiting-room';
import { contactStatusLabel, resolveBandLinkState } from '../../lib/session-live/signal-status';

interface WaitingRoomBandCheckProps {
  sessionId: string;
  participantId: string | null;
}

export function WaitingRoomBandCheck({
  sessionId,
  participantId,
}: WaitingRoomBandCheckProps): React.ReactElement {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const band = useBand({
    sessionId,
    participantId,
    enabled: Boolean(sessionId && participantId),
    skipAuth: !isAuthenticated,
  });

  const isConnected = band.connectionState === 'connected';
  // 브라우저 지원 여부를 직접 확인한다 — 연결 시도 전에도 미지원 안내를 확실히 보여준다
  const isUnsupported =
    !isBluetoothSupported() || band.connectionState === 'unsupported' || !band.isSupported;
  const linkState = resolveBandLinkState({ bleConnected: isConnected, lastEegAt: band.lastEegAt });

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white/70"
        >
          +
        </span>
        <h2 className="text-[15px] font-semibold text-white">LINK BAND 연결</h2>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/60">
          선택
        </span>
      </div>

      <p className="mt-3 text-[13px] leading-6 text-white/70">
        뇌파 측정을 함께 하려면 지금 연결해 두세요. 연결하지 않아도 클래스 참여와 AI 기록은 그대로
        제공됩니다.
      </p>

      {isUnsupported ? (
        <p className="mt-3 rounded-xl bg-white/5 px-4 py-3 text-[12px] leading-5 text-white/60">
          이 브라우저는 Web Bluetooth를 지원하지 않습니다(Chrome/Edge 권장). 밴드 없이 진행할 수
          있어요.
        </p>
      ) : isConnected ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-white/15 px-3 py-2 text-[13px] font-semibold text-white">
            연결됨
            {band.battery !== null ? ` · 배터리 ${Math.round(band.battery)}%` : ''}
            {` · 접촉 ${contactStatusLabel(band.deviceStatus)}`}
          </span>
          <button
            type="button"
            onClick={() => void band.disconnect()}
            className="rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/20"
          >
            연결 해제
          </button>
          {linkState === 'stale' && (
            <span className="text-[12px] text-amber-200">
              최근 뇌파 수신이 없습니다 — 접촉을 확인해 주세요
            </span>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void band.connect()}
            disabled={band.connectionState === 'connecting'}
            className="h-11 rounded-xl bg-[#5F0080] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#4C0066] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {band.connectionState === 'connecting'
              ? '연결 중…'
              : band.isMock
                ? '시뮬레이션 시작'
                : 'LINK BAND 연결'}
          </button>
          <span className="text-[12px] text-white/50">연결하지 않고 건너뛰어도 됩니다</span>
        </div>
      )}

      {band.error && (
        <p role="alert" className="mt-2 text-[12px] text-[#F7C6C6]">
          {band.error}
        </p>
      )}
    </section>
  );
}
