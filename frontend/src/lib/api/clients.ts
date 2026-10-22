// 내담자 관리 API

import { apiClient } from './client';

export interface ClientClassRef {
  id: string;
  title: string;
}

export interface ClientCounselorRef {
  id: string;
  name: string | null;
}

export type MemberType = 'member' | 'non_member';

export interface ClientListItem {
  id: string;
  name: string;
  email: string;
  concerns: string[];
  last_session_at: string | null;
  // SDD-230: 연락처는 서버 마스킹 값만 온다. 온라인·최근 접속은 후속 단계.
  gender?: string | null;
  age?: number | null;
  phone_masked?: string | null;
  classes?: ClientClassRef[];
  // 기관관리자 호출에서만 채워진다(상담사는 빈 배열).
  counselors?: ClientCounselorRef[];
  // 기관관리자 호출에서만: member(기관 회원) / non_member(기관 상담사와 연결만). 상담사는 null.
  member_type?: MemberType | null;
  last_activity_at?: string | null;
  last_activity_source?: string | null;
}

export interface ClientListResponse {
  clients: ClientListItem[];
  total: number;
  page: number;
  class_options?: ClientClassRef[];
  counselor_options?: ClientCounselorRef[];
}

export interface ClientProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  gender: string | null;
  birth_date: string | null;
  concerns: string[];
  interests: string[];
  bio: string | null;
  profile_image_url: string | null;
  memo: string | null;
  phone_masked?: string | null;
  age?: number | null;
  // false: 기관관리자가 비연결 기관 회원을 보는 중 — 상담사 개인 메모 영역을 숨긴다.
  memo_editable?: boolean;
  member_type?: MemberType | null;
}

export type ActivityType = 'session' | 'checkin' | 'measurement' | 'ai_checkin';

export interface ClientActivityItem {
  id: string;
  type: ActivityType;
  occurred_at: string;
  title: string;
  class_title: string | null;
  session_id: string | null;
  note: string | null;
}

export interface ClientActivityResponse {
  items: ClientActivityItem[];
  next_cursor: string | null;
  ai_included: boolean;
}

export interface ClientReportItem {
  id: string;
  session_id: string;
  title: string;
  type: string;
  type_label: string;
  status: string;
  status_label: string;
  occurred_at: string | null;
  created_at: string | null;
}

export interface ClientChangeMetric {
  key: string;
  label: string;
  delta: number | null;
  direction: string | null;
}

export interface ClientChangeItem {
  report_id: string;
  title: string;
  occurred_at: string | null;
  state: 'computed' | 'not_measured' | 'insufficient' | 'no_data';
  summary: string;
  metrics: ClientChangeMetric[];
}

export interface ClientReportsResponse {
  reports: ClientReportItem[];
  changes: ClientChangeItem[];
}

export interface ContactReveal {
  phone: string | null;
  birth_date: string | null;
}

export interface InviteCreateResponse {
  invite_token: string;
  invite_url: string;
  message: string;
}

export interface InviteInfoResponse {
  counselor_name: string;
  counselor_code: string;
  organization: string | null;
}

export interface ListClientsParams {
  q?: string;
  page?: number;
  size?: number;
  class_id?: string;
  active_within_days?: number;
  counselor_id?: string;
  member_type?: MemberType;
}

export const listClients = (params: ListClientsParams = {}): Promise<ClientListResponse> => {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.page !== undefined) search.set('page', String(params.page));
  if (params.size !== undefined) search.set('size', String(params.size));
  if (params.class_id) search.set('class_id', params.class_id);
  if (params.active_within_days) search.set('active_within_days', String(params.active_within_days));
  if (params.counselor_id) search.set('counselor_id', params.counselor_id);
  if (params.member_type) search.set('member_type', params.member_type);
  const qs = search.toString();
  return apiClient.get<ClientListResponse>(`/clients${qs ? `?${qs}` : ''}`);
};

export const getClientProfile = (id: string): Promise<ClientProfile> =>
  apiClient.get<ClientProfile>(`/clients/${id}`);

export const getClientActivity = (
  id: string,
  params: { days?: number; types?: ActivityType[]; limit?: number; cursor?: string } = {},
): Promise<ClientActivityResponse> => {
  const search = new URLSearchParams();
  if (params.days) search.set('days', String(params.days));
  if (params.types && params.types.length > 0) search.set('types', params.types.join(','));
  if (params.limit) search.set('limit', String(params.limit));
  if (params.cursor) search.set('cursor', params.cursor);
  const qs = search.toString();
  return apiClient.get<ClientActivityResponse>(`/clients/${id}/activity${qs ? `?${qs}` : ''}`);
};

export const getClientReports = (id: string): Promise<ClientReportsResponse> =>
  apiClient.get<ClientReportsResponse>(`/clients/${id}/reports`);

export const revealClientContact = (id: string): Promise<ContactReveal> =>
  apiClient.post<ContactReveal>(`/clients/${id}/contact-reveal`, {});

export const updateMemo = (id: string, memo: string): Promise<{ detail: string }> =>
  apiClient.put<{ detail: string }>(`/clients/${id}/memo`, { memo });

export const createInvite = (email: string): Promise<InviteCreateResponse> =>
  apiClient.post<InviteCreateResponse>(`/clients/invite`, { email });

export const getInviteInfo = (token: string): Promise<InviteInfoResponse> =>
  apiClient.get<InviteInfoResponse>(`/invite/${token}`, { skipAuth: true });
