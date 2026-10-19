/** SDD-218 리포트 상태 6종의 표시 계약.
 *
 * 승인된 시안 계약: 색만으로 구분하지 않는다. 외곽선 형태로도 구분해 색각 이상에서도 읽힌다.
 */

export type ReportStatusKey =
  | 'done' // 승인·발송 완료
  | 'review' // 검토 대기
  | 'busy' // 생성 중
  | 'partial' // 부분 실패
  | 'failed' // 생성 실패
  | 'empty'; // 미생성

interface StatusStyle {
  label: string;
  /** 색 외의 구분 수단. 둥근 정도와 테두리 형태가 상태마다 다르다. */
  className: string;
}

export const REPORT_STATUS: Record<ReportStatusKey, StatusStyle> = {
  done: {
    label: '승인·발송 완료',
    className: 'rounded-full bg-[#E3F8F2] text-[#0B6B55] border border-solid border-[#90C4B5]',
  },
  review: {
    label: '검토 대기',
    className: 'rounded-lg bg-[#F5EDFC] text-[#5F0080] border border-solid border-[#D2AEFC]',
  },
  busy: {
    label: '생성 중',
    className: 'rounded-full bg-[#F0ECF3] text-[#584465] border border-dotted border-[#6B5979]',
  },
  partial: {
    label: '부분 실패',
    className: 'rounded-lg bg-[#FBEAE3] text-[#8A3A1F] border border-dashed border-[#B77760]',
  },
  failed: {
    label: '생성 실패',
    className: 'rounded-none bg-[#FBEAE3] text-[#8A3A1F] border-[3px] border-double border-[#B77760]',
  },
  empty: {
    // partial 과 같은 (모서리, 테두리) 조합을 쓰지 않는다. 색을 못 보면 둘이 겹친다.
    label: '미생성',
    className: 'rounded-sm bg-white text-[#655D6B] border border-dashed border-[#97909C]',
  },
};

export interface SessionReportCounts {
  total: number;
  approved: number;
  pending: number;
  generating: number;
  failed: number;
}

/** 회차 단위 상태를 건별 집계에서 끌어낸다. */
export function sessionStatus(counts: SessionReportCounts): ReportStatusKey {
  if (counts.total === 0) return 'empty';
  if (counts.failed > 0) return counts.failed === counts.total ? 'failed' : 'partial';
  if (counts.generating > 0) return 'busy';
  if (counts.pending > 0) return 'review';
  return 'done';
}

/** 처리 제외 사유를 사람이 읽는 말로 바꾼다. */
export const EXCLUDED_REASON_TEXT: Record<string, string> = {
  absent: '결석 — 리포트 대상이 아니에요',
  consent_withdrawn: '회원이 이 회차 반영을 철회했어요',
  not_target: '리포트 대상이 아니에요',
  forbidden: '실행 시점에 권한이 없었어요',
};

export function excludedReasonText(code: string | null): string {
  if (!code) return '처리하지 않았어요';
  return EXCLUDED_REASON_TEXT[code] ?? '처리하지 않았어요';
}
