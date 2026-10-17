// SDD-209 H8 — FH09 하니스 입력(시안 host-b.html fh09 stage 표). 서버 steps[] 4키 상태로 만든다.
import type { ReportProgressStep, ReportProgressStepKey, ReportStepState } from '../../api/report-status';
import type { EndingInput } from './host-ending-model';

const ORDER: readonly ReportProgressStepKey[] = ['save', 'stt', 'summary', 'ready'];
const LABELS: Readonly<Record<ReportProgressStepKey, string>> = { save: '녹음 저장', stt: '음성 인식', summary: 'AI 요약', ready: '리포트 완료' };

function steps(states: readonly ReportStepState[]): ReportProgressStep[] {
  return ORDER.map((key, i) => ({ key, label: LABELS[key], state: states[i] ?? 'pending' }));
}

/** 하니스 시안: 48분 · 8명 */
const BASE = { durationMin: 48, headcount: 8, reason: null, excluded: 0 } as const;

export const ENDING_FIXTURES = {
  'end-saving': { ...BASE, steps: steps(['active', 'pending', 'pending', 'pending']), generationStatus: 'processing', progress: null, manual: false },
  'end-stt': { ...BASE, steps: steps(['done', 'active', 'pending', 'pending']), generationStatus: 'processing', progress: null, manual: false },
  'end-ai': { ...BASE, steps: steps(['done', 'done', 'active', 'pending']), generationStatus: 'processing', progress: null, manual: false },
  'end-done': { ...BASE, steps: steps(['done', 'done', 'done', 'done']), generationStatus: 'ready', progress: 100, manual: false },
  // 수동 기록: 서버는 partial 이면서 ready 가 active 다 — 완료로 오판하지도, 멈춘 것으로 보지도 않는다
  'manual-ing': { ...BASE, steps: steps(['skipped', 'skipped', 'skipped', 'active']), generationStatus: 'partial', progress: null, manual: true },
  'manual-done': { ...BASE, steps: steps(['skipped', 'skipped', 'skipped', 'done']), generationStatus: 'partial', progress: 100, manual: true },
  'excluded-common': { ...BASE, excluded: 2, steps: steps(['done', 'done', 'active', 'pending']), generationStatus: 'processing', progress: null, manual: false },
} as const satisfies Record<string, EndingInput>;
