import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { resolvePostLoginPath } from '../lib/auth-routing';
import '../components/landing/v6/landing-v6.css';
import { LandingV6Header, LandingV6Footer } from '../components/landing/v6/LandingV6Chrome';
import { LandingV6Sections } from '../components/landing/v6/LandingV6Sections';
import { InquiryModal } from '../components/landing/v6/InquiryModal';
import { FloatingInquiryButton } from '../components/landing/v6/FloatingInquiryButton';
import { InquiryModalContext } from '../components/landing/v6/use-inquiry-modal';

export default function LandingPage() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const navigate = useNavigate();

  // 이미 로그인된 사용자가 루트(/)로 들어오면 앱으로 자동 이동한다.
  // /app 등은 인증 API 호출(401→refresh 재시도)로 세션을 복구하지만, 랜딩 페이지는
  // 정적이라 refresh 결과를 아무도 소비하지 않아 "다시 로그인"처럼 보인다.
  // initialize가 localStorage 사용자를 복원한 시점에 앱 경로로 리다이렉트한다.
  useEffect(() => {
    if (isInitialized && isAuthenticated && user) {
      navigate(resolvePostLoginPath(user), { replace: true });
    }
  }, [isInitialized, isAuthenticated, user, navigate]);

  const [inquiryOpen, setInquiryOpen] = useState(false);
  const closeInquiry = useCallback(() => setInquiryOpen(false), []);
  const modalApi = useMemo(() => ({ open: () => setInquiryOpen(true) }), []);

  return <InquiryModalContext.Provider value={modalApi}>
    <div className="lv6">
      <a className="skip" href="#roles">본문으로 이동</a>
      <LandingV6Header />
      <main><LandingV6Sections /></main>
      <LandingV6Footer />
      <FloatingInquiryButton modalOpen={inquiryOpen} />
      {inquiryOpen && <InquiryModal onClose={closeInquiry} />}
    </div>
  </InquiryModalContext.Provider>;
}
