// 비로그인 코드 입장 후 가입 권유 — 선택 사항(SDD-249 D7). 닫아도 입장·참여에는 영향이 없다.

import { useState } from 'react';
import { Link } from 'react-router-dom';

export function GuestSignupPrompt() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <aside
      data-testid="guest-signup-prompt"
      className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[440px] px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="rounded-3xl bg-white p-5 text-[#1F1F1F] shadow-[0_10px_28px_rgba(0,0,0,0.35)]">
        <p className="text-[15px] font-bold">가입하면 더 편해요</p>
        <p className="mt-1 text-sm text-[#6F6F6F]">리포트를 계속 관리하고 편하게 클래스에 계속 참여하려면 가입하세요.</p>
        <div className="mt-3 flex gap-2">
          <Link to="/register/client" className="flex h-11 flex-1 items-center justify-center rounded-full bg-[#5F0080] text-sm font-semibold text-white">가입하기</Link>
          <button type="button" onClick={() => setDismissed(true)} className="h-11 flex-1 rounded-full border border-[#D4D4D4] text-sm font-semibold text-[#5F0080]">건너뛰고 계속 참여하기</button>
        </div>
      </div>
    </aside>
  );
}
