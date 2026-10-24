// SDD-209 M2 — 준비 마법사(FM06a~e) 초안과 요약 행. 어떤 값도 입장·녹음·업로드의 조건이 아니다(기본 제외·미동의로 진행 가능).
import type { FlowBandMode, FlowPlace } from './types';
import type { WizardKey } from './member-machine';
import type { BandStepUi } from '../band-step';
import type { MediaDeviceUi } from '../class-media';

/** 고지 문구 버전(서버 증빙용, 최대 20자). 문구가 바뀌면 올린다 */
export const REPORT_NOTICE_VERSION = 'r5-1';
export const CLASS_TEAM_NOTICE_VERSION = 'class-team-v1';
export const reportNoticeVersion = (sessionType?: string): string => sessionType === 'meditation' ? CLASS_TEAM_NOTICE_VERSION : REPORT_NOTICE_VERSION;
export const RESEARCH_NOTICE_VERSION = 'r5-2';

/** 리포트 반영 선택 — null = 아직 고르지 않음(서버 기본 = 제외) */
export type ReportChoice = 'included' | 'excluded' | null;
export type SurveyOutcome = 'none' | 'done' | 'skipped';
/** LINK BAND 단계 결과: connected 연결 · skipped 없이 계속 · none 아직 결정 전 */
export type BandOutcome = 'none' | 'connected' | 'skipped';
export type MicOutcome = 'unknown' | 'on' | 'off';

export interface PrepDraft {
  reportChoice: ReportChoice;
  reportSaveFailed: boolean;
  researchConsent: boolean;
  researchSaveFailed: boolean;
  survey: SurveyOutcome;
  bandOutcome: BandOutcome;
  mic: MicOutcome;
  camOn: boolean;
}

export function emptyPrepDraft(): PrepDraft {
  return {
    reportChoice: null, reportSaveFailed: false, researchConsent: false, researchSaveFailed: false,
    survey: 'none', bandOutcome: 'none', mic: 'unknown', camOn: false,
  };
}

/** 기록 원본 보관 기간(일) — 환경 설정값을 읽는다. 없거나 잘못되면 null(기간 숫자를 지어내지 않는다) */
export function parseRetentionDays(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

export type SummaryRowKey = 'report' | 'research' | 'survey' | 'band' | 'device';
export type SummaryIcon = 'shield' | 'lock' | 'smile' | 'activity' | 'mic' | 'micOff' | 'pin';

export interface SummaryRow {
  key: SummaryRowKey;
  icon: SummaryIcon;
  /** 한 줄 문장형 행은 null */
  label: string | null;
  value: string;
  warn: boolean;
  /** 눌렀을 때 이동할 단계. 고칠 수 없는 행은 null */
  goto: WizardKey | null;
}

export function buildSummaryRows(input: { place: FlowPlace; bandMode: FlowBandMode; draft: PrepDraft }): SummaryRow[] {
  const { place, bandMode, draft } = input;
  const bandValue =
    bandMode === 'none' ? '사용 안 해요' : draft.bandOutcome === 'connected' ? '연결됐어요 · 접촉 양호' : 'LINK BAND 없이 참가해요';
  const micWord = draft.mic === 'on' ? '정상' : draft.mic === 'off' ? '꺼짐' : '확인 전';
  const rows: SummaryRow[] = [
    {
      key: 'report', icon: 'shield', label: null, warn: false, goto: 'a',
      value: draft.reportChoice === 'included' ? '리포트 반영해요' : '리포트 반영하지 않아요',
    },
    {
      key: 'research', icon: 'lock', label: null, warn: false, goto: 'a',
      value: draft.researchConsent ? '연구 목적 활용에 동의했어요' : '연구 목적 활용에 동의하지 않았어요',
    },
    { key: 'survey', icon: 'smile', label: '오늘의 상태', warn: false, goto: 'b', value: draft.survey === 'done' ? '남겼어요' : '건너뛰었어요' },
    { key: 'band', icon: 'activity', label: 'LINK BAND', warn: false, goto: bandMode === 'none' ? null : 'c', value: bandValue },
  ];
  if (place === 'online') {
    rows.push({
      key: 'device', icon: draft.mic === 'off' ? 'micOff' : 'mic', label: '기기', goto: 'd',
      warn: draft.mic === 'off', value: `마이크 ${micWord} · 카메라 ${draft.camOn ? '켜짐' : '꺼짐'}`,
    });
  } else {
    rows.push({ key: 'device', icon: 'pin', label: '참여 방식', warn: false, goto: null, value: '현장에서 함께해요' });
  }
  return rows;
}

const PREP_LABEL: Partial<Record<WizardKey, string>> = { b: '오늘의 상태', c: 'LINK BAND', d: '기기' };

/** 시작 후 시트의 `남은 준비` — 지금 단계부터 끝까지 남은 건너뛸 수 있는 준비 이름 */
export function remainingPrepLabels(steps: readonly WizardKey[], current: WizardKey): string[] {
  const from = steps.indexOf(current);
  if (from < 0) return [];
  return steps.slice(from).flatMap((key) => {
    const label = PREP_LABEL[key];
    return label ? [label] : [];
  });
}

/**
 * LINK BAND 단계를 떠날 때의 결과. 접촉 불량이어도 `다음`이면 연결된 채로 진행한다(차단 없음).
 * 연결돼 있어도 `없이 계속하기`를 골랐으면 skipped.
 */
export function bandOutcomeOf(_state: BandStepUi, action: 'next' | 'skip'): BandOutcome {
  return action === 'next' ? 'connected' : 'skipped';
}

/** 기기 단계를 떠날 때 요약에 반영할 값. 확인 중(pending)은 아직 모른다 */
export function deviceOutcomeOf(mic: MediaDeviceUi, cam: MediaDeviceUi): { mic: MicOutcome; camOn: boolean } {
  const micOutcome: MicOutcome = mic === 'on' ? 'on' : mic === 'pending' ? 'unknown' : 'off';
  return { mic: micOutcome, camOn: cam === 'on' };
}
