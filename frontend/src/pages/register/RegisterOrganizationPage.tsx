// 기관 가입 상담 신청 — 접수만 하며 계정·기관을 만들지 않는다 (SDD-073)

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import ThemeToggle from '../../components/ThemeToggle';
import { submitOrganizationApplication } from '../../lib/api/signup';
import { ApiError } from '../../lib/api/client';

const inputClass =
  'w-full h-11 px-4 rounded-xl bg-surface-raised border border-border-default text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15 disabled:opacity-60';

export default function RegisterOrganizationPage() {
  const [organizationName, setOrganizationName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [inquiry, setInquiry] = useState('');
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!organizationName.trim() || !contactName.trim()) {
      setError('기업/기관명과 담당자 이름을 입력해주세요');
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('올바른 업무 이메일을 입력해주세요');
      return;
    }
    if (!privacyAgreed) {
      setError('개인정보 수집·이용에 동의해야 신청할 수 있습니다');
      return;
    }
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
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-canvas p-4 sm:p-8 relative">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[520px] space-y-8">
        <div className="text-center space-y-2">
          <Link to="/" className="inline-block">
            <h1 className="font-display text-3xl font-light text-ink-primary tracking-tight">
              Mind Breeze
            </h1>
          </Link>
          <p className="text-sm text-ink-tertiary">기관 가입 상담 신청</p>
          <p className="text-xs text-ink-tertiary">
            <Link to="/register" className="underline hover:text-brand-primary">
              다른 유형으로 가입하기
            </Link>
          </p>
        </div>

        {applicationId ? (
          <div className="bg-surface-raised rounded-2xl border border-border-default p-6 sm:p-8 text-center space-y-4">
            <p className="text-lg font-bold text-ink-primary">상담 신청이 접수되었습니다</p>
            <p className="text-sm text-ink-tertiary leading-relaxed">
              담당자가 연락드려 도입 조건을 안내드립니다.
              <br />
              접수만으로 계정이나 기관이 생성되지는 않습니다.
            </p>
            <p className="text-xs text-ink-tertiary font-mono">접수 번호: {applicationId}</p>
            <Link
              to="/"
              className="inline-block w-full h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90 flex items-center justify-center"
            >
              홈으로 돌아가기
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-surface-raised rounded-2xl border border-border-default p-6 sm:p-8 space-y-4"
          >
            <p className="text-xs text-ink-tertiary leading-relaxed">
              영업 담당자가 상담 후 도입을 진행합니다. 상담 사례나 건강정보 등 민감한 내용은
              입력하지 말아 주세요.
            </p>

            <div className="space-y-2">
              <label htmlFor="org-name" className="block text-sm font-medium text-ink-secondary">
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
              <label htmlFor="org-contact" className="block text-sm font-medium text-ink-secondary">
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
              <label htmlFor="org-phone" className="block text-sm font-medium text-ink-secondary">
                연락처 <span className="font-normal text-ink-tertiary">(선택)</span>
              </label>
              <input
                id="org-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="02-0000-0000"
                maxLength={20}
                disabled={loading}
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="org-email" className="block text-sm font-medium text-ink-secondary">
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
              <label htmlFor="org-inquiry" className="block text-sm font-medium text-ink-secondary">
                상담 요청 내용 <span className="font-normal text-ink-tertiary">(선택)</span>
              </label>
              <textarea
                id="org-inquiry"
                value={inquiry}
                onChange={(e) => setInquiry(e.target.value)}
                placeholder="예상 이용 인원, 도입 희망 시기 등을 알려주시면 상담에 도움이 됩니다."
                rows={4}
                maxLength={2000}
                disabled={loading}
                className="w-full px-4 py-3 rounded-xl bg-surface-raised border border-border-default text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15 disabled:opacity-60 resize-none"
              />
            </div>

            <label className="flex items-start gap-2 text-sm text-ink-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={privacyAgreed}
                onChange={(e) => setPrivacyAgreed(e.target.checked)}
                disabled={loading}
                className="mt-0.5"
              />
              <span>
                (필수) 개인정보 수집·이용에 동의합니다. 입력한 정보는 가입 상담 목적으로만 사용되며,
                미전환 신청 정보는 접수 후 90일 이내 삭제됩니다.
              </span>
            </label>

            {error && <p className="text-red-500 text-sm text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {loading ? '신청 중...' : '기관 가입 상담 신청'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-ink-tertiary">
          이미 기관 계정이 있으신가요?{' '}
          <Link to="/login?role=org_admin" className="text-brand-primary hover:text-brand-primary-hover font-medium">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
