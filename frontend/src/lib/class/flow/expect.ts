// SDD-209 T3 — 측정 스크립트(e2e/class-flow)가 쓰는 규칙 기대값의 단일 정본.
// 하니스가 window.__flowExpect 로 노출하고, mjs 쪽은 이 파생을 다시 구현하지 않는다.
import { expectedFlowState, expectedWizardSteps, parseFlowCaseRef } from './case-key';
import type { ExpectedFlowState } from './case-key';
import type { FlowCaseKey } from './types';

export interface FlowExpect extends ExpectedFlowState {
  /** FR2 진행 점 개수. null = 마법사 아님 */
  steps: number | null;
  /** FR1 비교 그룹. 같은 그룹은 하단 CTA 박스가 같아야 한다. null = 비교 대상 아님 */
  fr1Group: string | null;
}

/** FH02 마법사 5단계의 기준 케이스(각 단계의 기본 상태) */
const HOST_WIZARD_CANONICAL: Readonly<Record<string, string>> = {
  FH02a: 'online-group', FH02b: 'optional', FH02c: 'later', FH02d: 'picked', FH02e: 'online',
};

/** 시트가 열린 변형은 CTA 비교 그룹에서 뺀다(푸터가 inert 이지 자리가 바뀌는 것은 아니지만 측정 기준을 단순하게 둔다) */
function isSheetVariant(parsed: FlowCaseKey): boolean {
  return parsed.kind === 'prep' && (parsed.started || parsed.state.endsWith('-sheet'));
}

export function fr1GroupOf(parsed: FlowCaseKey): string | null {
  if (parsed.kind === 'prep' && /^FM06[a-e]$/.test(parsed.screen)) {
    return isSheetVariant(parsed) ? null : `FM06:${parsed.place}-${parsed.size}-${parsed.bandMode}`;
  }
  if (parsed.kind === 'simple' && HOST_WIZARD_CANONICAL[parsed.screen] === parsed.key) return 'FH02';
  return null;
}

/** 자가검증 픽스처의 기대값 */
function selftestExpect(key: string, query: URLSearchParams): FlowExpect {
  const none: FlowExpect = { steps: null, fr1Group: null, tracker: null, avMode: null };
  if (key === 'wizard') {
    const total = Number(query.get('total'));
    return { ...none, steps: Number.isFinite(total) && total > 0 ? total : 5 };
  }
  if (key === 'av-video') return { ...none, avMode: 'video' };
  if (key === 'av-bar') return { ...none, avMode: 'bar' };
  if (key === 'electrodes-bad') return { ...none, tracker: true };
  if (key === 'electrodes-good') return { ...none, tracker: false };
  return none;
}

export function deriveFlowExpect(ref: string, query = ''): FlowExpect {
  const params = new URLSearchParams(query);
  if (ref.startsWith('__selftest:')) return selftestExpect(ref.slice('__selftest:'.length), params);
  const parsed = parseFlowCaseRef(ref);
  if (!parsed) return { steps: null, fr1Group: null, tracker: null, avMode: null };
  return { steps: expectedWizardSteps(parsed), fr1Group: fr1GroupOf(parsed), ...expectedFlowState(parsed) };
}
