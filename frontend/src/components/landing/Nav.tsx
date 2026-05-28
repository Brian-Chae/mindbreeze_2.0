import { useState } from 'react';
import { Link } from 'react-router-dom';

const items = ['서비스', 'AI 리포트', '상담사', '고객센터'] as const;

const Nav: React.FC = () => {
  const [active, setActive] = useState<string>('서비스');
  return (
    <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-[#EFEFEF]">
      <div className="max-w-[1280px] mx-auto px-8 py-[18px] flex items-center justify-between gap-8">
        <a href="#" className="flex items-center gap-3 no-underline">
          <img src="/mb-design/assets/logo_symbol_dark.svg" width={28} height={13} alt="" />
          <span className="font-sans font-extrabold text-[19px] text-purple-900 tracking-[-0.02em]">
            Mind&nbsp;Breeze
          </span>
        </a>
        <div className="hidden md:flex gap-1 items-center">
          {items.map((label) => (
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
          <Link to="/login" className="mb-btn mb-btn--ghost h-10 px-4 text-[14px] whitespace-nowrap inline-flex items-center">
            상담사 로그인
          </Link>
          <Link to="/register" className="mb-btn h-10 px-[18px] text-[14px] whitespace-nowrap inline-flex items-center">
            무료 체험
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default Nav;
