// 회원 상담사 목록·추가 API 계약 (GET 배열 / POST 201 단일 CounselorInfo)

import { apiClient, ApiError } from './client';
import { COUNSELOR_COPY } from '../client-counselor-copy';

export interface ClientCounselor {
  id: string;
  name: string;
  profile_image: string | null;
  org_name?: string | null;
  status?: string;
}

export async function getClientCounselors(): Promise<ClientCounselor[]> {
  const res = await apiClient.get<ClientCounselor[]>('/client/counselors');
  return Array.isArray(res) ? res : [];
}

export async function addClientCounselor(code: string): Promise<ClientCounselor> {
  return apiClient.post<ClientCounselor>('/client/counselors', { code });
}

/** 코드를 공백 제거·대문자화해 정규화한다. 6자 영숫자가 아니면 null. */
export function normalizeCounselorCode(raw: string): string | null {
  const code = raw.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}

export type AddCounselorErrorKind = 'duplicate' | 'org_inactive' | 'unknown_result' | 'error';

export interface AddCounselorFailure {
  kind: AddCounselorErrorKind;
  message: string;
}

/** 추가 실패를 사용자 문구로 분류한다. 409 는 status 가 아니라 서버 detail 로 구분한다. */
export function classifyAddCounselorError(err: unknown): AddCounselorFailure {
  if (err instanceof ApiError) {
    const msg = err.message;
    if (err.status === 409) {
      if (msg.includes('이미 연결')) return { kind: 'duplicate', message: COUNSELOR_COPY.duplicate };
      return { kind: 'org_inactive', message: msg.includes('비활성') ? COUNSELOR_COPY.orgInactive : msg };
    }
    if (err.status === 404) return { kind: 'error', message: msg || COUNSELOR_COPY.notFound };
    if (err.status === 403) return { kind: 'error', message: msg || COUNSELOR_COPY.generic };
    if (err.status === 422) return { kind: 'error', message: COUNSELOR_COPY.invalidFormat };
    return { kind: 'error', message: COUNSELOR_COPY.generic };
  }
  // 응답을 받기 전에 끊긴 경우: 서버에서 이미 처리됐을 수 있어 결과를 단정하지 않는다.
  return { kind: 'unknown_result', message: COUNSELOR_COPY.networkUnknown };
}
