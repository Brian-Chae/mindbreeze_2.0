// 어드민 검토 큐 목록 페이지

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import { listReviews, type ReviewItemDto } from '../../lib/api/admin';

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

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function RiskBadge({ score }: { score: number }) {
  let color: string;
  let label: string;
  if (score >= 0.7) {
    color = 'bg-red-50 text-red-700';
    label = '고위험';
  } else if (score >= 0.3) {
    color = 'bg-yellow-50 text-yellow-700';
    label = '중간';
  } else {
    color = 'bg-green-50 text-green-700';
    label = '저위험';
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold font-mono ${color}`}>
      {label} {(score * 100).toFixed(0)}%
    </span>
  );
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

export default function AdminReviewListPage() {
  const [items, setItems] = useState<ReviewItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [docType, setDocType] = useState('');
  const [page, setPage] = useState(1);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page, size: 20 };
      if (docType) params.document_type = docType;
      const res = await listReviews(params as { document_type?: string; page?: number; size?: number });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '검토 큐 조회 실패');
    } finally {
      setLoading(false);
    }
  }, [page, docType]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <AppShell title="검토 큐" sub="ADMIN REVIEW QUEUE">
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {/* 필터 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        <select
          value={docType}
          onChange={(e) => { setDocType(e.target.value); setPage(1); }}
          className="rounded-xl border border-[#EFEFEF] px-3 py-2 text-[13px] text-[#1F1F1F] bg-white"
        >
          <option value="">전체 유형</option>
          {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <span className="text-[13px] text-[#6F6F6F]">총 {total}건</span>
      </div>

      {loading ? (
        <div className="text-[#6F6F6F]">불러오는 중...</div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-[#DDDEE7] rounded-2xl p-12 text-center">
          <div className="text-[#6F6F6F] text-sm">검토 대기 중인 문서가 없습니다.</div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {items.map((item) => (
              <Link
                key={item.id}
                to={`/admin/reviews/${item.target_type}/${item.id}`}
                className="block bg-white border border-[#EFEFEF] rounded-2xl p-5 hover:shadow-md hover:border-[#5F0080]/30 transition-all"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#F5EDFC] text-[#5F0080]">
                      {item.target_type === 'credential' ? '자격증빙' : '센터문서'}
                    </span>
                    <span className="text-[12px] text-[#6F6F6F] font-mono">
                      {DOC_TYPE_LABELS[item.document_type] ?? item.document_type}
                    </span>
                  </div>
                  <StatusBadge status={item.status} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-[15px] text-[#1F1F1F] mb-1">
                      {item.submitter_name ?? '이름 없음'}
                    </div>
                    <div className="text-[12px] text-[#6F6F6F]">
                      {item.submitter_email ?? ''}
                    </div>
                  </div>
                  <RiskBadge score={item.risk_score} />
                </div>

                <div className="text-[11px] text-[#9B9B9B] font-mono mt-3">
                  접수: {formatDate(item.created_at)}
                </div>
              </Link>
            ))}
          </div>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg text-[13px] border border-[#EFEFEF] disabled:opacity-30"
              >
                이전
              </button>
              <span className="text-[13px] text-[#6F6F6F]">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg text-[13px] border border-[#EFEFEF] disabled:opacity-30"
              >
                다음
              </button>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
