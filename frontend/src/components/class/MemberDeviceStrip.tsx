// SDD-124: 회원용 디바이스 상태 스트립 — 배터리·접촉·신호 품질·연결 시간을 한 줄로.

import {
  contactStatusLabel,
  signalQualityLevelLabel,
  type SignalQualityLevel,
} from '../../lib/session-live/signal-status';
import type { DeviceStatus } from '../../lib/api/session';

interface MemberDeviceStripProps {
  connected: boolean;
  battery: number | null;
  deviceStatus: DeviceStatus | null;
  signalQualityLevel: SignalQualityLevel;
  connectedElapsedSec: number;
}

function formatDuration(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  return mm > 0 ? `${mm}분 ${String(ss).padStart(2, '0')}초` : `${ss}초`;
}

export function MemberDeviceStrip({
  connected,
  battery,
  deviceStatus,
  signalQualityLevel,
  connectedElapsedSec,
}: MemberDeviceStripProps) {
  return (
    <div className="member-device-strip" role="status" aria-label="LINK BAND 상태">
      <span className={`member-device-name${connected ? '' : ' is-off'}`}>
        <i className="member-device-dot" aria-hidden="true" />
        LINK BAND 2.0
        <b>{connected ? '연결됨' : '미연결'}</b>
      </span>
      <span className="member-device-item">배터리 {battery ?? '—'}%</span>
      <span className="member-device-item">접촉 {contactStatusLabel(deviceStatus)}</span>
      <span className="member-device-item">신호 {signalQualityLevelLabel(signalQualityLevel)}</span>
      {connected && (
        <span className="member-device-item">연결 {formatDuration(connectedElapsedSec)}</span>
      )}
    </div>
  );
}
