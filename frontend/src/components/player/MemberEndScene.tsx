// SDD-208 M21 — 회원(게스트) 종료 씬. 점수 없는 종료 카드(MemberEndView) 아래에 기존 리포트 메일 신청·사후 체크인을 시트로 연다(plan D5).
// class-join-page 의 complete 단계가 GuestCompletePanel 대신 이 씬을 쓴다.
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MemberEndView } from '../class/player/member/MemberFullView';
import { ReportEmailRequestPanel } from '../class/ReportEmailRequestPanel';
import { SelfCheckinPanel } from '../class/SelfCheckinPanel';
import { formatEndDuration } from '../../lib/class/member-end';

interface MemberEndSceneProps {
  sessionId: string | null;
  sessionTitle: string | null;
  /** 수업 시작 시각 — "함께한 시간" 계산용 */
  startedAt: string | null;
  durationMin: number;
  participantId: string | null;
  participantToken: string | null;
  /** 로그인 회원 계정 이메일 — 있으면 리포트 신청 시 입력 생략 */
  accountEmail: string | null;
  isLoggedIn: boolean;
  error: string | null;
  /** 입장 상태(참가 정보·BLE)를 정리한다. 화면을 떠나기 직전에 부른다 */
  onReset: () => void;
  /** SDD-096 호환 — 점수를 노출하지 않으므로 화면에는 쓰지 않는다 */
  relaxationIndex?: number | null;
}

/** 기존 라이트 톤 패널(설문·이메일 폼)을 어두운 시트 안에서 읽히게 하는 밝은 카드 */
function LegacyPanelCard({ children }: { children: ReactNode }) {
  return <div className="mp-legacy-panel">{children}</div>;
}

export function MemberEndScene({
  sessionId, sessionTitle, startedAt, durationMin, participantId, participantToken, accountEmail, isLoggedIn, error, onReset,
}: MemberEndSceneProps) {
  const navigate = useNavigate();
  const [durationLabel] = useState(() => formatEndDuration({ startedAt, durationMin, nowMs: Date.now() }));

  const handleAction = (): void => {
    onReset();
    navigate(isLoggedIn ? '/role-redirect' : '/');
  };

  return (
    <div className="min-h-screen bg-black">
      <MemberEndView
        end={{
          title: sessionTitle ?? '클래스',
          durationLabel,
          actionLabel: isLoggedIn ? '대시보드로 이동' : '홈으로',
          reportPanel: sessionId ? (
            <LegacyPanelCard>
              <ReportEmailRequestPanel
                sessionId={sessionId}
                participantId={participantId}
                participantToken={participantToken}
                accountEmail={accountEmail}
                isLoggedIn={isLoggedIn}
              />
            </LegacyPanelCard>
          ) : undefined,
          checkinPanel: sessionId ? (
            <LegacyPanelCard>
              <SelfCheckinPanel sessionId={sessionId} participantId={participantId} participantToken={participantToken} isLoggedIn={isLoggedIn} />
            </LegacyPanelCard>
          ) : undefined,
        }}
        onAction={handleAction}
      />
      {error ? (
        <p
          role="alert"
          className="fixed bottom-4 left-1/2 z-20 w-[min(100%-2rem,28rem)] -translate-x-1/2 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
