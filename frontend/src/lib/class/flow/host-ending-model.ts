// SDD-209 H8 — FH09 종료 확인·종료 씬(같은 화면 리포트 진행) 파생. D-5① 독립 커밋 대상.
// 판정은 서버 steps[] 4키(save/stt/summary/ready)의 state 로 한다. 수동 기록은 generation_status=partial 이면서
// ready 가 active 라 generation_status 만 보면 멈춘 것처럼 보인다(F24). "함께한 시간·인원"은 값이 있을 때만 말한다.
import {
  isReportGenerationDone, reportProgressReasonLabel, type ReportGenerationStatus, type ReportProgressStep, type ReportProgressStepKey,
} from '../../api/report-status';

export type EndStepUi = 'done' | 'now' | 'todo' | 'skip' | 'fail';

export interface EndStepView {
  key: ReportProgressStepKey;
  label: string;
  ui: EndStepUi;
  word: string;
}

export interface EndingInput {
  /** 서버 steps[] (아직 조회 전이면 null → 첫 단계 진행 중으로 본다) */
  steps: readonly ReportProgressStep[] | null;
  generationStatus: ReportGenerationStatus | null;
  /** 서버 진행률 0~100. 없으면 단계로 추정 */
  progress: number | null;
  reason: string | null;
  /** 이 클래스를 수동 기록(녹음 없음)으로 진행했는가 */
  manual: boolean;
  /** 함께한 시간(분). 서버 ended_at 기준 값이 없으면 null */
  durationMin: number | null;
  headcount: number | null;
  /** 리포트에 반영하지 않은 참가자 수(익명 집계) */
  excluded: number;
}

export interface EndingView {
  done: boolean;
  manual: boolean;
  steps: EndStepView[];
  /** 0~100 */
  pct: number;
  heading: string;
  sub: string;
  cardTitle: string;
  /** 완료가 아닐 때만 `보통 3~5분` 칩 */
  etaChip: boolean;
  foot: string;
  excludedNotice: { title: string; sub: string } | null;
  /** 실패·부분 완료 사유 문구 */
  reasonText: string | null;
}

const LABEL: Readonly<Record<ReportProgressStepKey, string>> = { save: '녹음 저장', stt: '음성 인식', summary: 'AI 요약', ready: '리포트 완료' };
const ORDER: readonly ReportProgressStepKey[] = ['save', 'stt', 'summary', 'ready'];
/** 서버 진행률이 없을 때 단계별 추정치 */
const ESTIMATE: Readonly<Record<number, number>> = { 0: 25, 1: 50, 2: 75, 3: 90, 4: 100 };

function stateOf(steps: readonly ReportProgressStep[] | null, key: ReportProgressStepKey): ReportProgressStep['state'] {
  return steps?.find((s) => s.key === key)?.state ?? 'pending';
}

export function isEndingDone(steps: readonly ReportProgressStep[] | null, generationStatus: ReportGenerationStatus | null): boolean {
  if (steps) return stateOf(steps, 'ready') === 'done';
  return isReportGenerationDone(generationStatus) && generationStatus === 'ready';
}

/** 서버 steps 가 없을 때의 폴백: 첫 단계 진행 중 */
function effectiveSteps(steps: readonly ReportProgressStep[] | null): ReportProgressStep[] {
  if (steps && steps.length) return steps.map((s) => ({ ...s }));
  return ORDER.map((key, i) => ({ key, label: LABEL[key], state: i === 0 ? 'active' : 'pending' }));
}

function uiOf(state: ReportProgressStep['state']): EndStepUi {
  switch (state) {
    case 'done': return 'done';
    case 'active': return 'now';
    case 'skipped': return 'skip';
    case 'failed': return 'fail';
    default: return 'todo';
  }
}

function wordOf(key: ReportProgressStepKey, ui: EndStepUi, manual: boolean): string {
  if (manual) {
    if (key === 'save') return '녹음 없음';
    if (key === 'stt' || key === 'summary') return '건너뜀';
    return ui === 'done' ? '완료' : ui === 'fail' ? '완료하지 못했어요' : '메모로 만드는 중';
  }
  switch (ui) {
    case 'done': return '완료';
    case 'now': return '진행 중';
    case 'fail': return '완료하지 못했어요';
    case 'skip': return '건너뜀';
    default: return '기다리는 중';
  }
}

function togetherText(durationMin: number | null, headcount: number | null): string {
  if (durationMin && headcount) return `${durationMin}분 동안 ${headcount}명이 함께했어요.`;
  if (durationMin) return `${durationMin}분 동안 진행했어요.`;
  if (headcount) return `${headcount}명이 함께했어요.`;
  return '';
}

export function deriveEnding(input: EndingInput): EndingView {
  const raw = effectiveSteps(input.steps);
  const manual = input.manual || raw.some((s) => s.key === 'stt' && s.state === 'skipped');
  const done = isEndingDone(input.steps, input.generationStatus);
  const steps: EndStepView[] = ORDER.map((key) => {
    const st = raw.find((s) => s.key === key)?.state ?? 'pending';
    // 수동 기록은 앞 3단계를 항상 건너뜀으로 보인다(서버가 아직 안 채웠어도)
    const ui: EndStepUi = manual && key !== 'ready' ? 'skip' : uiOf(st);
    return { key, label: LABEL[key], ui: key === 'ready' && done ? 'done' : ui, word: '' };
  }).map((s) => ({ ...s, word: wordOf(s.key, s.ui, manual) }));
  const activeIdx = steps.findIndex((s) => s.ui === 'now');
  const doneCount = steps.filter((s) => s.ui === 'done' || s.ui === 'skip').length;
  const estimate = done ? 100 : ESTIMATE[Math.max(0, activeIdx === -1 ? doneCount : activeIdx)] ?? 25;
  const pct = done ? 100 : manual ? 70 : input.progress !== null && input.progress > 0 ? Math.min(99, input.progress) : estimate;
  const together = togetherText(input.durationMin, input.headcount);
  const lead = manual
    ? done ? '수동 기록 모드로 진행했어요. 내 메모로 리포트를 만들었어요.' : '수동 기록 모드로 진행했어요. 녹음 없이 내 메모로 리포트를 만들어요.'
    : done ? `${together ? `${together} ` : ''}리포트가 준비됐어요.` : `${together ? `${together} ` : ''}녹음이 저장됐고 리포트를 만들고 있어요.`;
  return {
    done,
    manual,
    steps,
    pct,
    heading: '클래스가 끝났어요',
    sub: lead,
    cardTitle: done ? '리포트가 준비됐어요' : '리포트를 만들고 있어요',
    etaChip: !done,
    foot: done ? '리포트는 기록에서 언제든 볼 수 있어요' : '화면을 닫아도 리포트는 계속 만들어져요',
    excludedNotice: input.excluded > 0
      ? { title: `리포트에 반영하지 않은 참가자 ${input.excluded}명이 있어 그룹 공통 요약은 제외돼요`, sub: '원본은 설정 기간 동안 보관돼요' }
      : null,
    reasonText: reportProgressReasonLabel(input.reason),
  };
}

/** FH09 종료 확인 시트의 3줄. 인원을 모르면 숫자 없이, 0명이면 줄을 뺀다 */
export function endConfirmLines(headcount: number | null): string[] {
  const lines = ['녹음과 녹화가 저장돼요', '상담사·회원 리포트가 자동으로 만들어져요'];
  if (headcount === null) lines.push('참여 중인 회원의 화면도 함께 끝나요');
  else if (headcount > 0) lines.push(`참여 중인 회원 ${headcount}명의 화면도 함께 끝나요`);
  return lines;
}
