import { useAuthStore } from '../stores/authStore';
import { mountSwipeSnapshot, resetSwipeSnapshots, saveSwipeSnapshot } from '../lib/mobile-menu-swipe-preview';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { UserRole } from '../lib/api/auth';
import { isCounselingEnabled } from '../lib/feature-flags';
import { getMobileMenuTabs, getSwipeAxis, getSwipeRootIndex, resistSwipe, shouldCommitSwipe, type SwipeSample } from '../lib/mobile-menu-swipe';
import { hasMobileSwipeProtection, hasSwipeDomProtection, isHorizontalSwipeRegion, isSwipeTargetExcluded, subscribeMobileSwipeProtection } from '../lib/mobile-menu-swipe-protection';
import '../components/layout/mobile-menu-swipe.css';

let pendingFocus: { path: string; label: string } | null = null;

export function useMobileMenuSwipe(role: UserRole | null | undefined, blocked: boolean, accountKey?: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ role, blocked, accountKey });
  latest.current = { role, blocked, accountKey };
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [showHint, setShowHint] = useState(false);
  const hintKey = `mb-mobile-menu-swipe-hint:${accountKey ?? 'session'}:${role ?? ''}`;
  const dismissHint = () => {
    setShowHint(false);
    try { sessionStorage.setItem(hintKey, '1'); } catch { /* 저장 불가여도 메뉴 이동은 유지한다. */ }
  };

  useEffect(() => {
    if (getSwipeRootIndex(pathname, getMobileMenuTabs(role, isCounselingEnabled())) < 0 || blocked) return;
    try { setShowHint(sessionStorage.getItem(hintKey) !== '1'); } catch { setShowHint(true); }
    if (pendingFocus?.path === pathname.replace(/\/+$/, '')) {
      const label = pendingFocus.label;
      pendingFocus = null;
      setMessage(`${label} 메뉴로 이동했어요`);
      const title = containerRef.current?.closest('section')?.querySelector<HTMLElement>('[data-mobile-swipe-title]') ?? containerRef.current;
      if (title) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
    }
  }, [pathname, role, blocked, hintKey]);

  useEffect(() => {
    const root = containerRef.current;
    const page = root?.querySelector<HTMLElement>('[data-mobile-swipe-page]');
    if (!root || !page) return;
    const snapshotScope = accountKey ? `${accountKey}:${role}` : '';
    resetSwipeSnapshots(snapshotScope);
    const tabs = getMobileMenuTabs(role, isCounselingEnabled());
    const index = getSwipeRootIndex(pathname, tabs);
    if (index < 0) return;
    const mobile = matchMedia('(max-width: 767px)');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    root.dataset.mobileSwipeEnabled = 'true';
    let composing = false;
    let active: { id: number; x: number; y: number; time: number; dx: number; width: number; horizontal: boolean; samples: SwipeSample[] } | null = null;
    let settling = false;
    let preview: HTMLDivElement | null = null;
    let targetIndex = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let animation: Animation | null = null;
    let previewAnimation: Animation | null = null;
    let suppressClickUntil = 0;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const protectedNow = () => latest.current.blocked || latest.current.role !== role || latest.current.accountKey !== accountKey || !mobile.matches || composing
      || document.visibilityState === 'hidden' || (window.visualViewport?.height ?? window.innerHeight) < viewportHeight - 120
      || hasMobileSwipeProtection() || hasSwipeDomProtection(document);
    const clearVisuals = () => {
      animation?.cancel(); previewAnimation?.cancel(); animation = null; previewAnimation = null;
      page.style.transform = ''; page.style.willChange = '';
      preview?.remove(); preview = null; targetIndex = -1;
      root.removeAttribute('data-mobile-swipe-dragging');
    };
    const release = () => {
      if (active && root.hasPointerCapture?.(active.id)) root.releasePointerCapture(active.id);
    };
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      release(); active = null; settling = false; clearVisuals();
    };
    const makePreview = (nextIndex: number) => {
      if (nextIndex === targetIndex) return;
      preview?.remove(); preview = null; targetIndex = nextIndex;
      if (!tabs[nextIndex] || reduced.matches) return;
      preview = document.createElement('div');
      preview.className = 'mobile-menu-swipe-preview';
      preview.dataset.mobileSwipePreview = '';
      preview.setAttribute('aria-hidden', 'true');
      preview.setAttribute('inert', '');
      root.append(preview);
      if (mountSwipeSnapshot(snapshotScope, tabs[nextIndex].to, preview)) {
        preview.dataset.mobileSwipePreviewKind = 'visited';
        preview.style.padding = '0';
      } else {
        preview.dataset.mobileSwipePreviewKind = 'loading';
        const title = document.createElement('h2'); title.textContent = tabs[nextIndex].label;
        const loading = document.createElement('p'); loading.textContent = '이동하면 화면을 불러와요';
        preview.append(title, loading);
      }
    };
    const render = () => {
      if (!active || !active.horizontal || reduced.matches) return;
      const nextIndex = index + (active.dx < 0 ? 1 : -1);
      makePreview(nextIndex);
      const offset = tabs[nextIndex] ? active.dx : resistSwipe(active.dx);
      page.style.transform = `translate3d(${offset}px,0,0)`;
      if (preview) preview.style.transform = `translate3d(${active.dx + (active.dx < 0 ? active.width : -active.width)}px,0,0)`;
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      if (active || settling) { if (active && event.pointerId !== active.id) cancel(); return; }
      if (!event.isPrimary || protectedNow() || !(event.target instanceof Element) || isSwipeTargetExcluded(event.target, root)) return;
      const rect = root.getBoundingClientRect();
      if (event.clientX < 24 || event.clientX > window.innerWidth - 24 || event.clientY < rect.top || event.clientY > rect.bottom) return;
      saveSwipeSnapshot(snapshotScope, tabs[index].to, page);
      active = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, dx: 0, width: rect.width, horizontal: false, samples: [{ x: event.clientX, time: event.timeStamp }] };
    };
    const move = (event: PointerEvent) => {
      if (!active || event.pointerId !== active.id || settling) return;
      if (protectedNow()) { cancel(); return; }
      active.dx = event.clientX - active.x;
      active.samples.push({ x: event.clientX, time: event.timeStamp });
      active.samples = active.samples.filter(sample => event.timeStamp - sample.time <= 80);
      if (!active.horizontal) {
        const axis = getSwipeAxis(active.dx, event.clientY - active.y, event.timeStamp - active.time);
        if (axis === 'cancel') { cancel(); return; }
        if (axis === 'pending') return;
        active.horizontal = true;
        root.setPointerCapture?.(active.id);
        root.dataset.mobileSwipeDragging = 'true';
        page.style.willChange = reduced.matches ? '' : 'transform';
      }
      event.preventDefault(); render();
    };
    const up = (event: PointerEvent) => {
      if (!active || event.pointerId !== active.id || settling) return;
      if (!active.horizontal || protectedNow()) { cancel(); return; }
      active.dx = event.clientX - active.x;
      active.samples.push({ x: event.clientX, time: event.timeStamp });
      const nextIndex = index + (active.dx < 0 ? 1 : -1);
      const commit = Boolean(tabs[nextIndex]) && Math.abs(active.dx) >= Math.abs(event.clientY - active.y) * 1.5 && shouldCommitSwipe(active.dx, active.width, active.samples);
      const destination = commit ? tabs[nextIndex] : null;
      const width = active.width;
      const dx = active.dx;
      release(); active = null; settling = true;
      suppressClickUntil = performance.now() + 400;
      const finish = () => {
        if (destination && !protectedNow()) {
          pendingFocus = { path: destination.to, label: destination.label };
          navigate(destination.to);
        }
        cancel();
      };
      if (reduced.matches) { finish(); return; }
      const duration = commit ? 240 : 160;
      const end = commit ? (dx < 0 ? -width : width) : 0;
      if (typeof page.animate === 'function') {
        animation = page.animate([{ transform: page.style.transform || 'translate3d(0,0,0)' }, { transform: `translate3d(${end}px,0,0)` }], { duration, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' });
        if (preview) previewAnimation = preview.animate([{ transform: preview.style.transform }, { transform: `translate3d(${end + (dx < 0 ? width : -width)}px,0,0)` }], { duration, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' });
      }
      timer = setTimeout(finish, duration);
    };
    // 레일을 포함한 조상의 빈 padding은 touch-action:auto여야 레일의 native pan이 산다.
    // PointerEvent.preventDefault는 그 기본 pan을 막지 못하므로, 잠금된 단일 수평 터치만 보조한다.
    const touchMove = (event: TouchEvent) => {
      if (active?.horizontal && event.touches.length === 1 && !protectedNow()) event.preventDefault();
    };
    const otherPointer = (event: PointerEvent) => { if (active && event.pointerType === 'touch' && event.pointerId !== active.id) cancel(); };
    const lostCapture = (event: PointerEvent) => { if (event.target === root && active?.id === event.pointerId && !settling) cancel(); };
    const click = (event: MouseEvent) => { if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); } };
    const compositionStart = () => { composing = true; cancel(); };
    const compositionEnd = () => { composing = false; };
    const checkProtection = () => { if ((active || settling) && protectedNow()) cancel(); };
    // pan-y인 조상이 있으면 레일의 auto도 가로 스크롤을 복구하지 못한다.
    // 레일을 포함한 조상은 auto, 그 밖의 본문 하위 트리만 pan-y로 잠근다.
    const markRails = () => {
      for (const element of page.querySelectorAll<HTMLElement>('*')) {
        const nativeX = isHorizontalSwipeRegion(element) || element.matches('[data-no-swipe],table,.recharts-wrapper,canvas,[role="slider"],input[type="range"]');
        if (nativeX && !element.hasAttribute('data-mobile-swipe-native-x')) element.setAttribute('data-mobile-swipe-native-x', '');
      }
    };
    markRails();
    const observer = new MutationObserver(() => { markRails(); checkProtection(); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-modal', 'hidden', 'aria-hidden', 'data-mobile-swipe-block', 'class'] });
    const unsubscribe = subscribeMobileSwipeProtection(checkProtection);
    const unsubscribeAuth = useAuthStore.subscribe(state => {
      const nextScope = state.user ? `${state.user.id}:${state.user.role}` : '';
      if (nextScope !== snapshotScope) { resetSwipeSnapshots(nextScope); cancel(); }
    });
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move, { passive: false });
    root.addEventListener('touchmove', touchMove, { passive: false });
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', cancel);
    root.addEventListener('lostpointercapture', lostCapture);
    root.addEventListener('click', click, true);
    document.addEventListener('pointerdown', otherPointer, true);
    document.addEventListener('compositionstart', compositionStart);
    document.addEventListener('compositionend', compositionEnd);
    document.addEventListener('focusin', checkProtection);
    document.addEventListener('input', checkProtection);
    document.addEventListener('visibilitychange', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    window.visualViewport?.addEventListener('resize', checkProtection);
    mobile.addEventListener('change', cancel); reduced.addEventListener('change', cancel);
    return () => {
      if (!protectedNow()) saveSwipeSnapshot(snapshotScope, tabs[index].to, page);
      cancel(); observer.disconnect(); unsubscribe(); unsubscribeAuth(); delete root.dataset.mobileSwipeEnabled;
      root.removeEventListener('pointerdown', down); root.removeEventListener('pointermove', move); root.removeEventListener('touchmove', touchMove); root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', cancel); root.removeEventListener('lostpointercapture', lostCapture); root.removeEventListener('click', click, true);
      document.removeEventListener('pointerdown', otherPointer, true); document.removeEventListener('compositionstart', compositionStart); document.removeEventListener('compositionend', compositionEnd);
      document.removeEventListener('focusin', checkProtection); document.removeEventListener('input', checkProtection); document.removeEventListener('visibilitychange', cancel);
      window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); window.visualViewport?.removeEventListener('resize', checkProtection);
      mobile.removeEventListener('change', cancel); reduced.removeEventListener('change', cancel);
    };
  }, [pathname, role, accountKey, navigate]);

  useEffect(() => {
    // drawer 등 React 상태 변경은 이벤트를 기다리지 않고 진행 중 드래그도 취소한다.
    if (blocked) containerRef.current?.dispatchEvent(new Event('pointercancel'));
  }, [blocked]);
  return { containerRef, message, showHint, dismissHint };
}
