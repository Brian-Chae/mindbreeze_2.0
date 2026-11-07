// SDD-321 — 센터 관리 D안(회원·가입 요청·기관 설정). 기존 OrgManagementPage 와 같은 API·확인 문구·권한 안내를 그대로 쓴다.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import CounselorInfoEditor from '../../../components/counselor/counselor-info-editor';
import { useAuthStore } from '../../../stores/authStore';
import { ApiError } from '../../../lib/api/client';
import {
  getOrg,
  listCounselors,
  updateCounselor,
  removeCounselor,
  type Org,
  type CounselorItem,
  type CounselorRole,
} from '../../../lib/api/org';
import { getOrgCounselorProfile, patchOrgCounselorProfile } from '../../../lib/api/counselor-info';
import { Pill } from './ui-v2-org-parts';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-brand.css';
import '../../../styles/ui-v2-org.css';

export function UiV2OrgManagementPage() {
  const { org_id: orgId } = useParams<{ org_id: string }>();
  const user = useAuthStore((s) => s.user);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  const [org, setOrg] = useState<Org | null>(null);
  const [counselors, setCounselors] = useState<CounselorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<CounselorItem | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const role = (user?.role ?? '') as string;
  const isOrgAdmin = role === 'org_admin';

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    Promise.all([getOrg(orgId), listCounselors(orgId).catch(() => [] as CounselorItem[])])
      .then(([o, c]) => {
        setOrg(o);
        setCounselors(c);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : '센터 정보를 불러오지 못했습니다');
      })
      .finally(() => setLoading(false));
  }, [orgId]);

  const handleRoleChange = async (userId: string, nextRole: CounselorRole) => {
    if (!orgId) return;
    const current = counselors.find((c) => c.id === userId);
    if (current?.role === nextRole) return;
    const roleLabel = nextRole === 'org_admin' ? '관리자' : '코치';
    if (!confirm(`역할을 '${roleLabel}'(으)로 변경하시겠습니까?`)) return;
    setBusyUser(userId);
    try {
      const updated = await updateCounselor(orgId, userId, { role: nextRole });
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

  const filteredCounselors = counselors.filter(
    (c) =>
      [c.name, c.email].some((value) => value.toLowerCase().includes(query.trim().toLowerCase())) &&
      (!statusFilter || (c.status ?? 'active') === statusFilter),
  );

  if (!isInitialized || loading) {
    return (
      <div className="ui-v2 u2-org-page"><div role="status" className="u2-org-loading">로딩 중...</div></div>
    );
  }

  const info: Array<[string, string | null | undefined]> = org
    ? [
        ['센터명', org.name],
        ['대표자명', org.ceo_name],
        ['사업자등록번호', org.biz_number],
        ['주소', org.address],
        ['전화번호', org.phone],
        ['인증 여부', org.verified ? `인증 완료 (${org.verified_at ?? ''})` : '미인증'],
        ['등록일', org.created_at],
      ]
    : [];

  return (
    <div className="ui-v2 u2-org-page">
      <div className="u2-org-page-inner u2-org-stack">
        <header>
          <h1>상담센터 관리</h1>
          <p>{org?.name}</p>
        </header>

        {error && <p className="u2-org-error" role="alert">{error}</p>}

        {!isOrgAdmin && (
          <div className="u2-notice">관리자 권한이 없습니다. 일부 기능이 제한될 수 있습니다.</div>
        )}

        {/* 가입 요청 관리 — 준비 중 (API 미연동) */}
        <section className="u2-card" style={{ marginBottom: 0 }}>
          <div className="u2-row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            <h2>가입 요청 관리</h2>
            <Pill tone="warn">준비 중</Pill>
          </div>
          <p className="u2-muted">가입 요청 관리 기능은 준비 중입니다.</p>
        </section>

        {/* 소속 코치 — 표 + 검색/상태 필터 + 정보 수정 */}
        <section aria-labelledby="u2-org-members-title">
          <div className="u2-org-section-head" style={{ marginTop: 0 }}>
            <h2 id="u2-org-members-title">소속 코치 ({counselors.length}명)</h2>
          </div>
          {editingUser && orgId && (
            <div className="u2-org-legacy" style={{ marginBottom: 14 }}>
              <CounselorInfoEditor
                load={() => getOrgCounselorProfile(orgId, editingUser.id)}
                save={(payload) => patchOrgCounselorProfile(orgId, editingUser.id, payload)}
                onCancel={() => setEditingUser(null)}
                onSaved={() => {
                  setEditingUser(null);
                  listCounselors(orgId).then(setCounselors).catch(() => undefined);
                }}
              />
            </div>
          )}
          <div className="u2-org-filter">
            <input aria-label="코치 검색" placeholder="이름·이메일 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select aria-label="계정 상태 필터" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">전체 상태</option>
              <option value="active">활성</option>
              <option value="pending">가입 대기</option>
            </select>
          </div>
          {counselors.length === 0 ? (
            <div className="u2-org-empty">아직 소속된 코치가 없습니다.</div>
          ) : filteredCounselors.length === 0 ? (
            <div className="u2-org-empty">검색 조건에 맞는 코치가 없습니다.</div>
          ) : (
            <div className="u2-table-card">
              <table className="u2-table u2-table-wide">
                <thead>
                  <tr>{['이름', '이메일', '상태', '역할', '관리'].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {filteredCounselors.map((c) => (
                    <tr key={c.id}>
                      <td data-label="이름" className="u2-cell-strong">{c.name}</td>
                      <td data-label="이메일" className="u2-cell-muted">{c.email}</td>
                      <td data-label="상태">{c.status === 'pending' ? '가입 대기' : '활성'}</td>
                      <td data-label="역할">
                        <select
                          className="u2-org-field"
                          aria-label={`${c.name} 역할`}
                          value={c.role}
                          onChange={(e) => handleRoleChange(c.id, e.target.value as CounselorRole)}
                          disabled={busyUser === c.id}
                        >
                          <option value="counselor">코치</option>
                          <option value="org_admin">관리자</option>
                        </select>
                      </td>
                      <td data-label="관리">
                        <div className="u2-row-actions">
                          <button
                            type="button"
                            className="u2-btn-sm"
                            onClick={() => setEditingUser(c)}
                            disabled={busyUser === c.id || !!editingUser || c.role !== 'counselor'}
                            title={c.role !== 'counselor' ? '기관 관리자 계정은 본인 설정 또는 플랫폼 관리자를 통해 수정합니다' : undefined}
                          >
                            정보 수정
                          </button>
                          <button type="button" className="u2-btn-danger" onClick={() => handleRemove(c.id)} disabled={busyUser === c.id}>
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
          <section className="u2-card" style={{ marginBottom: 0 }}>
            <h2>센터 정보</h2>
            <dl className="u2-org-facts" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
              {info.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}
