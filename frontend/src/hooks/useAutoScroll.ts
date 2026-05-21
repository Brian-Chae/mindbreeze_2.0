// 자동/수동 스크롤 관리 — 사용자가 위로 스크롤한 경우 자동 스크롤 억제
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

interface UseAutoScrollResult {
  handleScroll: () => void;
  scrollToBottom: () => void;
  userScrolledUp: boolean;
}

export function useAutoScroll(
  listRef: RefObject<HTMLDivElement | null>,
  deps: ReadonlyArray<unknown>,
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

  // deps 변경 시 자동 스크롤 (단, 사용자가 위로 스크롤한 경우 억제)
  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { handleScroll, scrollToBottom, userScrolledUp };
}
