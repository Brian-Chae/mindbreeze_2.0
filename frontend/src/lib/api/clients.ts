// 내담자 관리 API

import { apiClient } from './client';

export interface ClientListItem {
  id: string;
  name: string;
  email: string;
  concerns: string[];
  last_session_at: string | null;
}

export interface ClientListResponse {
  clients: ClientListItem[];
  total: number;
  page: number;
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
}

export interface InviteCreateResponse {
  invite_token: string;
  invite_url: string;
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
}

export const listClients = (params: ListClientsParams = {}): Promise<ClientListResponse> => {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.page !== undefined) search.set('page', String(params.page));
  if (params.size !== undefined) search.set('size', String(params.size));
  const qs = search.toString();
  return apiClient.get<ClientListResponse>(`/clients${qs ? `?${qs}` : ''}`);
};

export const getClientProfile = (id: string): Promise<ClientProfile> =>
  apiClient.get<ClientProfile>(`/clients/${id}`);

export const updateMemo = (id: string, memo: string): Promise<{ detail: string }> =>
  apiClient.put<{ detail: string }>(`/clients/${id}/memo`, { memo });

export const createInvite = (email: string): Promise<InviteCreateResponse> =>
  apiClient.post<InviteCreateResponse>(`/clients/invite`, { email });

export const getInviteInfo = (token: string): Promise<InviteInfoResponse> =>
  apiClient.get<InviteInfoResponse>(`/invite/${token}`, { skipAuth: true });
