// 기관 클래스 대시보드 (SDD-015)

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import { StatusBadge } from '../components/session/StatusBadge';
import {
  getOrgDashboard,
  type ClassSummary,
  type OrgCounselorStat,
  type OrgDashboardResponse,
} from '../lib/api/dashboard';
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
          <h2 className="text-[15px] font-bold text-[#5F0080]">상담사 초대용 기관 코드</h2>
          <p className="mt-1 text-[13px] text-[#6F6F6F]">
            상담사 회원가입 시 이 코드를 입력하면 기관에 소속됩니다.
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

export default function OrgDashboardPage() {
  const [data, setData] = useState<OrgDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await getOrgDashboard();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '기관 대시보드를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

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

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            <StatCard label="상담사" value={data.total_counselors} />
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
                {data.counselors.length}명
              </span>
            </div>

            {data.counselors.length === 0 ? (
              <div className="border border-dashed border-[#DDDEE7] rounded-2xl p-8 text-center text-[#6F6F6F] text-sm">
                등록된 상담사가 없습니다.
              </div>
            ) : (
              <>
                <div className="block md:hidden space-y-3">
                  {data.counselors.map((c) => (
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
                      {data.counselors.map((c) => (
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
