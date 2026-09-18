// SDD-082: 기관 관리자 — 상담사 관리 페이지 (조회/검색/상태 관리/이력/활성화·비활성화)

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import CounselorInfoEditor from '../../components/counselor/counselor-info-editor';
import { ApiError } from '../../lib/api/client';
import { getOrgDashboard } from '../../lib/api/dashboard';
import {
  getCounselorActivity,
  listCounselors,
  suspendCounselor,
  unsuspendCounselor,
  type CounselorActivity,
  type CounselorItem,
} from '../../lib/api/org';
import {
  getOrgCounselorProfile,
  patchOrgCounselorProfile,
  type CounselorInfoDto,
} from '../../lib/api/counselor-info';

type DisplayStatus = 'active' | 'pending' | 'suspended';

const SESSION_STATUS_LABELS: Record<string, string> = {
  scheduled: '예정',
  in_progress: '진행중',
  paused: '일시정지',
  completed: '완료',
  canceled: '취소',
  cancelled: '취소',
};

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

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: DisplayStatus }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center rounded-full bg-[#D1FAE5] px-2.5 py-1 text-[11px] font-bold text-[#065F46]">
        활성
      </span>
    );
  }
  if (status === 'suspended') {
    return (
      <span className="inline-flex items-center rounded-full bg-[#FEE2E2] px-2.5 py-1 text-[11px] font-bold text-[#991B1B]">
        정지
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-[#FEF3C7] px-2.5 py-1 text-[11px] font-bold text-[#92400E]">
      대기
    </span>
  );
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-[17px] font-bold text-[#1F1F1F]">
          {isSuspend ? '상담사 비활성화' : '상담사 활성화'}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-[#6F6F6F]">
          <span className="font-semibold text-[#1F1F1F]">{counselor.name}</span>
          {isSuspend
            ? ' 계정을 비활성화합니다. 비활성화된 상담사는 로그인이 차단되며, 데이터는 삭제되지 않습니다.'
            : ' 계정을 다시 활성화합니다. 활성화 즉시 로그인이 가능해집니다.'}
        </p>
        <label className="mt-4 block text-[12px] font-semibold text-[#6F6F6F]">
          사유 (필수)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="예: 휴직 처리에 따른 계정 비활성화"
            className="mt-1.5 w-full rounded-xl border border-[#DDDEE7] p-3 text-[14px] font-normal text-[#1F1F1F] focus:border-[#5F0080] focus:outline-none"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-[#DDDEE7] px-4 py-2.5 text-[14px] font-semibold text-[#6F6F6F] hover:bg-[#F8FAFC] disabled:opacity-60"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={busy || !reason.trim()}
            className={`rounded-xl px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50 ${
              isSuspend ? 'bg-[#B3261E] hover:bg-[#991B1B]' : 'bg-[#1F8A5B] hover:bg-[#065F46]'
            }`}
          >
            {busy ? '처리 중…' : isSuspend ? '비활성화' : '활성화'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 상세 패널 — 프로필 정보 + 최근 이력 (세션/리포트 탭) */
function CounselorDetailPanel({
  orgId,
  counselor,
  onClose,
}: {
  orgId: string;
  counselor: CounselorItem;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<CounselorInfoDto | null>(null);
  const [activity, setActivity] = useState<CounselorActivity | null>(null);
  const [tab, setTab] = useState<'sessions' | 'reports'>('sessions');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      // org_admin 행은 SDD-077 프로필 조회가 가능하지만 실패해도 이력은 보여준다
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

  return (
    <section className="rounded-2xl border border-[#DDDEE7] bg-white p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-bold tracking-tight text-[#1F1F1F]">
            {counselor.name}
            <span className="ml-2 align-middle">
              <StatusBadge status={displayStatusOf(counselor)} />
            </span>
          </h2>
          <p className="mt-0.5 break-all text-[13px] text-[#6F6F6F]">{counselor.email}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[#DDDEE7] px-3 py-1.5 text-[12px] font-semibold text-[#6F6F6F] hover:bg-[#F8FAFC]"
        >
          닫기
        </button>
      </div>

      {error && <p className="mt-3 text-[13px] text-[#B3261E]" role="alert">{error}</p>}

      {/* 프로필 요약 */}
      <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
        {[
          ['상담사 코드', counselor.counselor_code ?? profile?.counselor_code ?? '-'],
          ['역할', counselor.role === 'org_admin' ? '기관 관리자' : '상담사'],
          ['전화번호', profile?.phone ?? '-'],
          ['활동 형태', counselor.has_personal_office ? '개인 상담소 운영' : '기관 소속'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-[#F8FAFC] p-3">
            <dt className="text-[11px] text-[#6F6F6F]">{k}</dt>
            <dd className="mt-0.5 font-semibold text-[#1F1F1F]">{v}</dd>
          </div>
        ))}
      </dl>

      {/* 최근 이력 탭 */}
      <div className="mt-5 flex gap-1 border-b border-[#EFEFEF]">
        {(
          [
            ['sessions', `최근 세션 (${activity?.sessions.length ?? 0})`],
            ['reports', `최근 리포트 (${activity?.reports.length ?? 0})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-[13px] font-semibold transition-colors ${
              tab === key
                ? 'border-b-2 border-[#5F0080] text-[#5F0080]'
                : 'text-[#6F6F6F] hover:text-[#1F1F1F]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activity == null && !error ? (
        <p className="py-6 text-center text-[13px] text-[#6F6F6F]">이력을 불러오는 중…</p>
      ) : tab === 'sessions' ? (
        activity && activity.sessions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#EFEFEF] text-[11px] text-[#6F6F6F]">
                  {['제목', '유형', '상태', '일시', '참여자'].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activity.sessions.map((s) => (
                  <tr key={s.id} className="border-b border-[#EFEFEF] last:border-0">
                    <td className="px-3 py-2.5 font-medium text-[#1F1F1F]">{s.title || '제목 없음'}</td>
                    <td className="px-3 py-2.5 text-[#6F6F6F]">{SESSION_TYPE_LABELS[s.type] ?? s.type}</td>
                    <td className="px-3 py-2.5 text-[#6F6F6F]">{SESSION_STATUS_LABELS[s.status] ?? s.status}</td>
                    <td className="px-3 py-2.5 font-mono text-[12px] text-[#6F6F6F]">
                      {formatDateTime(s.scheduled_at ?? s.started_at)}
                    </td>
                    <td className="px-3 py-2.5 text-[#6F6F6F]">{s.participant_count}명</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-6 text-center text-[13px] text-[#6F6F6F]">최근 세션이 없습니다.</p>
        )
      ) : activity && activity.reports.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#EFEFEF] text-[11px] text-[#6F6F6F]">
                {['제목', '유형', '상태', '생성일'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activity.reports.map((r) => (
                <tr key={r.id} className="border-b border-[#EFEFEF] last:border-0">
                  <td className="px-3 py-2.5 font-medium text-[#1F1F1F]">{r.title || '제목 없음'}</td>
                  <td className="px-3 py-2.5 text-[#6F6F6F]">{r.type === 'counselor' ? '상담사용' : '내담자용'}</td>
                  <td className="px-3 py-2.5 text-[#6F6F6F]">{REPORT_STATUS_LABELS[r.status] ?? r.status}</td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-[#6F6F6F]">{formatDateTime(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-6 text-center text-[13px] text-[#6F6F6F]">최근 리포트가 없습니다.</p>
      )}
    </section>
  );
}

export default function OrgCounselorsPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [counselors, setCounselors] = useState<CounselorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<CounselorItem | null>(null);
  const [editing, setEditing] = useState<CounselorItem | null>(null);
  const [statusDialog, setStatusDialog] = useState<{
    counselor: CounselorItem;
    mode: 'suspend' | 'unsuspend';
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (targetOrgId: string): Promise<void> => {
    const list = await listCounselors(targetOrgId);
    setCounselors(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // FE User 타입에는 org_id 가 없으므로 기관 대시보드 응답에서 얻는다 (OrgDashboardPage 와 동일)
    getOrgDashboard()
      .then(async (res) => {
        if (cancelled) return;
        setOrgId(res.org_id);
        await refresh(res.org_id);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : '상담사 목록을 불러오지 못했습니다');
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
      const matchQuery =
        !q ||
        [c.name, c.email, c.counselor_code ?? ''].some((v) => v.toLowerCase().includes(q));
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
      const res =
        mode === 'suspend'
          ? await suspendCounselor(orgId, counselor.id, reason)
          : await unsuspendCounselor(orgId, counselor.id, reason);
      setCounselors((prev) =>
        prev.map((c) => (c.id === counselor.id ? { ...c, status: res.status } : c)),
      );
      setSelected((prev) =>
        prev && prev.id === counselor.id ? { ...prev, status: res.status } : prev,
      );
      setStatusDialog(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '상태 변경에 실패했습니다');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="상담사 관리" sub="COUNSELORS">
      {error && (
        <div className="mb-4 rounded-xl bg-[#FDECEC] p-3 text-sm text-[#B3261E]" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-[#6F6F6F]">불러오는 중...</div>
      ) : (
        <div className="space-y-6">
          {/* SDD-077 재사용 — 상담사 정보 수정 */}
          {editing && orgId && (
            <section className="rounded-2xl border border-[#DDDEE7] bg-white p-6">
              <h2 className="mb-4 text-[17px] font-bold text-[#1F1F1F]">
                정보 수정 — {editing.name}
              </h2>
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

          {/* 검색 + 필터 */}
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="상담사 검색"
              placeholder="이름·이메일·코드 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-xl border border-[#DDDEE7] bg-white px-3.5 text-[14px] text-[#1F1F1F] focus:border-[#5F0080] focus:outline-none"
            />
            <select
              aria-label="역할 필터"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="h-10 rounded-xl border border-[#DDDEE7] bg-white px-3 text-[14px] text-[#1F1F1F]"
            >
              <option value="">전체 역할</option>
              <option value="counselor">상담사</option>
              <option value="org_admin">기관 관리자</option>
            </select>
            <select
              aria-label="상태 필터"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 rounded-xl border border-[#DDDEE7] bg-white px-3 text-[14px] text-[#1F1F1F]"
            >
              <option value="">전체 상태</option>
              <option value="active">활성</option>
              <option value="pending">대기</option>
              <option value="suspended">정지</option>
            </select>
          </div>

          {/* 목록 */}
          {counselors.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#DDDEE7] p-8 text-center text-sm text-[#6F6F6F]">
              아직 소속된 상담사가 없습니다. 기관 대시보드에서 상담사를 초대해 보세요.
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#DDDEE7] p-8 text-center text-sm text-[#6F6F6F]">
              검색 조건에 맞는 상담사가 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-[#EFEFEF] bg-white">
              <table className="w-full min-w-[720px] text-[14px]">
                <thead>
                  <tr className="border-b border-[#EFEFEF] bg-[#F8FAFC]">
                    {['이름', '이메일', '코드', '역할', '상태', '관리'].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-left font-mono text-[12px] uppercase tracking-wider text-[#6F6F6F]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const status = displayStatusOf(c);
                    const isCounselor = c.role === 'counselor';
                    return (
                      <tr
                        key={c.id}
                        className="border-b border-[#EFEFEF] transition-colors last:border-0 hover:bg-[#F8FAFC]"
                      >
                        <td className="px-5 py-3.5 font-medium text-[#1F1F1F]">
                          {c.name}
                          {c.has_personal_office && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-[#EDE9FE] px-2 py-0.5 text-[10px] font-bold text-[#5B21B6]">
                              개인 상담소
                            </span>
                          )}
                        </td>
                        <td className="break-all px-5 py-3.5 text-[#6F6F6F]">{c.email}</td>
                        <td className="px-5 py-3.5 font-mono text-[12px] text-[#6F6F6F]">
                          {c.counselor_code ?? '-'}
                        </td>
                        <td className="px-5 py-3.5 text-[#6F6F6F]">
                          {c.role === 'org_admin' ? '기관 관리자' : '상담사'}
                        </td>
                        <td className="px-5 py-3.5">
                          <StatusBadge status={status} />
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditing(c)}
                              disabled={!isCounselor || !!editing}
                              title={
                                !isCounselor
                                  ? '기관 관리자 계정은 본인 설정 또는 플랫폼 관리자를 통해 수정합니다'
                                  : undefined
                              }
                              className="rounded-lg border border-[#DDDEE7] px-2.5 py-1.5 text-[12px] font-semibold text-[#6F6F6F] hover:bg-white hover:text-[#1F1F1F] disabled:opacity-40"
                            >
                              정보 수정
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelected(c)}
                              className="rounded-lg border border-[#DDDEE7] px-2.5 py-1.5 text-[12px] font-semibold text-[#6F6F6F] hover:bg-white hover:text-[#1F1F1F]"
                            >
                              이력
                            </button>
                            {isCounselor && status !== 'pending' && (
                              <button
                                type="button"
                                onClick={() =>
                                  setStatusDialog({
                                    counselor: c,
                                    mode: status === 'suspended' ? 'unsuspend' : 'suspend',
                                  })
                                }
                                className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold ${
                                  status === 'suspended'
                                    ? 'border-[#A7D9C4] text-[#1F8A5B] hover:bg-[#E6F8F3]'
                                    : 'border-[#F0B8B4] text-[#B3261E] hover:bg-[#FDECEC]'
                                }`}
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

          {/* 상세 패널 — 프로필 + 최근 이력 */}
          {selected && orgId && (
            // key 로 상담사 변경 시 재마운트 — 이전 상담사의 프로필/이력 상태를 초기화한다
            <CounselorDetailPanel
              key={selected.id}
              orgId={orgId}
              counselor={selected}
              onClose={() => setSelected(null)}
            />
          )}
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
    </AppShell>
  );
}
