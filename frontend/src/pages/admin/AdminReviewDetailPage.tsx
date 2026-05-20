// 어드민 검토 상세 페이지

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import {
  getCredentialReview,
  getOrgDocumentReview,
  processReview,
  type ReviewDetailResponse,
  type AuditDto,
} from '../../lib/api/admin';

const DOC_TYPE_LABELS: Record<string, string> = {
  id_card: '신분증',
  license: '면허증',
  diploma: '졸업증명',
  career: '경력증명',
  biz_registration: '사업자등록증',
  corporate_registry: '법인등기부등본',
  tax_cert: '납세증명',
  insurance_cert: '4대보험가입증명',
};

const ACTION_LABELS: Record<string, string> = {
  submitted: '제출',
  approved: '승인',
  rejected: '반려',
  request_more: '추가자료요청',
};

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: '대기중', cls: 'bg-[#FEF3C7] text-[#92400E]' },
    needs_review: { label: '검토필요', cls: 'bg-[#FEE2E2] text-[#991B1B]' },
    approved: { label: '승인', cls: 'bg-[#D1FAE5] text-[#065F46]' },
    rejected: { label: '반려', cls: 'bg-[#FEE2E2] text-[#991B1B]' },
  };
  const m = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${m.cls}`}>
      {m.label}
    </span>
  );
}

function AuditTimeline({ audits }: { audits: AuditDto[] }) {
  if (!audits || audits.length === 0) return null;
  return (
    <div className="border border-[#EFEFEF] rounded-2xl p-6">
      <h3 className="text-[15px] font-bold text-[#1F1F1F] mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[#5F0080]" />
        처리 이력
      </h3>
      <div className="space-y-3">
        {audits.map((a) => (
          <div key={a.id} className="flex gap-3 text-[13px]">
            <div className="w-1.5 h-1.5 rounded-full bg-[#DDDEE7] mt-1.5 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-[#1F1F1F]">
                  {ACTION_LABELS[a.action] ?? a.action}
                </span>
                <span className="text-[11px] text-[#9B9B9B] font-mono">
                  {formatDate(a.created_at)}
                </span>
              </div>
              {a.reason && <div className="text-[#6F6F6F] mt-0.5">{a.reason}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminReviewDetailPage() {
  const { targetType, id } = useParams<{ targetType: string; id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ReviewDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id || !targetType) return;
    const fetch = targetType === 'credential' ? getCredentialReview : getOrgDocumentReview;
    fetch(id)
      .then((d) => setDetail(d))
      .catch((e) => setError(e instanceof Error ? e.message : '상세 조회 실패'))
      .finally(() => setLoading(false));
  }, [id, targetType]);

  const handleAction = useCallback(async () => {
    if (!id || !targetType || !action) return;
    setSubmitting(true);
    setError(null);
    try {
      await processReview(targetType, id, action, reason || undefined);
      // 새로고침
      const fetch = targetType === 'credential' ? getCredentialReview : getOrgDocumentReview;
      const updated = await fetch(id);
      setDetail(updated);
      setAction('');
      setReason('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setSubmitting(false);
    }
  }, [id, targetType, action, reason]);

  // 승인/반려 시 자동 제출
  const handleQuickAction = useCallback(async (act: string) => {
    setAction(act);
    if (!id || !targetType) return;
    setSubmitting(true);
    setError(null);
    try {
      await processReview(targetType, id, act);
      const fetch = targetType === 'credential' ? getCredentialReview : getOrgDocumentReview;
      const updated = await fetch(id);
      setDetail(updated);
      setAction('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setSubmitting(false);
    }
  }, [id, targetType]);

  if (loading) {
    return (
      <AppShell title="검토 상세" sub="ADMIN REVIEW DETAIL">
        <div className="text-[#6F6F6F]">불러오는 중...</div>
      </AppShell>
    );
  }

  if (error && !detail) {
    return (
      <AppShell title="검토 상세" sub="ADMIN REVIEW DETAIL">
        <div className="p-4 rounded-xl bg-red-50 text-red-700 text-sm mb-4">{error}</div>
        <button
          onClick={() => navigate('/admin/reviews')}
          className="mb-btn mb-btn-secondary text-[14px] px-5 py-2.5 rounded-xl"
        >
          목록으로
        </button>
      </AppShell>
    );
  }

  if (!detail) return null;

  const isPending = detail.status === 'pending' || detail.status === 'needs_review';
  const verdict = detail.ai_verdict as Record<string, unknown> | null;
  const extractedFields = verdict?.extracted_fields as Record<string, string> | null;
  const forgerySignals = verdict?.forgery_signals as string[] | null;
  const recommendation = verdict?.recommendation as string | null;
  const publicApiMatch = verdict?.public_api_match as boolean | null;

  return (
    <AppShell title="검토 상세" sub="ADMIN REVIEW DETAIL">
      <div className="max-w-5xl mx-auto space-y-6">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 좌측: 기본 정보 */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#F5EDFC] text-[#5F0080]">
                  {DOC_TYPE_LABELS[detail.document_type] ?? detail.document_type}
                </span>
                <StatusBadge status={detail.status} />
              </div>
              <div className="font-bold text-[17px] text-[#1F1F1F] mb-1">
                {detail.submitter_name ?? '이름 없음'}
              </div>
              <div className="text-[13px] text-[#6F6F6F] mb-3">
                {detail.submitter_email ?? ''}
              </div>
              <div className="text-[12px] text-[#9B9B9B] font-mono">
                접수: {formatDate(detail.created_at)}
              </div>
            </div>

            {/* 원본 뷰어 */}
            {detail.s3_key && (
              <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6">
                <h3 className="text-[14px] font-bold text-[#1F1F1F] mb-3">원본 증빙</h3>
                <div className="bg-[#F8FAFC] rounded-xl p-4 text-center border border-[#EFEFEF]">
                  <div className="text-[12px] text-[#6F6F6F] font-mono break-all mb-2">
                    {detail.file_name ?? detail.s3_key}
                  </div>
                  <div className="text-[11px] text-[#9B9B9B]">
                    S3 Key: {detail.s3_key.substring(0, 40)}...
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 우측: AI 분석 */}
          <div className="lg:col-span-2 space-y-4">
            {/* AI 검증 결과 */}
            {verdict && (
              <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6">
                <h3 className="text-[15px] font-bold text-[#1F1F1F] mb-4 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#5F0080]" />
                  AI 검증 결과
                </h3>

                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-[#F8FAFC] rounded-xl p-3 text-center border border-[#EFEFEF]">
                    <div className="text-[11px] text-[#6F6F6F] font-mono uppercase mb-1">위험도</div>
                    <div className="text-[20px] font-bold text-[#EF4444]">
                      {((detail.risk_score ?? 0) * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="bg-[#F8FAFC] rounded-xl p-3 text-center border border-[#EFEFEF]">
                    <div className="text-[11px] text-[#6F6F6F] font-mono uppercase mb-1">공공API</div>
                    <div className="text-[20px] font-bold text-[#10B981]">
                      {publicApiMatch === true ? '일치' : publicApiMatch === false ? '불일치' : '-'}
                    </div>
                  </div>
                  <div className="bg-[#F8FAFC] rounded-xl p-3 text-center border border-[#EFEFEF]">
                    <div className="text-[11px] text-[#6F6F6F] font-mono uppercase mb-1">권장판정</div>
                    <div className="text-[15px] font-bold text-[#5F0080]">
                      {recommendation ?? '-'}
                    </div>
                  </div>
                </div>

                {/* 추출 필드 */}
                {extractedFields && Object.keys(extractedFields).length > 0 && (
                  <div className="mb-4">
                    <div className="text-[12px] font-bold text-[#6F6F6F] mb-2">추출 정보</div>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(extractedFields).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between py-1.5 px-3 bg-[#F5EDFC] rounded-lg text-[13px]">
                          <span className="text-[#6F6F6F]">{k}</span>
                          <span className="font-medium text-[#1F1F1F]">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 위변조 신호 */}
                {forgerySignals && forgerySignals.length > 0 && (
                  <div>
                    <div className="text-[12px] font-bold text-[#EF4444] mb-2">위변조 신호</div>
                    <div className="space-y-1">
                      {forgerySignals.map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-[13px] text-[#991B1B] bg-red-50 rounded-lg px-3 py-1.5">
                          <span className="text-[11px]">⚠️</span>
                          {s}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 액션 버튼 - 대기 중일 때만 */}
            {isPending && (
              <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6">
                <h3 className="text-[15px] font-bold text-[#1F1F1F] mb-4 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#5F0080]" />
                  검토 처리
                </h3>

                <div className="flex items-center gap-3 mb-4">
                  <button
                    onClick={() => handleQuickAction('approve')}
                    disabled={submitting}
                    className="mb-btn mb-btn-primary text-[14px] px-6 py-2.5 rounded-xl disabled:opacity-50"
                  >
                    {submitting && action === 'approve' ? '처리 중...' : '승인'}
                  </button>
                  <button
                    onClick={() => handleQuickAction('reject')}
                    disabled={submitting}
                    className="px-6 py-2.5 rounded-xl text-[14px] font-medium border border-[#EF4444] text-[#EF4444] hover:bg-red-50 disabled:opacity-50"
                  >
                    {submitting && action === 'reject' ? '처리 중...' : '반려'}
                  </button>
                  <button
                    onClick={() => setAction('request_more')}
                    className="px-6 py-2.5 rounded-xl text-[14px] font-medium border border-[#EFEFEF] text-[#6F6F6F] hover:bg-gray-50"
                  >
                    추가 자료 요청
                  </button>
                </div>

                {/* 사유 입력 (반려/추가자료 시) */}
                {(action === 'reject' || action === 'request_more') && (
                  <div className="space-y-3">
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="처리 사유를 입력하세요..."
                      rows={3}
                      className="w-full rounded-xl border border-[#EFEFEF] px-4 py-3 text-[14px] resize-none focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20"
                    />
                    <button
                      onClick={handleAction}
                      disabled={submitting || !reason.trim()}
                      className="mb-btn mb-btn-primary text-[14px] px-5 py-2 rounded-xl disabled:opacity-50"
                    >
                      {submitting ? '처리 중...' : '확인'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 처리 이력 */}
            <AuditTimeline audits={detail.audits ?? []} />
          </div>
        </div>

        {/* 목록으로 */}
        <div className="pt-4 border-t border-[#EFEFEF]">
          <button
            onClick={() => navigate('/admin/reviews')}
            className="mb-btn mb-btn-secondary text-[14px] px-5 py-2.5 rounded-xl"
          >
            목록으로
          </button>
        </div>
      </div>
    </AppShell>
  );
}
