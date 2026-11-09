// SDD-321 — 기관 대시보드 D안. 데이터·핸들러는 기존 OrgDashboardPage 와 같은 API 함수를 호출하고, 초대·퇴직 안내는 기존 컴포넌트를 그대로 쓴다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import OrgRemovedNoticeDialog from '../../../components/org/OrgRemovedNoticeDialog';
import CounselorInviteSection from '../../../components/org/counselor-invite-section';
import { UiV2OrgShell } from '../../../components/ui-v2/ui-v2-org-shell';
import { UiV2OrgCodeCard } from '../../../components/ui-v2/ui-v2-org-code-card';
import {
  getOrgDashboard,
  type ClassSummary,
  type OrgCounselorStat,
  type OrgDashboardResponse,
} from '../../../lib/api/dashboard';
import { listCounselors, type CounselorItem } from '../../../lib/api/org';
import { sessionStatusLabel } from '../../../lib/session-status';
import type { SessionStatus, SessionType } from '../../../lib/api/session';
import { Pill, SessionStatusPill, StatCell, type PillTone } from './ui-v2-org-parts';
import { formatDateTime } from './ui-v2-org-format';

const TYPE_LABELS: Record<SessionType, string> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상수업',
  custom: '기타',
};

const TYPE_TONES: Record<SessionType, PillTone> = {
  clinical: 'accent',
  hypnosis: 'accent',
  meditation: 'ok',
  custom: 'warn',
};

function isActiveForStats(counselorId: string, inviteList: CounselorItem[]): boolean {
  const match = inviteList.find((item) => item.id === counselorId);
  if (!match) return true;
  return match.status === 'active';
}

function TypePill({ cls }: { cls: ClassSummary }) {
  const label = cls.type === 'custom' && cls.custom_type_name ? cls.custom_type_name : TYPE_LABELS[cls.type];
  return <Pill tone={TYPE_TONES[cls.type]}>{label}</Pill>;
}

export function UiV2OrgDashboardPage() {
  const [data, setData] = useState<OrgDashboardResponse | null>(null);
  const [inviteList, setInviteList] = useState<CounselorItem[]>([]);
  const [inviteListError, setInviteListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const fetchCounselors = useCallback(async (orgId: string): Promise<void> => {
    setInviteListError(null);
    try {
      const counselors = await listCounselors(orgId);
      setInviteList(counselors.filter((item) => item.role === 'counselor'));
    } catch (err) {
      setInviteList([]);
      setInviteListError(err instanceof Error ? err.message : '코치 목록을 불러오지 못했습니다.');
    }
  }, []);

  const fetchDashboard = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await getOrgDashboard();
      setData(res);
      await fetchCounselors(res.org_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '기관 대시보드를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, [fetchCounselors]);

  const refreshInviteData = useCallback(async (): Promise<void> => {
    if (!data?.org_id) return;
    try {
      const [dashboardRes, counselors] = await Promise.all([getOrgDashboard(), listCounselors(data.org_id)]);
      setData(dashboardRes);
      setInviteList(counselors.filter((item) => item.role === 'counselor'));
      setInviteListError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '목록을 새로고침하지 못했습니다');
      setInviteListError(err instanceof Error ? err.message : '코치 목록을 불러오지 못했습니다.');
    }
  }, [data?.org_id]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  const activeCounselors: OrgCounselorStat[] =
    data?.counselors.filter((counselor) => isActiveForStats(counselor.id, inviteList)) ?? [];
  const activeCounselorCount = inviteList.length
    ? inviteList.filter((item) => item.status === 'active').length
    : data?.total_counselors ?? 0;

  const classes = data?.classes;
  const filteredClasses = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (classes ?? []).filter((cls) => {
      const matchQuery = !q || [cls.title ?? '', cls.access_code ?? ''].some((v) => v.toLowerCase().includes(q));
      return matchQuery && (!statusFilter || cls.status === statusFilter) && (!typeFilter || cls.type === typeFilter);
    });
  }, [classes, query, statusFilter, typeFilter]);

  const statuses: SessionStatus[] = ['ready', 'scheduled', 'open', 'in_progress', 'completed', 'cancelled'];

  return (
    <UiV2OrgShell title={data?.org_name ?? '기관 대시보드'} subtitle="기관 전체 코치와 클래스를 한눈에 확인합니다.">
      <OrgRemovedNoticeDialog />

      {data && <div className="u2-org-stack"><UiV2OrgCodeCard orgCode={data.org_code} /></div>}

      <Link to="/upload-status" data-upload-status-shortcut className="u2-org-shortcut">
        <span><strong>데이터 현황</strong><small className="u2-muted">회차별 데이터 도착 확인</small></span>
        <span aria-hidden="true">→</span>
      </Link>

      {error && <div className="u2-org-error" role="alert">{error}</div>}

      {loading ? (
        <div className="u2-org-loading" role="status">불러오는 중...</div>
      ) : data ? (
        <div className="u2-org-stack">
          <div className="u2-legacy u2-org-legacy">
            <CounselorInviteSection
              orgId={data.org_id}
              inviteList={inviteList}
              inviteListError={inviteListError}
              onRefresh={refreshInviteData}
            />
          </div>

          <dl className="u2-org-stats" aria-label="기관 현황">
            <StatCell label="활성 코치" value={activeCounselorCount} />
            <StatCell label="총 클래스" value={data.total_classes} accent />
            <StatCell label="총 회원" value={data.total_members ?? data.total_participants} />
            <StatCell label="종료한 클래스" value={data.completed_classes} />
            <StatCell label="진행중" value={data.in_progress_classes} accent />
          </dl>

          <section aria-labelledby="u2-org-coaches-title">
            <div className="u2-org-section-head">
              <h2 id="u2-org-coaches-title">소속 코치 실적</h2>
              <span className="u2-org-count">{activeCounselors.length}명</span>
            </div>
            {activeCounselors.length === 0 ? (
              <div className="u2-org-empty">활성 코치 실적이 없습니다. 초대가 완료된 코치만 표시됩니다.</div>
            ) : (
              <div className="u2-table-card">
                <table className="u2-table">
                  <thead>
                    <tr>
                      <th scope="col">이름</th>
                      <th scope="col">이메일</th>
                      <th scope="col">클래스</th>
                      <th scope="col">참여자</th>
                      <th scope="col">종료</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeCounselors.map((c) => (
                      <tr key={c.id}>
                        <td data-label="이름" className="u2-cell-strong">{c.name}</td>
                        <td data-label="이메일" className="u2-cell-muted">{c.email}</td>
                        <td data-label="클래스">{c.class_count}</td>
                        <td data-label="참여자">{c.participant_count}</td>
                        <td data-label="종료">{c.completed_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="u2-org-classes-title">
            <div className="u2-org-section-head">
              <h2 id="u2-org-classes-title">기관 전체 클래스</h2>
              <span className="u2-org-count">{filteredClasses.length === data.classes.length ? `${data.classes.length}건` : `${filteredClasses.length} / ${data.classes.length}건`}</span>
            </div>
            {data.classes.length === 0 ? (
              <div className="u2-org-empty">진행된 클래스가 없습니다.</div>
            ) : (
              <>
                <div className="u2-org-filter">
                  <input aria-label="클래스 검색" placeholder="클래스 이름·코드 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
                  <select aria-label="클래스 상태 필터" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">전체 상태</option>
                    {statuses.map((s) => <option key={s} value={s}>{sessionStatusLabel(s)}</option>)}
                  </select>
                  <select aria-label="클래스 유형 필터" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                    <option value="">전체 유형</option>
                    {(Object.keys(TYPE_LABELS) as SessionType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
                {filteredClasses.length === 0 ? (
                  <div className="u2-org-empty">조건에 맞는 클래스가 없습니다.</div>
                ) : (
                  <div className="u2-table-card">
                    <table className="u2-table u2-table-wide">
                      <thead>
                        <tr>
                          <th scope="col">제목</th>
                          <th scope="col">유형</th>
                          <th scope="col">상태</th>
                          <th scope="col">코드</th>
                          <th scope="col">참여자</th>
                          <th scope="col">시작</th>
                          <th scope="col">종료</th>
                          <th scope="col">기록</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredClasses.map((cls) => {
                          const showRecordLink = cls.has_record || cls.has_summary;
                          return (
                            <tr key={cls.id}>
                              <td data-label="제목" className="u2-cell-strong">
                                <Link to={`/sessions/${cls.id}`} className="u2-link">{cls.title || '제목 없음'}</Link>
                              </td>
                              <td data-label="유형"><TypePill cls={cls} /></td>
                              <td data-label="상태"><SessionStatusPill status={cls.status} /></td>
                              <td data-label="코드" className="u2-cell-code">{cls.access_code ?? '-'}</td>
                              <td data-label="참여자">
                                {cls.participant_count}명
                                {cls.guest_count > 0 && <small className="u2-muted"> (게스트 {cls.guest_count})</small>}
                              </td>
                              <td data-label="시작" className="u2-mono">{formatDateTime(cls.started_at)}</td>
                              <td data-label="종료" className="u2-mono">{formatDateTime(cls.ended_at)}</td>
                              <td data-label="기록">
                                {showRecordLink ? (
                                  <Link to={`/sessions/${cls.id}/record`} className="u2-link">기록 보기</Link>
                                ) : (
                                  <span className="u2-muted">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      ) : null}
    </UiV2OrgShell>
  );
}
