import AgentCheckinPanel from '../../components/clients/agent-checkin-panel';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import { useAuthStore } from '../../stores/authStore';
import {
  getClientActivity,
  getClientProfile,
  getClientReports,
  revealClientContact,
  updateMemo,
  type ActivityType,
  type ClientActivityItem,
  type ClientProfile,
  type ClientReportsResponse,
  type ContactReveal,
} from '../../lib/api/clients';
import { ApiError } from '../../lib/api/client';
import { useRequireAuth, useRequireRole } from '../../hooks/useAuth';
import MemberTypeBadge from '../../components/clients/MemberTypeBadge';
import { MEMBER_TYPE_HELP } from '../../lib/clients/member-type';
import { isAiEnabled } from '../../lib/feature-flags';
import { ACTIVITY_LABELS, ageLabel, formatKst, genderLabel } from '../../lib/clients/overview';
import { buttonClass } from '../../components/ui';

const PERIODS = [
  { days: 7, label: '7일' },
  { days: 30, label: '30일' },
  { days: 90, label: '90일' },
];

const panel = 'rounded-[20px] border border-[#E6E3E6] bg-white p-5';

export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isInitialized, user } = useAuthStore();

  // SEC-07: 회원 프로필 상세는 상담사·기관관리자 역할만 접근 가능 (라우트 RoleGuard와 이중 방어)
  useRequireAuth();
  useRequireRole(['counselor', 'org_admin']);

  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [memo, setMemo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [memoError, setMemoError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // 연락처 원문은 화면 상태로만 둔다(URL·스토리지 저장 금지). 다른 회원으로 이동하면 폐기.
  const [revealed, setRevealed] = useState<ContactReveal | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  const [days, setDays] = useState(30);
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [activity, setActivity] = useState<ClientActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [aiIncluded, setAiIncluded] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityKey, setActivityKey] = useState(0);

  const [reports, setReports] = useState<ClientReportsResponse | null>(null);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [reportsKey, setReportsKey] = useState(0);

  useEffect(() => {
    setRevealed(null);
    setRevealError(null);
  }, [id]);

  useEffect(() => {
    if (!id || !isAuthenticated) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getClientProfile(id)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setMemo(p.memo ?? '');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : '프로필을 불러오지 못했습니다');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isAuthenticated]);

  // 활동 타임라인 — 부분 실패를 '활동 없음'으로 바꾸지 않고 재시도를 보여 준다.
  useEffect(() => {
    if (!id || !isAuthenticated) return;
    let cancelled = false;
    setActivityLoading(true);
    setActivityError(null);
    getClientActivity(id, { days, types, limit: 20 })
      .then((res) => {
        if (cancelled) return;
        setActivity(res.items);
        setNextCursor(res.next_cursor);
        setAiIncluded(res.ai_included);
      })
      .catch((err) => {
        if (cancelled) return;
        setActivityError(err instanceof ApiError ? err.message : '활동을 불러오지 못했습니다');
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isAuthenticated, days, types, activityKey]);

  useEffect(() => {
    if (!id || !isAuthenticated) return;
    let cancelled = false;
    setReportsError(null);
    getClientReports(id)
      .then((res) => {
        if (!cancelled) setReports(res);
      })
      .catch((err) => {
        if (!cancelled) setReportsError(err instanceof ApiError ? err.message : '리포트를 불러오지 못했습니다');
      });
    return () => {
      cancelled = true;
    };
  }, [id, isAuthenticated, reportsKey]);

  const loadMore = useCallback(async () => {
    if (!id || !nextCursor) return;
    setActivityLoading(true);
    try {
      const res = await getClientActivity(id, { days, types, limit: 20, cursor: nextCursor });
      setActivity((prev) => [...prev, ...res.items]);
      setNextCursor(res.next_cursor);
    } catch (err) {
      setActivityError(err instanceof ApiError ? err.message : '활동을 불러오지 못했습니다');
    } finally {
      setActivityLoading(false);
    }
  }, [id, nextCursor, days, types]);

  const toggleType = (t: ActivityType) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const handleReveal = async () => {
    if (!id) return;
    setRevealing(true);
    setRevealError(null);
    try {
      setRevealed(await revealClientContact(id));
    } catch (err) {
      setRevealError(err instanceof ApiError ? err.message : '개인정보를 열람할 수 없습니다');
    } finally {
      setRevealing(false);
    }
  };

  const handleSaveMemo = async () => {
    if (!id) return;
    setSaving(true);
    setMemoError(null);
    try {
      await updateMemo(id, memo);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2000);
    } catch (err) {
      setMemoError(err instanceof ApiError ? err.message : '메모 저장에 실패했습니다');
    } finally {
      setSaving(false);
    }
  };

  if (!isInitialized || loading) {
    return <div className="flex min-h-screen items-center justify-center bg-surface-canvas">불러오는 중...</div>;
  }

  if (error && !profile) {
    return (
      <AppShell title="회원">
        <div className="py-24 text-center">
          <p role="alert" className="text-red-600">{error}</p>
          <button type="button" className="mb-btn mb-btn--ghost mt-4" onClick={() => navigate('/clients')}>
            목록으로
          </button>
        </div>
      </AppShell>
    );
  }

  if (!profile) return null;

  const backLink = (
    <Link to="/clients" className="inline-flex min-h-[44px] items-center text-sm text-[#6F6F6F] hover:text-[#5F0080]">
      ← 목록으로
    </Link>
  );

  return (
    <AppShell title={profile.name} sub="CLIENT" rightSlot={backLink}>
      <div className="mx-auto w-full max-w-mb-content space-y-5">
        {/* 요약 헤더 */}
        <section aria-label="회원 요약" className={panel}>
          <div className="flex items-center gap-4">
            {profile.profile_image_url ? (
              <img src={profile.profile_image_url} alt={profile.name} className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#F5EDFC] text-xl font-semibold text-[#5F0080]">
                {profile.name.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold text-[#1F1F1F]">{profile.name}</h1>
              <p className="truncate text-sm text-[#6F6F6F]">{profile.email}</p>
              {profile.member_type && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[#6F6F6F]">
                  <MemberTypeBadge type={profile.member_type} />
                  <span data-testid="member-type-desc">{MEMBER_TYPE_HELP[profile.member_type]}</span>
                </p>
              )}
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-[#6F6F6F]">성별</dt>
              <dd className="text-[#1F1F1F]">{genderLabel(profile.gender)}</dd>
            </div>
            <div>
              <dt className="text-[#6F6F6F]">만 나이</dt>
              <dd className="text-[#1F1F1F]">{ageLabel(profile.age)}</dd>
            </div>
            <div>
              <dt className="text-[#6F6F6F]">연락처</dt>
              <dd className="font-mono text-[#1F1F1F]" data-testid="contact-phone">
                {revealed ? revealed.phone || '미입력' : profile.phone_masked ?? '미입력'}
              </dd>
            </div>
            <div>
              <dt className="text-[#6F6F6F]">생년월일</dt>
              <dd className="font-mono text-[#1F1F1F]" data-testid="contact-birth">
                {revealed ? revealed.birth_date || '미입력' : '비공개 (열람 시 표시)'}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {!revealed ? (
              <button type="button" className="mb-btn mb-btn--ghost" onClick={handleReveal} disabled={revealing}>
                {revealing ? '확인 중...' : '개인정보 열람'}
              </button>
            ) : (
              <button type="button" className="mb-btn mb-btn--ghost" onClick={() => setRevealed(null)}>
                다시 가리기
              </button>
            )}
            <span className="text-[12px] text-[#6F6F6F]">열람할 때마다 권한을 다시 확인하고 열람 기록을 남깁니다.</span>
            {revealError && <span role="alert" className="text-sm text-red-600">{revealError}</span>}
          </div>
          {profile.bio && <p className="mt-4 text-sm text-[#4B4B4B]">{profile.bio}</p>}
          {(profile.concerns.length > 0 || profile.interests.length > 0) && (
            <div className="mt-4 flex flex-wrap gap-1">
              {profile.concerns.map((tag) => (
                <span key={`c-${tag}`} className="rounded-full bg-[#F5EDFC] px-2 py-0.5 text-xs text-[#5F0080]">{tag}</span>
              ))}
              {profile.interests.map((tag) => (
                <span key={`i-${tag}`} className="rounded-full bg-[#EFE3FA] px-2 py-0.5 text-xs text-[#6E1A8C]">{tag}</span>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {/* 활동 타임라인 */}
          <section aria-label="활동 타임라인" className={panel}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[#1F1F1F]">활동 타임라인</h2>
              <div role="group" aria-label="기간" className="flex rounded-[13px] border border-[#DDDEE7] p-1">
                {PERIODS.map((p) => (
                  <button
                    key={p.days}
                    type="button"
                    aria-pressed={days === p.days}
                    onClick={() => setDays(p.days)}
                    className={`min-h-[40px] min-w-[56px] rounded-[10px] px-3 text-sm ${
                      days === p.days ? 'bg-[#F5EDFC] font-bold text-[#5F0080]' : 'text-[#6F6F6F]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div role="group" aria-label="활동 유형" className="mt-3 flex flex-wrap gap-2">
              {(Object.keys(ACTIVITY_LABELS) as ActivityType[])
                .filter((t) => t !== 'ai_checkin' || aiIncluded)
                .map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={types.includes(t)}
                    onClick={() => toggleType(t)}
                    className={`min-h-[44px] rounded-full border px-3 text-sm ${
                      types.includes(t)
                        ? 'border-[#5F0080] bg-[#F5EDFC] font-bold text-[#5F0080]'
                        : 'border-[#DDDEE7] text-[#6F6F6F]'
                    }`}
                  >
                    {ACTIVITY_LABELS[t]}
                  </button>
                ))}
            </div>

            {activityError && (
              <div role="alert" className="py-6 text-center text-red-600">
                <p>{activityError}</p>
                <button type="button" className="mb-btn mb-btn--ghost mt-3" onClick={() => setActivityKey((k) => k + 1)}>
                  다시 시도
                </button>
              </div>
            )}
            {!activityError && (
              <ol className="mt-4 space-y-3">
                {activity.map((a) => (
                  <li key={`${a.type}-${a.id}`} className="rounded-[14px] border border-[#F0EDF1] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded-full bg-[#F5EDFC] px-2 py-0.5 text-[12px] text-[#5F0080]">
                        {ACTIVITY_LABELS[a.type]}
                      </span>
                      <time className="font-mono text-[12px] text-[#6F6F6F]" dateTime={a.occurred_at}>
                        {formatKst(a.occurred_at)}
                      </time>
                    </div>
                    <p className="mt-2 font-medium text-[#1F1F1F]">{a.title}</p>
                    {(a.class_title || a.note) && (
                      <p className="text-[13px] text-[#6F6F6F]">{[a.class_title, a.note].filter(Boolean).join(' · ')}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {!activityError && !activityLoading && activity.length === 0 && (
              <p className="py-8 text-center text-sm text-[#6F6F6F]">선택한 기간에 확인된 활동이 없습니다.</p>
            )}
            {activityLoading && <p className="py-4 text-center text-sm text-[#6F6F6F]">불러오는 중...</p>}
            {nextCursor && !activityLoading && (
              <div className="pt-3 text-center">
                <button type="button" className="mb-btn mb-btn--ghost" onClick={loadMore}>
                  더 보기
                </button>
              </div>
            )}
          </section>

          <div className="space-y-5">
            {/* 리포트 */}
            <section aria-label="리포트" className={panel}>
              <h2 className="text-lg font-semibold text-[#1F1F1F]">리포트</h2>
              {reportsError && (
                <div role="alert" className="py-4 text-center text-red-600">
                  <p>{reportsError}</p>
                  <button type="button" className="mb-btn mb-btn--ghost mt-3" onClick={() => setReportsKey((k) => k + 1)}>
                    다시 시도
                  </button>
                </div>
              )}
              {!reportsError && reports && reports.reports.length === 0 && (
                <p className="py-6 text-center text-sm text-[#6F6F6F]">열람할 수 있는 리포트가 없습니다.</p>
              )}
              <ul className="mt-3 space-y-2">
                {(reports?.reports ?? []).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 rounded-[14px] border border-[#F0EDF1] p-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[#1F1F1F]">{r.title}</p>
                      <p className="text-[12px] text-[#6F6F6F]">
                        {r.type_label} · <span className="font-mono">{formatKst(r.occurred_at)}</span>
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[#F5EDFC] px-2 py-0.5 text-[12px] text-[#5F0080]">
                      {r.status_label}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* 변화 서사 — 점수·종합점수·회차 간 비교 없음 */}
            <section aria-label="회차 내부 변화" className={panel}>
              <h2 className="text-lg font-semibold text-[#1F1F1F]">회차 내부 변화</h2>
              <p className="mt-1 text-[12px] text-[#6F6F6F]">
                승인된 리포트의 같은 회차 안 전반→후반 변화만 보여 줍니다. 회차끼리 비교하거나 점수로 환산하지 않습니다.
              </p>
              <ul className="mt-3 space-y-3">
                {(reports?.changes ?? []).map((c) => (
                  <li key={c.report_id} className="rounded-[14px] border border-[#F0EDF1] p-3">
                    <p className="text-[13px] font-medium text-[#1F1F1F]">
                      {c.title} <span className="font-mono text-[12px] font-normal text-[#6F6F6F]">{formatKst(c.occurred_at)}</span>
                    </p>
                    <p className="mt-1 text-sm text-[#4B4B4B]">{c.summary}</p>
                  </li>
                ))}
              </ul>
              {reports && reports.changes.length === 0 && (
                <p className="py-4 text-center text-sm text-[#6F6F6F]">승인된 리포트가 없어 변화 기록이 없습니다.</p>
              )}
            </section>
          </div>
        </div>

        {/* SDD-220: AI 비공개면 체크인 패널(조회 포함)을 mount 하지 않는다 */}
        {isAiEnabled() && id && user?.role === 'counselor' && <AgentCheckinPanel key={id} clientId={id} />}

        {profile?.memo_editable !== false && (
        <section aria-label="코치 비공개 메모" className={panel}>
          <h2 className="mb-2 text-lg font-semibold">코치 비공개 메모</h2>
          <p className="mb-3 text-xs text-gray-500">회원에게 공개되지 않습니다.</p>
          <textarea
            id="client-memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={6}
            aria-invalid={memoError ? true : undefined}
            aria-describedby={memoError ? 'client-memo-error' : undefined}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5F0080]"
            placeholder="상담 메모를 입력하세요"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={handleSaveMemo}
              disabled={saving}
              className={buttonClass({ variant: 'primary' })}
            >
              {saving ? '저장 중...' : '저장'}
            </button>
            {savedAt && <span role="status" className="text-sm text-[#5F0080]">저장되었습니다</span>}
            {memoError && <span id="client-memo-error" role="alert" className="text-sm text-red-600">{memoError}</span>}
          </div>
        </section>
        )}
      </div>
    </AppShell>
  );
}
