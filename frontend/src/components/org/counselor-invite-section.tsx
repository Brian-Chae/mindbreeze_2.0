// 상담사 초대 공용 섹션 — 기관 대시보드·구성원 관리 페이지 공용 (초대 폼 + 초대·가입 현황)

import { useState, type FormEvent } from 'react';
import { buttonClass, cardClass, fieldClass } from '../ui';
import { inviteCounselor, resendCounselorInvite, type CounselorItem } from '../../lib/api/org';
import { ApiError } from '../../lib/api/client';

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
      <span className="inline-flex items-center rounded-full bg-[#D1FAE5] px-2.5 py-1 text-[12px] font-bold text-[#065F46]">
        활성
      </span>
    );
  }
  if (status === 'expired') {
    return (
      <span className="inline-flex items-center rounded-full bg-[#FEE2E2] px-2.5 py-1 text-[12px] font-bold text-[#991B1B]">
        만료
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-[#FEF3C7] px-2.5 py-1 text-[12px] font-bold text-[#92400E]">
      대기
    </span>
  );
}

// SDD-079: 초대 유형 라벨 — 신규 가입 초대 / 소속 추가 초대 (active 구성원은 null)
function getInviteTypeLabel(counselor: CounselorItem): string | null {
  if (counselor.invite_type === 'org_membership') return '소속 추가';
  if (counselor.invite_type === 'new_account') return '신규 가입';
  return null;
}

function InviteTypeBadge({ counselor }: { counselor: CounselorItem }) {
  const label = getInviteTypeLabel(counselor);
  if (!label) return <span className="text-[12px] text-[#C2C3CE]">-</span>;
  const isMembership = counselor.invite_type === 'org_membership';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-bold ${
        isMembership ? 'bg-[#EDE9FE] text-[#5B21B6]' : 'bg-[#DBEAFE] text-[#1E40AF]'
      }`}
    >
      {label}
    </span>
  );
}

export default function CounselorInviteSection({
  orgId,
  inviteList,
  inviteListError,
  onRefresh,
  showList = true,
}: {
  orgId: string;
  inviteList: CounselorItem[];
  inviteListError?: string | null;
  onRefresh: () => Promise<void>;
  /** false 면 초대 폼만 표시 (구성원 페이지 모달용) */
  showList?: boolean;
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
      setInviteError(
        err instanceof ApiError && err.message
          ? err.message
          : err instanceof Error
            ? err.message
            : '초대 발송에 실패했습니다.',
      );
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
      <div className={cardClass()}>
        <div className="mb-5">
          <h2 className="text-[18px] font-bold text-[#1F1F1F]">코치 초대</h2>
          <p className="mt-1 text-[13px] text-[#6F6F6F]">
            이름과 이메일을 입력하면 초대 메일이 발송됩니다. 코치는 메일의 링크로 비밀번호를
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
              className={fieldClass('input')}
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
              className={fieldClass('input', inviteError ? '!border-[#F87171] !bg-[#FEF2F2]' : '')}
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
              className={buttonClass({ className: 'w-full md:w-auto' })}
            >
              {inviting ? '발송 중…' : '초대 발송'}
            </button>
          </div>
        </form>
      </div>

      {showList && (
      <div>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-[18px] font-bold tracking-tight text-[#1F1F1F]">초대·가입 현황</h2>
          <span className="font-mono text-[12px] text-[#6F6F6F]">{sortedInviteList.length}명</span>
        </div>

        {inviteListError ? (
          <div className="rounded-2xl border border-[#F5C2C2] bg-red-50 p-8 text-center">
            <p className="text-sm text-red-700">목록을 불러오지 못했습니다.</p>
            <p className="mt-2 text-[13px] text-red-600">{inviteListError}</p>
          </div>
        ) : sortedInviteList.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#DDDEE7] p-8 text-center">
            <p className="text-sm text-[#6F6F6F]">아직 초대한 코치가 없습니다.</p>
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
                    className={cardClass('compact')}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-[#1F1F1F]">{counselor.name}</div>
                        <div className="break-all text-[13px] text-[#6F6F6F]">{counselor.email}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <InviteStatusBadge status={displayStatus} />
                        {getInviteTypeLabel(counselor) && <InviteTypeBadge counselor={counselor} />}
                      </div>
                    </div>
                    <div className="text-[12px] text-[#6F6F6F]">
                      초대일 {formatDate(counselor.invited_at)}
                    </div>
                    {canResend && (
                      <button
                        type="button"
                        onClick={() => void handleResend(counselor.id)}
                        disabled={resendingUserId === counselor.id}
                        className={buttonClass({ variant: 'secondary', size: 'sm', className: 'mt-3' })}
                      >
                        {resendingUserId === counselor.id ? '발송 중…' : '재발송'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className={cardClass('none', 'hidden overflow-x-auto md:block')}>
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="border-b border-[#EFEFEF] bg-[#F8FAFC]">
                    <th className="px-6 py-3 text-left text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
                      이름
                    </th>
                    <th className="px-6 py-3 text-left text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
                      이메일
                    </th>
                    <th className="px-6 py-3 text-left text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
                      유형
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
                          <InviteTypeBadge counselor={counselor} />
                        </td>
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
                              className={buttonClass({ variant: 'secondary', size: 'sm' })}
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
      )}
    </section>
  );
}
