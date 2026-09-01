// 플랫폼 관리자용 기관 코드 발급 및 기관 목록 관리

import { useEffect, useState, type FormEvent } from 'react';
import AppShell from '../../components/layout/AppShell';
import {
  createAdminOrganization,
  listAdminOrganizations,
  type AdminOrganizationDto,
} from '../../lib/api/admin';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function VerificationBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex items-center rounded-full bg-[#D1FAE5] px-2.5 py-1 text-[11px] font-bold text-[#065F46]">
      인증됨
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-[#FEF3C7] px-2.5 py-1 text-[11px] font-bold text-[#92400E]">
      미인증
    </span>
  );
}

export default function OrgManagementPage() {
  const [organizations, setOrganizations] = useState<AdminOrganizationDto[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [createdOrganization, setCreatedOrganization] = useState<AdminOrganizationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadOrganizations = async (): Promise<void> => {
      try {
        const organizationsResponse = await listAdminOrganizations();
        if (!cancelled) setOrganizations(organizationsResponse);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '기관 목록을 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadOrganizations();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError('기관명을 입력해주세요.');
      return;
    }

    setCreating(true);
    setError(null);
    setCopyMessage(null);
    try {
      const organization = await createAdminOrganization({
        name: normalizedName,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      setCreatedOrganization(organization);
      setOrganizations((current) => [organization, ...current]);
      setName('');
      setPhone('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '기관을 등록하지 못했습니다.');
    } finally {
      setCreating(false);
    }
  };

  const handleCopyCode = async () => {
    const code = createdOrganization?.org_code;
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      setCopyMessage('기관 코드를 복사했습니다.');
    } catch {
      setCopyMessage('기관 코드를 복사하지 못했습니다.');
    }
  };

  return (
    <AppShell title="기관 관리" sub="ORGANIZATION MANAGEMENT">
      {error && (
        <div role="alert" className="mb-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="mb-8 rounded-2xl border border-[#EFEFEF] bg-white p-5 md:p-6">
        <div className="mb-5">
          <h2 className="text-[17px] font-bold text-[#1F1F1F]">새 기관 등록</h2>
          <p className="mt-1 text-[13px] text-[#6F6F6F]">
            기관을 등록하면 상담사 가입에 사용할 6자리 기관 코드가 발급됩니다.
          </p>
        </div>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex-1">
            <span className="mb-1.5 block text-[13px] font-semibold text-[#1F1F1F]">기관명</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="기관명을 입력하세요"
              required
              maxLength={200}
              disabled={creating}
              className="w-full rounded-xl border border-[#EFEFEF] px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20 disabled:opacity-60"
            />
          </label>
          <label className="flex-1">
            <span className="mb-1.5 block text-[13px] font-semibold text-[#1F1F1F]">전화번호 <span className="font-normal text-[#9B9B9B]">(선택)</span></span>
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="02-0000-0000"
              maxLength={20}
              disabled={creating}
              className="w-full rounded-xl border border-[#EFEFEF] px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20 disabled:opacity-60"
            />
          </label>
          <button
            type="submit"
            disabled={creating}
            className="rounded-xl bg-[#5F0080] px-5 py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-[#4B0066] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? '등록 중...' : '기관 등록'}
          </button>
        </form>

        {createdOrganization && (
          <div className="mt-5 rounded-xl border border-[#DDD0EA] bg-[#F5EDFC] p-4">
            <div className="text-[13px] font-semibold text-[#5F0080]">{createdOrganization.name}의 기관 코드</div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <strong className="font-mono text-3xl tracking-[0.2em] text-[#5F0080]">
                {createdOrganization.org_code ?? '발급 정보 없음'}
              </strong>
              {createdOrganization.org_code && (
                <button
                  type="button"
                  onClick={() => void handleCopyCode()}
                  className="rounded-lg border border-[#C9B0E8] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#5F0080] transition-colors hover:bg-[#EFE3FA]"
                >
                  코드 복사
                </button>
              )}
              {copyMessage && <span className="text-[13px] text-[#5F0080]">{copyMessage}</span>}
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-[#1F1F1F]">등록 기관</h2>
          <span className="text-[13px] text-[#6F6F6F]">총 {organizations.length}개</span>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-[#EFEFEF] p-10 text-center text-sm text-[#6F6F6F]">
            기관 목록을 불러오는 중...
          </div>
        ) : organizations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#DDDEE7] p-10 text-center text-sm text-[#6F6F6F]">
            등록된 기관이 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#EFEFEF] bg-white">
            <table className="min-w-[680px] w-full text-left text-[14px]">
              <thead>
                <tr className="border-b border-[#EFEFEF] bg-[#F8FAFC]">
                  <th className="px-5 py-3 text-[12px] font-mono font-normal uppercase tracking-wider text-[#6F6F6F]">기관명</th>
                  <th className="px-5 py-3 text-[12px] font-mono font-normal uppercase tracking-wider text-[#6F6F6F]">기관 코드</th>
                  <th className="px-5 py-3 text-[12px] font-mono font-normal uppercase tracking-wider text-[#6F6F6F]">전화번호</th>
                  <th className="px-5 py-3 text-[12px] font-mono font-normal uppercase tracking-wider text-[#6F6F6F]">인증</th>
                  <th className="px-5 py-3 text-[12px] font-mono font-normal uppercase tracking-wider text-[#6F6F6F]">생성일</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((organization) => (
                  <tr key={organization.id} className="border-b border-[#EFEFEF] last:border-0 hover:bg-[#F8FAFC]">
                    <td className="px-5 py-4 font-semibold text-[#1F1F1F]">{organization.name}</td>
                    <td className="px-5 py-4 font-mono font-semibold tracking-wider text-[#5F0080]">{organization.org_code ?? '-'}</td>
                    <td className="px-5 py-4 text-[#6F6F6F]">{organization.phone ?? '-'}</td>
                    <td className="px-5 py-4"><VerificationBadge verified={organization.verified} /></td>
                    <td className="px-5 py-4 font-mono text-[12px] text-[#9B9B9B]">{formatDate(organization.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
