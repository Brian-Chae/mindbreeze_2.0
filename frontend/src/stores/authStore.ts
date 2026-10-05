// 인증 전역 상태 (Zustand)
// access token은 메모리에만 보관, refresh token은 httpOnly cookie로 관리

import { create } from 'zustand';
import { ApiError, tokenStorage, refreshAccessToken } from '../lib/api/client';
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

const USER_KEY = 'mb_user';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isInitialized: boolean;

  initialize: () => void;
  login: (email: string, password: string, role?: UserRole, rememberMe?: boolean) => Promise<User>;
  loginGoogle: (idToken: string, inviteToken?: string, role?: string, rememberMe?: boolean, consents?: { tos: boolean; privacy: boolean; sensitive: boolean }) => Promise<User>;
  devLogin: (userId: string) => Promise<User>;
  registerClient: (data: ClientRegisterPayload, rememberMe?: boolean) => Promise<User>;
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
  tokenStorage.set(res.access_token); // refresh는 httpOnly cookie로 백엔드가 설정
  persistUser(res.user);
  return res.user;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isInitialized: false,

  initialize: (): void => {
    const user = loadUser();
    // SDD-139: localStorage(mb_user) 존재만으로 인증을 확정하지 않는다.
    // 서버 refresh 검증 성공 전까지 isInitialized=false 로 두어 UI 게이트가
    // 통과하지 못하게 하고, 검증 완료 후에만 isAuthenticated 를 확정한다.
    set({
      user,
      accessToken: null,
      isAuthenticated: false,
      isInitialized: false,
    });
    if (user) {
      // access token 복구 — refresh(httpOnly cookie)로 메모리 재적재
      refreshAccessToken().then((token) => {
        if (token) {
          set({ accessToken: token, isAuthenticated: true, isInitialized: true });
        } else {
          tokenStorage.clear();
          persistUser(null);
          set({ user: null, accessToken: null, isAuthenticated: false, isInitialized: true });
        }
      });
    } else {
      set({ isInitialized: true });
    }
  },

  login: async (email, password, role, rememberMe = true): Promise<User> => {
    const res = await apiLogin(email, password, role, rememberMe);
    const user = applyLogin(res, role);
    set({ user, accessToken: res.access_token, isAuthenticated: true });
    return user;
  },

  loginGoogle: async (idToken, inviteToken, role, rememberMe = true, consents): Promise<User> => {
    const res = await apiLoginGoogle(
      { access_token: idToken, invite_token: inviteToken, role, consents },
      rememberMe,
    );
    const user = applyLogin(res, role);
    set({ user, accessToken: res.access_token, isAuthenticated: true });
    return user;
  },

  // SEC-05: dev 인증 모듈은 프로덕션 번들에서 제외한다.
  // import.meta.env.DEV 게이트 + 동적 import로 dev 빌드에서만 로드된다.
  devLogin: async (userId): Promise<User> => {
    if (!import.meta.env.DEV) {
      throw new ApiError(404, 'dev 로그인은 개발 환경에서만 사용할 수 있습니다.', null);
    }
    const { loginDevUser } = await import('../lib/api/devAuth');
    const res = await loginDevUser(userId);
    const user = applyLogin(res);
    set({ user, accessToken: res.access_token, isAuthenticated: true });
    return user;
  },

  registerClient: async (data, rememberMe = true): Promise<User> => {
    const res = await apiRegisterClient(data, rememberMe);
    const user = applyLogin(res);
    set({ user, accessToken: res.access_token, isAuthenticated: true });
    return user;
  },

  refreshAuth: async (): Promise<boolean> => {
    try {
      const res = await apiRefresh();
      tokenStorage.set(res.access_token);
      set({ accessToken: res.access_token });
      return true;
    } catch {
      return false;
    }
  },

  logout: async (): Promise<void> => {
    try {
      await apiLogout();
    } catch {
      // 서버 에러는 무시하고 로컬 상태만 정리
    }
    tokenStorage.clear();
    persistUser(null);
    set({ user: null, accessToken: null, isAuthenticated: false });
  },

  setUser: (user): void => {
    persistUser(user);
    set({ user });
  },
}));
