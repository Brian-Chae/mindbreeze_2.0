// SDD-321 — 코치 관리 D안. 조회·상태 변경·정보 수정·이력은 기존 OrgCounselorsPage 와 같은 API 를 호출한다.
// 정보 수정은 CounselorInfoEditor 를 그대로 쓴다(성별·생년월일·전화·주소 수정 가능, 이메일은 불변 아이디라 입력 없음).
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import CounselorInviteSection from '../../../components/org/counselor-invite-section';
import CounselorInfoEditor from '../../../components/counselor/counselor-info-editor';
import { UiV2OrgShell } from '../../../components/ui-v2/ui-v2-org-shell';
import { ApiError } from '../../../lib/api/client';
import { sessionStatusLabel } from '../../../lib/session-status';
import { getOrgDashboard } from '../../../lib/api/dashboard';
import {
  getCounselorActivity,
  listCounselors,
  suspendCounselor,
  unsuspendCounselor,
  type CounselorActivity,
  type CounselorItem,
  type CounselorRole,
} from '../../../lib/api/org';
import {
  getOrgCounselorProfile,
  patchOrgCounselorProfile,
  type CounselorInfoDto,
} from '../../../lib/api/counselor-info';
import { useDialogA11y } from '../../../hooks/useDialogA11y';
import { OrgDialog, Pill } from './ui-v2-org-parts';
import { formatDateTime } from './ui-v2-org-format';

type DisplayStatus = 'active' | 'pending' | 'suspended';

const REPORT_STATUS_LABELS: Record<string, string> = {
  pending_analysis: '분석 중',
  pending_review: '검토 대기',
  completed: '완료',
  error: '오류',
};

const SESSION_TYPE_LABELS: Record<string, string> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상수업',
  custom: '기타',
};

function displayStatusOf(c: CounselorItem): DisplayStatus {
  if (c.status === 'suspended') return 'suspended';
  if (c.status === 'active') return 'active';
  return 'pending';
}

function StatusPill({ status }: { status: DisplayStatus }) {
  if (status === 'active') return <Pill tone="ok">활성</Pill>;
  if (status === 'suspended') return <Pill tone="danger">정지</Pill>;
  return <Pill tone="warn">대기</Pill>;
}

/** 정지/해제 사유 입력 다이얼로그 — 사유 필수 */
function StatusChangeDialog({
  counselor,
  mode,
  busy,
  onConfirm,
  onCancel,
}: {
  counselor: CounselorItem;
  mode: 'suspend' | 'unsuspend';
  busy: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const isSuspend = mode === 'suspend';
  return (
    <OrgDialog labelledBy="status-change-title" onClose={onCancel}>
      <h3 id="status-change-title">{isSuspend ? '코치 비활성화' : '코치 활성화'}</h3>
      <p>
        <strong style={{ color: 'var(--u2-text)' }}>{counselor.name}</strong>
        {isSuspend
          ? ' 계정을 비활성화합니다. 비활성화된 코치는 로그인이 차단되며, 데이터는 삭제되지 않습니다.'
          : ' 계정을 다시 활성화합니다. 활성화 즉시 로그인이 가능해집니다.'}
      </p>
      <label className="u2-dialog-label">
        사유 (필수)
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="예: 휴직 처리에 따른 계정 비활성화" />
      </label>
      <div className="u2-dialog-actions">
        <button type="button" className="u2-secondary" onClick={onCancel} disabled={busy}>취소</button>
        <button
          type="button"
          className={`u2-primary ${isSuspend ? 'u2-btn-solid-danger' : 'u2-btn-solid-ok'}`}
          onClick={() => onConfirm(reason.trim())}
          disabled={busy || !reason.trim()}
        >
          {busy ? '처리 중…' : isSuspend ? '비활성화' : '활성화'}
        </button>
      </div>
    </OrgDialog>
  );
}

/** 상세 패널 — 프로필 정보 + 최근 이력 (세션/리포트 탭) */
function CounselorDetailPanel({ orgId, counselor, onClose }: { orgId: string; counselor: CounselorItem; onClose: () => void }) {
  const [profile, setProfile] = useState<CounselorInfoDto | null>(null);
  const [activity, setActivity] = useState<CounselorActivity | null>(null);
  const [tab, setTab] = useState<'sessions' | 'reports'>('sessions');
  const [error, setError] = useState<string | null>(null);
  const tabsId = useId();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getOrgCounselorProfile(orgId, counselor.id).catch(() => null),
      getCounselorActivity(orgId, counselor.id),
    ])
      .then(([p, a]) => {
        if (cancelled) return;
        setProfile(p);
        setActivity(a);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : '이력을 불러오지 못했습니다');
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, counselor.id]);

  const facts: Array<[string, string]> = [
    ['코치 코드', counselor.counselor_code ?? profile?.counselor_code ?? '-'],
    ['역할', counselor.role === 'org_admin' ? '기관 관리자' : '코치'],
    ['전화번호', profile?.phone ?? '-'],
    ['활동 형태', counselor.has_personal_office ? '개인 상담소 운영' : '기관 소속'],
  ];
  const tabs = [
    ['sessions', `최근 세션 (${activity?.sessions.length ?? 0})`],
    ['reports', `최근 리포트 (${activity?.reports.length ?? 0})`],
  ] as const;

  return (
    <section className="u2-org-panel" aria-label={`${counselor.name} 이력`}>
      <div className="u2-org-panel-head">
        <div>
          <h2>
            {counselor.name} <StatusPill status={displayStatusOf(counselor)} />
          </h2>
          <p>{counselor.email}</p>
        </div>
        <button type="button" className="u2-btn-sm" onClick={onClose}>닫기</button>
      </div>

      {error && <p className="u2-error" role="alert" style={{ marginTop: 12 }}>{error}</p>}

      <dl className="u2-org-facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <div className="u2-org-tabs" role="tablist" aria-label="최근 이력">
        {tabs.map(([key, label], index, arr) => (
          <button
            key={key}
            id={`${tabsId}-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={`${tabsId}-panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const nextIndex = event.key === 'ArrowRight' ? (index + 1) % arr.length : (index - 1 + arr.length) % arr.length;
              const nextKey = arr[nextIndex][0];
              setTab(nextKey);
              document.getElementById(`${tabsId}-tab-${nextKey}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${tabsId}-panel-${tab}`} aria-labelledby={`${tabsId}-tab-${tab}`} tabIndex={0} className="u2-org-tabpanel">
        {activity == null && !error ? (
          <p className="u2-org-loading" style={{ textAlign: 'center' }}>이력을 불러오는 중…</p>
        ) : tab === 'sessions' ? (
          activity && activity.sessions.length > 0 ? (
            <div className="u2-table-card">
              <table className="u2-table">
                <thead>
                  <tr>{['제목', '유형', '상태', '일시', '참여자'].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {activity.sessions.map((s) => (
                    <tr key={s.id}>
                      <td data-label="제목" className="u2-cell-strong">{s.title || '제목 없음'}</td>
                      <td data-label="유형" className="u2-cell-muted">{SESSION_TYPE_LABELS[s.type] ?? s.type}</td>
                      <td data-label="상태" className="u2-cell-muted">{sessionStatusLabel(s.status)}</td>
                      <td data-label="일시" className="u2-mono">{formatDateTime(s.scheduled_at ?? s.started_at)}</td>
                      <td data-label="참여자" className="u2-cell-muted">{s.participant_count}명</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="u2-org-empty" style={{ marginTop: 12 }}>최근 세션이 없습니다.</p>
          )
        ) : activity && activity.reports.length > 0 ? (
          <div className="u2-table-card">
            <table className="u2-table">
              <thead>
                <tr>{['제목', '유형', '상태', '생성일'].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
              </thead>
              <tbody>
                {activity.reports.map((r) => (
                  <tr key={r.id}>
                    <td data-label="제목" className="u2-cell-strong">{r.title || '제목 없음'}</td>
                    <td data-label="유형" className="u2-cell-muted">{r.type === 'counselor' ? '코치용' : '내담자용'}</td>
                    <td data-label="상태" className="u2-cell-muted">{REPORT_STATUS_LABELS[r.status] ?? r.status}</td>
                    <td data-label="생성일" className="u2-mono">{formatDateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="u2-org-empty" style={{ marginTop: 12 }}>최근 리포트가 없습니다.</p>
        )}
      </div>
    </section>
  );
}

export function UiV2OrgCounselorsPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [counselors, setCounselors] = useState<CounselorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<CounselorItem | null>(null);
  const [editing, setEditing] = useState<CounselorItem | null>(null);
  const [statusDialog, setStatusDialog] = useState<{ counselor: CounselorItem; mode: 'suspend' | 'unsuspend' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteRole, setInviteRole] = useState<CounselorRole>('counselor');
  const inviteDialogRef = useDialogA11y(showInvite, () => setShowInvite(false));

  const refresh = useCallback(async (targetOrgId: string): Promise<void> => {
    const list = await listCounselors(targetOrgId);
    setCounselors(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getOrgDashboard()
      .then(async (res) => {
        if (cancelled) return;
        setOrgId(res.org_id);
        await refresh(res.org_id);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : '코치 목록을 불러오지 못했습니다');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return counselors.filter((c) => {
      const matchQuery = !q || [c.name, c.email, c.counselor_code ?? ''].some((v) => v.toLowerCase().includes(q));
      const matchRole = !roleFilter || c.role === roleFilter;
      const matchStatus = !statusFilter || displayStatusOf(c) === statusFilter;
      return matchQuery && matchRole && matchStatus;
    });
  }, [counselors, query, roleFilter, statusFilter]);

  const handleStatusChange = async (reason: string) => {
    if (!orgId || !statusDialog) return;
    setBusy(true);
    setError(null);
    try {
      const { counselor, mode } = statusDialog;
      const res = mode === 'suspend' ? await suspendCounselor(orgId, counselor.id, reason) : await unsuspendCounselor(orgId, counselor.id, reason);
      setCounselors((prev) => prev.map((c) => (c.id === counselor.id ? { ...c, status: res.status } : c)));
      setSelected((prev) => (prev && prev.id === counselor.id ? { ...prev, status: res.status } : prev));
      setStatusDialog(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '상태 변경에 실패했습니다');
    } finally {
      setBusy(false);
    }
  };

  const openInvite = (role: CounselorRole) => {
    setInviteRole(role);
    setShowInvite(true);
  };

  return (
    <UiV2OrgShell
      title="코치 관리"
      subtitle="소속 코치의 정보·이력을 확인하고 계정 상태를 관리합니다."
      actions={
        orgId ? (
          <>
            <button type="button" className="u2-secondary" onClick={() => openInvite('org_admin')}>기관관리자 초대</button>
            <button type="button" data-header-action="primary" className="u2-primary" onClick={() => openInvite('counselor')}>코치 초대</button>
          </>
        ) : undefined
      }
    >
      {error && <div className="u2-org-error" role="alert">{error}</div>}

      {loading ? (
        <div role="status" className="u2-org-loading">불러오는 중...</div>
      ) : (
        <div className="u2-org-stack">
          {editing && orgId && (
            <section className="u2-org-legacy" aria-label={`정보 수정 — ${editing.name}`}>
              <h2 style={{ marginBottom: 14 }}>정보 수정 — {editing.name}</h2>
              <CounselorInfoEditor
                load={() => getOrgCounselorProfile(orgId, editing.id)}
                save={(payload) => patchOrgCounselorProfile(orgId, editing.id, payload)}
                onCancel={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  void refresh(orgId);
                }}
              />
            </section>
          )}

          <div className="u2-org-filter">
            <input aria-label="코치 검색" placeholder="이름·이메일·코드 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select aria-label="역할 필터" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">전체 역할</option>
              <option value="counselor">코치</option>
              <option value="org_admin">기관 관리자</option>
            </select>
            <select aria-label="상태 필터" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">전체 상태</option>
              <option value="active">활성</option>
              <option value="pending">대기</option>
              <option value="suspended">정지</option>
            </select>
          </div>

          {counselors.length === 0 ? (
            <div className="u2-org-empty">아직 소속된 코치가 없습니다. 상단의 '코치 초대' 버튼으로 초대해 보세요.</div>
          ) : filtered.length === 0 ? (
            <div className="u2-org-empty">검색 조건에 맞는 코치가 없습니다.</div>
          ) : (
            <div className="u2-table-card">
              <table className="u2-table u2-table-wide">
                <thead>
                  <tr>{['이름', '이메일', '코드', '역할', '상태', '관리'].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const status = displayStatusOf(c);
                    const isCounselor = c.role === 'counselor';
                    return (
                      <tr key={c.id}>
                        <td data-label="이름" className="u2-cell-strong">
                          {c.name}
                          {c.has_personal_office && <> <Pill tone="accent">개인 상담소</Pill></>}
                        </td>
                        <td data-label="이메일" className="u2-cell-muted">{c.email}</td>
                        <td data-label="코드" className="u2-cell-muted u2-mono">{c.counselor_code ?? '-'}</td>
                        <td data-label="역할" className="u2-cell-muted">{c.role === 'org_admin' ? '기관 관리자' : '코치'}</td>
                        <td data-label="상태"><StatusPill status={status} /></td>
                        <td data-label="관리">
                          <div className="u2-row-actions">
                            <button
                              type="button"
                              className="u2-btn-sm"
                              onClick={() => setEditing(c)}
                              disabled={!isCounselor || !!editing}
                              title={!isCounselor ? '기관 관리자 계정은 본인 설정 또는 플랫폼 관리자를 통해 수정합니다' : undefined}
                            >
                              정보 수정
                            </button>
                            <button type="button" className="u2-btn-sm" onClick={() => setSelected(c)}>이력</button>
                            {status !== 'pending' && (
                              <button
                                type="button"
                                className={status === 'suspended' ? 'u2-btn-ok' : 'u2-btn-danger'}
                                onClick={() => setStatusDialog({ counselor: c, mode: status === 'suspended' ? 'unsuspend' : 'suspend' })}
                              >
                                {status === 'suspended' ? '활성화' : '비활성화'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {selected && orgId && (
            // key 로 코치 변경 시 재마운트 — 이전 코치의 프로필/이력 상태를 초기화한다
            <CounselorDetailPanel key={selected.id} orgId={orgId} counselor={selected} onClose={() => setSelected(null)} />
          )}
        </div>
      )}

      {showInvite && orgId && (
        <div className="ui-v2 u2-overlay">
          <div
            ref={inviteDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={inviteRole === 'org_admin' ? '기관관리자 초대' : '코치 초대'}
            className="u2-dialog u2-dialog--wide"
          >
            <div className="u2-org-legacy" style={{ padding: 0 }}>
              <CounselorInviteSection orgId={orgId} inviteList={[]} showList={false} inviteRole={inviteRole} onRefresh={() => refresh(orgId)} />
            </div>
            <div className="u2-dialog-actions">
              <button type="button" className="u2-secondary" onClick={() => setShowInvite(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {statusDialog && (
        <StatusChangeDialog
          counselor={statusDialog.counselor}
          mode={statusDialog.mode}
          busy={busy}
          onConfirm={(reason) => void handleStatusChange(reason)}
          onCancel={() => setStatusDialog(null)}
        />
      )}
    </UiV2OrgShell>
  );
}
