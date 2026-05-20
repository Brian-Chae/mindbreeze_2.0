// 내 가입 신청 목록 페이지

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { ApiError } from '../../lib/api/client';
import { getMyRequests, type JoinRequest, type JoinRequestStatus } from '../../lib/api/org';

const statusLabel: Record<JoinRequestStatus, string> = {
  pending: '대기 중',
  approved: '승인됨',
  rejected: '거절됨',
};

const statusColor: Record<JoinRequestStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export default function MyRequestsPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isInitialized) return;
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    getMyRequests()
      .then(setRequests)
      .catch((err) => setError(err instanceof ApiError ? err.message : '목록을 불러오지 못했습니다'))
      .finally(() => setLoading(false));
  }, [isInitialized, isAuthenticated, navigate]);

  if (!isInitialized || loading) {
    return <div className="min-h-screen bg-surface-canvas p-8 text-sm text-ink-tertiary">로딩 중...</div>;
  }

  return (
    <div className="min-h-screen bg-surface-canvas p-4 sm:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="font-display text-3xl font-light text-ink-primary">내 가입 신청 내역</h1>
          <p className="text-sm text-ink-secondary mt-1">상담센터 가입 신청 현황을 확인하세요</p>
        </div>

        {error && <p className="text-red-500 text-sm" role="alert">{error}</p>}

        {requests.length === 0 ? (
          <div className="rounded-xl border border-border-default bg-surface-raised p-6 text-sm text-ink-tertiary">
            신청 내역이 없습니다.
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-border-default bg-surface-raised p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink-primary break-words">{r.org_name}</p>
                    <p className="text-xs text-ink-tertiary mt-1">신청일: {r.created_at}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${statusColor[r.status]}`}>
                    {statusLabel[r.status]}
                  </span>
                </div>
                {r.status === 'rejected' && r.reason && (
                  <p className="mt-3 text-sm text-ink-secondary border-t border-border-default pt-3">
                    거절 사유: {r.reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
