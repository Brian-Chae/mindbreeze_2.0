// SDD-208 — 회원 화면 아이콘. 메인 화면과 같은 2px 아웃라인(lucide), 이모지는 쓰지 않는다(X2).
import { Battery, Bluetooth, Hand, Info, Mic, MicOff, SignalLow, TriangleAlert, VideoOff, WifiOff, type LucideIcon } from 'lucide-react';
import type { MemberIconName } from '../../../../lib/class/member-player-case';

const ICONS: Record<MemberIconName, LucideIcon> = {
  hand: Hand,
  mic: Mic,
  micOff: MicOff,
  cameraOff: VideoOff,
  signalLow: SignalLow,
  battery: Battery,
  alert: TriangleAlert,
  wifiOff: WifiOff,
  info: Info,
  bluetooth: Bluetooth,
};

interface MemberIconProps {
  name: MemberIconName;
  size?: number;
}

export function MemberIcon({ name, size = 20 }: MemberIconProps) {
  const Icon = ICONS[name];
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />;
}
