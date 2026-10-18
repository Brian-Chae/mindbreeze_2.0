// 승인 전 리포트의 회원 화면 문구(SDD-211 U1=B·U2). 서버가 내려주는 `in_review` 가산 필드로만 판정한다.

/** 목록·홈 카드의 배지·칩 */
export const REPORT_IN_REVIEW_BADGE = '리뷰 중';
/** 상세(소프트 페이지) 안내 */
export const REPORT_IN_REVIEW_NOTICE = '리뷰 중이에요. 확인이 끝나면 알려드릴게요.';

/** 생성이 평소보다 늦어질 때만 붙는 보조 문구(SDD-212 D-1=B). 내부 용어는 쓰지 않는다. */
export const REPORT_IN_REVIEW_DELAYED_NOTICE = '평소보다 조금 늦어지고 있어요.';

export function isReportInReview(report: { in_review?: boolean | null }): boolean {
  return report.in_review === true;
}

/** 승인 전이면서 서버가 생성 지연으로 판정한 경우만 참. 구 응답(필드 없음)은 거짓. */
export function isReportDelayed(report: { in_review?: boolean | null; in_review_delayed?: boolean | null }): boolean {
  return report.in_review === true && report.in_review_delayed === true;
}
