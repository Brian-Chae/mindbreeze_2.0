// 카카오 로그인 버튼 (MVP2 출시 예정 — UI only)

export default function KakaoLoginButton() {
  const handleClick = () => {
    alert('카카오 로그인은 MVP2 출시 예정입니다.');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled
      className="flex items-center justify-center gap-3 w-full h-[52px] rounded-xl bg-[#FEE500] border border-[#FEE500] opacity-70 cursor-not-allowed transition-all duration-200"
    >
      {/* 카카오 로고 */}
      <svg width="18" height="17" viewBox="0 0 18 17" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M9 .5C4.03.5 0 3.608 0 7.442c0 2.404 1.576 4.535 3.978 5.796l-.795 2.938c-.05.185.022.324.169.324.082 0 .164-.036.241-.103l3.387-2.266c.668.1 1.352.155 2.02.155 4.97 0 9-3.108 9-6.943C18 3.608 13.97.5 9 .5z"
          fill="#000"
        />
      </svg>
      <span className="text-[15px] font-medium text-[#1F1F1F]">카카오로 시작하기</span>
      <span className="text-[12px] text-[#6F6F6F] ml-1">(MVP2 출시 예정)</span>
    </button>
  );
}
