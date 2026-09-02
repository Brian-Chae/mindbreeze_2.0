// 상담사 클래스 대시보드 (SDD-015)

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import { StatusBadge } from '../components/session/StatusBadge';
import {
  getCounselorDashboard,
  type ClassSummary,
  type CounselorDashboardResponse,
} from '../lib/api/dashboard';
import type { SessionType } from '../lib/api/session';
import { useAuthStore } from '../stores/authStore';

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

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white border border-[#DDDEE7] rounded-2xl p-5">
      <div className="text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-2">
        {label}
      </div>
      <div className={`text-[28px] font-bold tracking-tight ${accent ?? 'text-[#1F1F1F]'}`}>
        {value.toLocaleString('ko-KR')}
      </div>
    </div>
  );
}

function AccessCodeCell({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 클립보드 실패 시 무시 */
    }
  };

  if (!code) {
    return <span className="text-[#C2C3CE]">-</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono font-bold tracking-widest text-[#5F0080]">{code}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="px-2 py-1 rounded-lg bg-[#F5EDFC] text-[#5F0080] text-[11px] font-semibold hover:bg-[#EBDEF7] transition-colors"
      >
        {copied ? '복사됨' : '복사'}
      </button>
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
      <td className="px-6 py-4">
        <AccessCodeCell code={cls.access_code} />
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
    <div className="bg-white border border-[#EFEFEF] rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <Link
          to={`/sessions/${cls.id}`}
          className="font-bold text-[#1F1F1F] hover:text-[#5F0080] truncate"
        >
          {cls.title || '제목 없음'}
        </Link>
        <StatusBadge status={cls.status} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge cls={cls} />
        <span className="text-[12px] text-[#6F6F6F]">
          참여 {cls.participant_count}명
          {cls.guest_count > 0 && ` · 게스트 ${cls.guest_count}`}
        </span>
      </div>
      <AccessCodeCell code={cls.access_code} />
      <div className="text-[12px] text-[#6F6F6F] font-mono space-y-0.5">
        <div>시작 {formatDateTime(cls.started_at)}</div>
        <div>종료 {formatDateTime(cls.ended_at)}</div>
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

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<CounselorDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileBannerDismissed, setProfileBannerDismissed] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const fetchDashboard = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCounselorDashboard();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '대시보드를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  const displayName = data?.counselor_name ?? user?.name ?? '상담사';
  const orgLabel = data?.org_name ? `${data.org_name} 소속` : 'MY CLASSES';
  const counselorCode = user?.counselor_code ?? null;
  const showProfileBanner =
    !profileBannerDismissed && user?.role === 'counselor' && !user.onboarding_completed;

  const handleCopyCounselorCode = async (): Promise<void> => {
    if (!counselorCode) return;
    try {
      await navigator.clipboard.writeText(counselorCode);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      /* 클립보드 실패 시 무시 */
    }
  };

  return (
    <AppShell
      title={`안녕하세요, ${displayName}님`}
      sub={orgLabel}
      rightSlot={
        <button
          type="button"
          onClick={() => navigate('/sessions')}
          className="h-11 px-[18px] rounded-full bg-[#5F0080] text-white font-semibold text-sm hover:bg-[#4B0066] transition-colors"
        >
          클래스 관리
        </button>
      }
    >
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-[#FDECEC] text-[#B3261E] text-sm">{error}</div>
      )}

      {showProfileBanner && (
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#DDD0EA] bg-[#F5EDFC] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[14px] font-semibold text-[#5F0080]">프로필을 완성해보세요</p>
            <p className="mt-1 text-[13px] text-[#6F6F6F]">
              자격증명·경력 등은 원하실 때 설정에서 입력하실 수 있습니다.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/onboarding/counselor')}
              className="h-9 rounded-xl bg-[#5F0080] px-4 text-[13px] font-semibold text-white hover:bg-[#4B0066] transition-colors"
            >
              프로필 완성하기
            </button>
            <button
              type="button"
              onClick={() => setProfileBannerDismissed(true)}
              className="h-9 rounded-xl border border-[#C9B0E8] bg-white px-4 text-[13px] font-semibold text-[#6F6F6F] hover:bg-[#EFE3FA] transition-colors"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-[#6F6F6F] text-sm">불러오는 중...</div>
      ) : data ? (
        <div className="space-y-6">
          {counselorCode && (
            <div className="rounded-2xl border border-[#DDD0EA] bg-[#F5EDFC] p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
                    내 상담사 코드
                  </p>
                  <p className="mt-1 text-[13px] text-[#6F6F6F]">
                    내담자에게 이 코드를 공유하면 상담 관계가 연결됩니다.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-2xl font-bold tracking-[0.25em] text-[#5F0080]">
                    {counselorCode}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyCounselorCode()}
                    className="rounded-lg border border-[#C9B0E8] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#5F0080] hover:bg-[#EFE3FA] transition-colors"
                  >
                    {codeCopied ? '복사됨' : '복사'}
                  </button>
                  <Link
                    to="/settings"
                    className="text-[12px] font-semibold text-[#5F0080] hover:underline"
                  >
                    설정
                  </Link>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="총 클래스" value={data.total_classes} accent="text-[#5F0080]" />
            <StatCard label="진행중" value={data.in_progress_classes} accent="text-[#1F8A5B]" />
            <StatCard label="완료" value={data.completed_classes} />
            <StatCard label="총 참여자" value={data.total_participants} />
          </div>

          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-bold text-[17px] text-[#1F1F1F] tracking-tight">내 클래스</h2>
              <span className="font-mono text-[11px] text-[#6F6F6F]">
                {data.classes.length}건
              </span>
            </div>

            {data.classes.length === 0 ? (
              <div className="border border-dashed border-[#DDDEE7] rounded-2xl p-12 text-center">
                <p className="text-[#6F6F6F] text-sm mb-4">아직 진행한 클래스가 없습니다.</p>
                <button
                  type="button"
                  onClick={() => navigate('/sessions')}
                  className="h-10 px-5 rounded-xl bg-[#F5EDFC] text-[#5F0080] font-semibold text-sm hover:bg-[#EBDEF7] transition-colors"
                >
                  클래스 만들기
                </button>
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
                          클래스 코드
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
