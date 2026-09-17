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
import {
  getOrgCounselorProfile,
  patchOrgCounselorProfile,
} from '../../lib/api/counselor-info';
import CounselorInfoEditor from '../../components/counselor/counselor-info-editor';

export default function OrgManagementPage() {
  const { org_id: orgId } = useParams<{ org_id: string }>();
  const user = useAuthStore((s) => s.user);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  const [org, setOrg] = useState<Org | null>(null);
  const [counselors, setCounselors] = useState<CounselorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  // SDD-077: 상담사 정보 수정 (성별/생년월일/전화/주소 포함 — 정책 확정)
  const [editingUser, setEditingUser] = useState<CounselorItem | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

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

  const filteredCounselors = counselors.filter((c) =>
    [c.name, c.email].some((value) => value.toLowerCase().includes(query.trim().toLowerCase()))
    && (!statusFilter || (c.status ?? 'active') === statusFilter),
  );

  if (!isInitialized || loading) {
    return (
      <div className="min-h-screen bg-surface-canvas p-8 text-sm text-ink-tertiary">로딩 중...</div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-canvas p-4 sm:p-8">
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

        {/* 소속 상담사 — 테이블 + 검색/상태 필터 + 정보 수정 (SDD-077) */}
        <section className="rounded-xl border border-border-default bg-surface-raised p-6 space-y-4">
          <h2 className="text-lg font-medium text-ink-primary">소속 상담사 ({counselors.length}명)</h2>
          {editingUser && orgId && (
            <CounselorInfoEditor
              load={() => getOrgCounselorProfile(orgId, editingUser.id)}
              save={(payload) => patchOrgCounselorProfile(orgId, editingUser.id, payload)}
              onCancel={() => setEditingUser(null)}
              onSaved={() => {
                setEditingUser(null);
                listCounselors(orgId).then(setCounselors).catch(() => undefined);
              }}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="상담사 검색"
              placeholder="이름·이메일 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 min-w-0 flex-1 px-3 rounded-lg bg-surface-canvas border border-border-default text-sm text-ink-primary"
            />
            <select
              aria-label="계정 상태 필터"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 px-3 rounded-lg bg-surface-canvas border border-border-default text-sm text-ink-primary"
            >
              <option value="">전체 상태</option>
              <option value="active">활성</option>
              <option value="pending">가입 대기</option>
            </select>
          </div>
          {counselors.length === 0 ? (
            <p className="text-sm text-ink-tertiary">아직 소속된 상담사가 없습니다.</p>
          ) : filteredCounselors.length === 0 ? (
            <p className="text-sm text-ink-tertiary">검색 조건에 맞는 상담사가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border-default text-xs text-ink-tertiary">
                    {['이름', '이메일', '상태', '역할', '관리'].map((h) => (
                      <th key={h} className="p-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredCounselors.map((c) => (
                    <tr key={c.id} className="border-b border-border-default">
                      <td className="p-2 text-ink-primary">{c.name}</td>
                      <td className="p-2 text-ink-tertiary">{c.email}</td>
                      <td className="p-2 text-ink-tertiary">{c.status === 'pending' ? '가입 대기' : '활성'}</td>
                      <td className="p-2">
                        <select
                          aria-label={`${c.name} 역할`}
                          value={c.role}
                          onChange={(e) => handleRoleChange(c.id, e.target.value as CounselorRole)}
                          disabled={busyUser === c.id}
                          className="h-9 px-3 rounded-lg bg-surface-canvas border border-border-default text-sm text-ink-primary"
                        >
                          <option value="counselor">상담사</option>
                          <option value="org_admin">관리자</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingUser(c)}
                            disabled={busyUser === c.id || !!editingUser || c.role !== 'counselor'}
                            title={c.role !== 'counselor' ? '기관 관리자 계정은 본인 설정 또는 플랫폼 관리자를 통해 수정합니다' : undefined}
                            className="h-9 px-3 rounded-pill border border-border-default text-sm text-ink-secondary hover:text-ink-primary disabled:opacity-50"
                          >
                            정보 수정
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemove(c.id)}
                            disabled={busyUser === c.id}
                            className="h-9 px-3 rounded-pill border border-border-default text-sm text-ink-secondary hover:text-red-500 hover:border-red-500"
                          >
                            소속 해제
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
