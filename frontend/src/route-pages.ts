import { preloadableLazy } from './lib/preloadable-lazy';

// 첫 화면 후보 라우트 페이지. main.tsx 가 세션 검증과 병렬로 preload() 한다.
// SDD-318: UI_V2 는 빌드 시 상수다. 운영 빌드(define 'false')에서는 D안 import 분기가 제거돼 기존 화면만 남는다.
export const MemberStructureHomePage = preloadableLazy(() => import.meta.env.VITE_UI_V2 === 'true'
  ? import('./pages/client/ui-v2/ui-v2-home-page').then((module) => ({ default: module.UiV2HomePage }))
  : import('./pages/client/member-structure-home-page').then((module) => ({ default: module.MemberStructureHomePage })));
export const MemberClassesPage = preloadableLazy(() => import.meta.env.VITE_UI_V2 === 'true'
  ? import('./pages/client/ui-v2/ui-v2-classes-page').then((module) => ({ default: module.UiV2ClassesPage }))
  : import('./pages/client/member-classes-page').then((module) => ({ default: module.MemberClassesPage })));
