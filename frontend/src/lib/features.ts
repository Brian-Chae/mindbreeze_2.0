// ─────────────────────────────────────────────────────────────
// MVP 기능 플래그 — 프론트 노출 제어 전용 (백엔드 로직은 유지)
// ─────────────────────────────────────────────────────────────
//
// 기능을 "삭제"하지 않고 프론트 노출만 끄고 싶을 때 여기서 게이트한다.
// 백엔드 엔드포인트/파이프라인은 그대로 둔다 — 추후 재활성화는 플래그만 바꾸면 된다.

import { isAiEnabled } from './feature-flags';

/**
 * STT(음성 레코딩 → 텍스트) 기반 AI 기록
 * - 생성 시간이 길고 정확도가 낮아 MVP에서 제외.
 * - 백엔드 파이프라인(STT → 화자분리 → 요약)은 삭제하지 않고 유지.
 * - 프론트 노출만 끈다: 기록지 AI요약·전사문 탭, 리포트 AI요약·인사이트, 전사 기록지.
 * - 영상·음성 재생과 EEG 서사(몸·마음 리포트)는 그대로 유지.
 * - 모든 기능 완성 후 유료 모델로 전환할 때 true로 변경.
 */
export const ENABLE_STT_AI_RECORD = false;

/**
 * SDD-228 — 받아쓰기(STT) 공개 여부. 빌드 시 VITE_STT_ENABLED === 'true' 일 때만 공개(기본 비공개).
 * 서버 STT_ENABLED 와 짝으로 켠다(재공개 = 두 값 변경 후 재배포). 영상·음성 재생과는 무관하다.
 */
export function isSttEnabled(): boolean {
  return import.meta.env.VITE_STT_ENABLED === 'true';
}

// ─────────────────────────────────────────────────────────────
// SDD-220 — AI 비공개(isAiEnabled) 와 결합한 파생 판정·문구
// ─────────────────────────────────────────────────────────────

/** SDD-228 — 리포트 진행 스텝퍼의 받아쓰기·요약 단계 노출. AI 공개 AND STT 공개일 때만(레거시 상수와 무관). */
export function isSttProgressVisible(): boolean {
  return isAiEnabled() && isSttEnabled();
}

/** 전사·AI 요약 화면 노출 — 기존 STT 비공개 조건·AI 플래그·STT 플래그(SDD-228) 모두 참일 때만(AND). */
export function isSttAiRecordVisible(): boolean {
  return ENABLE_STT_AI_RECORD && isAiEnabled() && isSttEnabled();
}

/**
 * 리포트의 "자동 기록 없음" 안내 문구. AI 비공개일 때는 AI·전사·요약 표현 없이 "자동 기록" 으로만 안내한다
 * (녹음·영상·수동 메모는 그대로 사용 가능).
 */
export function aiRecordUnavailableText(reason: string | null | undefined): string {
  // SDD-228: 받아쓰기(STT) 미제공 빌드의 '전사 없음'은 마이크 꺼짐이 아니다 — 별도 사유로 안내한다.
  if (reason === 'stt_disabled') {
    return '이 세션은 음성 녹음과 영상 다시보기를 제공하며, 음성 기록(전사)은 제공하지 않습니다.';
  }
  if (!isAiEnabled()) {
    return reason === 'mic_off'
      ? '이 세션은 마이크를 사용하지 않아 자동 기록이 없습니다.'
      : '이 세션에는 자동 기록이 없습니다.';
  }
  if (reason === 'mic_off') {
    return '이 세션은 마이크를 사용하지 않아 AI 자동 기록(전사·요약)이 제공되지 않습니다.';
  }
  if (reason === 'low_confidence') {
    return '오디오 분석 신뢰도가 낮아 AI 자동 요약을 제공하지 않습니다. 녹음 원본 전사문은 아래 기록지에서 확인할 수 있습니다.';
  }
  return '이 세션에는 AI 자동 기록(전사·요약)이 없습니다.';
}
