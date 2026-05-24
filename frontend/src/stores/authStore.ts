// 인증 전역 상태 (Zustand)

import { create } from 'zustand';
import { tokenStorage } from '../lib/api/client';
import {
  login as apiLogin,
  registerCounselor as apiRegisterCounselor,
  registerClient as apiRegisterClient,
  logout as apiLogout,
  refreshToken as apiRefresh,
  loginGoogle as apiLoginGoogle,
  type User,
  type CounselorRegisterPayload,
  type ClientRegisterPayload,
  type LoginResponse,
} from '../lib/api/auth';

const USER_KEY = 'mb_user';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isInitialized: boolean;

  initialize: () => void;
  login: (email: string, password: string) => Promise<User>;
  loginGoogle: (idToken: string, inviteToken?: string) => Promise<User>;
  registerCounselor: (data: CounselorRegisterPayload) => Promise<User>;
  registerClient: (data: ClientRegisterPayload) => Promise<User>;
  refreshAuth: () => Promise<boolean>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

const persistUser = (user: User | null): void => {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
};

const loadUser = (): User | null => {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
};

const applyLogin = (res: LoginResponse): User => {
  tokenStorage.set(res.access_token, res.refresh_token);
  persistUser(res.user);
  return res.user;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isInitialized: false,

  initialize: (): void => {
    const access = tokenStorage.getAccess();
    const refresh = tokenStorage.getRefresh();
    const user = loadUser();
    set({
      user,
      accessToken: access,
      refreshToken: refresh,
      isAuthenticated: Boolean(access && user),
      isInitialized: true,
    });
  },

  login: async (email, password): Promise<User> => {
    const res = await apiLogin(email, password);
    const user = applyLogin(res);
    set({
      user,
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      isAuthenticated: true,
    });
    return user;
  },

  loginGoogle: async (idToken, inviteToken): Promise<User> => {
    const res = await apiLoginGoogle({ id_token: idToken, invite_token: inviteToken });
    const user = applyLogin(res);
    set({
      user,
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      isAuthenticated: true,
    });
    return user;
  },

  registerCounselor: async (data): Promise<User> => {
    const res = await apiRegisterCounselor(data);
    const user = applyLogin(res);
    set({
      user,
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      isAuthenticated: true,
    });
    return user;
  },

  registerClient: async (data): Promise<User> => {
    const res = await apiRegisterClient(data);
    const user = applyLogin(res);
    set({
      user,
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      isAuthenticated: true,
    });
    return user;
  },

  refreshAuth: async (): Promise<boolean> => {
    const refresh = get().refreshToken ?? tokenStorage.getRefresh();
    if (!refresh) return false;
    try {
      const res = await apiRefresh(refresh);
      tokenStorage.set(res.access_token, res.refresh_token);
      set({ accessToken: res.access_token, refreshToken: res.refresh_token });
      return true;
    } catch {
      return false;
    }
  },

  logout: async (): Promise<void> => {
    const { accessToken, refreshToken } = get();
    if (accessToken && refreshToken) {
      try {
        await apiLogout(accessToken, refreshToken);
      } catch {
        // 서버 에러는 무시하고 로컬 상태만 정리
      }
    }
    tokenStorage.clear();
    persistUser(null);
    set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
  },

  setUser: (user): void => {
    persistUser(user);
    set({ user });
  },
}));
