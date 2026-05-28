// 내담자 프로필 API 클라이언트

import { apiClient } from './client';

export interface ClientProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  phone?: string | null;
  profile_image?: string | null;
  bio?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  concerns: string[];
  interests: string[];
}

export interface ClientProfileUpdate {
  name?: string;
  phone?: string;
  profile_image?: string;
  bio?: string;
  gender?: string;
  birth_date?: string;
  concerns?: string[];
  interests?: string[];
}

export const getClientProfile = (): Promise<ClientProfile> =>
  apiClient.get<ClientProfile>('/auth/clients/me/profile');

export const updateClientProfile = (
  data: ClientProfileUpdate,
): Promise<ClientProfile> =>
  apiClient.patch<ClientProfile>('/auth/clients/me/profile', data);
