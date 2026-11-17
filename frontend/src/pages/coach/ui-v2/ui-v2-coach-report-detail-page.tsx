// SDD-320 F-2 — 코치 리포트 상세(시안 report-detail.html). PC 2열: 왼쪽 읽기(회원 리포트 서사 본문 재사용) / 오른쪽 코멘트·AI 초안·승인. 모바일은 위아래.
// 승인·코멘트 저장·AI 초안·다시 발송은 기존 ReportDetailView 와 같은 API 함수를 호출한다(approveAndSendReport → getReport, CounselorCommentCard, ReportApprovalStatus).
// 코치용 회차 공통 리포트(type=counselor)는 기존 ReportDetailView 를 그대로 감싸 기능을 보존한다.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppShell from '../../../components/layout/AppShell';
import ReportDetailView from '../../../components/reports/ReportDetailView';
import CounselorCommentCard from '../../../components/reports/CounselorCommentCard';
import ReportApprovalStatus from '../../../components/reports/ReportApprovalStatus';
import DataExportButton from '../../../components/reports/DataExportButton';
import { UploadParticipantNotice } from '../../../components/class/upload-participant-notice';
import { UiV2ReportBody } from '../../../components/ui-v2/ui-v2-report-body';
import { downloadReportPdf } from '../../../lib/report/print-report';
import {
  adaptReportContent,
  approveAndSendReport,
  canApproveReport,
  getReport,
  resendReportEmail,
  resolveReportStatus,
  type ReportDto,
} from '../../../lib/api/reports';
import { REPORT_STATUS_LABELS } from '../../../lib/api/report-status';
import { useAuthStore } from '../../../stores/authStore';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-brand.css';
import '../../../styles/ui-v2-coach-pc.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function commentOf(content: Record<string, unknown> | null | undefined): string | null {
  const value = content?.counselor_comment;
  return typeof value === 'string' && value.trim() ? value : null;
}

/** 승인 버튼 노출 판정 — ReportDetailView 와 같은 규칙(서버 capability 우선, 구 응답은 기존 규칙). */
// eslint-disable-next-line react-refresh/only-export-components -- 순수 함수, 시험에서 직접 검증
export function canShowApprove(report: ReportDto, isCounselorUser: boolean, isStaffUser: boolean, approvedLocally: boolean): boolean {
  if (approvedLocally || !isStaffUser) return false;
  return report.capabilities
    ? report.capabilities.can_approve
    : isCounselorUser && canApproveReport({ status: report.status, sent_at: report.sent_at, alreadyApprovedLocally: approvedLocally });
}

export function UiV2CoachReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true); setLoadError(null);
    getReport(id).then(setReport).catch((e) => setLoadError(e instanceof Error ? e.message : '리포트 조회 실패')).finally(() => setLoading(false));
  }, [id]);

  const back = () => navigate('/reports');
  if (loading) return <AppShell title="한 사람의 변화를 읽어요"><div className="ui-v2 u2f"><p className="u2-empty" role="status">불러오는 중...</p></div></AppShell>;
  if (loadError && !report) {
    return (
      <AppShell title="한 사람의 변화를 읽어요">
        <div className="ui-v2 u2f"><div className="u2-alert" role="alert"><p>{loadError}</p><button type="button" className="u2-secondary u2-gap" onClick={back}>목록으로</button></div></div>
      </AppShell>
    );
  }
  if (!report) return null;

  // 코치용 회차 공통 문서: 기존 상세를 그대로 쓴다(영상·기록지·클래스 리포트 로더 포함).
  if (report.type !== 'client') {
    return (
      <AppShell title="한 사람의 변화를 읽어요">
        <div className="ui-v2 u2f"><div className="u2f-legacy"><ReportDetailView report={report} onReportChange={setReport} error={loadError} showListAction listActionLabel="목록으로" onListAction={back} /></div></div>
      </AppShell>
    );
  }
  return <ClientReportReview report={report} onReportChange={setReport} onBack={back} />;
}

function ClientReportReview({ report, onReportChange, onBack }: { report: ReportDto; onReportChange: (r: ReportDto) => void; onBack: () => void }) {
  const userRole = useAuthStore((s) => s.user?.role);
  const userId = useAuthStore((s) => s.user?.id);
  const isCounselorUser = userRole === 'counselor';
  const isStaffUser = isCounselorUser || userRole === 'org_admin';
  const [current, setCurrent] = useState(report);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [commentDirty, setCommentDirty] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [resendEmail, setResendEmail] = useState(report.report_email ?? '');
  const [resending, setResending] = useState(false);
  const [resendOk, setResendOk] = useState<string | null>(null);
  const [resendErr, setResendErr] = useState<string | null>(null);

  useEffect(() => { setCurrent(report); setResendEmail(report.report_email ?? ''); setApproved(false); setError(null); setResendOk(null); setResendErr(null); }, [report]);
  const update = useCallback((next: ReportDto) => { setCurrent(next); onReportChange(next); }, [onReportChange]);

  const handleApprove = useCallback(async () => {
    if (commentDirty && !window.confirm('저장하지 않은 코멘트가 있습니다. 저장하지 않고 승인할까요?')) return;
    const adaptedNow = adaptReportContent(current.content, current.type);
    const noData = !adaptedNow.eeg && adaptedNow.aiRecord?.status === 'not_available';
    if (current.type === 'client' && noData && !commentOf(current.content) && !window.confirm('이 리포트에는 전달할 내용이 없습니다. 코멘트 없이 승인하시겠습니까?')) return;
    setApproving(true); setError(null);
    try {
      await approveAndSendReport(current.id!);
      setApproved(true);
      update(await getReport(current.id!));
    } catch (e) {
      setError(e instanceof Error ? e.message : '승인 처리 실패');
    } finally {
      setApproving(false);
    }
  }, [current, update, commentDirty]);

  const handlePdf = useCallback(async () => {
    if (printing) return;
    setPrinting(true); setError(null);
    try { await downloadReportPdf({ reportId: current.id! }); }
    catch (e) { setError(e instanceof Error ? e.message : 'PDF 다운로드에 실패했습니다.'); }
    finally { setPrinting(false); }
  }, [printing, current.id]);

  const handleResend = useCallback(async () => {
    const email = resendEmail.trim();
    setResendOk(null); setResendErr(null);
    if (!email || !EMAIL_RE.test(email)) { setResendErr('올바른 이메일 주소를 입력해 주세요.'); return; }
    setResending(true);
    try {
      const res = await resendReportEmail(current.id!, email);
      if (!res.success || !res.sent) { setResendErr(res.message || '메일 발송에 실패했습니다.'); return; }
      setResendOk(res.message || `${email}로 리포트 메일을 발송했습니다.`);
    } catch (e) {
      setResendErr(e instanceof Error ? e.message : '메일 발송에 실패했습니다.');
    } finally {
      setResending(false);
    }
  }, [current.id, resendEmail]);

  const adapted = adaptReportContent(current.content, current.type);
  const pipeline = resolveReportStatus(current);
  const noMeasured = !adapted.eeg && adapted.aiRecord?.status === 'not_available';
  const showCommentEditor = pipeline === 'pending_review' && (current.capabilities ? current.capabilities.can_edit_comment : isCounselorUser);
  const showApprove = canShowApprove(current, isCounselorUser, isStaffUser, approved);
  const showResend = isCounselorUser && current.status === 'completed';
  const path = [current.session_title, current.counselor_name && `담당 ${current.counselor_name}`, current.participant_name].filter(Boolean).join(' › ');

  return (
    <AppShell title="한 사람의 변화를 읽어요">
      <div className="ui-v2 u2f u2f-report">
        <p className="u2f-lead">{path || '회원용 리포트'}</p>
        {error && <div className="u2-alert" role="alert" data-print-exclude><p>{error}</p></div>}
        <div className="u2f-split">
          <article className="u2-card u2f-sheet" aria-label="리포트 읽기">
            <span className="u2f-badge">{REPORT_STATUS_LABELS[pipeline]}</span>
            {isStaffUser && current.participant_id && <div className="u2-gap"><UploadParticipantNotice sessionId={current.session_id} participantId={current.participant_id} /></div>}
            <UiV2ReportBody report={current} hideCounselorComment={showCommentEditor} />
          </article>
          <aside className="u2f-editor" aria-label="코치의 기록">
            <div className="u2-card">
              <span className="u2f-badge">{showCommentEditor ? '1 · 초안 살피기' : '승인 상태'}</span>
              <h2 style={{ marginTop: 12 }}>코치의 기록</h2>
              <p className="u2-muted">초안은 참고 자료예요. 대화 맥락을 살펴 다듬어 주세요.</p>
            </div>
            {showCommentEditor && <div className="u2f-legacy"><CounselorCommentCard report={current} onReportChange={update} showNoDataBanner={noMeasured} noDataExcluded={adapted.eegExcluded} onDirtyChange={setCommentDirty} /></div>}
            {isStaffUser && <div className="u2f-legacy"><ReportApprovalStatus report={current} onChange={update} /></div>}
            <div className="u2-card" data-print-exclude>
              <div className="u2f-actions" style={{ marginTop: 0 }}>
                {showApprove && <button type="button" className="u2-primary" onClick={() => void handleApprove()} disabled={approving}>{approving ? '승인 중...' : '승인하고 발송'}</button>}
                {(isCounselorUser || userRole === 'platform_admin') && userId && current.participant_id && <DataExportButton key={`${current.session_id}:${current.participant_id}:${userId}`} sessionId={current.session_id} participantId={current.participant_id} userId={userId} />}
                {isCounselorUser && current.status === 'completed' && <button type="button" className="u2-secondary" onClick={() => void handlePdf()} disabled={printing} aria-busy={printing}>{printing ? 'PDF 준비 중...' : 'PDF 다운로드'}</button>}
                <button type="button" className="u2-secondary" onClick={onBack}>목록으로</button>
              </div>
              <small>승인과 회원 공개·메일 발송은 별도 상태예요.</small>
            </div>
            {showResend && <div className="u2-card" data-print-exclude>
              <h3>메일 발송</h3>
              <p className="u2-muted">기본 주소는 저장된 리포트 수신 메일이에요. 주소를 확인한 뒤 발송해 주세요.</p>
              <div className="u2f-actions">
                <input type="email" value={resendEmail} onChange={(e) => { setResendEmail(e.target.value); setResendOk(null); setResendErr(null); }} placeholder="수신 이메일 주소" aria-label="발송 이메일" disabled={resending} className="u2f-input" />
                <button type="button" className="u2-primary" onClick={() => void handleResend()} disabled={resending || !resendEmail.trim()}>{resending ? '발송 중...' : '발송'}</button>
              </div>
              {resendOk && <p role="status" className="u2-muted">{resendOk}</p>}
              {resendErr && <p role="alert" className="u2-error">{resendErr}</p>}
            </div>}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
