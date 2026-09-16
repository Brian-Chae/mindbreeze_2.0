// 가입 신청(기관 상담 / 개인 상담사) + 상담사 코드 확인 API (SDD-073)

import { apiClient } from './client';

export interface OrganizationApplicationPayload {
  organization_name: string;
  contact_name: string;
  email: string;
  phone?: string;
  inquiry?: string;
  consents: { privacy: boolean };
}

export interface IndividualCounselorApplicationPayload {
  name: string;
  email: string;
  email_verify_token: string;
  phone?: string;
  display_name?: string;
  specialties?: string;
  inquiry?: string;
  consents: { privacy: boolean };
}

export interface ApplicationCreatedResponse {
  application_id: string;
  status: string;
}

export interface CounselorCodeCheckResponse {
  counselor_name: string;
  organization_name: string | null;
}

export const submitOrganizationApplication = (
  payload: OrganizationApplicationPayload,
): Promise<ApplicationCreatedResponse> =>
  apiClient.post('/signup-applications/organization', payload, { skipAuth: true });

export const submitIndividualCounselorApplication = (
  payload: IndividualCounselorApplicationPayload,
): Promise<ApplicationCreatedResponse> =>
  apiClient.post('/signup-applications/individual-counselor', payload, { skipAuth: true });

export const checkCounselorCode = (
  counselorCode: string,
  emailVerifyToken: string,
): Promise<CounselorCodeCheckResponse> =>
  apiClient.post(
    '/auth/counselor-code/check',
    { counselor_code: counselorCode, email_verify_token: emailVerifyToken },
    { skipAuth: true },
  );
