// SDD-320 — 코치 화면 D안 스코프. 코치(counselor) 업무 경로에서만 <html class="u2-coach"> 를 붙여 ui-v2-coach.css 스킨을 켠다.
// 기존 페이지 마크업·상태는 건드리지 않는다. 실시간 클래스 진행(플레이어·라이브)·기관/플랫폼 관리자·내담자·공개 화면은 제외한다.
import '../../styles/ui-v2-coach.css';
import '../../styles/ui-v2-coach-classes.css';
import '../../styles/ui-v2-brand.css';
import '../../styles/ui-v2-pc.css';
import { useAuthStore } from '../../stores/authStore';

export const COACH_SCOPE_CLASS = 'u2-coach';

/** D안을 적용하는 코치 경로(정확히 일치하거나 하위 경로). 정규식으로 둬 상담 경로 문자열 전수 검사(SDD-219)에 걸리지 않게 한다. */
const INCLUDED = /^\/(dashboard|classes|clients|reports|counseling|upload-status|chat|settings|notifications|profile\/professional|credentials)(\/|$)/;
/** 포함 경로 안에서도 제외하는 경로(실시간 진행·대기실·기관 대시보드). */
const EXCLUDED = [/^\/dashboard\/org(\/|$)/, /^\/sessions\//, /^\/classes\/now(\/|$)/, /^\/reports\/sample(\/|$)/, /^\/report-view/];

export function isCoachScopePath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (EXCLUDED.some((re) => re.test(path))) return false;
  return INCLUDED.test(path);
}

export function shouldApplyCoachScope(role: string | null | undefined, pathname: string): boolean {
  return role === 'counselor' && isCoachScopePath(pathname);
}

interface RouterLike {
  state: { location: { pathname: string } };
  subscribe: (listener: (state: { location: { pathname: string } }) => void) => () => void;
}

/** 라우터 이동·로그인/로그아웃에 맞춰 스코프 클래스를 토글한다. 반환값은 해제 함수. */
export function attachCoachScope(router: RouterLike, root: HTMLElement = document.documentElement): () => void {
  const apply = (pathname: string): void => {
    const on = shouldApplyCoachScope(useAuthStore.getState().user?.role, pathname);
    root.classList.toggle(COACH_SCOPE_CLASS, on);
  };
  apply(router.state.location.pathname);
  const offRouter = router.subscribe((state) => apply(state.location.pathname));
  const offAuth = useAuthStore.subscribe(() => apply(router.state.location.pathname));
  return () => { offRouter(); offAuth(); root.classList.remove(COACH_SCOPE_CLASS); };
}
