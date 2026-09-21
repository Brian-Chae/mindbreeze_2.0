// SDD-088: 회원(게스트) 대기실 씬 — class-join-page 의 waiting 렌더를 플레이어 씬으로 이전.
// Welcome → LINK BAND 착용 가이드 → 시작 대기 (1.0 3단계 패리티)

import { FadingImageBackground } from '../class/FadingImageBackground';
import { WelcomeText } from '../class/WelcomeText';
import { BandGuidePanel } from '../class/BandGuidePanel';

export type MemberWaitingStep = 'welcome' | 'guide' | 'wait';

interface MemberWaitingSceneProps {
  title: string | null;
  waitingStep: MemberWaitingStep;
  sessionId: string;
  participantId: string | null;
  displayName: string | null;
  classCode: string;
  statusLabel: string;
  error: string | null;
  onWelcomeFinish: () => void;
  onGuideConfirm: () => void;
  onLeave: () => void;
}

export function MemberWaitingScene({
  title,
  waitingStep,
  sessionId,
  participantId,
  displayName,
  classCode,
  statusLabel,
  error,
  onWelcomeFinish,
  onGuideConfirm,
  onLeave,
}: MemberWaitingSceneProps) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-black text-white">
      <FadingImageBackground />

      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-8">
        <button
          type="button"
          onClick={onLeave}
          className="rounded-xl bg-white/20 px-4 py-2 text-sm font-medium text-white"
        >
          종료
        </button>
        <h1 className="truncate px-3 text-center text-base font-medium text-white/80 sm:text-lg">
          {title ?? '클래스'}
        </h1>
        <div className="w-[4.5rem]" aria-hidden="true" />
      </header>

      <div
        className={`relative z-10 flex flex-1 flex-col px-4 pb-16 ${
          waitingStep === 'guide'
            ? 'justify-start pt-2 md:justify-center'
            : 'items-center justify-center'
        }`}
      >
        {waitingStep === 'welcome' && <WelcomeText onFinish={onWelcomeFinish} />}
        {(waitingStep === 'guide' || waitingStep === 'wait') && (
          <BandGuidePanel
            sessionId={sessionId}
            participantId={participantId}
            phase={waitingStep}
            onConfirm={onGuideConfirm}
            displayName={displayName}
            classCode={classCode}
            statusLabel={statusLabel}
          />
        )}
        {error && (
          <p
            role="alert"
            className="mt-8 w-full max-w-md self-center rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          >
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
