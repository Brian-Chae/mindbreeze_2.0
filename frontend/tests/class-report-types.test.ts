import { describe, expect, it } from 'vitest';
import { getMockReport, getMockSummary, MOCK_STATES } from '../src/lib/class-report/mocks';
import { isClassReportResponse, isClassSummaryResponse } from '../src/lib/class-report/types';
import { sourceLabel } from '../src/lib/class-report/narrative-fields';

describe('SDD-237 계약 fixture', () => {
  it.each(MOCK_STATES)('%s 응답 계약과 결측값을 지킨다', (state) => {
    const report = getMockReport(state);
    expect(isClassReportResponse(report)).toBe(true);
    expect(isClassSummaryResponse(getMockSummary(state))).toBe(true);
    for (const metric of Object.values(report.block?.metrics ?? {})) {
      if (metric.state !== 'ok') {
        expect(metric.mean).toBeNull();
        expect(metric.series).toEqual([]);
      }
    }
  });
  it('편집본은 초안을 보존하고 상담사 출처를 표시한다', () => {
    const field = getMockReport('edited').block!.narrative.fields.headline;
    expect(field.source).toBe('edited');
    expect(field.ai_draft).toBeTruthy();
    expect(sourceLabel(field)).toContain('상담사 수정');
  });
  it('잘못된 응답은 거절한다', () => {
    expect(isClassReportResponse({ block: {} })).toBe(false);
    expect(isClassSummaryResponse({})).toBe(false);
  });
});
