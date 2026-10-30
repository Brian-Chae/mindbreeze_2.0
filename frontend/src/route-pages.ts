import { preloadableLazy } from './lib/preloadable-lazy';

// 첫 화면 후보 라우트 페이지. main.tsx 가 세션 검증과 병렬로 preload() 한다.
export const MemberStructureHomePage = preloadableLazy(() => import('./pages/client/member-structure-home-page').then((module) => ({ default: module.MemberStructureHomePage })));
export const MemberClassesPage = preloadableLazy(() => import('./pages/client/member-classes-page').then((module) => ({ default: module.MemberClassesPage })));
