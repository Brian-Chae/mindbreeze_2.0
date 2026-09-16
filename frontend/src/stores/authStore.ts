// 인증 전역 상태 (Zustand)

import { create } from 'zustand';
import { ApiError, tokenStorage } from '../lib/api/client';
import {
  login as apiLogin,
  registerClient as apiRegisterClient,
  logout as apiLogout,
  refreshToken as apiRefresh,
  loginGoogle as apiLoginGoogle,
  type User,
  type UserRole,
  type ClientRegisterPayload,
  type LoginResponse,
} from '../lib/api/auth';
import { loginDevUser } from '../lib/api/devAuth';

const USER_KEY = 'mb_user';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isInitialized: boolean;

  initialize: () => void;
  login: (email: string, password: string, role?: UserRole) => Promise<User>;
  loginGoogle: (idToken: string, inviteToken?: string, role?: string) => Promise<User>;
  devLogin: (userId: string) => Promise<User>;
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

const applyLogin = (res: LoginResponse, requestedRole?: string): User => {
  if (!res.user?.role) throw new ApiError(502, '로그인 응답을 확인할 수 없습니다.', null);
  if (requestedRole && res.user.role !== requestedRole) {
    throw new ApiError(403, '선택한 로그인 유형과 계정 유형이 다릅니다. 올바른 탭에서 다시 로그인해 주세요.', null);
  }
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

  login: async (email, password, role): Promise<User> => {
    const res = await apiLogin(email, password, role);
    const user = applyLogin(res, role);
    set({
      user,
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      isAuthenticated: true,
    });
    return user;
  },

  loginGoogle: async (accessToken, inviteToken, role): Promise<User> => {
    const res = await apiLoginGoogle({ access_token: accessToken, invite_token: inviteToken, role });
    const user = applyLogin(res, role);
    set({
      user,
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      isAuthenticated: true,
    });
    return user;
  },

  devLogin: async (userId): Promise<User> => {
    const res = await loginDevUser(userId);
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
