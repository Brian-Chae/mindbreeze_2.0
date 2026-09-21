// SDD-088: 상담사 이탈 보수 처리 훅 — beforeunload(브라우저 이탈) + useBlocker(SPA 라우팅 이탈)
// open/in_progress/paused 상태의 호스트 플레이어에서만 활성화한다.
// useBlocker 는 데이터 라우터(createBrowserRouter) 전용 — App 라우터가 데이터 라우터여야 한다.

import { useEffect, useRef } from 'react';
import { useBlocker, type Blocker } from 'react-router-dom';

/**
 * shouldGuard 는 이탈 시점에 평가되는 콜백 — 종료/닫기 후 프로그램적 이동(bypass)을
 * ref 로 판정할 수 있도록 boolean 이 아니라 함수를 받는다.
 */
export function useLeaveGuard(shouldGuard: () => boolean): Blocker {
  const guardRef = useRef(shouldGuard);
  guardRef.current = shouldGuard;

  // 새로고침·탭 닫기·주소 이동 — 브라우저 기본 확인 대화상자 강제
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent): void => {
      if (!guardRef.current()) return;
      event.preventDefault();
      // 일부 브라우저는 returnValue 설정이 있어야 대화상자를 띄운다
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // SPA 내 라우팅 이탈(뒤로가기·메뉴 클릭) — 자체 확인 모달은 호출측이 blocker 상태로 렌더
  return useBlocker(
    ({ currentLocation, nextLocation }) =>
      guardRef.current() && currentLocation.pathname !== nextLocation.pathname,
  );
}
