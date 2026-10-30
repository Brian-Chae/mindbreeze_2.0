import { NativeOrganizationGate } from '../../components/routing/native-organization-gate';
// 기관 가입 상담 신청 — 접수만 하며 계정·기관을 만들지 않는다 (SDD-073)

import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import AuthShell from '../../components/auth/AuthShell';
import { submitOrganizationApplication } from '../../lib/api/signup';
import { ApiError } from '../../lib/api/client';
import { PrivacyPolicyLink } from '../../components/legal/PrivacyPolicyLink';

// FORM-03: 기관 담당자 연락처(휴대전화·유선) 형식 검증 — 임의 문자열 접수를 막는다.
const PHONE_REGEX = /^0\d{1,2}-\d{3,4}-\d{4}$/;

const inputClass =
  'w-full h-11 px-4 rounded-xl bg-white border border-[#D4D4D4] text-sm text-[#1F1F1F] placeholder:text-[#6F6F6F] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/15 disabled:opacity-60';

export default function RegisterOrganizationPage() {
  return <NativeOrganizationGate><OrganizationApplicationForm /></NativeOrganizationGate>;
}

function OrganizationApplicationForm() {
  const [organizationName, setOrganizationName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [inquiry, setInquiry] = useState('');
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  /** FORM-03: 제출 중 재클릭(이중 접수)을 막는 동기 가드 */
  const submittingRef = useRef(false);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    // 이미 제출 중이면 무시 — loading 상태 반영(리렌더) 전 재클릭을 차단한다.
    if (submittingRef.current) return;
    setError(null);
    if (!organizationName.trim() || !contactName.trim()) {
      setError('기업/기관명과 담당자 이름을 입력해주세요');
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('올바른 업무 이메일을 입력해주세요');
      return;
    }
    if (phone.trim() && !PHONE_REGEX.test(phone.trim())) {
      setError('연락처 형식을 확인해주세요 (예: 02-0000-0000, 010-0000-0000)');
      return;
    }
    if (!privacyAgreed) {
      setError('개인정보 수집·이용에 동의해야 신청할 수 있습니다');
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    try {
      const res = await submitOrganizationApplication({
        organization_name: organizationName.trim(),
        contact_name: contactName.trim(),
        email,
        phone: phone.trim() || undefined,
        inquiry: inquiry.trim() || undefined,
        consents: { privacy: true },
      });
      // FORM-03: 접수 성공 시 applicationId 를 갱신해 폼을 완료 화면으로 전환한다.
      setApplicationId(res.application_id);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError('이미 접수된 신청이 있습니다. 검토 후 이메일로 안내드립니다.');
        } else if (err.status === 429) {
          setError('잠시 후 다시 시도해 주세요.');
        } else {
          setError(err.message || '신청에 실패했습니다');
        }
      } else {
        setError('네트워크 오류가 발생했습니다');
      }
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <AuthShell title="기관 가입 상담 신청" maxWidthClass="max-w-[520px]">
      <div className="space-y-5">

        {applicationId ? (
          <div className="bg-white rounded-3xl p-6 shadow-xl sm:p-8 text-center space-y-4">
            <p className="text-lg font-bold text-[#1F1F1F]">상담 신청이 접수되었습니다</p>
            <p className="text-sm text-[#6F6F6F] leading-relaxed">
              담당자가 연락드려 도입 조건을 안내드립니다.
              <br />
              접수만으로 계정이나 기관이 생성되지는 않습니다.
            </p>
            <p className="text-xs text-[#6F6F6F] font-mono">접수 번호: {applicationId}</p>
            <Link
              to="/"
              className="inline-block w-full h-[52px] rounded-full bg-[#5F0080] text-white font-semibold hover:opacity-90 flex items-center justify-center"
            >
              홈으로 돌아가기
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-3xl p-6 shadow-xl sm:p-8 space-y-4"
          >
            <p className="text-xs text-[#6F6F6F] leading-relaxed">
              영업 담당자가 상담 후 도입을 진행합니다. 상담 사례나 건강정보 등 민감한 내용은
              입력하지 말아 주세요.
            </p>

            <div className="space-y-2">
              <label htmlFor="org-name" className="block text-sm font-medium text-[#4A4A4A]">
                기업/기관명
              </label>
              <input
                id="org-name"
                type="text"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="예: 마음숲 심리상담센터"
                maxLength={200}
                disabled={loading}
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="org-contact" className="block text-sm font-medium text-[#4A4A4A]">
                담당자 이름
              </label>
              <input
                id="org-contact"
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                maxLength={100}
                disabled={loading}
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="org-phone" className="block text-sm font-medium text-[#4A4A4A]">
                연락처 <span className="font-normal text-[#6F6F6F]">(선택)</span>
              </label>
              <input
                id="org-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="02-0000-0000"
                maxLength={13}
                disabled={loading}
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="org-email" className="block text-sm font-medium text-[#4A4A4A]">
                업무 이메일
              </label>
              <input
                id="org-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                disabled={loading}
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="org-inquiry" className="block text-sm font-medium text-[#4A4A4A]">
                상담 요청 내용 <span className="font-normal text-[#6F6F6F]">(선택)</span>
              </label>
              <textarea
                id="org-inquiry"
                value={inquiry}
                onChange={(e) => setInquiry(e.target.value)}
                placeholder="예상 이용 인원, 도입 희망 시기 등을 알려주시면 상담에 도움이 됩니다."
                rows={4}
                maxLength={2000}
                disabled={loading}
                className="w-full px-4 py-3 rounded-xl bg-white border border-[#D4D4D4] text-sm text-[#1F1F1F] placeholder:text-[#6F6F6F] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/15 disabled:opacity-60 resize-none"
              />
            </div>

            <label className="flex items-start gap-2 text-sm text-[#4A4A4A] cursor-pointer">
              <input
                type="checkbox"
                checked={privacyAgreed}
                onChange={(e) => setPrivacyAgreed(e.target.checked)}
                disabled={loading}
                className="mt-0.5"
              />
              <span>
                (필수) 개인정보 수집·이용에 동의합니다. 입력한 정보는 가입 상담 목적으로만 사용되며,
                미전환 신청 정보는 접수 후 90일 이내 삭제됩니다.{' '}
                <PrivacyPolicyLink>개인정보 처리방침 보기</PrivacyPolicyLink>
              </span>
            </label>

            {error && <p role="alert" className="text-red-500 text-sm text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-[52px] rounded-full bg-[#5F0080] text-white font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {loading ? '신청 중...' : '기관 가입 상담 신청'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-white/90">
          이미 기관 계정이 있으신가요?{' '}
          <Link to="/login?role=org_admin" className="font-semibold text-white underline">
            로그인
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
