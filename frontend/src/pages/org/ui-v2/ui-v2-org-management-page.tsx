// SDD-321 — 센터 관리 D안(회원·가입 요청·기관 설정). 기존 OrgManagementPage 와 같은 API·확인 문구·권한 안내를 그대로 쓴다.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuthStore } from '../../../stores/authStore';
import { ApiError } from '../../../lib/api/client';
import { getOrg, type Org } from '../../../lib/api/org';
import { Pill } from './ui-v2-org-parts';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-brand.css';
import '../../../styles/ui-v2-org.css';

export function UiV2OrgManagementPage() {
  const { org_id: orgId } = useParams<{ org_id: string }>();
  const user = useAuthStore((s) => s.user);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = (user?.role ?? '') as string;
  const isOrgAdmin = role === 'org_admin';

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    getOrg(orgId)
      .then((o) => {
        setOrg(o);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : '센터 정보를 불러오지 못했습니다');
      })
      .finally(() => setLoading(false));
  }, [orgId]);

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

        {/* SDD-323: 구성원(코치·관리자·초대·가입 요청) 관리는 구성원 화면으로 일원화 — 중복 UI 제거 */}
        <section className="u2-card" style={{ marginBottom: 0 }}>
          <div className="u2-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div>
              <h2>구성원</h2>
              <p className="u2-muted">코치와 관리자, 초대와 가입 요청은 구성원 화면에서 관리합니다.</p>
            </div>
            {isOrgAdmin && <Link to="/counselors" className="u2-secondary" data-members-link>구성원 관리로 이동 →</Link>}
          </div>
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
