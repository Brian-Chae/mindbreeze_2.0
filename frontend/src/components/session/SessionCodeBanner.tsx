// 세션코드 안내 배너 — 1.0 RadiusContainer #F2F3F8 / radius 12 패리티 (SDD-029)

import { useState } from 'react';

interface SessionCodeBannerProps {
  accessCode: string;
  /** 대기 / 진행 / 일시정지 */
  mode: 'waiting' | 'running' | 'paused';
  /** 진행시간 표시 문자열 (예: 03분 12초) */
  elapsedText?: string;
  onRefresh?: () => void;
}

export function SessionCodeBanner({
  accessCode,
  mode,
  elapsedText,
  onRefresh,
}: SessionCodeBannerProps) {
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

  const statusLine =
    mode === 'waiting'
      ? `아직 수업이 시작되지 않았어요. 수강생에게 세션코드(${accessCode})를 알려주세요.`
      : mode === 'paused'
        ? `수업이 일시정지되었어요. 경과시간: ${elapsedText ?? '—'}`
        : `수업을 시작했어요. 진행시간: ${elapsedText ?? '—'}`;

  return (
    <div className="rounded-xl bg-[#F2F3F8] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-base font-semibold leading-6 text-[#5E4FFF]">
          {statusLine}
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="mb-btn mb-btn--ghost h-10 text-sm"
          >
            {copied ? '복사 완료' : '코드 복사'}
          </button>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="mb-btn mb-btn--ghost h-10 text-sm"
            >
              화면 새로고침
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
