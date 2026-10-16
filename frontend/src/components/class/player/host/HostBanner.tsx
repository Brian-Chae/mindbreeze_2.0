// SDD-208 H2 — 상단 배너(마이크 꺼짐·권한 거부·네트워크 불안정/끊김). 공용 NoticeBanner 를 쓰고 제목 + 설명 + (선택) 버튼 한 개를 둔다.
import { MicOff, WifiOff } from 'lucide-react';
import type { HostBanner as HostBannerModel, HostSheetKey } from '../../../../lib/class/host-player-case';
import { NoticeBanner } from '../shared/NoticeBanner';
import './host-player.css';

interface HostBannerProps {
  banner: HostBannerModel;
  onSheet: (sheet: HostSheetKey) => void;
  onToggleMic: () => void;
  onRetry: () => void;
}

export function HostBanner({ banner, onSheet, onToggleMic, onRetry }: HostBannerProps) {
  const Icon = banner.icon === 'wifioff' ? WifiOff : MicOff;
  const action = banner.action;
  const onAction = (): void => {
    if (!action) return;
    if (action.kind === 'sheet') onSheet(action.sheet);
    else if (action.act === 'mic') onToggleMic();
    else onRetry();
  };
  return (
    <NoticeBanner
      tone={banner.tone}
      variant="banner"
      icon={<Icon size={22} strokeWidth={2} />}
      action={action ? <button type="button" className="hp-btn-soft" onClick={onAction}>{action.label}</button> : undefined}
    >
      <b className="hp-banner__title">{banner.title}</b>
      {banner.detail}
    </NoticeBanner>
  );
}
