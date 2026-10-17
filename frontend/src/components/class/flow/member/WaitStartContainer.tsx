// SDD-209 M6 — FM07 컨테이너: 시작 예정 시각의 상대 표기를 갱신하고, 온라인에서는 대기실 BGM 을 재생한다.
// 대기를 떠나면(언마운트) BGM 은 자동으로 멈춘다.
import { useEffect, useState } from 'react';
import { useLobbyBgm } from '../../../../hooks/useLobbyBgm';
import { formatWhen, startsInLabel } from '../../../../lib/class/flow/member-format';
import type { FlowBandMode, FlowPlace, FlowSize } from '../../../../lib/class/flow/types';
import { WaitStartView } from './WaitStartView';

const TICK_MS = 30_000;

interface WaitStartContainerProps {
  place: FlowPlace;
  size: FlowSize;
  bandMode: FlowBandMode;
  title: string;
  hostName: string | null;
  scheduledAt: string | null;
  address: string | null;
  onRecheck: () => void;
  onExit: () => void;
}

export function WaitStartContainer({ scheduledAt, ...rest }: WaitStartContainerProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const online = rest.place === 'online';
  const bgm = useLobbyBgm(online);
  return (
    <WaitStartView
      {...rest}
      whenLabel={formatWhen(scheduledAt, now)}
      startsIn={startsInLabel(scheduledAt, now)}
      readyCount={null}
      bgm={
        online
          ? { title: bgm.state.track?.title ?? '대기실 BGM', playing: !bgm.state.muted && !bgm.state.blocked, volume: bgm.state.volume, blocked: bgm.state.blocked }
          : null
      }
      onBgmToggle={() => (bgm.state.blocked ? bgm.resume() : bgm.toggleMute())}
      onBgmVolume={bgm.setVolume}
    />
  );
}
