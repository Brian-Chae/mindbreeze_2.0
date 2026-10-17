// SDD-209 H4 — 하니스용 세팅 래퍼(권한·장치 상태를 케이스가 고정하고, 시트·토글만 화면 안에서 동작)
import { useState } from 'react';
import type { MediaDeviceUi } from '../../../../lib/class/class-media';
import type { FlowPlace } from '../../../../lib/class/flow/types';
import { decideOpen } from '../../../../lib/class/flow/host-open';
import { SetupScreen, type SetupMedia } from './SetupScreen';

export interface SetupFixtureProps {
  place: FlowPlace;
  media: Omit<SetupMedia, 'speakerPlaying'>;
  warnOpen?: boolean;
  backdropSrc: string;
}

export function SetupFixture({ place, media, warnOpen = false, backdropSrc }: SetupFixtureProps) {
  const [warn, setWarn] = useState(warnOpen);
  const [help, setHelp] = useState<'마이크' | '카메라' | null>(null);
  const [mic, setMic] = useState<MediaDeviceUi>(media.mic);
  const current = { ...media, mic, speakerPlaying: false };
  const micFlip = (): void => setMic((prev) => (prev === 'on' ? 'off' : prev === 'off' ? 'on' : prev));
  return (
    <SetupScreen
      title="마음챙김 명상 · 4회차"
      startText="오늘 오후 3:00"
      place={place}
      solo={false}
      address="서울 강남구 테헤란로 123 · 4층 명상실"
      media={current}
      micOffSheetOpen={warn}
      helpDevice={help}
      backdropSrc={backdropSrc}
      onBack={() => undefined}
      onOpen={() => { if (decideOpen({ place, mic, cam: media.cam }) === 'confirm-mic-off') setWarn(true); }}
      onToggleMic={micFlip}
      onToggleCamera={() => undefined}
      onRecheck={() => setHelp(null)}
      onPlayTone={() => undefined}
      onOpenHelp={setHelp}
      onCloseHelp={() => setHelp(null)}
      onOpenWithMic={() => { setMic('on'); setWarn(false); }}
      onOpenManual={() => setWarn(false)}
      onDismissMicOff={() => setWarn(false)}
    />
  );
}
