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
  /** 클래스 코드 — 상담사 라이브 영상 구독용 */
  classCode: string | null;
  /** 게스트 소유 증명 토큰 */
  participantToken?: string | null;
  /** 클래스 장소 유형 — 오프라인은 스피커 기본 뮤트(하울링 방지) */
  locationType?: 'online' | 'offline';
  /** 참여 방식 — 오프라인 그룹 대규모에서는 상담사 영상을 숨긴다 */
  participantMode?: 'one_on_one' | 'group';
  /** 정원 — 오프라인 그룹 20명 초과 시 상담사 영상 타일 미표시 */
  maxParticipants?: number;
}

export function MemberSessionScene({
  title,
  startedAt,
  durationMin,
  sessionId,
  participantId,
  error,
  onLeave,
  classCode,
  participantToken,
  locationType,
  participantMode,
  maxParticipants,
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
        classCode={classCode}
        participantToken={participantToken}
        locationType={locationType}
        participantMode={participantMode}
        maxParticipants={maxParticipants}
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
