// SDD-219 — 기능 플래그. 빌드 시 환경변수로 주입한다(재공개 = 값 변경 후 재배포).

/** 상담 영역 공개 여부. VITE_COUNSELING_ENABLED === 'true' 일 때만 공개한다(기본 비공개). */
export function isCounselingEnabled(): boolean {
  return import.meta.env.VITE_COUNSELING_ENABLED === 'true';
}

/**
 * SDD-220 — AI 기능(루시·STT·요약·AI 초안) 공개 여부. VITE_AI_ENABLED === 'true' 일 때만 공개(기본 비공개).
 * 상담 플래그와 독립이다. 서버는 AI_FEATURES_ENABLED 로 별도 차단한다(이중 방어).
 */
export function isAiEnabled(): boolean {
  return import.meta.env.VITE_AI_ENABLED === 'true';
}

/** SDD-220 — 디자인 시안 라우트(/design/*) 노출. 개발 서버이거나 VITE_DESIGN_ROUTES_ENABLED === 'true' 일 때만. */
export function isDesignRoutesEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_DESIGN_ROUTES_ENABLED === 'true';
}
