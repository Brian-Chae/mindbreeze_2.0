// SDD-208 H2 — "내 밴드" 시트(상담사 본인 LINK BAND). 선택 사항이라 미착용·미지원도 오류가 아니라 정상 안내다.
import { Battery, BatteryLow } from 'lucide-react';
import { isLowBattery } from '../../../../../lib/session-live/signal-status';
import type { HostSelfBand } from '../../../../../lib/class/host-player-case';
import { HostRow } from '../HostAtoms';
import '../host-player.css';

interface MybandSheetProps {
  band: HostSelfBand;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function MybandSheet({ band, onConnect, onDisconnect }: MybandSheetProps) {
  if (band.state === 'connected') {
    const low = isLowBattery(band.battery);
    return (
      <div className="hp-sheet">
        <HostRow
          lead={<span className="hp-row__lead"><i className="hp-dot" data-state="on" /></span>}
          title="연결됨"
          sub={[band.signalLabel, band.relaxation !== null ? `내 이완도 ${band.relaxation}` : null, band.contactLabel ? `접촉 ${band.contactLabel}` : null].filter(Boolean).join(' · ')}
        />
        {band.battery !== null ? (
          <HostRow
            lead={<span className="hp-row__lead">{low ? <BatteryLow aria-hidden="true" strokeWidth={2} /> : <Battery aria-hidden="true" strokeWidth={2} />}</span>}
            title={`배터리 ${Math.round(band.battery)}%`}
            sub={low ? '낮아요 · 충전해 주세요' : '충분해요'}
            subTone={low ? 'caution' : undefined}
          />
        ) : null}
        <p className="hp-note">내 지표는 나에게만 보여요. 참가자에게는 공유되지 않아요.</p>
        <button type="button" className="hp-btn" data-variant="ghost" onClick={onDisconnect}>연결 해제</button>
      </div>
    );
  }
  if (band.state === 'unsupported') {
    return (
      <div className="hp-sheet">
        <HostRow lead={<span className="hp-row__lead"><i className="hp-dot" data-state="off" /></span>} title="이 브라우저에서는 밴드 연결이 안 돼요" sub="선택 사항이에요" />
        <p className="hp-note">Chrome 또는 Edge로 열면 내 밴드를 연결할 수 있어요. 밴드 없이도 수업은 그대로 진행돼요.</p>
      </div>
    );
  }
  const connecting = band.state === 'connecting';
  return (
    <div className="hp-sheet">
      <HostRow
        lead={<span className="hp-row__lead"><i className="hp-dot" data-state="off" /></span>}
        title={connecting ? '연결하는 중이에요' : '미착용'}
        sub="선택 사항이에요"
        trailing={
          <button type="button" className="hp-btn" disabled={connecting || !band.canConnect} onClick={onConnect}>
            {connecting ? '연결 중' : '밴드 연결'}
          </button>
        }
      />
      {band.error ? <p className="hp-note" data-tone="coral">{band.error}</p> : null}
      <p className="hp-note">밴드 없이도 수업은 그대로 진행돼요. 착용하면 내 지표도 볼 수 있어요.</p>
    </div>
  );
}
