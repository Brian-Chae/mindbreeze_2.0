// SDD-209 M — 참가자 화면 공용 라벨. 방식·인원·LINK BAND 모드를 칩 문구로 바꾼다(시안 member-a/b).
import type { FlowBandMode, FlowPlace, FlowSize } from './types';

/** 입장 확인(FM05)은 `온라인`/`오프라인`, 준비 마법사·시작 대기는 `온라인`/`대면` */
export function placeLabel(place: FlowPlace, tone: 'confirm' | 'prep' = 'prep'): string {
  if (place === 'online') return '온라인';
  return tone === 'confirm' ? '오프라인' : '대면';
}

export function sizeLabel(size: FlowSize): string {
  return size === 'group' ? '그룹' : '1:1';
}

/** LINK BAND 칩: 어느 모드든 참가를 막지 않는다(필수 설정도 `권장`) */
export function bandChipLabel(mode: FlowBandMode): string {
  if (mode === 'none') return 'LINK BAND 사용 안 함';
  return mode === 'req' ? 'LINK BAND 권장' : 'LINK BAND 선택';
}
