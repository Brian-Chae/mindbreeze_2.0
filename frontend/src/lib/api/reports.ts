// AI 리포트 API 클라이언트

import { apiClient } from './client';

// content.eeg 계약·어댑터는 report.ts (SDD-022)
export type {
  AdaptedReportContent,
  EegMetricKey,
  EegQualityStatus,
  EegTimelinePoint,
  ReportAiRecord,
  ReportEegContent,
  ReportMarker,
} from './report';
export {
  adaptReportContent,
  CLIENT_METRIC_LABELS,
  CLIENT_PRIMARY_METRIC_KEYS,
  COUNSELOR_METRIC_LABELS,
  EEG_METRIC_KEYS,
  relaxationTrendFromTimeline,
  reliabilityLabel,
  resolveMetricLabel,
} from './report';

// SDD-027 — 파이프라인 상태 · data_credibility
export type {
  DataCredibilityDisplay,
  ReportPipelineStatus,
} from './report-status';
export {
  REPORT_STATUS_LABELS,
  canApproveReport,
  credibilityFromQuality,
  resolveDataCredibility,
  resolveReportStatus,
  isAwaitingApproval,
} from './report-status';

// SDD-095 — 리포트 생성 진행 상태(승인 상태와 독립 축)
export type {
  ReportGenerationStatus,
  ReportProgressDto,
  ReportProgressStep,
  ReportProgressStepKey,
  ReportStepState,
} from './report-status';
export {
  REPORT_GENERATION_LABELS,
  REPORT_PROGRESS_REASON_LABELS,
  REPORT_PROGRESS_STEP_LABELS,
  getSessionReportStatus,
  isReportGenerationDone,
  parseReportProgress,
  reportProgressReasonLabel,
  resolveReportGenerationStatus,
} from './report-status';

import type { SubjectiveStateDto } from './checkin';

export type ReportType = 'counselor' | 'client';

export interface ReportDto {
  /** 리포트 미생성 세션 합성 항목은 null(목록에서 '생성 실패' 상태로 표시). */
  id: string | null;
  session_id: string;
  /** 게스트 리포트 시 null 가능(SDD-027) */
  user_id: string | null;
  type: ReportType;
  content: Record<string, unknown>;
  pdf_url: string | null;
  sent_at: string | null;
  is_read: boolean;
  created_at: string | null;
  session_title: string | null;
  counselor_name?: string | null;
  session_type: string | null;
  scheduled_at: string | null;
  /**
   * SDD-027 파이프라인 상태.
   * 미제공 시 resolveReportStatus가 sent_at 기준 폴백.
   */
  status?: string | null;
  /**
   * SDD-095 생성 진행 상태(pending/processing/ready/partial).
   * 승인 상태(status)와 독립 축 — 홈 목록 배지가 '생성 중'을 표시한다.
   */
  generation_status?: string | null;
  /**
   * SDD-101 생성 실패 사유(50자 이하 코드·메시지).
   * null이면 실패 아님. /reports 목록에서 실패 로그로 노출한다.
   */
  generation_error?: string | null;
  /** SDD-101 생성 시작 시각(processing 진입 시각). */
  generation_started_at?: string | null;
  /**
   * quality 게이트 파생 신뢰도(서버).
   * number(0~1/0~100) 또는 quality/라벨 문자열.
   */
  data_credibility?: string | number | null;
  /** 게스트/참여자 기반 리포트 */
  participant_id?: string | null;
  /** SDD-050 — participant.report_email (client 리포트 재발송 기본값) */
  report_email?: string | null;
  /** SDD-065 — 참여자 표시명 (게스트 guest_name / 회원 user.name) */
  participant_name?: string | null;
  /** SDD-065 — male | female | other */
  gender?: string | null;
  /** SDD-065 — ISO date (YYYY-MM-DD) */
  birth_date?: string | null;
  /** SDD-065 — participant.user_id 없으면 true */
  is_guest?: boolean | null;
  /**
   * SDD-096 — 셀프 체크인(주관 상태).
   * 내담자 리포트는 본인 슬롯(scope=participant), 상담사 리포트는 세션 전체(scope=session).
   */
  subjective_state?: SubjectiveStateDto | null;
  /**
   * SDD-211 — 회원 조회 시 승인 전 리포트이면 true(본문·지표는 서버가 마스킹).
   * 서버 미배포·구 응답에서는 없을 수 있어 optional 로 둔다.
   */
  in_review?: boolean;
  /**
   * SDD-212 — 승인 전이면서 리포트 생성이 평소보다 늦어질 때만 true.
   * 상담사 확인 대기 건은 false. 구 응답에는 없을 수 있어 optional.
   */
  in_review_delayed?: boolean;
  /** 승인 대상 여부 — false 면 클래스 회차 상담사용 리포트(검토중 집계·일괄 승인 제외). 구 응답엔 없음(=대상). */
  approval_required?: boolean;
  /** SDD-253 — 승인 감사·발송 상태(상담사·기관관리자 응답에서만 채워짐. 회원·토큰 응답은 항상 없음). */
  approved_at?: string | null;
  approved_by_name?: string | null;
  approved_by_role?: string | null;
  /** manual | auto | null(기존 기록·승인자 미확인) */
  approval_source?: string | null;
  /** pending | sending | sent | failed | not_requested | unavailable — 승인과 독립 축 */
  delivery_status?: string | null;
  delivery_attempted_at?: string | null;
  delivery_attempt_count?: number | null;
  delivery_failure_code?: string | null;
  capabilities?: ReportCapabilities | null;
}

/** SDD-253 — 서버가 계산한 화면 버튼 근거. 승인 권한과 코멘트 편집 권한은 별개다. */
export interface ReportCapabilities {
  can_view: boolean;
  can_approve: boolean;
  can_edit_comment: boolean;
  can_retry_delivery: boolean;
}

export interface ReportListResponse {
  reports: ReportDto[];
  total: number;
}

/** SDD-058 — 리포트 목록 페이지네이션 */
export interface ListReportsParams {
  page?: number;
  limit?: number;
}

const DEFAULT_REPORT_LIST_LIMIT = 20;

function buildReportListQuery(params?: ListReportsParams): string {
  if (!params) return '';
  const page = params.page ?? 1;
  const limit = params.limit ?? DEFAULT_REPORT_LIST_LIMIT;
  const sp = new URLSearchParams();
  sp.set('page', String(page));
  sp.set('limit', String(limit));
  return `?${sp.toString()}`;
}

export const listReports = (params?: ListReportsParams): Promise<ReportListResponse> =>
  apiClient.get<ReportListResponse>(`/reports${buildReportListQuery(params)}`);
/** 사이드바·탭바 배지용 경량 집계 — 목록 본문 없이 숫자만 받는다(GET /reports/counts). */
export interface ReportBadgeCounts { unread: number; pending_review: number }
export const getReportBadgeCounts = (): Promise<ReportBadgeCounts> =>
  apiClient.get<ReportBadgeCounts>('/reports/counts');

/** SDD-253 D4 — 승인하고 발송(승인 멱등 + 발송 예약 1회). */
export const approveAndSendReport = (id: string): Promise<ReportDto> =>
  apiClient.post<ReportDto>(`/reports/${id}/approve-and-send`, {});

/** SDD-253 D4 — 발송 실패 건 다시 발송(승인자·승인 시각 불변). */
export const retryReportDelivery = (id: string): Promise<ReportDto> =>
  apiClient.post<ReportDto>(`/reports/${id}/retry-delivery`, {});

export const getReport = (id: string): Promise<ReportDto> =>
  apiClient.get<ReportDto>(`/reports/${id}`);

/** SDD-052 — 메일 토큰 기반 리포트 열람 (로그인 불필요) */
export const getReportView = (token: string): Promise<ReportDto> =>
  apiClient.get<ReportDto>(`/reports/view?token=${encodeURIComponent(token)}`, {
    skipAuth: true,
  });

export const generateReport = (sessionId: string, type: ReportType = 'counselor'): Promise<ReportDto> =>
  apiClient.post<ReportDto>(`/reports/generate/${sessionId}`, { type });

export const updateReport = (id: string, content: Record<string, unknown>): Promise<ReportDto> =>
  apiClient.put<ReportDto>(`/reports/${id}`, { content });

export const approveReport = (id: string, note?: string): Promise<ReportDto> =>
  apiClient.post<ReportDto>(`/reports/${id}/approve`, { note });

/** SDD-087 — 상담사 코멘트 저장 (comment: null = 삭제, 1000자 제한) */
export const updateReportComment = (
  reportId: string,
  comment: string | null,
): Promise<ReportDto> =>
  apiClient.patch<ReportDto>(`/reports/${reportId}/comment`, { comment });

/** SDD-087 — AI(Gemini) 코멘트 초안. 실패 시 서버가 규칙 템플릿으로 폴백(source: 'rule') */
export interface CommentDraftResponse {
  draft: string;
  source: 'llm' | 'rule';
}

export const generateCommentDraft = (reportId: string): Promise<CommentDraftResponse> =>
  apiClient.post<CommentDraftResponse>(`/reports/${reportId}/comment-draft`, {});

/** SDD-049 — 리포트 자동 승인 설정 */
export interface AutoApproveResponse {
  enabled: boolean;
}

export const getAutoApprove = (): Promise<AutoApproveResponse> =>
  apiClient.get<AutoApproveResponse>('/reports/auto-approve');

export const setAutoApprove = (enabled: boolean): Promise<AutoApproveResponse> =>
  apiClient.patch<AutoApproveResponse>('/reports/auto-approve', { enabled });

/** SDD-050 / RPT-EMAIL-CONTRACT-004 — 리포트 메일 재발송 응답 계약: {success, sent, message} */
export interface ResendReportEmailResponse {
  success: boolean;
  sent: boolean;
  message: string;
}

export const resendReportEmail = (
  reportId: string,
  email: string,
): Promise<ResendReportEmailResponse> =>
  apiClient.post<ResendReportEmailResponse>(`/reports/${reportId}/resend-email`, { email });

/** 내담자 리포트 전체 읽음 — 쌓인 미열람 리포트를 한 번에 처리 */
export interface MarkAllReportsReadResponse {
  count: number;
}

export const markAllReportsRead = (): Promise<MarkAllReportsReadResponse> =>
  apiClient.put<MarkAllReportsReadResponse>('/reports/read-all');

/** 상담사 일괄 승인 — 검토중(pending_review) 리포트를 코멘트 없이 모두 승인·발송 */
export interface ApproveAllReportsResponse {
  approved: number;
}

export const approveAllReports = (): Promise<ApproveAllReportsResponse> =>
  apiClient.post<ApproveAllReportsResponse>('/reports/approve-all');
