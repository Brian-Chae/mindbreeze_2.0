import { apiClient } from './client';

/** SDD-218 클래스 리포트 일괄 작업과 변화 추이. */

/** 재시도 가능한 실패(failed)와 정책상 처리 제외(excluded)는 다르다. */
export type JobItemState = 'pending' | 'succeeded' | 'failed' | 'excluded';
export type JobAction = 'approve' | 'regenerate' | 'resend_email';

export interface ReportJobItem {
  report_id: string;
  state: JobItemState;
  reason_code: string | null;
  /** 재시도 수단 노출 여부는 서버가 정한다. excluded 는 언제나 false. */
  retriable: boolean;
  approved_by: string | null;
  processed_at: string | null;
  error_message: string | null;
}

export interface ReportJob {
  job_id: string;
  class_id: string;
  action: JobAction;
  status: 'accepted' | 'running' | 'completed';
  /** 주강사가 타인 진행 회차를 대행 승인했는지. */
  on_behalf: boolean;
  accepted: number;
  excluded: ReportJobItem[];
  items: ReportJobItem[];
}

export interface ReportJobCommand {
  action: JobAction;
  operation_key: string;
  targets: string[];
  session_id?: string;
}

/** 각 회차 내부의 전반→후반 변화. 회차 사이의 변화는 다루지 않는다. */
export interface ChangeMetric {
  before: number;
  after: number;
  delta: number;
  direction: 'eased' | 'steady' | 'tensed';
}

export type ReportChange =
  | { status: 'computed'; metrics: Record<string, ChangeMetric> }
  | { status: 'not_computed'; reason: string }
  | { status: 'not_measured'; excluded?: boolean };

/** 미측정 사유는 서로 구분한다. 0 으로 대체하지 않는다. */
export type MeasurementState =
  | 'measured'
  | 'not_worn'
  | 'not_consented'
  | 'data_lost'
  | 'excluded'
  | 'none';

export interface TrendParticipation {
  state: 'attended' | 'absent' | 'withdrawn' | 'expected' | 'not_enrolled';
  is_makeup: boolean;
  makeup_for_session_id?: string;
}

export interface TrendSession {
  session_id: string;
  order: number;
  scheduled_at: string | null;
  participation: TrendParticipation;
  measurement: MeasurementState;
  /** 승인된 리포트만 내려온다. 승인 전에는 null. */
  report: { id: string } | null;
  change: ReportChange | null;
}

export interface MemberTrend {
  class_id: string;
  member_id: string;
  measured_session_count: number;
  sessions: TrendSession[];
}

export interface SessionSummary {
  class_id: string;
  session_id: string;
  attendance: { attended: number; absent: number; withdrawn: number; expected: number };
  makeup_linked: number;
  valid_cohort: number;
  min_cohort: number;
  /** 유효 착용이 min_cohort 미만이면 null 이고 hidden_reason 이 채워진다. */
  distribution: Record<string, { eased: number; steady: number; tensed: number }> | null;
  hidden_reason: 'small_cohort' | null;
}

const base = (classId: string): string => `/classes/${classId}`;

/** 중복 클릭·재시도에도 같은 작업으로 묶이도록 호출부에서 한 번만 만들어 쓴다. */
export function newOperationKey(prefix = 'rj'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export const classReportsApi = {
  /** 접수는 202. 처리 결과는 getJob 으로 따로 본다. */
  createJob: (classId: string, command: ReportJobCommand): Promise<ReportJob> =>
    apiClient.post<ReportJob>(`${base(classId)}/report-jobs`, command),

  getJob: (classId: string, jobId: string): Promise<ReportJob> =>
    apiClient.get<ReportJob>(`${base(classId)}/report-jobs/${jobId}`),

  /** 실패한 건만 다시 시도한다. 처리 제외 건은 대상이 아니다. */
  retryJob: (classId: string, jobId: string): Promise<ReportJob> =>
    apiClient.post<ReportJob>(`${base(classId)}/report-jobs/${jobId}/retry`),

  memberTrend: (classId: string): Promise<MemberTrend> =>
    apiClient.get<MemberTrend>(`${base(classId)}/me/trend`),

  sessionSummary: (classId: string, sessionId: string): Promise<SessionSummary> =>
    apiClient.get<SessionSummary>(`${base(classId)}/sessions/${sessionId}/summary`),
};
