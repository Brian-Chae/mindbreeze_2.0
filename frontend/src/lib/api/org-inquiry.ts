// 공개 랜딩 기관 도입 문의 API (SDD-248) — 비로그인
import { apiClient } from './client';

export type OrgInquiryType = 'counseling_center' | 'meditation_center' | 'education' | 'company' | 'other';

export interface OrgInquiryPayload {
  org_name: string;
  contact_name: string;
  email: string;
  phone: string;
  org_type?: OrgInquiryType;
  expected_users?: number;
  band_interest?: boolean;
  message?: string;
  privacy_consent: boolean;
  /** 허니팟 — 항상 빈 문자열 */
  website: string;
}

export interface OrgInquiryResponse {
  inquiry_id: string;
  status: string;
}

export const submitOrgInquiry = (payload: OrgInquiryPayload): Promise<OrgInquiryResponse> =>
  apiClient.post('/public/org-inquiries', payload, { skipAuth: true });
