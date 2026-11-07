// SDD-321 — 내 가입 신청 내역 D안. 기존 MyRequestsPage 와 같은 API·리다이렉트·상태 문구를 그대로 쓴다.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../../stores/authStore';
import { ApiError } from '../../../lib/api/client';
import { getMyRequests, type JoinRequest, type JoinRequestStatus } from '../../../lib/api/org';
import { Pill, type PillTone } from './ui-v2-org-parts';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-brand.css';
import '../../../styles/ui-v2-org.css';

const STATUS_LABEL: Record<JoinRequestStatus, string> = {
  pending: '대기 중',
  approved: '승인됨',
  rejected: '거절됨',
};

const STATUS_TONE: Record<JoinRequestStatus, PillTone> = {
  pending: 'warn',
  approved: 'ok',
  rejected: 'danger',
};

// ISO 원문 노출 방지 — ko-KR 날짜로 포맷하고, 유효하지 않으면 '-'로 표시한다.
function formatCreatedAt(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('ko-KR');
}

export function UiV2OrgRequestsPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isInitialized) return;
    if (!isAuthenticated) {
      navigate('/login?role=counselor');
      return;
    }
    getMyRequests()
      .then(setRequests)
      .catch((err) => setError(err instanceof ApiError ? err.message : '목록을 불러오지 못했습니다'))
      .finally(() => setLoading(false));
  }, [isInitialized, isAuthenticated, navigate]);

  if (!isInitialized || loading) {
    return <div className="ui-v2 u2-org-page"><div role="status" className="u2-org-loading">로딩 중...</div></div>;
  }

  return (
    <div className="ui-v2 u2-org-page">
      <div className="u2-org-page-inner">
        <header>
          <h1>내 가입 신청 내역</h1>
          <p>상담센터 가입 신청 현황을 확인하세요</p>
        </header>

        {error && <p className="u2-org-error" role="alert">{error}</p>}

        {requests.length === 0 ? (
          <div className="u2-org-empty">신청 내역이 없습니다.</div>
        ) : (
          <div className="u2-org-cards">
            {requests.map((r) => (
              <div key={r.id} className="u2-org-card">
                <div className="u2-org-reqtop">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="u2-setstrong" style={{ overflowWrap: 'anywhere' }}>{r.org_name}</p>
                    <p className="u2-muted" style={{ fontSize: 13, marginTop: 4 }}>신청일: {formatCreatedAt(r.created_at)}</p>
                  </div>
                  <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
                </div>
                {r.status === 'rejected' && r.reason && (
                  <p className="u2-muted" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--u2-line)', fontSize: 14 }}>
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
