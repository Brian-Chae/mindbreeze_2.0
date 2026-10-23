import type { ClassReportResponse, ClassSummaryResponse } from './types';
export const MOCK_STATES = ['normal', 'partial', 'single', 'poor', 'lost', 'unworn', 'pending', 'error', 'zero', 'edited'] as const;
export type MockState = typeof MOCK_STATES[number];
const fixtures = import.meta.glob('./fixtures/*.json', { eager: true, import: 'default' });
export function getMockState(): MockState | null {
  const query = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('mock');
  const candidate = query === 'measured' ? 'normal' : query === 'poor_signal' ? 'poor' : query;
  if (MOCK_STATES.includes(candidate as MockState)) return candidate as MockState;
  return import.meta.env.VITE_CLASS_REPORT_MOCK === '1' ? 'normal' : null;
}
export function getMockReport(state: MockState = 'normal'): ClassReportResponse {
  return structuredClone(fixtures[`./fixtures/report-${state}.json`]) as ClassReportResponse;
}
export function getMockSummary(state: MockState = 'normal'): ClassSummaryResponse {
  const summary = structuredClone(fixtures[`./fixtures/summary-${state === 'edited' ? 'normal' : state}.json`]) as ClassSummaryResponse;
  if (state === 'edited') {
    const field = getMockReport(state).block!.narrative.fields.headline;
    summary.class_report.headline = { text: field.text, source: field.source, edited_by_name: field.edited_by_name, edited_at: field.edited_at };
  }
  return summary;
}
