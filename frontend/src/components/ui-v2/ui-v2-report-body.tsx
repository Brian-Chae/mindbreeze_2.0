// SDD-318 F-B — 회원 리포트 상세 본문(D안 report-detail 구조). 레거시 ClientReportViewer 는 쓰지 않는다.
// 데이터는 기존 ReportDto/adaptReportContent 그대로 사용하고, 서버에 없는 필드(인용문)는 만들지 않고 숨긴다.
import NarrativeSections from '../reports/NarrativeSections';
import SubjectiveCheckinCard from '../reports/SubjectiveCheckinCard';
import { aiRecordUnavailableText, isSttAiRecordVisible } from '../../lib/features';
import { parseSubjectiveState } from '../../lib/api/checkin';
import { buildReportSessionInfo, REPORT_EXCLUDED_NOTICE } from '../../lib/report/session-info';
import { WELLNESS_DISCLAIMER } from '../../lib/legal-copy';
import { NO_BAND_NOTICE } from './ui-v2-report-copy';
import { adaptReportContent, relaxationTrendFromTimeline, type ReportDto } from '../../lib/api/reports';

export function UiV2ReportBody({ report, onClose }: { report: ReportDto; onClose: () => void }) {
  const adapted = adaptReportContent(report.content, 'client');
  const { summary, insights, displayNarrative } = adapted;
  const eeg = adapted.eeg;
  const eegMeasured = adapted.showEegSection && eeg?.status !== 'not_measured';
  const aiRecordUnavailable = adapted.aiRecord?.status === 'not_available';
  const aiVisible = !aiRecordUnavailable && isSttAiRecordVisible();
  const subjective = parseSubjectiveState(report.subjective_state);
  const counselorComment = (report.content?.counselor_comment as string | undefined)?.trim() || null;
  const sessionInfo = buildReportSessionInfo(report, adapted);
  const noBandNotice = adapted.eegExcluded ? REPORT_EXCLUDED_NOTICE : NO_BAND_NOTICE;
  // 착용 시 서사(journey)는 아래 측정 본문(NarrativeSections)이 이미 보여 주므로 여기서 반복하지 않는다.
  const showReflect = !eegMeasured || aiRecordUnavailable;

  return (
    <div className="u2-rp" data-testid="ui-v2-report-body">
      {showReflect && (
        <>
          <span className="u2-rp-sub">함께 돌아보는 시간</span>
          {/* 인용문(quote): 서버에 대응 필드가 없어 만들지 않는다. */}
          {!eegMeasured && <div className="u2-rp-notice" data-testid="report-no-band-notice">{noBandNotice}</div>}
          {aiRecordUnavailable && <div className="u2-rp-notice">{aiRecordUnavailableText(adapted.aiRecord?.reason)}</div>}
        </>
      )}
      {counselorComment && (
        <>
          <h3 className="u2-rp-h">코치 코멘트</h3>
          <p className="u2-rp-text">{counselorComment}</p>
        </>
      )}
      {aiVisible && summary && (
        <>
          <h3 className="u2-rp-h">AI 요약</h3>
          <p className="u2-rp-text">{summary}</p>
          {insights.length > 0 && <ul className="u2-rp-list">{insights.map((item, i) => <li key={i}>{item}</li>)}</ul>}
        </>
      )}
      {subjective && (
        <div className="u2-rp-block">
          <SubjectiveCheckinCard subjective={subjective} relaxationScore={eeg?.metrics?.relaxation_score ?? null} relaxationTrend={relaxationTrendFromTimeline(adapted.eeg_timeline)} eegMeasured={eegMeasured} />
        </div>
      )}
      {eegMeasured && displayNarrative && (
        <div className="u2-rp-block u2-rp-measure"><NarrativeSections narrative={displayNarrative} showCover={false} session={sessionInfo} /></div>
      )}
      <button type="button" className="u2-secondary u2-gap" onClick={onClose}>리포트 닫기</button>
      {/* 측정 본문(NarrativeSections)에 같은 고지가 이미 있으면 반복하지 않는다. */}
      {!(eegMeasured && displayNarrative) && <p className="u2-footnote" style={{ textAlign: 'center' }}>{WELLNESS_DISCLAIMER}</p>}
    </div>
  );
}
