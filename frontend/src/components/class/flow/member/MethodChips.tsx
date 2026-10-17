// SDD-209 M — 방식·인원·LINK BAND 모드 칩 줄(FM05·FM06a·FM07 공용). 색만으로 전달하지 않고 아이콘+라벨을 함께 쓴다.
import { Activity, MapPin, User, Users, Video } from 'lucide-react';
import { bandChipLabel, placeLabel, sizeLabel } from '../../../../lib/class/flow/member-labels';
import type { FlowBandMode, FlowPlace, FlowSize } from '../../../../lib/class/flow/types';
import { FlowChip, FlowChipRow } from '../shared/flow-primitives';

interface MethodChipsProps {
  place: FlowPlace;
  size: FlowSize;
  /** 생략하면 LINK BAND 칩을 그리지 않는다 */
  bandMode?: FlowBandMode;
  tone?: 'confirm' | 'prep';
}

export function MethodChips({ place, size, bandMode, tone = 'prep' }: MethodChipsProps) {
  return (
    <FlowChipRow>
      <FlowChip icon={place === 'online' ? <Video size={16} /> : <MapPin size={16} />}>{placeLabel(place, tone)}</FlowChip>
      <FlowChip icon={size === 'group' ? <Users size={16} /> : <User size={16} />}>{sizeLabel(size)}</FlowChip>
      {bandMode ? <FlowChip icon={<Activity size={16} />}>{bandChipLabel(bandMode)}</FlowChip> : null}
    </FlowChipRow>
  );
}
