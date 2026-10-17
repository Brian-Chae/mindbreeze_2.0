// SDD-209 BE-10 — 회원 준비 상태(대기실 presence) 계약 변환. 서버는 저장하지 않고 호스트 룸으로 중계만 한다.
// 회원 쪽: 준비 마법사 진행 → readiness(완료·건너뜀 + band{state, lead_off, battery}) 로 만든다.
// 호스트 쪽: 중계된 band.lead_off → LeadOffStatus. 채널 값이 하나라도 boolean 이 아니면 접촉을 알 수 없다(null).
import type { LeadOffStatus } from '../../eeg/types/eeg';
import type { WaitingRoomBand, WaitingRoomReadiness } from '../../socket';
import type { FlowBandMode, FlowPlace } from './types';
import type { BandOutcome, MicOutcome, SurveyOutcome } from './member-prep';

/** 밴드 단계에서 관찰한 스냅샷 */
export interface BandSnapshot {
  /** BandStepUi 식별자(소문자) */
  state: string;
  leadOff: LeadOffStatus | null;
  /** 0~100. 모르면 null */
  battery: number | null;
}

export interface MemberReadinessInput {
  place: FlowPlace;
  bandMode: FlowBandMode;
  survey: SurveyOutcome;
  bandOutcome: BandOutcome;
  mic: MicOutcome;
  band: BandSnapshot | null;
}

export function toWaitingRoomBand(snapshot: BandSnapshot | null): WaitingRoomBand | null {
  if (!snapshot) return null;
  const battery = snapshot.battery !== null && Number.isInteger(snapshot.battery) && snapshot.battery >= 0 && snapshot.battery <= 100
    ? snapshot.battery
    : null;
  return {
    state: /^[a-z][a-z0-9_]{0,23}$/.test(snapshot.state) ? snapshot.state : null,
    lead_off: snapshot.leadOff ? { ch1: snapshot.leadOff.ch1, ch2: snapshot.leadOff.ch2 } : null,
    battery,
  };
}

/** 마법사 진행 → 서버 readiness. 밴드를 쓰지 않는 클래스·오프라인은 해당 단계를 완료로 본다(호스트는 na 로 숨긴다) */
export function buildMemberReadiness(input: MemberReadinessInput): WaitingRoomReadiness {
  const bandApplies = input.bandMode !== 'none';
  const deviceApplies = input.place === 'online';
  return {
    surveyDone: input.survey !== 'none',
    surveySkipped: input.survey === 'skipped',
    bandDone: bandApplies ? input.bandOutcome !== 'none' : true,
    bandSkipped: bandApplies && input.bandOutcome === 'skipped',
    deviceDone: deviceApplies ? input.mic !== 'unknown' : true,
    deviceSkipped: false,
    band: bandApplies ? toWaitingRoomBand(input.band) : null,
  };
}

/** 중계된 band → 호스트 로비의 LeadOffStatus. 알 수 없으면 null(거짓 접촉 불량·거짓 양호 금지) */
export function leadOffFromBand(band: WaitingRoomBand | null | undefined): LeadOffStatus | null {
  const lead = band?.lead_off;
  if (!lead || typeof lead.ch1 !== 'boolean' || typeof lead.ch2 !== 'boolean') return null;
  return { ch1: lead.ch1, ch2: lead.ch2 };
}
