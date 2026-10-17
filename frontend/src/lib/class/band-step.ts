// SDD-209 T2b — 입장 준비 LINK BAND 단계(FM06c) 상태와 전극 파생.
// deriveBandUi(player-case.ts) 는 L/R 분할·연결 실패·접촉 미확인을 구분하지 못해 얇은 래퍼를 둔다(임계값은 새로 만들지 않는다).
import type { LeadOffStatus } from '../eeg/types/eeg';
import { deriveBandUi, type BandInput } from './player-case';

export type BandStepUi = 'idle' | 'connecting' | 'connected' | 'leadoffl' | 'leadoffr' | 'leadoff' | 'unsupported';

/** 접촉 상태: good 양호 / bad 실패 / unknown 확인 전(거짓 불량 표시 금지) */
export type ElectrodeState = 'good' | 'bad' | 'unknown';

export interface Electrodes {
  left: ElectrodeState;
  ref: ElectrodeState;
  right: ElectrodeState;
}

/** ch1→왼쪽, ch2→오른쪽(좌우 대응은 SDK 문서로 미확인 — 현행·시안 가정). 기준 = 둘 다 양호일 때만 양호 */
export function deriveElectrodes(leadOff: LeadOffStatus | null): Electrodes {
  if (!leadOff) return { left: 'unknown', ref: 'unknown', right: 'unknown' };
  const left: ElectrodeState = leadOff.ch1 ? 'bad' : 'good';
  const right: ElectrodeState = leadOff.ch2 ? 'bad' : 'good';
  return { left, ref: left === 'good' && right === 'good' ? 'good' : 'bad', right };
}

export function deriveBandStep(input: BandInput, leadOff: LeadOffStatus | null, nowMs: number): BandStepUi {
  const ui = deriveBandUi(input, nowMs);
  if (ui === 'unsupported') return 'unsupported';
  if (ui === 'pending') return 'connecting';
  if (ui === 'off' || ui === 'lost') return 'idle';
  // 연결된 상태에서만 접촉을 본다. 채널별 정보가 있으면 그것을 정본으로 쓴다
  if (leadOff && (leadOff.ch1 || leadOff.ch2)) {
    if (leadOff.ch1 && leadOff.ch2) return 'leadoff';
    return leadOff.ch1 ? 'leadoffl' : 'leadoffr';
  }
  // 채널 정보 없이 서버식 lead_off 판정만 있으면 어느 쪽인지 알 수 없어 둘 다로 본다
  if (ui === 'leadoff') return 'leadoff';
  return 'connected';
}

/** 전극 LED 상태별 색. 색만으로 상태를 전달하지 않는다(라벨·aria 병행) */
export interface ElectrodeColors {
  good: string;
  bad: string;
  unknown: string;
}

export const DEFAULT_ELECTRODE_COLORS: ElectrodeColors = {
  good: 'var(--mb-mint, #01F0C8)',
  bad: 'var(--mb-danger-deep, #D33F3F)',
  unknown: '#8A8A9A',
};
