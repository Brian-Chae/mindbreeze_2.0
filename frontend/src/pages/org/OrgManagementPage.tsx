// 상담센터 관리 페이지 (org_admin)

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { ApiError } from '../../lib/api/client';
import {
  getOrg,
  listCounselors,
  updateCounselor,
  removeCounselor,
  type Org,
  type CounselorItem,
  type CounselorRole,
} from '../../lib/api/org';

export default function OrgManagementPage() {
  const { org_id: orgId } = useParams<{ org_id: string }>();
  const user = useAuthStore((s) => s.user);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  const [org, setOrg] = useState<Org | null>(null);
  const [counselors, setCounselors] = useState<CounselorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  // org_admin 가드는 백엔드에서 강제됨. 프런트에서는 안내만.
  // org_admin 가드는 백엔드에서 강제됨. UserRole 타입에 'org_admin'이 아직 없어 문자열 비교로 처리.
  const role = (user?.role ?? '') as string;
  const isOrgAdmin = role === 'org_admin' || role === 'counselor';

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    Promise.all([
      getOrg(orgId),
      listCounselors(orgId).catch(() => [] as CounselorItem[]),
    ])
      .then(([o, c]) => {
        setOrg(o);
        setCounselors(c);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : '센터 정보를 불러오지 못했습니다');
      })
      .finally(() => setLoading(false));
  }, [orgId]);

  const handleRoleChange = async (userId: string, role: CounselorRole) => {
    if (!orgId) return;
    setBusyUser(userId);
    try {
      const updated = await updateCounselor(orgId, userId, { role });
      setCounselors((prev) => prev.map((c) => (c.id === userId ? updated : c)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '권한 변경 실패');
    } finally {
      setBusyUser(null);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!orgId) return;
    if (!confirm('소속을 해제하시겠습니까?')) return;
    setBusyUser(userId);
    try {
      await removeCounselor(orgId, userId);
      setCounselors((prev) => prev.filter((c) => c.id !== userId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '소속 해제 실패');
    } finally {
      setBusyUser(null);
    }
  };

  if (!isInitialized || loading) {
    return (
      <div className="min-h-screen bg-surface-canvas p-8 text-sm text-ink-tertiary">로딩 중...</div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-canvas p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="font-display text-3xl font-light text-ink-primary">상담센터 관리</h1>
          <p className="text-sm text-ink-secondary mt-1">{org?.name}</p>
        </div>

        {error && <p className="text-red-500 text-sm" role="alert">{error}</p>}

        {!isOrgAdmin && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm">
            관리자 권한이 없습니다. 일부 기능이 제한될 수 있습니다.
          </div>
        )}

        {/* 가입 요청 관리 */}
        <section className="rounded-xl border border-border-default bg-surface-raised p-6 space-y-3">
          <h2 className="text-lg font-medium text-ink-primary">가입 요청 관리</h2>
          <p className="text-sm text-ink-tertiary">
            가입 요청 목록 API 추가 예정 — 본 섹션의 UI는 API 연동 시 활성화됩니다.
          </p>
        </section>

        {/* 소속 상담사 */}
        <section className="rounded-xl border border-border-default bg-surface-raised p-6 space-y-4">
          <h2 className="text-lg font-medium text-ink-primary">소속 상담사 ({counselors.length}명)</h2>
          {counselors.length === 0 ? (
            <p className="text-sm text-ink-tertiary">아직 소속된 상담사가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {counselors.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border-default"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-primary truncate">{c.name}</p>
                    <p className="text-xs text-ink-tertiary truncate">{c.email}</p>
                  </div>
                  <select
                    value={c.role}
                    onChange={(e) => handleRoleChange(c.id, e.target.value as CounselorRole)}
                    disabled={busyUser === c.id}
                    className="h-9 px-3 rounded-lg bg-surface-canvas border border-border-default text-sm text-ink-primary"
                  >
                    <option value="counselor">상담사</option>
                    <option value="org_admin">관리자</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handleRemove(c.id)}
                    disabled={busyUser === c.id}
                    className="h-9 px-3 rounded-pill border border-border-default text-sm text-ink-secondary hover:text-red-500 hover:border-red-500"
                  >
                    소속 해제
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 센터 정보 */}
        {org && (
          <section className="rounded-xl border border-border-default bg-surface-raised p-6 space-y-3">
            <h2 className="text-lg font-medium text-ink-primary">센터 정보</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {[
                ['센터명', org.name],
                ['대표자명', org.ceo_name],
                ['사업자등록번호', org.biz_number],
                ['주소', org.address],
                ['전화번호', org.phone],
                ['인증 여부', org.verified ? `인증 완료 (${org.verified_at ?? ''})` : '미인증'],
                ['등록일', org.created_at],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-ink-tertiary text-xs">{k}</dt>
                  <dd className="text-ink-primary mt-0.5">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}
