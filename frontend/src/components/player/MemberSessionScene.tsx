// SDD-088: 회원(게스트) 진행 씬 — class-join-page 의 meditation 렌더를 플레이어 씬으로 이전.
// 검정 풀블리드 immersive (SDD-029)

import { GuestMeditationPanel } from '../class/GuestMeditationPanel';

interface MemberSessionSceneProps {
  title: string | null;
  startedAt: string | null;
  durationMin: number;
  sessionId: string;
  participantId: string | null;
  error: string | null;
  onLeave: () => void;
}

export function MemberSessionScene({
  title,
  startedAt,
  durationMin,
  sessionId,
  participantId,
  error,
  onLeave,
}: MemberSessionSceneProps) {
  return (
    <main className="min-h-screen bg-black">
      <GuestMeditationPanel
        title={title}
        startedAt={startedAt}
        durationMin={durationMin}
        onLeave={onLeave}
        sessionId={sessionId}
        participantId={participantId}
      />
      {error && (
        <p
          role="alert"
          className="fixed bottom-4 left-1/2 z-20 w-[min(100%-2rem,28rem)] -translate-x-1/2 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
        >
          {error}
        </p>
      )}
    </main>
  );
}
