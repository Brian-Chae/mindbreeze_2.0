// 플랫폼 관리자 — 가입 신청(기관 상담 / 개인 상담사) 관리 (SDD-073)

import { useCallback, useEffect, useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import {
  approveSignupApplication,
  getSignupApplication,
  listSignupApplications,
  rejectSignupApplication,
  resendSignupApplicationNotice,
  type SignupApplicationDetailDto,
  type SignupApplicationDto,
} from '../../lib/api/admin';

const TYPE_LABELS: Record<string, string> = {
  organization: '기관 가입 상담',
  individual_counselor: '개인 상담사',
};

const STATUS_LABELS: Record<string, string> = {
  submitted: '접수',
  reviewing: '검토 중',
  approved: '승인',
  rejected: '반려',
  withdrawn: '철회',
};

const NOTIFY_LABELS: Record<string, string> = {
  pending: '발송 대기',
  queued: '큐 적재',
  sent: '발송 완료',
  failed: '발송 실패',
};

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    submitted: 'bg-[#E0F2FE] text-[#075985]',
    reviewing: 'bg-[#FEF3C7] text-[#92400E]',
    approved: 'bg-[#D1FAE5] text-[#065F46]',
    rejected: 'bg-[#FEE2E2] text-[#991B1B]',
    withdrawn: 'bg-[#F3F4F6] text-[#4B5563]',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${styles[status] ?? 'bg-[#F3F4F6] text-[#4B5563]'}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function SignupApplicationsPage() {
  const [items, setItems] = useState<SignupApplicationDto[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<SignupApplicationDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listSignupApplications({
        application_type: typeFilter || undefined,
        status: statusFilter || undefined,
        size: 50,
      });
      setItems(res.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '신청 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setMessage(null);
    setRejectReason('');
    try {
      setDetail(await getSignupApplication(id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '신청 상세를 불러오지 못했습니다.');
    } finally {
      setDetailLoading(false);
    }
  };

  const runAction = async (
    action: () => Promise<{ application: SignupApplicationDetailDto; invite_sent: boolean }>,
    successMessage: (inviteSent: boolean) => string,
  ) => {
    setActionLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await action();
      setDetail(res.application);
      setMessage(successMessage(res.invite_sent));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '처리에 실패했습니다.');
    } finally {
      setActionLoading(false);
    }
  };

  const canReview = detail && (detail.status === 'submitted' || detail.status === 'reviewing');

  return (
    <AppShell title="가입 신청 관리" sub="SIGNUP APPLICATIONS">
      {error && (
        <div role="alert" className="mb-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="mb-5 rounded-xl bg-[#F5EDFC] p-3 text-sm text-[#5F0080]">
          {message}
        </div>
      )}

      <section className="mb-5 flex flex-wrap items-center gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-xl border border-[#EFEFEF] bg-white px-3 py-2 text-[13px]"
        >
          <option value="">전체 유형</option>
          <option value="organization">기관 가입 상담</option>
          <option value="individual_counselor">개인 상담사</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-[#EFEFEF] bg-white px-3 py-2 text-[13px]"
        >
          <option value="">전체 상태</option>
          <option value="submitted">접수</option>
          <option value="reviewing">검토 중</option>
          <option value="approved">승인</option>
          <option value="rejected">반려</option>
        </select>
        <span className="ml-auto text-[13px] text-[#6F6F6F]">총 {items.length}건</span>
      </section>

      {loading ? (
        <div className="rounded-2xl border border-[#EFEFEF] p-10 text-center text-sm text-[#6F6F6F]">
          신청 목록을 불러오는 중...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#DDDEE7] p-10 text-center text-sm text-[#6F6F6F]">
          접수된 신청이 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#EFEFEF] bg-white">
          <table className="min-w-[860px] w-full text-left text-[14px]">
            <thead>
              <tr className="border-b border-[#EFEFEF] bg-[#F8FAFC]">
                <th className="px-5 py-3 text-[12px] font-mono font-normal uppercase tracking-wider text-[#6F6F6F]">유형</th>
                <th className="px-5 py-3 text-[12px] font-mono font-normal uppercase tracking-wider text-[#6F6F6F]">기관/활동명</th>
                <th className="px-5 py-3 text-[12px] font-mono font-normal uppercase tracking-wider text-[#6F6F6F]">신청자</th>
                <th className="px-5 py-3 text-[12px] font-mono font-normal uppercase tracking-wider text-[#6F6F6F]">이메일</th>
                <th className="px-5 py-3 text-[12px] font-mono font-normal uppercase tracking-wider text-[#6F6F6F]">상태</th>
                <th className="px-5 py-3 text-[12px] font-mono font-normal uppercase tracking-wider text-[#6F6F6F]">알림</th>
                <th className="px-5 py-3 text-[12px] font-mono font-normal uppercase tracking-wider text-[#6F6F6F]">접수일</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => void openDetail(item.id)}
                  className={`cursor-pointer border-b border-[#EFEFEF] last:border-0 hover:bg-[#F8FAFC] ${detail?.id === item.id ? 'bg-[#F5EDFC]' : ''}`}
                >
                  <td className="px-5 py-4 text-[#1F1F1F]">{TYPE_LABELS[item.application_type]}</td>
                  <td className="px-5 py-4 font-semibold text-[#1F1F1F]">{item.organization_name}</td>
                  <td className="px-5 py-4 text-[#6F6F6F]">{item.contact_name}</td>
                  <td className="px-5 py-4 text-[#6F6F6F]">{item.email}</td>
                  <td className="px-5 py-4"><StatusBadge status={item.status} /></td>
                  <td className="px-5 py-4 text-[12px] text-[#6F6F6F]">{NOTIFY_LABELS[item.notify_status] ?? item.notify_status}</td>
                  <td className="px-5 py-4 font-mono text-[12px] text-[#9B9B9B]">{formatDateTime(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailLoading && (
        <div className="mt-6 rounded-2xl border border-[#EFEFEF] p-6 text-center text-sm text-[#6F6F6F]">
          상세를 불러오는 중...
        </div>
      )}

      {detail && !detailLoading && (
        <section className="mt-6 rounded-2xl border border-[#EFEFEF] bg-white p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-bold text-[#1F1F1F]">
                {TYPE_LABELS[detail.application_type]} — {detail.organization_name}
              </h2>
              <p className="mt-1 text-[12px] font-mono text-[#9B9B9B]">신청 ID: {detail.id}</p>
            </div>
            <StatusBadge status={detail.status} />
          </div>

          <dl className="mt-4 grid gap-x-8 gap-y-2 text-[14px] md:grid-cols-2">
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-[#6F6F6F]">신청자</dt><dd className="text-[#1F1F1F]">{detail.contact_name}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-[#6F6F6F]">이메일</dt><dd className="text-[#1F1F1F]">{detail.email}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-[#6F6F6F]">전화번호</dt><dd className="text-[#1F1F1F]">{detail.phone ?? '미입력'}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-[#6F6F6F]">접수일</dt><dd className="text-[#1F1F1F]">{formatDateTime(detail.created_at)}</dd></div>
            {detail.specialties && (
              <div className="flex gap-2"><dt className="w-24 shrink-0 text-[#6F6F6F]">전문 분야</dt><dd className="text-[#1F1F1F]">{detail.specialties}</dd></div>
            )}
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-[#6F6F6F]">알림 상태</dt>
              <dd className="text-[#1F1F1F]">
                {NOTIFY_LABELS[detail.notify_status] ?? detail.notify_status}
                {detail.notified_at ? ` (${formatDateTime(detail.notified_at)})` : ''}
              </dd>
            </div>
            {detail.reviewed_at && (
              <div className="flex gap-2"><dt className="w-24 shrink-0 text-[#6F6F6F]">검토일</dt><dd className="text-[#1F1F1F]">{formatDateTime(detail.reviewed_at)}</dd></div>
            )}
            {detail.review_note && (
              <div className="flex gap-2 md:col-span-2"><dt className="w-24 shrink-0 text-[#6F6F6F]">검토 메모</dt><dd className="text-[#1F1F1F]">{detail.review_note}</dd></div>
            )}
            {detail.inquiry && (
              <div className="flex gap-2 md:col-span-2"><dt className="w-24 shrink-0 text-[#6F6F6F]">문의 내용</dt><dd className="whitespace-pre-wrap text-[#1F1F1F]">{detail.inquiry}</dd></div>
            )}
          </dl>

          {detail.application_type === 'individual_counselor' && canReview && (
            <p className="mt-4 rounded-xl bg-[#F5EDFC] p-3 text-[13px] text-[#5F0080]">
              승인하면 개인 상담사 계정이 바로 활성화되고, 신청자에게 비밀번호 설정(초대) 메일이 발송됩니다.
            </p>
          )}
          {detail.application_type === 'organization' && canReview && (
            <p className="mt-4 rounded-xl bg-[#F5EDFC] p-3 text-[13px] text-[#5F0080]">
              승인은 검토 통과 기록입니다. 기관·담당자 생성은 [기관 관리]의 기관 등록으로 진행하세요.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {canReview && (
              <>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() =>
                    void runAction(
                      () => approveSignupApplication(detail.id),
                      (inviteSent) =>
                        detail.application_type === 'individual_counselor'
                          ? `승인 완료 — 초대 메일 ${inviteSent ? '발송됨' : '발송 실패(재발송 필요)'}`
                          : '승인 완료 — 기관 등록은 기관 관리에서 진행하세요.',
                    )
                  }
                  className="rounded-xl bg-[#5F0080] px-5 py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-[#4B0066] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionLoading ? '처리 중...' : '승인'}
                </button>
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="반려 사유 (선택)"
                  maxLength={1000}
                  className="w-56 rounded-xl border border-[#EFEFEF] px-3 py-2.5 text-[13px]"
                />
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() =>
                    void runAction(
                      () => rejectSignupApplication(detail.id, rejectReason.trim() || undefined),
                      () => '반려 처리되었습니다.',
                    )
                  }
                  className="rounded-xl border border-[#FCA5A5] bg-white px-5 py-2.5 text-[14px] font-bold text-[#B91C1C] transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  반려
                </button>
              </>
            )}
            {(detail.notify_status === 'pending' || detail.notify_status === 'failed') && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() =>
                  void runAction(
                    () => resendSignupApplicationNotice(detail.id),
                    () => '운영 알림 재발송을 요청했습니다.',
                  )
                }
                className="rounded-lg border border-[#C9B0E8] bg-white px-3 py-2 text-[13px] font-semibold text-[#5F0080] transition-colors hover:bg-[#EFE3FA] disabled:cursor-not-allowed disabled:opacity-60"
              >
                알림 재발송
              </button>
            )}
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="ml-auto rounded-lg px-3 py-2 text-[13px] text-[#6F6F6F] hover:bg-[#F8FAFC]"
            >
              닫기
            </button>
          </div>
        </section>
      )}
    </AppShell>
  );
}
