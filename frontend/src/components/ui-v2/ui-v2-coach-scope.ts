// SDD-320 — 코치 화면 D안 스코프. 코치(counselor) 업무 경로에서만 <html class="u2-coach"> 를 붙여 ui-v2-coach.css 스킨을 켠다.
// 기존 페이지 마크업·상태는 건드리지 않는다. 실시간 클래스 진행(플레이어·라이브)·기관/플랫폼 관리자·내담자·공개 화면은 제외한다.
import '../../styles/ui-v2-coach.css';
import '../../styles/ui-v2-coach-classes.css';
import '../../styles/ui-v2-brand.css';
import '../../styles/ui-v2-pc.css';
import '../../styles/ui-v2-mid.css';
import '../../styles/ui-v2-coach-live.css';
import '../../styles/ui-v2-org-side.css';
import '../../styles/ui-v2-elevation.css';
import { useAuthStore } from '../../stores/authStore';
import { attachCoachCompactTitle, resetCoachCompactTitle } from './ui-v2-coach-compact-title';
import { attachCoachSidebarCode, syncCoachSidebarCode } from './ui-v2-coach-sidebar-code';

export const COACH_SCOPE_CLASS = 'u2-coach';
/** SDD-320 F-5: 라이브(대기실·진행·종료) 화면 전용 스킨 클래스. 코치 D안 스코프(u2-coach)와 배타적이다. */
export const LIVE_SCOPE_CLASS = 'u2-live';
const LIVE_PATHS = [/^\/sessions\/[^/]+\/(player|live)(\/|$)/, /^\/classes\/now(\/|$)/];
export function isLiveScopePath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return LIVE_PATHS.some((re) => re.test(path));
}
export function shouldApplyLiveScope(role: string | null | undefined, pathname: string): boolean {
  return role === 'counselor' && isLiveScopePath(pathname);
}

/** D안을 적용하는 코치 경로(정확히 일치하거나 하위 경로). 정규식으로 둬 상담 경로 문자열 전수 검사(SDD-219)에 걸리지 않게 한다. */
const INCLUDED = /^\/(dashboard|classes|clients|reports|counseling|upload-status|chat|settings|notifications|playground|profile\/professional|credentials)(\/|$)/;
/** 포함 경로 안에서도 제외하는 경로(실시간 진행·대기실·기관 대시보드). */
const EXCLUDED = [/^\/dashboard\/org(\/|$)/, /^\/sessions\//, /^\/classes\/now(\/|$)/, /^\/reports\/sample(\/|$)/, /^\/report-view/];

export function isCoachScopePath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (EXCLUDED.some((re) => re.test(path))) return false;
  return INCLUDED.test(path);
}

/** SDD-321 기관 정합(11/9): 기관관리자(org_admin)에게도 코치와 같은 셸·스킨을 적용하는 경로. 기관 홈(/dashboard/org)·코치 관리·데이터 센터를 포함한다. */
const ORG_INCLUDED = /^\/(dashboard\/org|classes|clients|reports|counseling|upload-status|chat|settings|notifications|playground|profile\/professional|credentials|org\/(counselors|data-center))(\/|$)/;
const ORG_EXCLUDED = [/^\/sessions\//, /^\/classes\/now(\/|$)/, /^\/reports\/sample(\/|$)/, /^\/report-view/];
export function isOrgScopePath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (ORG_EXCLUDED.some((re) => re.test(path))) return false;
  return ORG_INCLUDED.test(path);
}

export function shouldApplyCoachScope(role: string | null | undefined, pathname: string): boolean {
  if (role === 'org_admin') return isOrgScopePath(pathname);
  return role === 'counselor' && isCoachScopePath(pathname);
}

/** 코치 D안 화면(홈 제외)을 그대로 쓰는 역할. 기관관리자도 같은 화면 부품을 쓴다. */
export function isCoachUiRole(role: string | null | undefined): boolean {
  return role === 'counselor' || role === 'org_admin';
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
    root.classList.toggle(LIVE_SCOPE_CLASS, shouldApplyLiveScope(useAuthStore.getState().user?.role, pathname));
  };
  apply(router.state.location.pathname);
  const offTitle = attachCoachCompactTitle(root);
  const offCode = attachCoachSidebarCode(root);
  let lastPath = router.state.location.pathname;
  const offRouter = router.subscribe((state) => {
    apply(state.location.pathname);
    syncCoachSidebarCode(root);
    if (state.location.pathname !== lastPath) { lastPath = state.location.pathname; resetCoachCompactTitle(root); }
  });
  const offAuth = useAuthStore.subscribe(() => apply(router.state.location.pathname));
  return () => { offRouter(); offAuth(); offTitle(); offCode(); root.classList.remove(COACH_SCOPE_CLASS, LIVE_SCOPE_CLASS); };
}
