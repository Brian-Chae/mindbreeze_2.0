// SDD-318 F-B/F-E — 회원 리포트 상세 본문(확정 시안 v3e). 레거시 ClientReportViewer 는 쓰지 않는다.
// 데이터는 기존 ReportDto/adaptReportContent 그대로 사용한다. 측정 본문은 UiV2ReportMeasure(레거시 NarrativeSections 미사용).
// 섹션 순서: 나의 명상(커버+인용) → 종합 여정 → 몸 → 마음 → 마무리 → 코치 코멘트 → 셀프 체크인 → AI 요약 → 인사이트.
import SubjectiveCheckinCard from '../reports/SubjectiveCheckinCard';
import { aiRecordUnavailableText, isSttAiRecordVisible } from '../../lib/features';
import { parseSubjectiveState } from '../../lib/api/checkin';
import { REPORT_EXCLUDED_NOTICE, buildReportSessionInfo } from '../../lib/report/session-info';
import { WELLNESS_DISCLAIMER } from '../../lib/legal-copy';
import { NO_BAND_NOTICE, readReportQuote } from './ui-v2-report-copy';
import { UiV2ReportMeasure } from './ui-v2-report-measure';
import { adaptReportContent, relaxationTrendFromTimeline, type ReportDto } from '../../lib/api/reports';
import '../../styles/ui-v2-report-v3.css';

interface RailItem { id: string; num: string; label: string }

export function UiV2ReportBody({ report, onClose, hideCounselorComment = false, showRail = false }: { report: ReportDto; onClose?: () => void; hideCounselorComment?: boolean; showRail?: boolean }) {
  const adapted = adaptReportContent(report.content, 'client');
  const { summary, insights, displayNarrative } = adapted;
  const eeg = adapted.eeg;
  const eegMeasured = adapted.showEegSection && eeg?.status !== 'not_measured';
  const aiRecordUnavailable = adapted.aiRecord?.status === 'not_available';
  const aiVisible = !aiRecordUnavailable && isSttAiRecordVisible();
  const subjective = parseSubjectiveState(report.subjective_state);
  const counselorComment = hideCounselorComment ? null : (report.content?.counselor_comment as string | undefined)?.trim() || null;
  const quote = readReportQuote(report.content);
  const noBandNotice = adapted.eegExcluded ? REPORT_EXCLUDED_NOTICE : NO_BAND_NOTICE;
  const info = buildReportSessionInfo(report, adapted);
  const showMeasure = eegMeasured && !!displayNarrative;
  const showAi = aiVisible && !!summary;

  const rail: RailItem[] = [{ id: 'u2r3-cover', num: '01', label: '나의 명상' }];
  if (showMeasure) {
    rail.push({ id: 'u2r3-journey', num: '02', label: '종합 여정' });
    if (displayNarrative.body.length > 0 || displayNarrative.bodyText) rail.push({ id: 'u2r3-body', num: '03', label: '몸의 변화' });
    if (displayNarrative.mind.length > 0 || displayNarrative.mindText) rail.push({ id: 'u2r3-mind', num: '04', label: '마음의 변화' });
    rail.push({ id: 'u2r3-closing', num: '05', label: '마무리' });
  }
  if (counselorComment) rail.push({ id: 'u2r3-coach', num: '', label: '코치 코멘트' });
  if (showAi) rail.push({ id: 'u2r3-ai', num: '', label: 'AI 요약' });

  const go = (id: string) => (event: { preventDefault: () => void }) => {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  };

  return (
    <div className={`u2r3 u2-rp${showRail ? ' u2r3--rail' : ''}`} data-testid="ui-v2-report-body">
      {showRail && (
        <aside className="u2r3-rail" aria-label="리포트 탐색">
          <div className="u2r3-eyebrow">오늘의 명상 기록</div>
          <nav>{rail.map((r) => <a key={r.id} href={`#${r.id}`} onClick={go(r.id)}>{r.num && <span>{r.num}</span>}{r.label}</a>)}</nav>
          <small>나를 알아가는 시간,<br />그 작은 변화를 기록해요.<br /><br />{info.shortDate ?? ''}{info.durationMinutes ? <><br />{info.durationMinutes}분 호흡 명상</> : null}</small>
        </aside>
      )}
      <div className="u2r3-main">
        <section id="u2r3-cover" className="u2r3-section u2r3-cover" data-section="cover">
          <div className="u2r3-eyebrow">01 · 나의 명상</div>
          <div className="u2r3-meta">
            {info.dateLabel && <span>{info.dateLabel}</span>}
            {info.timeLabel && <span>{info.timeLabel}</span>}
            {info.className && <span>{info.className}</span>}
          </div>
          {quote && <blockquote className="u2r3-quote" data-testid="report-quote">{quote}</blockquote>}
          {!eegMeasured && <div className="u2r3-notice" data-testid="report-no-band-notice">{noBandNotice}</div>}
          {aiRecordUnavailable && <div className="u2r3-notice">{aiRecordUnavailableText(adapted.aiRecord?.reason)}</div>}
        </section>

        {showMeasure && <UiV2ReportMeasure narrative={displayNarrative} durationMinutes={info.durationMinutes} />}

        {counselorComment && (
          <section id="u2r3-coach" className="u2r3-section" data-section="coach">
            <div className="u2r3-eyebrow">함께 돌아보는 시간</div>
            <h2>코치 코멘트</h2>
            <p className="u2r3-text">{counselorComment}</p>
          </section>
        )}

        {subjective && (
          <section className="u2r3-section" data-section="checkin">
            <SubjectiveCheckinCard subjective={subjective} relaxationScore={eeg?.metrics?.relaxation_score ?? null} relaxationTrend={relaxationTrendFromTimeline(adapted.eeg_timeline)} eegMeasured={eegMeasured} />
          </section>
        )}

        {showAi && (
          <section id="u2r3-ai" className="u2r3-section" data-section="ai">
            <div className="u2r3-eyebrow">대화에서 남긴 기록</div>
            <h2>AI 요약</h2>
            <p className="u2r3-text">{summary}</p>
            {insights.length > 0 && (
              <div className="u2r3-insights" data-testid="report-insights">
                <h3>인사이트</h3>
                <ul>{insights.map((item, i) => <li key={i}>{item}</li>)}</ul>
              </div>
            )}
          </section>
        )}

        <div className="u2r3-foot">
          {onClose && <button type="button" className="u2r3-back" onClick={onClose}>리포트 닫기</button>}
          <p className="u2-footnote" style={{ textAlign: 'center' }}>{WELLNESS_DISCLAIMER}</p>
        </div>
      </div>
    </div>
  );
}
