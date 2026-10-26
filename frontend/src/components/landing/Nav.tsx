import { useState } from 'react';
import { Link } from 'react-router-dom';
import { isAiEnabled, isCounselingEnabled } from '../../lib/feature-flags';

// 상담·AI 비공개(기본)에서는 출시 범위(명상 클래스) 밖의 메뉴 이름을 쓰지 않는다.
const navItems = (): string[] => ['서비스', isAiEnabled() ? 'AI 리포트' : '리포트', ...(isCounselingEnabled() ? ['상담사'] : []), '고객센터'];

const Nav: React.FC = () => {
  const [active, setActive] = useState<string>('서비스');
  return (
    <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-[#EFEFEF]">
      <div className="max-w-[1280px] mx-auto px-8 py-[18px] flex items-center justify-between gap-8">
        <a href="#" className="flex items-center gap-3 no-underline">
          <img src="/mb-design/assets/logo_symbol_dark.svg" width={28} height={13} alt="" />
          <span className="font-sans font-extrabold text-[18px] text-purple-900 tracking-[-0.02em]">
            Mind&nbsp;Breeze
          </span>
        </a>
        <div className="hidden md:flex gap-1 items-center">
          {navItems().map((label) => (
            <button
              key={label}
              onClick={() => setActive(label)}
              className={`bg-transparent border-0 px-[18px] py-[10px] font-sans text-[15px] cursor-pointer ${
                active === label ? 'font-bold text-purple-900' : 'font-medium text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-[10px]">
          <Link to="/join" className="mb-btn mb-btn--ghost h-10 px-4 text-[15px] whitespace-nowrap inline-flex items-center">
            코드로 입장
          </Link>
          <Link to="/login?role=counselor" className="mb-btn mb-btn--ghost h-10 px-4 text-[15px] whitespace-nowrap inline-flex items-center">
            {isCounselingEnabled() ? '상담사 로그인' : '진행자 로그인'}
          </Link>
          <Link to="/login/client" className="mb-btn mb-btn--ghost h-10 px-4 text-[15px] whitespace-nowrap inline-flex items-center">
            회원 로그인
          </Link>
          <Link to="/register" className="mb-btn h-10 px-[18px] text-[15px] whitespace-nowrap inline-flex items-center">
            시작하기
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default Nav;
