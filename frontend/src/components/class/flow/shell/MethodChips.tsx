// SDD-209 SH1 — 방식 칩 3개(온라인/오프라인 · 그룹/1:1 · LINK BAND). 시안의 methodItems 와 같은 순서.
import { Activity, MapPin, User, Users, Video } from 'lucide-react';
import type { LinkbandMode, LocationType, ParticipantMode } from '../../../../lib/api/session';
import { bandLabel, placeLabel, sizeLabel } from '../../../../lib/class/class-labels';
import './shell-kit.css';

interface MethodChipsProps {
  place: LocationType;
  mode: ParticipantMode;
  band: LinkbandMode;
  /** 사진 위(어두운 면) 칩 */
  dark?: boolean;
}

export function MethodChips({ place, mode, band, dark = false }: MethodChipsProps) {
  const cls = dark ? 'sh-hchip' : 'sh-chip mute';
  const PlaceIcon = place === 'online' ? Video : MapPin;
  const SizeIcon = mode === 'one_on_one' ? User : Users;
  return (
    <>
      <span className={cls} data-method="place"><PlaceIcon size={16} aria-hidden="true" />{placeLabel(place)}</span>
      <span className={cls} data-method="size"><SizeIcon size={16} aria-hidden="true" />{sizeLabel(mode)}</span>
      <span className={cls} data-method="band"><Activity size={16} aria-hidden="true" />{bandLabel(band)}</span>
    </>
  );
}
