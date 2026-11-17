// SDD-320 H — 코치 모바일: 스크롤하면 상단 바에 현재 메뉴 제목을 보여 준다(회원 앱 UiV2ClientShell 과 같은 동작).
// 레거시 AppShell 마크업은 바꾸지 않는다. 코치 스코프(html.u2-coach)에서만 동작하며 운영 번들에는 포함되지 않는다.
export const COACH_COLLAPSED_CLASS = 'u2-coach-collapsed';
export const COMPACT_TITLE_CLASS = 'u2-coach-compact-title';
const COLLAPSE_AT = 24;
const MOBILE_QUERY = '(max-width: 767px)';

/** 큰 제목 블록(모바일 PageHeader)에서 제목 문자열을 읽는다. 제목이 없으면 빈 문자열. */
export function readCoachTitle(doc: Document = document): string {
  return doc.querySelector('[data-ui="page-header"].mb-page-header-mobile h1')?.textContent?.trim() ?? '';
}

/** 접힘 판정: 스크롤이 임계값을 넘고, 접어도 남는 스크롤 여유가 있을 때만 접는다(짧은 화면 깜빡임 방지). */
export function shouldCollapse(scrollTop: number, scrollHeight: number, clientHeight: number, headerHeight: number, wasCollapsed: boolean): boolean {
  if (wasCollapsed) return scrollTop > 0;
  return scrollTop > COLLAPSE_AT && scrollHeight - clientHeight > headerHeight + COLLAPSE_AT;
}

function ensureTitleNode(doc: Document): HTMLElement | null {
  const bar = doc.querySelector('.mb-shell-topbar');
  if (!bar) return null;
  let node = bar.querySelector<HTMLElement>(`.${COMPACT_TITLE_CLASS}`);
  if (!node) {
    node = doc.createElement('span');
    node.className = COMPACT_TITLE_CLASS;
    node.setAttribute('aria-hidden', 'true');
    bar.insertBefore(node, bar.lastElementChild);
  }
  return node;
}

function setCollapsed(root: HTMLElement, on: boolean): void {
  const doc = root.ownerDocument;
  const title = on ? readCoachTitle(doc) : '';
  const node = ensureTitleNode(doc);
  const show = on && !!title;
  if (node) { node.textContent = title; node.dataset.shown = String(show); }
  root.classList.toggle(COACH_COLLAPSED_CLASS, show);
}

/** 스크롤·라우트 변경을 감시한다. 반환값은 해제 함수. */
export function attachCoachCompactTitle(root: HTMLElement = document.documentElement): () => void {
  const doc = root.ownerDocument;
  const onScroll = (event: Event): void => {
    const target = event.target;
    // 쉘 안의 세로 스크롤 영역만 본다(가로 레일·작은 목록의 스크롤은 무시). 화면마다 스크롤 컨테이너가 달라 마커에 의존하지 않는다.
    if (!(target instanceof HTMLElement) || !target.closest('[data-shell-variant]') || target.clientHeight < 300 || target.scrollHeight - target.clientHeight < 40) return;
    if (!doc.defaultView?.matchMedia(MOBILE_QUERY).matches) { setCollapsed(root, false); return; }
    const header = doc.querySelector<HTMLElement>('[data-ui="page-header"].mb-page-header-mobile');
    const was = root.classList.contains(COACH_COLLAPSED_CLASS);
    const headerHeight = was ? 0 : Math.max(header?.offsetHeight ?? 0, 56);
    const next = shouldCollapse(target.scrollTop, target.scrollHeight, target.clientHeight, headerHeight, was);
    if (next !== was) setCollapsed(root, next);
  };
  doc.addEventListener('scroll', onScroll, true);
  return () => { doc.removeEventListener('scroll', onScroll, true); setCollapsed(root, false); doc.querySelector(`.${COMPACT_TITLE_CLASS}`)?.remove(); };
}

/** 페이지 이동 시 접힘을 초기화한다(새 화면은 맨 위에서 시작). */
export function resetCoachCompactTitle(root: HTMLElement = document.documentElement): void {
  if (root.classList.contains(COACH_COLLAPSED_CLASS)) setCollapsed(root, false);
}
