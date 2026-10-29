import { useEffect, useRef } from 'react';

/**
 * 회차 종료(phase=ended) 감지 시 biosignal close intent 를 한 번만 기록한다.
 * 호스트가 회차를 끝내면 회원은 밴드 해제 없이 떠나 close intent 가 생기지 않았고,
 * 그 결과 manifest 가 unknown 에 머물렀다. 종료가 취소되거나(ended→다른 phase) 재진입하면 다시 허용한다.
 */
export function useCloseBiosignalOnEnd(ended: boolean, close: (reason: string) => Promise<unknown>): void {
  const doneRef = useRef(false);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!ended) { doneRef.current = false; return; }
    if (doneRef.current) return;
    doneRef.current = true;
    void closeRef.current('session_ended').catch(() => undefined);
  }, [ended]);
}
