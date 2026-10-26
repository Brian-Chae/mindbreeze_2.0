// [MB261026][FIX] 리포트 "뇌파 상세 지표 보기"(품질 배너·지표 격자·집중/이완/스트레스 추이) 제거 — 회원·상담사 모두.
// Brian: 이 서비스는 스트레스를 전면에 내세우지 않는다 → 상세 지표 영역 자체를 뺀다.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = ['src/components/reports/ReportDetailView.tsx', 'src/components/reports/ClientReportViewer.tsx'];

describe('리포트 뇌파 상세 지표 영역 제거', () => {
  it.each(files)('%s 에 상세 지표·추이·스트레스가 렌더되지 않는다', (f) => {
    const src = readFileSync(f, 'utf8');
    expect(src).not.toContain('뇌파 상세 지표 보기');
    expect(src).not.toMatch(/<EegTimeline\b/);
    expect(src).not.toMatch(/<EegMetricsGrid\b/);
    expect(src).not.toMatch(/<EegQualityBanner\b/);
    expect(src).not.toContain('data-testid="eeg-section"');
  });
});
