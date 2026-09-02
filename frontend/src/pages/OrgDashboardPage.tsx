// 기관 클래스 대시보드 (SDD-015, SDD-017)

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import { StatusBadge } from '../components/session/StatusBadge';
import {
  getOrgDashboard,
  type ClassSummary,
  type OrgCounselorStat,
  type OrgDashboardResponse,
} from '../lib/api/dashboard';
import {
  inviteCounselor,
  listCounselors,
  resendCounselorInvite,
  type CounselorItem,
} from '../lib/api/org';
import { ApiError } from '../lib/api/client';
import type { SessionType } from '../lib/api/session';

const TYPE_LABELS: Record<SessionType, string> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상수업',
  custom: '기타',
};

const TYPE_CLASSES: Record<SessionType, string> = {
  clinical: 'bg-[#F5EDFC] text-[#5F0080]',
  hypnosis: 'bg-[#EFE3FA] text-[#6E1A8C]',
  meditation: 'bg-[#E6F8F3] text-[#1F8A5B]',
  custom: 'bg-[#FFF4DC] text-[#8A6B1F]',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

type InviteDisplayStatus = 'pending' | 'active' | 'expired';

function getInviteDisplayStatus(counselor: CounselorItem): InviteDisplayStatus {
  if (counselor.status === 'active') return 'active';
  if (counselor.invite_expires_at && new Date(counselor.invite_expires_at) < new Date()) {
    return 'expired';
  }
  return 'pending';
}

function InviteStatusBadge({ status }: { status: InviteDisplayStatus }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center rounded-full bg-[#D1FAE5] px-2.5 py-1 text-[11px] font-bold text-[#065F46]">
        활성
      </span>
    );
  }
  if (status === 'expired') {
    return (
      <span className="inline-flex items-center rounded-full bg-[#FEE2E2] px-2.5 py-1 text-[11px] font-bold text-[#991B1B]">
        만료
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-[#FEF3C7] px-2.5 py-1 text-[11px] font-bold text-[#92400E]">
      대기
    </span>
  );
}

function isActiveForStats(counselorId: string, inviteList: CounselorItem[]): boolean {
  const match = inviteList.find((item) => item.id === counselorId);
  if (!match) return true;
  return match.status === 'active';
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-white border border-[#DDDEE7] rounded-2xl p-5">
      <div className="text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-2">
        {label}
      </div>
      <div className={`text-[28px] font-bold tracking-tight ${accent ?? 'text-[#1F1F1F]'}`}>
        {typeof value === 'number' ? value.toLocaleString('ko-KR') : value}
      </div>
      {sub && <div className="text-[12px] text-[#9B9B9B] mt-1 font-mono">{sub}</div>}
    </div>
  );
}

function TypeBadge({ cls }: { cls: ClassSummary }) {
  const label =
    cls.type === 'custom' && cls.custom_type_name
      ? cls.custom_type_name
      : TYPE_LABELS[cls.type];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide ${TYPE_CLASSES[cls.type]}`}
    >
      {label}
    </span>
  );
}

function CounselorRow({ counselor }: { counselor: OrgCounselorStat }) {
  return (
    <tr className="border-b border-[#EFEFEF] last:border-0 hover:bg-[#F8FAFC] transition-colors">
      <td className="px-6 py-4 font-medium text-[#1F1F1F]">{counselor.name}</td>
      <td className="px-6 py-4 text-[#6F6F6F] break-all">{counselor.email}</td>
      <td className="px-6 py-4 text-[#1F1F1F]">{counselor.class_count}</td>
      <td className="px-6 py-4 text-[#1F1F1F]">{counselor.participant_count}</td>
      <td className="px-6 py-4 text-[#1F8A5B] font-semibold">{counselor.completed_count}</td>
    </tr>
  );
}

function CounselorCard({ counselor }: { counselor: OrgCounselorStat }) {
  return (
    <div className="bg-white border border-[#EFEFEF] rounded-2xl p-4">
      <div className="font-bold text-[#1F1F1F] mb-1">{counselor.name}</div>
      <div className="text-[13px] text-[#6F6F6F] break-all mb-3">{counselor.email}</div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-[#F8F4FC] py-2">
          <div className="text-[11px] text-[#6F6F6F]">클래스</div>
          <div className="font-bold text-[#5F0080]">{counselor.class_count}</div>
        </div>
        <div className="rounded-xl bg-[#F8F4FC] py-2">
          <div className="text-[11px] text-[#6F6F6F]">참여자</div>
          <div className="font-bold text-[#5F0080]">{counselor.participant_count}</div>
        </div>
        <div className="rounded-xl bg-[#E6F8F3] py-2">
          <div className="text-[11px] text-[#6F6F6F]">완료</div>
          <div className="font-bold text-[#1F8A5B]">{counselor.completed_count}</div>
        </div>
      </div>
    </div>
  );
}

function ClassRow({ cls }: { cls: ClassSummary }) {
  const showRecordLink = cls.has_record || cls.has_summary;

  return (
    <tr className="border-b border-[#EFEFEF] last:border-0 hover:bg-[#F8FAFC] transition-colors">
      <td className="px-6 py-4">
        <Link
          to={`/sessions/${cls.id}`}
          className="font-medium text-[#1F1F1F] hover:text-[#5F0080] hover:underline"
        >
          {cls.title || '제목 없음'}
        </Link>
      </td>
      <td className="px-6 py-4">
        <TypeBadge cls={cls} />
      </td>
      <td className="px-6 py-4">
        <StatusBadge status={cls.status} />
      </td>
      <td className="px-6 py-4 font-mono font-bold tracking-widest text-[#5F0080]">
        {cls.access_code ?? '-'}
      </td>
      <td className="px-6 py-4 text-[#6F6F6F]">
        {cls.participant_count}명
        {cls.guest_count > 0 && (
          <span className="text-[12px] text-[#9B9B9B] ml-1">(게스트 {cls.guest_count})</span>
        )}
      </td>
      <td className="px-6 py-4 font-mono text-[12px] text-[#6F6F6F] whitespace-nowrap">
        {formatDateTime(cls.started_at)}
      </td>
      <td className="px-6 py-4 font-mono text-[12px] text-[#6F6F6F] whitespace-nowrap">
        {formatDateTime(cls.ended_at)}
      </td>
      <td className="px-6 py-4">
        {showRecordLink ? (
          <Link
            to={`/sessions/${cls.id}/record`}
            className="text-[13px] font-semibold text-[#5F0080] hover:underline"
          >
            기록 보기
          </Link>
        ) : (
          <span className="text-[12px] text-[#C2C3CE]">-</span>
        )}
      </td>
    </tr>
  );
}

function ClassCard({ cls }: { cls: ClassSummary }) {
  const showRecordLink = cls.has_record || cls.has_summary;

  return (
    <div className="bg-white border border-[#EFEFEF] rounded-2xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <Link
          to={`/sessions/${cls.id}`}
          className="font-bold text-[#1F1F1F] hover:text-[#5F0080] truncate"
        >
          {cls.title || '제목 없음'}
        </Link>
        <StatusBadge status={cls.status} />
      </div>
      <TypeBadge cls={cls} />
      <div className="text-[12px] text-[#6F6F6F]">
        코드{' '}
        <span className="font-mono font-bold tracking-widest text-[#5F0080]">
          {cls.access_code ?? '-'}
        </span>
        {' · '}
        참여 {cls.participant_count}명
        {cls.guest_count > 0 && ` · 게스트 ${cls.guest_count}`}
      </div>
      <div className="text-[12px] text-[#6F6F6F] font-mono">
        {formatDateTime(cls.started_at)} ~ {formatDateTime(cls.ended_at)}
      </div>
      {showRecordLink && (
        <Link
          to={`/sessions/${cls.id}/record`}
          className="inline-flex text-[13px] font-semibold text-[#5F0080] hover:underline"
        >
          기록 보기 →
        </Link>
      )}
    </div>
  );
}

function OrgCodeCard({ orgCode }: { orgCode: string | null }) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const handleCopy = async (): Promise<void> => {
    if (!orgCode) return;
    try {
      await navigator.clipboard.writeText(orgCode);
      setCopyMessage('기관 코드를 복사했습니다.');
    } catch {
      setCopyMessage('기관 코드를 복사하지 못했습니다.');
    }
  };

  return (
    <div className="rounded-2xl border border-[#DDD0EA] bg-[#F5EDFC] p-5 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-[15px] font-bold text-[#5F0080]">기관 코드</h2>
          <p className="mt-1 text-[13px] text-[#6F6F6F]">
            상담사는 기관 담당자의 초대로 가입합니다. 아래 코드는 기관 식별용이며, 직접 회원가입 시
            더 이상 사용하지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <strong className="font-mono text-3xl tracking-[0.2em] text-[#5F0080]">
            {orgCode ?? '-'}
          </strong>
          {orgCode && (
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="rounded-lg border border-[#C9B0E8] bg-white px-4 py-2 text-[13px] font-semibold text-[#5F0080] transition-colors hover:bg-[#EFE3FA]"
            >
              코드 복사
            </button>
          )}
        </div>
      </div>
      {copyMessage && <p className="mt-3 text-[13px] text-[#5F0080]">{copyMessage}</p>}
    </div>
  );
}

function CounselorInviteSection({
  orgId,
  inviteList,
  onRefresh,
}: {
  orgId: string;
  inviteList: CounselorItem[];
  onRefresh: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [resendingUserId, setResendingUserId] = useState<string | null>(null);

  const handleInvite = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedEmail = email.trim();

    if (!normalizedName) {
      setInviteError('이름을 입력해주세요.');
      return;
    }
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setInviteError('올바른 이메일을 입력해주세요.');
      return;
    }

    setInviting(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      await inviteCounselor(orgId, { name: normalizedName, email: normalizedEmail });
      setName('');
      setEmail('');
      setInviteSuccess(`${normalizedEmail}(으)로 초대 메일을 발송했습니다.`);
      await onRefresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setInviteError('이미 등록된 이메일입니다. 다른 이메일을 사용해주세요.');
      } else {
        setInviteError(err instanceof Error ? err.message : '초대 발송에 실패했습니다.');
      }
    } finally {
      setInviting(false);
    }
  };

  const handleResend = async (userId: string): Promise<void> => {
    setResendingUserId(userId);
    setInviteError(null);
    try {
      await resendCounselorInvite(orgId, userId);
      setInviteSuccess('초대 메일을 다시 발송했습니다.');
      await onRefresh();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : '초대 메일 재발송에 실패했습니다.');
    } finally {
      setResendingUserId(null);
    }
  };

  const sortedInviteList = [...inviteList].sort((a, b) => {
    const aTime = a.invited_at ? new Date(a.invited_at).getTime() : 0;
    const bTime = b.invited_at ? new Date(b.invited_at).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-[#EFEFEF] bg-white p-5 md:p-6">
        <div className="mb-5">
          <h2 className="text-[17px] font-bold text-[#1F1F1F]">상담사 초대</h2>
          <p className="mt-1 text-[13px] text-[#6F6F6F]">
            이름과 이메일을 입력하면 초대 메일이 발송됩니다. 상담사는 메일의 링크로 비밀번호를
            설정한 뒤 바로 이용할 수 있습니다.
          </p>
        </div>

        {inviteSuccess && (
          <div
            role="status"
            className="mb-4 rounded-xl bg-[#D1FAE5] px-4 py-3 text-[13px] font-medium text-[#065F46]"
          >
            {inviteSuccess}
          </div>
        )}

        <form
          onSubmit={(event) => void handleInvite(event)}
          className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"
        >
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-[#1F1F1F]">이름</span>
            <input
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setInviteError(null);
              }}
              placeholder="홍길동"
              maxLength={100}
              disabled={inviting}
              className="w-full rounded-xl border border-[#EFEFEF] px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20 disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-[#1F1F1F]">이메일</span>
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setInviteError(null);
              }}
              placeholder="name@example.com"
              disabled={inviting}
              className={`w-full rounded-xl border px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20 disabled:opacity-60 ${
                inviteError ? 'border-[#F87171] bg-[#FEF2F2]' : 'border-[#EFEFEF]'
              }`}
            />
            {inviteError && (
              <p role="alert" className="mt-1.5 text-[12px] text-[#B3261E]">
                {inviteError}
              </p>
            )}
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={inviting || !name.trim() || !email.trim()}
              className="h-[42px] w-full rounded-xl bg-[#5F0080] px-6 text-[14px] font-semibold text-white transition-colors hover:bg-[#4B0066] disabled:opacity-60 md:w-auto"
            >
              {inviting ? '발송 중…' : '초대 발송'}
            </button>
          </div>
        </form>
      </div>

      <div>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-[17px] font-bold tracking-tight text-[#1F1F1F]">초대·가입 현황</h2>
          <span className="font-mono text-[11px] text-[#6F6F6F]">{sortedInviteList.length}명</span>
        </div>

        {sortedInviteList.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#DDDEE7] p-8 text-center">
            <p className="text-sm text-[#6F6F6F]">아직 초대한 상담사가 없습니다.</p>
            <p className="mt-2 text-[13px] text-[#9B9B9B]">
              위 양식에서 이름과 이메일을 입력하고 초대를 발송해주세요.
            </p>
          </div>
        ) : (
          <>
            <div className="block space-y-3 md:hidden">
              {sortedInviteList.map((counselor) => {
                const displayStatus = getInviteDisplayStatus(counselor);
                const canResend = displayStatus === 'pending' || displayStatus === 'expired';
                return (
                  <div
                    key={counselor.id}
                    className="rounded-2xl border border-[#EFEFEF] bg-white p-4"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-[#1F1F1F]">{counselor.name}</div>
                        <div className="break-all text-[13px] text-[#6F6F6F]">{counselor.email}</div>
                      </div>
                      <InviteStatusBadge status={displayStatus} />
                    </div>
                    <div className="text-[12px] text-[#6F6F6F]">
                      초대일 {formatDate(counselor.invited_at)}
                    </div>
                    {canResend && (
                      <button
                        type="button"
                        onClick={() => void handleResend(counselor.id)}
                        disabled={resendingUserId === counselor.id}
                        className="mt-3 rounded-lg border border-[#C9B0E8] bg-[#F5EDFC] px-3 py-1.5 text-[12px] font-semibold text-[#5F0080] hover:bg-[#EFE3FA] disabled:opacity-60"
                      >
                        {resendingUserId === counselor.id ? '발송 중…' : '재발송'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto rounded-2xl border border-[#EFEFEF] bg-white md:block">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-[#EFEFEF] bg-[#F8FAFC]">
                    <th className="px-6 py-3 text-left text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
                      이름
                    </th>
                    <th className="px-6 py-3 text-left text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
                      이메일
                    </th>
                    <th className="px-6 py-3 text-left text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
                      상태
                    </th>
                    <th className="px-6 py-3 text-left text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
                      초대일
                    </th>
                    <th className="px-6 py-3 text-left text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
                      작업
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedInviteList.map((counselor) => {
                    const displayStatus = getInviteDisplayStatus(counselor);
                    const canResend = displayStatus === 'pending' || displayStatus === 'expired';
                    return (
                      <tr
                        key={counselor.id}
                        className="border-b border-[#EFEFEF] last:border-0 transition-colors hover:bg-[#F8FAFC]"
                      >
                        <td className="px-6 py-4 font-medium text-[#1F1F1F]">{counselor.name}</td>
                        <td className="px-6 py-4 break-all text-[#6F6F6F]">{counselor.email}</td>
                        <td className="px-6 py-4">
                          <InviteStatusBadge status={displayStatus} />
                        </td>
                        <td className="px-6 py-4 font-mono text-[12px] text-[#6F6F6F]">
                          {formatDate(counselor.invited_at)}
                        </td>
                        <td className="px-6 py-4">
                          {canResend ? (
                            <button
                              type="button"
                              onClick={() => void handleResend(counselor.id)}
                              disabled={resendingUserId === counselor.id}
                              className="rounded-lg border border-[#C9B0E8] bg-[#F5EDFC] px-3 py-1.5 text-[12px] font-semibold text-[#5F0080] hover:bg-[#EFE3FA] disabled:opacity-60"
                            >
                              {resendingUserId === counselor.id ? '발송 중…' : '재발송'}
                            </button>
                          ) : (
                            <span className="text-[12px] text-[#C2C3CE]">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export default function OrgDashboardPage() {
  const [data, setData] = useState<OrgDashboardResponse | null>(null);
  const [inviteList, setInviteList] = useState<CounselorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCounselors = useCallback(async (orgId: string): Promise<void> => {
    try {
      const counselors = await listCounselors(orgId);
      setInviteList(counselors.filter((item) => item.role === 'counselor'));
    } catch {
      setInviteList([]);
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
      const [dashboardRes, counselors] = await Promise.all([
        getOrgDashboard(),
        listCounselors(data.org_id),
      ]);
      setData(dashboardRes);
      setInviteList(counselors.filter((item) => item.role === 'counselor'));
    } catch (err) {
      setError(err instanceof Error ? err.message : '목록을 새로고침하지 못했습니다');
    }
  }, [data?.org_id]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  const activeCounselors =
    data?.counselors.filter((counselor) => isActiveForStats(counselor.id, inviteList)) ?? [];
  const activeCounselorCount = inviteList.length
    ? inviteList.filter((item) => item.status === 'active').length
    : data?.total_counselors ?? 0;

  return (
    <AppShell
      title={data?.org_name ?? '기관 대시보드'}
      sub="ORG DASHBOARD"
    >
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-[#FDECEC] text-[#B3261E] text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-[#6F6F6F] text-sm">불러오는 중...</div>
      ) : data ? (
        <div className="space-y-8">
          <OrgCodeCard orgCode={data.org_code} />

          <CounselorInviteSection
            orgId={data.org_id}
            inviteList={inviteList}
            onRefresh={refreshInviteData}
          />

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            <StatCard label="활성 상담사" value={activeCounselorCount} />
            <StatCard label="총 클래스" value={data.total_classes} accent="text-[#5F0080]" />
            <StatCard label="총 참여자" value={data.total_participants} />
            <StatCard label="완료" value={data.completed_classes} accent="text-[#1F8A5B]" />
            <StatCard label="진행중" value={data.in_progress_classes} accent="text-[#1F8A5B]" />
          </div>

          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-bold text-[17px] text-[#1F1F1F] tracking-tight">
                소속 상담사 실적
              </h2>
              <span className="font-mono text-[11px] text-[#6F6F6F]">
                {activeCounselors.length}명
              </span>
            </div>

            {activeCounselors.length === 0 ? (
              <div className="border border-dashed border-[#DDDEE7] rounded-2xl p-8 text-center text-[#6F6F6F] text-sm">
                활성 상담사 실적이 없습니다. 초대가 완료된 상담사만 표시됩니다.
              </div>
            ) : (
              <>
                <div className="block md:hidden space-y-3">
                  {activeCounselors.map((c) => (
                    <CounselorCard key={c.id} counselor={c} />
                  ))}
                </div>

                <div className="hidden md:block bg-white border border-[#EFEFEF] rounded-2xl overflow-x-auto">
                  <table className="w-full text-[14px]">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b border-[#EFEFEF]">
                        <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                          이름
                        </th>
                        <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                          이메일
                        </th>
                        <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                          클래스
                        </th>
                        <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                          참여자
                        </th>
                        <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                          완료
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeCounselors.map((c) => (
                        <CounselorRow key={c.id} counselor={c} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-bold text-[17px] text-[#1F1F1F] tracking-tight">
                기관 전체 클래스
              </h2>
              <span className="font-mono text-[11px] text-[#6F6F6F]">
                {data.classes.length}건
              </span>
            </div>

            {data.classes.length === 0 ? (
              <div className="border border-dashed border-[#DDDEE7] rounded-2xl p-8 text-center text-[#6F6F6F] text-sm">
                진행된 클래스가 없습니다.
              </div>
            ) : (
              <>
                <div className="block md:hidden space-y-3">
                  {data.classes.map((cls) => (
                    <ClassCard key={cls.id} cls={cls} />
                  ))}
                </div>

                <div className="hidden md:block bg-white border border-[#EFEFEF] rounded-2xl overflow-x-auto">
                  <table className="w-full text-[14px] min-w-[960px]">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b border-[#EFEFEF]">
                        <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                          제목
                        </th>
                        <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                          유형
                        </th>
                        <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                          상태
                        </th>
                        <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                          코드
                        </th>
                        <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                          참여자
                        </th>
                        <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                          시작
                        </th>
                        <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                          종료
                        </th>
                        <th className="text-left px-6 py-3 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                          기록
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.classes.map((cls) => (
                        <ClassRow key={cls.id} cls={cls} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
