import { useAuthStore } from '../../../stores/authStore';
// SDD-321 — 기관 대시보드 D안. 데이터·핸들러는 기존 OrgDashboardPage 와 같은 API 함수를 호출하고, 초대·퇴직 안내는 기존 컴포넌트를 그대로 쓴다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import OrgRemovedNoticeDialog from '../../../components/org/OrgRemovedNoticeDialog';
import { UiV2OrgShell } from '../../../components/ui-v2/ui-v2-org-shell';
import { UiV2OrgCodeCard } from '../../../components/ui-v2/ui-v2-org-code-card';
import {
  getOrgDashboard,
  type ClassSummary,
  type OrgCounselorStat,
  type OrgDashboardResponse,
} from '../../../lib/api/dashboard';
import { listCounselors, listOrgJoinRequests, type CounselorItem, type OrgJoinRequest } from '../../../lib/api/org';
import { summaryOf } from './members/members-model';
import { sessionStatusLabel } from '../../../lib/session-status';
import type { SessionStatus, SessionType } from '../../../lib/api/session';
import { Pill, SessionStatusPill, StatCell, type PillTone } from './ui-v2-org-parts';
import { formatDateTime } from './ui-v2-org-format';
import { homeEntryAction } from '../../../lib/dashboard/counselor-home-model';
import '../../../styles/ui-v2-org-members.css';

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
  const [joinRequests, setJoinRequests] = useState<OrgJoinRequest[]>([]);
  const [allMembers, setAllMembers] = useState<CounselorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const fetchCounselors = useCallback(async (orgId: string): Promise<void> => {
    try {
      const counselors = await listCounselors(orgId);
      setAllMembers(counselors);
      setInviteList(counselors.filter((item) => item.role === 'counselor'));
    } catch {
      setAllMembers([]);
      setInviteList([]);
    }
    // 가입 요청 대기 건수만 필요하다 — 홈 표시를 막지 않고, 실패해도 그대로 보여 준다.
    void Promise.resolve(listOrgJoinRequests(orgId)).then(setJoinRequests).catch(() => setJoinRequests([]));
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

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  const activeCounselors: OrgCounselorStat[] =
    data?.counselors.filter((counselor) => isActiveForStats(counselor.id, inviteList)) ?? [];
  const summary = summaryOf(allMembers, joinRequests);
  const hasSummary = allMembers.length > 0;

  const classes = data?.classes;
  const filteredClasses = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (classes ?? []).filter((cls) => {
      const matchQuery = !q || [cls.title ?? '', cls.access_code ?? ''].some((v) => v.toLowerCase().includes(q));
      return matchQuery && (!statusFilter || cls.status === statusFilter) && (!typeFilter || cls.type === typeFilter);
    });
  }, [classes, query, statusFilter, typeFilter]);

  const statuses: SessionStatus[] = ['ready', 'scheduled', 'open', 'in_progress', 'completed', 'cancelled'];

  // 11/9: 사이드바 '기관 코드' 줄은 auth user.org_code 를 읽는다. users/me 가 아직 org_code 를 주지 않는 서버에서도
  // 대시보드 응답의 org_code 로 채워 둔다(값이 다를 때만 갱신).
  useEffect(() => {
    const code = data?.org_code ?? null;
    const st = useAuthStore.getState();
    if (code && st.user && st.user.org_code !== code) useAuthStore.setState({ user: { ...st.user, org_code: code } });
  }, [data?.org_code]);

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
          <section aria-labelledby="u2-org-members-summary-title">
            <div className="u2-org-section-head" style={{ marginTop: 0 }}>
              <h2 id="u2-org-members-summary-title">구성원 현황</h2>
              <Link to="/counselors" className="u2-link" data-members-shortcut>구성원에서 관리 →</Link>
            </div>
            <div className="u2m-summary" role="group" aria-label="구성원 요약">
              {([
                ['활성 코치', hasSummary ? summary.coaches : data.total_counselors, 'coaches'],
                ['활성 관리자', summary.admins, 'admins'],
                ['초대 대기', summary.invitesPending, 'invites'],
                ['가입 요청', summary.requestsPending, 'requests'],
              ] as const).map(([label, value, tab]) => (
                <Link key={tab} to={tab === 'coaches' ? '/counselors' : `/counselors?tab=${tab}`} data-summary-tab={tab}>
                  <span className="u2m-summary-label">{label}</span>
                  <strong className="u2m-summary-value">{value}<small>명</small></strong>
                </Link>
              ))}
            </div>
          </section>

          <dl className="u2-org-stats" aria-label="기관 현황">
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
                                {(() => {
                                  // 11/12 대표 지시: 기관관리자는 열린 회차를 참관 입장하기로 바로 들어간다(꺼져 있으면 안내만).
                                  const entry = homeEntryAction(cls, 'org_admin');
                                  if (entry.kind === 'observe') return <Link to={entry.to} className="u2-link" data-testid="home-entry-cta">{entry.label}</Link>;
                                  if (entry.kind === 'note') return <small className="u2-muted" data-testid="home-entry-note">{entry.text}</small>;
                                  return null;
                                })()}
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
