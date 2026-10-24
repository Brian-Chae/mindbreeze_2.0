/** 이탈 가드와 지속 활동을 공유한다. 콜백이므로 드래그 도중에도 최신 상태를 읽는다. */
const protections = new Set<() => boolean>();
const listeners = new Set<() => void>();
export function registerMobileSwipeProtection(protection: () => boolean): () => void {
  protections.add(protection);
  notifyMobileSwipeProtection();
  return () => { protections.delete(protection); notifyMobileSwipeProtection(); };
}
export function hasMobileSwipeProtection(): boolean { return [...protections].some(check => check()); }
export function notifyMobileSwipeProtection(): void { listeners.forEach(listener => listener()); }
export function subscribeMobileSwipeProtection(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const interactive = 'a,button,input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="slider"],canvas,svg.recharts-surface,.recharts-wrapper,table,[data-no-swipe],[data-mobile-swipe-native-x]';
export function isSwipeTargetExcluded(target: Element, root: HTMLElement): boolean {
  if (target.closest(interactive)) return true;
  for (let element: Element | null = target; element && element !== root; element = element.parentElement) {
    if (isHorizontalSwipeRegion(element)) return true;
  }
  return false;
}
export function isHorizontalSwipeRegion(element: Element): boolean {
  if (element.hasAttribute('data-mobile-swipe-page')) return false;
  const style = getComputedStyle(element);
  return /auto|scroll/.test(style.overflowX) && (element.scrollWidth > element.clientWidth + 1
    || element.classList.contains('overflow-x-auto') || element.classList.contains('overflow-x-scroll')
    || (element instanceof HTMLElement && /auto|scroll/.test(element.style.overflowX)));
}
function visible(element: Element): boolean {
  if (element.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  }
  // 브라우저에서는 레이아웃 박스 없는 숨겨진 UI도 제외한다. jsdom에는 이 API가 없다.
  return !element.checkVisibility || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
}
/** fixed inset-0는 기존 dialog 역할 없는 리포트 상세·시트도 포함한다. */
export function hasSwipeDomProtection(doc: Document): boolean {
  if (doc.activeElement?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return true;
  if (doc.getSelection()?.toString().trim()) return true;
  if ([...doc.querySelectorAll('dialog[open],[role="dialog"],[aria-modal="true"],[data-mobile-swipe-block],.fixed.inset-0')].some(visible)) return true;
  // 검색 필터도 내용이 있으면 보수적으로 버튼 이동만 허용한다. blur는 전송/저장이 아니다.
  return [...doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]),textarea')]
    .some(input => visible(input) && input.value.trim() !== '' && !input.readOnly && !input.disabled)
    || [...doc.querySelectorAll<HTMLElement>('[contenteditable="true"]')].some(input => visible(input) && Boolean(input.textContent?.trim()));
}
