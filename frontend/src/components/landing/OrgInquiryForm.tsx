// 기관 도입 문의 폼 (SDD-248) — 랜딩 모달·별도 페이지 어디서든 재사용
import { useRef, useState, type FormEvent } from 'react';
import { submitOrgInquiry, type OrgInquiryType } from '../../lib/api/org-inquiry';
import { ApiError } from '../../lib/api/client';
import { PrivacyPolicyLink } from '../legal/PrivacyPolicyLink';
import { primaryButton } from './landing-ui';

export const ORG_INQUIRY_SUCCESS_MESSAGE = '문의가 접수되었습니다. 영업일 기준 2일 안에 회신드릴게요.';

const ORG_TYPES: ReadonlyArray<{ value: OrgInquiryType; label: string }> = [
  { value: 'counseling_center', label: '상담센터' },
  { value: 'meditation_center', label: '명상센터' },
  { value: 'education', label: '교육기관' },
  { value: 'company', label: '기업' },
  { value: 'other', label: '기타' },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const inputClass =
  'mt-2 w-full min-h-12 rounded-xl border border-[#D9D0DC] bg-white px-4 text-sm text-[#2F2335] placeholder:text-[#A89BB0] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/15 disabled:opacity-60';
const labelClass = 'block text-sm font-semibold text-[#44324E]';

interface OrgInquiryFormProps {
  onSuccess?: () => void;
  /** true 면 동의·오류·제출 버튼을 스크롤 영역 하단에 고정한다(모달용). */
  stickyFooter?: boolean;
}

export function OrgInquiryForm({ onSuccess, stickyFooter = false }: OrgInquiryFormProps) {
  const [orgName, setOrgName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [orgType, setOrgType] = useState<OrgInquiryType | ''>('');
  const [expectedUsers, setExpectedUsers] = useState('');
  const [bandInterest, setBandInterest] = useState(false);
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submittingRef = useRef(false);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);
    if (!orgName.trim() || !contactName.trim() || !phone.trim()) {
      setError('기관명, 담당자 이름, 연락처를 입력해 주세요.');
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      setError('올바른 이메일을 입력해 주세요.');
      return;
    }
    const users = expectedUsers.trim() === '' ? undefined : Number(expectedUsers);
    if (users !== undefined && (!Number.isInteger(users) || users < 0)) {
      setError('예상 이용 인원은 0 이상의 숫자로 입력해 주세요.');
      return;
    }
    if (message.length > 2000) {
      setError('문의 내용은 2000자 이내로 입력해 주세요.');
      return;
    }
    if (!consent) {
      setError('개인정보 수집·이용에 동의해야 문의할 수 있습니다.');
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    try {
      await submitOrgInquiry({
        org_name: orgName.trim(),
        contact_name: contactName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        org_type: orgType || undefined,
        expected_users: users,
        band_interest: bandInterest,
        message: message.trim() || undefined,
        privacy_consent: true,
        website,
      });
      setDone(true);
      onSuccess?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setError('요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      else if (err instanceof ApiError) setError('문의 접수에 실패했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.');
      else setError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div role="status" className="rounded-2xl bg-[#F6F1F8] p-6 text-center">
        <p className="text-base font-bold text-[#5F0080]">{ORG_INQUIRY_SUCCESS_MESSAGE}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="기관 도입 문의" className="space-y-4">
      <div>
        <label htmlFor="oi-org-name" className={labelClass}>기관명 *</label>
        <input id="oi-org-name" className={inputClass} value={orgName} maxLength={200} disabled={loading} onChange={(e) => setOrgName(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="oi-contact-name" className={labelClass}>담당자 이름 *</label>
          <input id="oi-contact-name" className={inputClass} value={contactName} maxLength={100} disabled={loading} onChange={(e) => setContactName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="oi-phone" className={labelClass}>연락처 *</label>
          <input id="oi-phone" type="tel" className={inputClass} value={phone} maxLength={30} placeholder="010-0000-0000" disabled={loading} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor="oi-email" className={labelClass}>이메일 *</label>
        <input id="oi-email" type="email" className={inputClass} value={email} maxLength={254} disabled={loading} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="oi-org-type" className={labelClass}>기관 유형</label>
          <select id="oi-org-type" className={inputClass} value={orgType} disabled={loading} onChange={(e) => setOrgType(e.target.value as OrgInquiryType | '')}>
            <option value="">선택 안 함</option>
            {ORG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="oi-users" className={labelClass}>예상 이용 인원</label>
          <input id="oi-users" type="number" min={0} inputMode="numeric" className={inputClass} value={expectedUsers} disabled={loading} onChange={(e) => setExpectedUsers(e.target.value)} />
        </div>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm text-[#44324E]">
        <input type="checkbox" checked={bandInterest} disabled={loading} onChange={(e) => setBandInterest(e.target.checked)} />
        LINK BAND(뇌파 측정) 도입에도 관심 있어요
      </label>
      <div>
        <label htmlFor="oi-message" className={labelClass}>문의 내용</label>
        <textarea id="oi-message" rows={4} maxLength={2000} className={`${inputClass} py-3`} value={message} disabled={loading} onChange={(e) => setMessage(e.target.value)} />
      </div>
      {/* 허니팟 — 사람에게는 보이지 않는다 */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>웹사이트<input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      </div>
      <div className={stickyFooter ? 'sticky bottom-0 z-10 -mx-5 space-y-3 border-t border-[#E4DBEA] bg-white px-5 pb-4 pt-3 shadow-[0_-10px_20px_rgba(56,37,66,0.07)] sm:-mx-9 sm:px-9' : 'space-y-4'}>
        <div className="rounded-xl bg-[#FAF8FB] p-4 text-xs leading-6 text-[#6F5F78]">
          <p><strong>개인정보 수집·이용 안내</strong></p>
          <p>목적: 도입 상담 회신 / 항목: 기관명·이름·이메일·연락처·문의내용 / 보관: 1년</p>
          <label className="mt-2 flex min-h-11 items-center gap-3 text-sm font-semibold text-[#44324E]">
            <input type="checkbox" checked={consent} disabled={loading} onChange={(e) => setConsent(e.target.checked)} />
            개인정보 수집·이용에 동의합니다 (필수) <PrivacyPolicyLink className="font-normal underline underline-offset-2">자세히</PrivacyPolicyLink>
          </label>
        </div>
        {error && <p role="alert" className="text-sm font-semibold text-[#B3261E]">{error}</p>}
        <button type="submit" disabled={loading} className={`${primaryButton} w-full disabled:opacity-60`}>
          {loading ? '접수 중…' : '문의 보내기'}
        </button>
      </div>
    </form>
  );
}

export default OrgInquiryForm;
