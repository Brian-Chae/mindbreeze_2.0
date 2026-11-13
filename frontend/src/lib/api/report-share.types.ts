// 리포트 공유 메일 API 타입 (SDD-327 T11) — backend/app/schemas/report_share.py 와 1:1.
// 받는 주소는 응답에서 항상 마스킹 표기(a***@d***.com)로만 내려온다.

export const REPORT_SHARE_MAX_RECIPIENTS = 3
export const REPORT_SHARE_MAX_MESSAGE_LEN = 200

export type ReportShareStatus = 'queued' | 'sent' | 'failed'

export interface ReportShareRequest {
  recipients: string[]
  attach_pdf: boolean
  message?: string | null
}

export interface ReportShareHistoryItem {
  id: string
  recipient_masked: string
  attached: boolean
  status: ReportShareStatus
  created_at: string
  sent_at: string | null
}

export interface ReportShareRejectedItem {
  masked: string
  reason: 'invalid' | 'too_soon' | string
}

export interface ReportShareResponse {
  accepted_count: number
  /** 형식 오류·1분 간격 등으로 보내지 않은 주소(부분 성공). 없으면 빈 배열. */
  rejected?: ReportShareRejectedItem[]
  attached: boolean
  delivery_delayed: boolean
  daily_remaining: number | null
  events: ReportShareHistoryItem[]
}

export interface ReportShareHistoryResponse {
  items: ReportShareHistoryItem[]
}
