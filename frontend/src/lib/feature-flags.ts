// SDD-219 — 기능 플래그. 빌드 시 환경변수로 주입한다(재공개 = 값 변경 후 재배포).

/** 상담 영역 공개 여부. VITE_COUNSELING_ENABLED === 'true' 일 때만 공개한다(기본 비공개). */
export function isCounselingEnabled(): boolean {
  return import.meta.env.VITE_COUNSELING_ENABLED === 'true';
}
