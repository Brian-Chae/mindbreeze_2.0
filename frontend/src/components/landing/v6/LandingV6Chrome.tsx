// 랜딩 v6 헤더·푸터 (SDD-248) — 기존 로그인·코드 입장·약관 링크 유지
import { Link } from 'react-router-dom';

export function LandingV6Header() {
  return (
    <header>
      <div className="nav wrap">
        <Link className="brand" to="/" aria-label="Mind Breeze 홈">
          <img src="/landing-v6/logo.svg" alt="" width={30} height={20} />Mind Breeze <small>2.0</small>
        </Link>
        <nav aria-label="메인 메뉴">
          <a href="#apps">서비스</a>
          <a href="#roles">이용 대상</a>
          <a href="#band">LINK BAND</a>
          <a href="#faq">자주 묻는 질문</a>
          <Link className="nav-entry login" to="/login">로그인</Link>
          <Link to="/join">코드로 입장 ↗</Link>
        </nav>
      </div>
    </header>
  );
}

export function LandingV6Footer() {
  return (
    <footer className="wrap">
      <div>
        <Link className="brand" to="/">Mind Breeze <small>2.0</small></Link>
        <p>기술이 돕고, 사람이 돌봅니다.</p>
        <small>© {new Date().getFullYear()} Looxid Labs Inc.</small>
      </div>
      <div className="footer-links">
        <Link to="/privacy">개인정보 처리방침</Link>
        <Link to="/terms">이용약관</Link>
        <Link to="/support">고객 지원</Link>
        <Link to="/account-deletion">계정 삭제 안내</Link>
        <Link to="/measurement-guide">측정 방법</Link>
        <Link to="/crisis-help">긴급 도움 안내</Link>
        <a href="mailto:admin-mindbreeze@looxidlabs.com">admin-mindbreeze@looxidlabs.com</a>
      </div>
    </footer>
  );
}
