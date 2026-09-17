// 플랫폼 관리자용 기관 코드 발급 및 기관 목록 관리

import { useEffect, useRef, useState, type FormEvent } from 'react';
import OrgDetailModal, { orgKindLabel, orgDate } from '../../components/admin/org-detail-modal';
import AppShell from '../../components/layout/AppShell';
import { apiClient } from '../../lib/api/client';
import {
  listAdminOrganizations,
  type AdminOrganizationDto,
} from '../../lib/api/admin';

interface AdminUserSummary {
  id: string;
  email: string;
  name: string;
}

interface CreateOrganizationResponse {
  org: AdminOrganizationDto;
  admin: AdminUserSummary;
  invite_sent: boolean;
}

interface ResendInviteResponse {
  invite_sent: boolean;
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
  const [selectedOrg, setSelectedOrg] = useState<AdminOrganizationDto | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState('');
  const [verification, setVerification] = useState('');
  const [kind, setKind] = useState('');
  const [grouped, setGrouped] = useState(false);
  const [listError, setListError] = useState(false);
  const [listAttempt, setListAttempt] = useState(0);
  const [organizations, setOrganizations] = useState<AdminOrganizationDto[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [createdResult, setCreatedResult] = useState<CreateOrganizationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [resendingOrgId, setResendingOrgId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadOrganizations = async (): Promise<void> => {
      try {
        const organizationsResponse = await listAdminOrganizations();
        if (!cancelled) setOrganizations(organizationsResponse);
      } catch {
        if (!cancelled) {
          setListError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadOrganizations();
    return () => {
      cancelled = true;
    };
  }, [listAttempt]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedAdminName = adminName.trim();
    const normalizedAdminEmail = adminEmail.trim();

    if (!normalizedName) {
      setError('기관명을 입력해주세요.');
      return;
    }
    if (!normalizedAdminName) {
      setError('담당자 이름을 입력해주세요.');
      return;
    }
    if (!normalizedAdminEmail) {
      setError('담당자 이메일을 입력해주세요.');
      return;
    }

    setCreating(true);
    setError(null);
    setCopyMessage(null);
    setResendMessage(null);
    try {
      const result = await apiClient.post<CreateOrganizationResponse>('/admin/orgs', {
        name: normalizedName,
        admin_name: normalizedAdminName,
        admin_email: normalizedAdminEmail,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
        ...(adminPhone.trim() ? { admin_phone: adminPhone.trim() } : {}),
      });
      setCreatedResult(result);
      setOrganizations((current) => [result.org, ...current]);
      setName('');
      setPhone('');
      setAddress('');
      setAdminName('');
      setAdminEmail('');
      setAdminPhone('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '기관을 등록하지 못했습니다.');
    } finally {
      setCreating(false);
    }
  };

  const handleCopyCode = async () => {
    const code = createdResult?.org.org_code;
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      setCopyMessage('기관 코드를 복사했습니다.');
    } catch {
      setCopyMessage('기관 코드를 복사하지 못했습니다.');
    }
  };

  const handleResendInvite = async (orgId: string) => {
    setResendingOrgId(orgId);
    setError(null);
    setResendMessage(null);
    try {
      await apiClient.post<ResendInviteResponse>(`/admin/orgs/${orgId}/resend-invite`, {});
      setResendMessage('초대 메일을 다시 발송했습니다.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '초대 메일을 재발송하지 못했습니다.');
    } finally {
      setResendingOrgId(null);
    }
  };

  const filteredOrganizations = organizations.filter((org) =>
    [org.name, org.org_code ?? ''].some((value) => value.toLowerCase().includes(query.trim().toLowerCase()))
    && (!kind || org.kind === kind)
    && (!verification || org.verified === (verification === 'verified')),
  );
  const groups = grouped
    ? [...new Set(filteredOrganizations.map((org) => org.kind))].sort().map((value) => ({
      label: orgKindLabel(value), items: filteredOrganizations.filter((org) => org.kind === value),
    })) : [{ label: '', items: filteredOrganizations }];
  const openOrg = (org: AdminOrganizationDto, button: HTMLButtonElement | null) => {
    openerRef.current = button;
    setSelectedOrg(org);
  };
  const closeOrg = () => {
    setSelectedOrg(null);
    requestAnimationFrame(() => openerRef.current?.focus());
  };
  const resetFilters = () => { setQuery(''); setVerification(''); setKind(''); };
  const copyListCode = async (code: string) => {
    try { await navigator.clipboard.writeText(code); setResendMessage('기관 코드를 복사했습니다.'); }
    catch { setResendMessage('기관 코드를 복사하지 못했습니다.'); }
  };

  return (
    <AppShell title="기관 관리" sub="ORGANIZATION MANAGEMENT">
      {error && (
        <div role="alert" className="mb-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {resendMessage && (
        <div role="status" className="mb-5 rounded-xl bg-[#F5EDFC] p-3 text-sm text-[#5F0080]">
          {resendMessage}
        </div>
      )}

      <section className="mb-8 rounded-2xl border border-[#EFEFEF] bg-white p-5 md:p-6">
        <div className="mb-5">
          <h2 className="text-[17px] font-bold text-[#1F1F1F]">새 기관 등록</h2>
          <p className="mt-1 text-[13px] text-[#6F6F6F]">
            기관과 주 담당자를 등록하면 상담사용 기관 코드가 발급되고, 담당자에게 초대 메일이 발송됩니다.
          </p>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
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
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-[#1F1F1F]">
                기관 전화번호 <span className="font-normal text-[#9B9B9B]">(선택)</span>
              </span>
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
            <label className="block md:col-span-2">
              <span className="mb-1.5 block text-[13px] font-semibold text-[#1F1F1F]">
                기관 주소 <span className="font-normal text-[#9B9B9B]">(선택)</span>
              </span>
              <input
                type="text"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="기관 주소"
                maxLength={300}
                disabled={creating}
                className="w-full rounded-xl border border-[#EFEFEF] px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20 disabled:opacity-60"
              />
            </label>
          </div>

          <div className="rounded-xl border border-[#DDDEE7] bg-[#FAFAFC] p-4">
            <h3 className="text-[14px] font-bold text-[#1F1F1F]">주 담당자 정보</h3>
            <p className="mt-1 text-[12px] text-[#6F6F6F]">
              담당자 이메일로 비밀번호 설정 링크가 발송됩니다.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-[#1F1F1F]">담당자 이름</span>
                <input
                  type="text"
                  value={adminName}
                  onChange={(event) => setAdminName(event.target.value)}
                  placeholder="홍길동"
                  required
                  maxLength={100}
                  disabled={creating}
                  className="w-full rounded-xl border border-[#EFEFEF] bg-white px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20 disabled:opacity-60"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-[#1F1F1F]">담당자 이메일</span>
                <input
                  type="email"
                  value={adminEmail}
                  onChange={(event) => setAdminEmail(event.target.value)}
                  placeholder="admin@example.com"
                  required
                  maxLength={200}
                  disabled={creating}
                  className="w-full rounded-xl border border-[#EFEFEF] bg-white px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20 disabled:opacity-60"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-[#1F1F1F]">
                  담당자 전화 <span className="font-normal text-[#9B9B9B]">(선택)</span>
                </span>
                <input
                  type="tel"
                  value={adminPhone}
                  onChange={(event) => setAdminPhone(event.target.value)}
                  placeholder="010-0000-0000"
                  maxLength={20}
                  disabled={creating}
                  className="w-full rounded-xl border border-[#EFEFEF] bg-white px-4 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20 disabled:opacity-60"
                />
              </label>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={creating}
              className="rounded-xl bg-[#5F0080] px-5 py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-[#4B0066] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? '등록 중...' : '기관 등록 및 초대 발송'}
            </button>
          </div>
        </form>

        {createdResult && (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[#DDD0EA] bg-[#F5EDFC] p-4">
              <div className="text-[13px] font-semibold text-[#5F0080]">상담사용 기관 코드</div>
              <p className="mt-1 text-[12px] text-[#6F6F6F]">{createdResult.org.name}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <strong className="font-mono text-3xl tracking-[0.2em] text-[#5F0080]">
                  {createdResult.org.org_code ?? '발급 정보 없음'}
                </strong>
                {createdResult.org.org_code && (
                  <button
                    type="button"
                    onClick={() => void handleCopyCode()}
                    className="rounded-lg border border-[#C9B0E8] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#5F0080] transition-colors hover:bg-[#EFE3FA]"
                  >
                    코드 복사
                  </button>
                )}
              </div>
              {copyMessage && <p className="mt-2 text-[13px] text-[#5F0080]">{copyMessage}</p>}
            </div>

            <div className="rounded-xl border border-[#DDD0EA] bg-[#F5EDFC] p-4">
              <div className="text-[13px] font-semibold text-[#5F0080]">담당자 계정</div>
              <p className="mt-1 text-[12px] text-[#6F6F6F]">
                {createdResult.invite_sent ? '초대 메일 발송 완료' : '초대 메일 발송 대기'}
              </p>
              <div className="mt-3 space-y-1">
                <div className="text-[15px] font-semibold text-[#1F1F1F]">{createdResult.admin.name}</div>
                <div className="text-[14px] text-[#6F6F6F]">{createdResult.admin.email}</div>
              </div>
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-[#1F1F1F]">등록 기관</h2>
          <span className="text-[13px] text-[#6F6F6F]">총 {organizations.length}개</span>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input aria-label="기관 검색" placeholder="기관명·기관 코드 검색" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" />
          <select aria-label="인증 여부" value={verification} onChange={(event) => setVerification(event.target.value)} className="rounded-lg border px-3 py-2 text-sm">
            <option value="">전체 인증</option><option value="verified">인증됨</option><option value="unverified">미인증</option>
          </select>
          <select aria-label="기관 유형" value={kind} onChange={(event) => setKind(event.target.value)} className="rounded-lg border px-3 py-2 text-sm">
            <option value="">전체 유형</option><option value="institution">일반 기관</option><option value="individual">개인 기관</option>
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={grouped} onChange={(event) => setGrouped(event.target.checked)} />유형별 그룹핑</label>
          <button type="button" onClick={resetFilters} className="rounded-lg border px-3 py-2 text-sm">검색 초기화</button>
        </div>
        {loading ? <p role="status" className="p-10 text-center text-sm">기관 목록을 불러오는 중...</p>
          : listError ? <div role="alert" className="rounded-xl bg-red-50 p-5 text-sm">기관 목록 조회에 실패했습니다. <button type="button" onClick={() => { setListError(false); setLoading(true); setListAttempt((value) => value + 1); }} className="ml-3 rounded-lg border px-3 py-2">다시 시도</button></div>
          : filteredOrganizations.length === 0 ? <p className="p-10 text-center text-sm">{organizations.length === 0 ? '등록된 기관이 없습니다.' : '검색 조건에 맞는 기관이 없습니다.'}</p>
          : groups.map((group) => <div key={group.label} className="mb-5">
            {group.label && <h3 className="mb-2 text-sm font-bold">{group.label} · {group.items.length}개</h3>}
            <div className="overflow-x-auto rounded-2xl border border-[#EFEFEF] bg-white">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-[#F8FAFC] text-xs text-[#6F6F6F]"><tr>{['기관명', '유형', '기관 코드', '전화번호', '인증', '생성일 (KST)', '초대'].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
                <tbody>{group.items.map((organization) => <tr key={organization.id}
                  onClick={(event) => openOrg(organization, event.currentTarget.querySelector<HTMLButtonElement>('[data-org-opener]'))}
                  className="cursor-pointer border-t border-[#EFEFEF] hover:bg-[#F8FAFC]">
                  <td className="px-4 py-4"><button type="button" data-org-opener
                    onClick={(event) => { event.stopPropagation(); openOrg(organization, event.currentTarget); }}
                    className="text-left font-semibold text-[#5F0080] underline-offset-4 hover:underline focus-visible:outline-2" aria-haspopup="dialog">{organization.name}</button></td>
                  <td className="px-4 py-4 text-xs">{orgKindLabel(organization.kind)}</td>
                  <td className="px-4 py-4"><span className="font-mono text-[#5F0080]">{organization.org_code ?? '미등록'}</span>
                    {organization.org_code && <button type="button" aria-label={`${organization.name} 기관 코드 복사`} onClick={(event) => { event.stopPropagation(); void copyListCode(organization.org_code!); }} className="ml-2 rounded border px-2 py-1 text-xs">복사</button>}</td>
                  <td className="px-4 py-4">{organization.phone ?? '미등록'}</td>
                  <td className="px-4 py-4"><VerificationBadge verified={organization.verified} /></td>
                  <td className="px-4 py-4 text-xs">{orgDate(organization.created_at)}</td>
                  <td className="px-4 py-4" onClick={(event) => event.stopPropagation()}>
                    <button type="button" onClick={(event) => { event.stopPropagation(); void handleResendInvite(organization.id); }}
                      disabled={resendingOrgId === organization.id || organization.kind === 'individual' || !organization.has_primary_admin}
                      title={organization.kind === 'individual' ? '개인 기관은 담당자 초대 대상이 아닙니다.' : !organization.has_primary_admin ? '담당자 미지정' : undefined}
                      className="rounded-lg border border-[#C9B0E8] px-3 py-1.5 text-xs font-semibold text-[#5F0080] disabled:cursor-not-allowed disabled:opacity-50">
                      {resendingOrgId === organization.id ? '발송 중...' : '초대 재발송'}
                    </button>
                    {(organization.kind === 'individual' || !organization.has_primary_admin) && <p className="mt-1 text-xs text-[#6F6F6F]">{organization.kind === 'individual' ? '개인 기관' : '담당자 미지정'}</p>}
                  </td>
                </tr>)}</tbody>
              </table>
            </div>
          </div>)}
      </section>
      {selectedOrg && <OrgDetailModal key={selectedOrg.id} organization={selectedOrg} onClose={closeOrg} />}
    </AppShell>
  );
}
