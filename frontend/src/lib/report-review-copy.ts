// 승인 전 리포트의 회원 화면 문구(SDD-211 U1=B·U2). 서버가 내려주는 `in_review` 가산 필드로만 판정한다.

/** 목록·홈 카드의 배지·칩 */
export const REPORT_IN_REVIEW_BADGE = '리뷰 중';
/** 상세(소프트 페이지) 안내 */
export const REPORT_IN_REVIEW_NOTICE = '리뷰 중이에요. 확인이 끝나면 알려드릴게요.';

export function isReportInReview(report: { in_review?: boolean | null }): boolean {
  return report.in_review === true;
}
