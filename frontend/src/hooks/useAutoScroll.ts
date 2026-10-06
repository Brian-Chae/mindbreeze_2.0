// 자동/수동 스크롤 관리 — 사용자가 위로 스크롤한 경우 자동 스크롤 억제
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

interface UseAutoScrollResult {
  handleScroll: () => void;
  scrollToBottom: () => void;
  userScrolledUp: boolean;
}

/**
 * HOOK-STATE-05: 가변 길이 deps 배열을 useEffect 의존성으로 전개하면 React가
 * "The final argument passed to useEffect changed size between renders" 오류를 던진다.
 * 호출측은 단일 트리거(원시값)를 넘기고, 훅은 고정 길이 의존성 배열을 유지한다.
 * 새 메시지·로딩 변화 등 여러 요소를 반영하려면 호출측에서 문자열로 합쳐 하나의 값으로 넘긴다.
 */
export function useAutoScroll(
  listRef: RefObject<HTMLDivElement | null>,
  trigger: unknown,
  enabled = true,
): UseAutoScrollResult {
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const userScrolledUpRef = useRef(false);

  const handleScroll = useCallback((): void => {
    const el = listRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    const next = !isAtBottom;
    userScrolledUpRef.current = next;
    setUserScrolledUp(next);
  }, [listRef]);

  const scrollToBottom = useCallback((): void => {
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      userScrolledUpRef.current = false;
      setUserScrolledUp(false);
    });
  }, [listRef]);

  // trigger 변경 시 자동 스크롤 (단, 사용자가 위로 스크롤한 경우 억제)
  useEffect(() => {
    if (!enabled || userScrolledUpRef.current) return;
    const el = listRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [trigger, enabled, listRef]);

  return { handleScroll, scrollToBottom, userScrolledUp };
}
