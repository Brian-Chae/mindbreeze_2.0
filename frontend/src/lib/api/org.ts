// 상담센터(Org) 관련 API 호출

import { apiClient } from './client';

export interface Org {
  id: string;
  name: string;
  ceo_name: string;
  biz_number: string;
  address: string;
  phone: string;
  verified: boolean;
  verified_at: string | null;
  created_at: string;
}

export interface OrgSearchItem {
  id: string;
  name: string;
  address: string;
  verified: boolean;
}

export type JoinRequestStatus = 'pending' | 'approved' | 'rejected';

export interface JoinRequest {
  id: string;
  org_id: string;
  org_name: string;
  status: JoinRequestStatus;
  reason: string | null;
  created_at: string;
}

export type CounselorRole = 'counselor' | 'org_admin';
export type CounselorAccountStatus = 'pending' | 'active';

export interface CounselorItem {
  id: string;
  name: string;
  email: string;
  role: CounselorRole;
  status?: CounselorAccountStatus;
  invited_at?: string | null;
  invite_expires_at?: string | null;
}

export interface InviteCounselorPayload {
  name: string;
  email: string;
}

export interface InviteCounselorResponse {
  id: string;
  name: string;
  email: string;
  status: CounselorAccountStatus;
  invited_at: string;
  invite_expires_at: string;
  invite_sent: boolean;
}

export interface ResendCounselorInviteResponse {
  invite_sent: boolean;
  invite_expires_at: string;
}

export interface RegisterOrgPayload {
  name: string;
  ceo_name: string;
  biz_number: string;
  address: string;
  phone: string;
}

export interface HandleRequestPayload {
  status: 'approved' | 'rejected';
  reason?: string;
}

const PREFIX = '/org';

export const searchOrgs = (q: string, region?: string): Promise<OrgSearchItem[]> => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (region) params.set('region', region);
  const qs = params.toString();
  return apiClient.get<OrgSearchItem[]>(`${PREFIX}/search${qs ? `?${qs}` : ''}`, { skipAuth: true });
};

export const registerOrg = (body: RegisterOrgPayload): Promise<Org> =>
  apiClient.post<Org>(`${PREFIX}/register`, body);

export const getOrg = (orgId: string): Promise<Org> =>
  apiClient.get<Org>(`${PREFIX}/${orgId}`, { skipAuth: true });

export const joinOrg = (orgId: string): Promise<JoinRequest> =>
  apiClient.post<JoinRequest>(`${PREFIX}/${orgId}/join`);

export const getMyRequests = (): Promise<JoinRequest[]> =>
  apiClient.get<JoinRequest[]>(`${PREFIX}/requests`);

export const handleRequest = (
  orgId: string,
  reqId: string,
  body: HandleRequestPayload,
): Promise<JoinRequest> => apiClient.put<JoinRequest>(`${PREFIX}/${orgId}/requests/${reqId}`, body);

export const listCounselors = (orgId: string): Promise<CounselorItem[]> =>
  apiClient.get<CounselorItem[]>(`${PREFIX}/${orgId}/counselors`);

export const updateCounselor = (
  orgId: string,
  userId: string,
  body: { role: CounselorRole },
): Promise<CounselorItem> =>
  apiClient.put<CounselorItem>(`${PREFIX}/${orgId}/counselors/${userId}`, body);

export const removeCounselor = (orgId: string, userId: string): Promise<void> =>
  apiClient.delete<void>(`${PREFIX}/${orgId}/counselors/${userId}`);

export const inviteCounselor = (
  orgId: string,
  body: InviteCounselorPayload,
): Promise<InviteCounselorResponse> =>
  apiClient.post<InviteCounselorResponse>(`${PREFIX}/${orgId}/counselors/invite`, body);

export const resendCounselorInvite = (
  orgId: string,
  userId: string,
): Promise<ResendCounselorInviteResponse> =>
  apiClient.post<ResendCounselorInviteResponse>(
    `${PREFIX}/${orgId}/counselors/${userId}/resend-invite`,
    {},
  );
