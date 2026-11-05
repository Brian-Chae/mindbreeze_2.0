import { useEffect, useRef } from 'react';

/**
 * 회차 종료(phase=ended) 감지 시 biosignal close intent 를 한 번만 기록하고, 이어서 밴드 연결을 해제한다.
 * 호스트가 회차를 끝내면 회원은 밴드 해제 없이 떠나 close intent 가 생기지 않았고, GATT 연결도 남았다(SDD-298).
 * close 가 실패해도 release 는 반드시 호출한다. release 는 이중 호출에 안전해야 한다(이미 해제면 no-op).
 * 종료가 취소되거나(ended→다른 phase) 재진입하면 다시 허용한다.
 */
export function useCloseBiosignalOnEnd(
  ended: boolean,
  close: (reason: string) => Promise<unknown>,
  release?: () => Promise<unknown>,
): void {
  const doneRef = useRef(false);
  const closeRef = useRef(close);
  closeRef.current = close;
  const releaseRef = useRef(release);
  releaseRef.current = release;
  useEffect(() => {
    if (!ended) { doneRef.current = false; return; }
    if (doneRef.current) return;
    doneRef.current = true;
    void (async () => {
      await closeRef.current('session_ended').catch(() => undefined);
      await releaseRef.current?.()?.catch(() => undefined);
    })();
  }, [ended]);
}
