/** 공개 문구의 공통 계약. 의료 면책은 이 문장 전체만 검사 예외로 인정한다. */
export const WELLNESS_DISCLAIMER = '본 서비스와 LINK BAND는 의료기기가 아니며, 의학적 진단·치료·처방을 대신하지 않습니다.';
export const ESTIMATED_METRICS_NOTICE = '집중도·이완도·스트레스는 추정 참고 지표입니다.';
export const OPERATIONS_EMAIL = 'admin-mindbreeze@looxidlabs.com';
/** 공개 페이지(계정 삭제·지원)에 표시하는 앱·개발자 이름. 사업자등록번호 등 회사 식별값은 넣지 않는다. */
export const SERVICE_NAME = 'MIND BREEZE 2.0(마인드브리즈)';
/** 첫 출시 부제(2026-10-26 확정). 마침표 없이 쓴다. */
export const SERVICE_SUBTITLE = '뇌과학 기반 명상 클래스 서비스';
export const DEVELOPER_NAME = '룩시드랩스(Looxid Labs Inc.)';
export const PRIVACY_OFFICER = '채용욱 대표이사';
export const ORGANIZATION_WEB_URL = 'https://mindbreeze.looxidlabs.com/register/organization';
/** 게시 직전 공식 출처와 관할 확인 후 채운다. 미검증 번호를 노출하지 않는다. */
export const TODO_VERIFIED_CRISIS_CONTACTS: ReadonlyArray<{ name: string; phone: string; source: string }> = [];
export const PAYMENT_COPY_TERMS = ['가격', '요금', '구독', '결제', '유료', '무료 체험', '무료로 시작하기', '업그레이드', '플랜', '구매'] as const;
export const MEDICAL_COPY_TERMS = ['진단', '치료', '처방', '질병', '효과 입증', '효과가 입증', '위험 신호'] as const;
export function findPublicCopyViolations(text: string): string[] {
  const normalized = text.replaceAll(WELLNESS_DISCLAIMER, '');
  return [...PAYMENT_COPY_TERMS, ...MEDICAL_COPY_TERMS].filter((term) => normalized.includes(term));
}
