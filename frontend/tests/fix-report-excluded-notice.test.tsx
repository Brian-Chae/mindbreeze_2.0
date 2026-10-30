// 리포트 제외 선택으로 비운 EEG 와 실제 미측정의 문구 구분(2안)
import { describe, expect, it } from 'vitest';
import { adaptReportContent, type ReportDto } from '../src/lib/api/reports';
import { buildReportSessionInfo, REPORT_EXCLUDED_NOTICE } from '../src/lib/report/session-info';

const mk = (eeg: Record<string, unknown>): ReportDto =>
  ({
    id: 'r1', session_id: 's1', user_id: 'u', type: 'client', status: 'pending_review', pdf_url: null, sent_at: null, is_read: false,
    created_at: '2026-10-28T05:10:00Z', scheduled_at: '2026-10-28T05:00:00Z', session_title: '호흡 명상',
    session_type: 'meditation', participant_name: '지우', counselor_name: '코치', in_review: false,
    content: { headline: 'x', eeg },
  }) as ReportDto;

describe('리포트 제외 문구 구분', () => {
  it('reason=participant_excluded 면 제외 안내 문구를 쓴다', () => {
    const r = mk({ status: 'not_measured', excluded: true, reason: 'participant_excluded', notice: '참가자가 제외를 선택했어요' });
    const adapted = adaptReportContent(r.content, 'client');
    expect(adapted.eegExcluded).toBe(true);
    const info = buildReportSessionInfo(r, adapted);
    expect(info.recordedSignals).toBe(REPORT_EXCLUDED_NOTICE);
    expect(info.recordedSignals).toContain('리포트 제외를 선택해 표시하지 않아요');
    expect(info.recordedSignals).toContain('측정 데이터는 보관 중');
  });
  it('실제 미측정(사유 없음)·사유 없는 기존 제외 리포트는 기존 문구', () => {
    for (const eeg of [{ status: 'not_measured' }, { status: 'not_measured', excluded: true, notice: 'x' }]) {
      const r = mk(eeg);
      const adapted = adaptReportContent(r.content, 'client');
      expect(adapted.eegExcluded).toBe(false);
      expect(buildReportSessionInfo(r, adapted).recordedSignals).toBe('밴드 측정 없음');
    }
  });
});
