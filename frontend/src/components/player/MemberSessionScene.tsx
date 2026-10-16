// SDD-088: 회원(게스트) 진행 씬 — class-join-page 의 meditation 렌더를 플레이어 씬으로 이전.
// SDD-208: 진행 화면 본체를 GuestMeditationPanel 에서 새 컨테이너(MemberClassContainer)로 교체.

import { MemberClassContainer } from '../class/player/member/MemberClassContainer';
import type { LinkbandMode } from '../../lib/api/session';

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
  /** 세션 밴드 사용 정책 — none이면 밴드 UI 전체 숨김 */
  linkbandMode?: LinkbandMode;
  /** 정원이 차서 대기열에 들어간 참가자 — 대기 화면만 보이고 자리가 나면 자동으로 입장한다 */
  waitlisted?: boolean;
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
  linkbandMode,
  waitlisted = false,
}: MemberSessionSceneProps) {
  return (
    <div className="min-h-screen bg-black">
      <MemberClassContainer
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
        linkbandMode={linkbandMode}
        waitlisted={waitlisted}
      />
      {error && (
        <p
          role="alert"
          className="fixed bottom-4 left-1/2 z-20 w-[min(100%-2rem,28rem)] -translate-x-1/2 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}
