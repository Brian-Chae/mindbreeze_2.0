// 내담자 상세 페이지와 모달이 공유하는 리포트 본문
import EegQualityBanner from './EegQualityBanner';
import EegMetricsGrid from './EegMetricsGrid';
import EegTimeline from './EegTimeline';
import NarrativeSections from './NarrativeSections';
import ReportCoverSection from './ReportCoverSection';
import SubjectiveCheckinCard from './SubjectiveCheckinCard';
import { ENABLE_STT_AI_RECORD } from '../../lib/features';
import { parseSubjectiveState } from '../../lib/api/checkin';
import { useNotificationStore } from '../../stores/notificationStore';
import {
  adaptReportContent,
  relaxationTrendFromTimeline,
  type ReportDto,
} from '../../lib/api/reports';

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6">
      <h3 className="text-[15px] font-bold text-[#1F1F1F] mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-sm bg-[#5F0080]" />
        {title}
      </h3>
      {children}
    </div>
  );
}

export default function ClientReportViewer({ report, onClose, closeLabel = '닫기' }: {
  report: ReportDto;
  onClose: () => void;
  closeLabel?: string;
}) {
  const showToast = useNotificationStore((s) => s.showToast);
  // 내담자 뷰로 강제 — 라벨·접힘 비대칭
  const adapted = adaptReportContent(report.content, 'client');
  const { summary, insights, displayNarrative } = adapted;
  const eeg = adapted.eeg;
  // SDD-085: 마이크 오프(수동 기록) 세션 — AI 요약 섹션 숨김 + 사유 표기
  const aiRecordUnavailable = adapted.aiRecord?.status === 'not_available';
  const aiRecordReasonText =
    adapted.aiRecord?.reason === 'mic_off'
      ? '이 세션은 마이크를 사용하지 않아 AI 자동 기록(전사·요약)이 제공되지 않습니다.'
      : '이 세션에는 AI 자동 기록(전사·요약)이 없습니다.';
  // SDD-096 — 셀프 체크인(주관 상태): 참여자 스코프 슬롯 + EEG 두뇌휴식도 병기
  const subjective = parseSubjectiveState(report.subjective_state);
  const relaxationScore = eeg?.metrics?.relaxation_score ?? null;
  const relaxationTrend = relaxationTrendFromTimeline(adapted.eeg_timeline);
  const eegMeasured = adapted.showEegSection && eeg?.status !== 'not_measured';

  // SDD-087 — 상담사 코멘트 (내담자에게 전달되는 메시지)
  const counselorComment =
    (report.content?.counselor_comment as string | undefined)?.trim() || null;

  return (
    <div className="bg-[#FAFAFA]">
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Cover — 서사 우선, 종합점수 대형 노출 없음 (SDD-054) */}
        {/* 이중 커버 방지: 커버는 ReportCoverSection이 담당하고 NarrativeSections는 본문만 렌더한다. */}
        <ReportCoverSection report={report} adapted={adapted} />

        {displayNarrative && <NarrativeSections narrative={displayNarrative} showCover={false} />}

        {aiRecordUnavailable && (
          <div className="rounded-2xl border border-[#EFEFEF] bg-white p-5 text-sm text-[#6F6F6F]">
            {aiRecordReasonText}
          </div>
        )}

        {/* SDD-087 — 상담사 코멘트 (있을 때만) */}
        {counselorComment && (
          <SummaryCard title="상담사 코멘트">
            <p className="text-[15px] text-[#1F1F1F] leading-relaxed whitespace-pre-wrap">
              {counselorComment}
            </p>
          </SummaryCard>
        )}

        {/* SDD-096 — 주관 체크인 대비 (밴드 미착용이면 주관 값만) */}
        {subjective && (
          <SubjectiveCheckinCard
            subjective={subjective}
            relaxationScore={relaxationScore}
            relaxationTrend={relaxationTrend}
            eegMeasured={eegMeasured}
          />
        )}

        {!aiRecordUnavailable && ENABLE_STT_AI_RECORD && summary && (
          <SummaryCard title="AI 요약">
            <p className="text-[15px] text-[#1F1F1F] leading-relaxed whitespace-pre-wrap">
              {summary}
            </p>
          </SummaryCard>
        )}

        {!aiRecordUnavailable && ENABLE_STT_AI_RECORD && insights.length > 0 && (
          <SummaryCard title="인사이트 카드">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {insights.map((insight, i) => (
                <div
                  key={i}
                  className="bg-gradient-to-br from-[#F5EDFC] to-white border border-[#EFEFEF] rounded-xl p-4"
                >
                  <div className="text-[12px] text-[#6F6F6F] font-mono mb-1">
                    INSIGHT {String(i + 1).padStart(2, '0')}
                  </div>
                  <p className="text-[15px] text-[#1F1F1F] leading-relaxed">{insight}</p>
                </div>
              ))}
            </div>
          </SummaryCard>
        )}

        {/* EEG — not_measured면 미마운트. 마커는 내담자 미노출 */}
        {adapted.showEegSection && eeg && (
          <div className="space-y-4" data-testid="eeg-section">
            <EegQualityBanner eeg={eeg} reportType="client" />
            {adapted.showEegMetrics && (
              <EegMetricsGrid eeg={eeg} reportType="client" />
            )}
            {adapted.showEegTimeline && (
              <EegTimeline data={adapted.eeg_timeline} dense />
            )}
          </div>
        )}

        <div className="flex items-center gap-3 pt-4 border-t border-[#EFEFEF]">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-white border border-[#EFEFEF] text-[15px] text-[#1F1F1F] hover:bg-[#F5F5F5] transition-colors"
          >
            {closeLabel}
          </button>

          {report.pdf_url ? (
            <a
              href={report.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2.5 rounded-xl bg-white border border-[#EFEFEF] text-[15px] text-[#1F1F1F] hover:bg-[#F5F5F5] transition-colors"
            >
              PDF 다운로드
            </a>
          ) : report.sent_at ? (
            <button
              type="button"
              onClick={() =>
                showToast({
                  id: `pdf-pending-${Date.now()}`,
                  type: 'info',
                  title: 'PDF 준비 중',
                  body: 'PDF 생성 기능은 추후 제공됩니다.',
                })
              }
              className="px-5 py-2.5 rounded-xl bg-white border border-[#EFEFEF] text-[15px] text-[#1F1F1F] hover:bg-[#F5F5F5] transition-colors"
            >
              PDF 생성 (준비 중)
            </button>
          ) : null}
        </div>

        <p className="text-center text-[12px] text-[#9B9B9B] pb-4">
          본 리포트는 의료 진단이 아닌 두뇌건강 관리 목적의 참고 자료입니다.
        </p>
      </div>
    </div>
  );
}
