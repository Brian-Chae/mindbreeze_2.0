// 대화 목록 영역의 크기가 바뀔 때(키보드 열림/닫힘 등) 맨 아래에 있던 사용자는 계속 맨 아래를 유지한다.
// 키보드 이벤트 시점과 웹뷰 실제 리사이즈 시점이 어긋나는 문제(첫 입력 때 최신 메시지가 가려짐)를 막는다.
import { useEffect, type RefObject } from 'react';
import { KEYBOARD_EVENT } from '../lib/native/keyboard';

const NEAR_BOTTOM_PX = 80;
const KEYBOARD_RETRY_MS = [0, 120, 300, 500];

export function useStickToBottom(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    let wasAtBottomBeforeKeyboard = true;
    const timers: number[] = [];

    const toBottom = (): void => { el.scrollTop = el.scrollHeight; };
    const onScroll = (): void => {
      atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    };
    const onKeyboard = (): void => {
      // 키보드가 열린 직후 레이아웃이 늦게 확정될 수 있어 여러 번 맨 아래로 맞춘다.
      if (!wasAtBottomBeforeKeyboard) return;
      for (const ms of KEYBOARD_RETRY_MS) timers.push(window.setTimeout(toBottom, ms));
    };
    // 키보드가 올라오기 직전의 위치 기억 — 위로 스크롤해 과거 대화를 보던 사용자는 방해하지 않는다.
    const onFocusIn = (): void => { wasAtBottomBeforeKeyboard = atBottom; };

    // 입력창이 커지거나 키보드가 열려 목록 영역이 줄어들 때, 줄어들기 "직전"에 맨 아래였다면 계속 맨 아래를 유지한다.
    // atBottom 플래그는 스크롤 이벤트로만 갱신돼 키보드 전환 중 어긋날 수 있어, 높이 변화량으로 직접 다시 판정한다.
    let prevHeight = el.clientHeight;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      const height = el.clientHeight;
      const shrink = prevHeight - height;
      prevHeight = height;
      const distance = el.scrollHeight - el.scrollTop - height;
      const wasNearBottom = atBottom || (shrink > 0 && distance - shrink < NEAR_BOTTOM_PX);
      if (!wasNearBottom) return;
      toBottom();
      requestAnimationFrame(toBottom);
    });
    observer?.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener(KEYBOARD_EVENT, onKeyboard);
    return () => {
      observer?.disconnect();
      el.removeEventListener('scroll', onScroll);
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener(KEYBOARD_EVENT, onKeyboard);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [ref, active]);
}
