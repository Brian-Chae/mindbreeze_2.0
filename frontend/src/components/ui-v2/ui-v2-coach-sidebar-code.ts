// 11/9 대표 지시 — 데스크톱 좌측 메뉴 하단(코치 이름·이메일) 아래에 코치 코드 전체 숫자를 함께 보여 준다.
// 레거시 SidebarNav 마크업은 바꾸지 않는다. 코치 스코프(html.u2-coach)에서만 줄을 붙이며 운영 번들에는 포함되지 않는다.
import { useAuthStore } from '../../stores/authStore';

export const SIDEBAR_CODE_CLASS = 'u2-coach-sidebar-code';

/** 프로필 블록 끝에 코치 코드 줄을 넣거나 갱신·제거한다. */
export function syncCoachSidebarCode(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const user = useAuthStore.getState().user;
  const code = root.classList.contains('u2-coach') && user?.role === 'counselor' ? user.counselor_code ?? null : null;
  doc.querySelectorAll<HTMLElement>('[data-sidebar-profile]').forEach((profile) => {
    let line = profile.querySelector<HTMLElement>(`.${SIDEBAR_CODE_CLASS}`);
    if (!code) { line?.remove(); return; }
    if (!line) {
      line = doc.createElement('div');
      line.className = SIDEBAR_CODE_CLASS;
      profile.appendChild(line);
    }
    const text = `코치 코드 ${code}`;
    if (line.textContent !== text) line.textContent = text;
  });
}

/** 사이드바가 다시 그려질 때마다 코드 줄을 유지한다. 반환값은 해제 함수. */
export function attachCoachSidebarCode(root: HTMLElement): () => void {
  const doc = root.ownerDocument;
  syncCoachSidebarCode(root);
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; syncCoachSidebarCode(root); });
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  const offAuth = useAuthStore.subscribe(() => syncCoachSidebarCode(root));
  return () => {
    observer.disconnect();
    offAuth();
    doc.querySelectorAll(`.${SIDEBAR_CODE_CLASS}`).forEach((n) => n.remove());
  };
}
