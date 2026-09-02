// 클래스 시작 전 세션코드 안내 배너 (1.0 패리티)

import { useState } from 'react';

interface SessionCodeBannerProps {
  accessCode: string;
  waitingCount: number;
}

export function SessionCodeBanner({ accessCode, waitingCount }: SessionCodeBannerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(accessCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-[20px] border border-[#DDD0EA] bg-[#F5EDFC] p-5 sm:p-6">
      <p className="text-[15px] font-semibold text-[#5F0080]">
        수강생에게 클래스 코드({accessCode})를 알려주세요
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-4xl font-black tracking-[0.16em] text-[#5F0080] sm:text-5xl">
          {accessCode}
        </p>
        <button type="button" onClick={() => void handleCopy()} className="mb-btn text-sm shrink-0">
          {copied ? '복사 완료' : '코드 복사'}
        </button>
      </div>
      <p className="mt-4 text-sm text-[#6F6F6F]">
        {waitingCount > 0
          ? `참가자 ${waitingCount}명 대기 중`
          : '참가자가 /join 에서 코드 입력 후 입장하면 시작할 수 있습니다'}
      </p>
    </div>
  );
}
