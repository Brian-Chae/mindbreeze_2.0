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

/** SDD-246 T09 — archive 업로드 v3(단계별 재시도·분할 복구·종료 후 사후전송 판정). 기본 off: 켜지 않으면 현행 v1/v2 동작이다. */
export function isArchiveV3Enabled(): boolean {
  return import.meta.env.VITE_ARCHIVE_V3 === 'true';
}

/** SDD-246 T06 — session-live v2 실시간 프로토콜(LiveClient/LiveState 단일 출처). 기본 off: 켜지 않으면 현행(v1) 경로 그대로다. */
export function isLiveProtocolV2Enabled(
  env: { VITE_LIVE_PROTOCOL_V2?: string } = import.meta.env as { VITE_LIVE_PROTOCOL_V2?: string },
): boolean {
  return env.VITE_LIVE_PROTOCOL_V2 === 'true';
}

/**
 * SDD-286 — 로그인 화면의 「로그인 없이 코드로 입장」 버튼 노출. VITE_GUEST_ENTRY_ENABLED === 'true' 일 때만(기본 숨김).
 * 운영 빌드는 vite.config.ts 가 'false' 로 고정하고, dev 는 deploy-dev.yml 이 'true' 를 주입한다.
 */
export function isGuestEntryEnabled(): boolean {
  return import.meta.env.VITE_GUEST_ENTRY_ENABLED === 'true';
}

/**
 * SDD-318 — 내담자 앱 화면 D안(UI_V2). VITE_UI_V2 === 'true' 일 때만 켠다(기본 꺼짐).
 * 운영 빌드는 vite.config.ts 가 'false' 로 고정하고, dev 는 deploy-dev.yml 이 'true' 를 주입한다.
 */
export function isUiV2Enabled(): boolean {
  return import.meta.env.VITE_UI_V2 === 'true';
}
