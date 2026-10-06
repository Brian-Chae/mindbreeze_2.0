// 인증 전역 상태 (Zustand)
// access token은 메모리에만 보관, refresh token은 httpOnly cookie로 관리

import { create } from 'zustand';
import {
  ApiError,
  tokenStorage,
  refreshAccessTokenResult,
  type RefreshFailureReason,
} from '../lib/api/client';
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

/**
 * API7-01: 세션 복구 실패 안내. network/server 는 세션 만료가 아니므로
 * 사용자에게 안내하고 재시도할 수 있게 한다(invalid 는 즉시 로그아웃이라 노출하지 않는다).
 */
export interface SessionRecoveryNotice {
  reason: RefreshFailureReason;
  message: string;
}

const recoveryNotice = (reason: RefreshFailureReason): SessionRecoveryNotice => ({
  reason,
  message:
    reason === 'server'
      ? '서버가 일시적으로 응답하지 않아 로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'
      : '네트워크 연결이 불안정해 로그인 상태를 확인하지 못했습니다. 연결을 확인한 후 다시 시도해 주세요.',
});

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  /** 세션 복구(초기 refresh) 실패 안내. 정상/세션 만료 시 null. */
  sessionError: SessionRecoveryNotice | null;

  initialize: () => void;
  /** 세션 복구 재시도 — initialize() 를 다시 실행한다. */
  retryInitialize: () => void;
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

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isInitialized: false,
  sessionError: null,

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
      sessionError: null,
    });
    if (!user) {
      set({ isInitialized: true });
      return;
    }
    // access token 복구 — refresh(httpOnly cookie)로 메모리 재적재.
    // API7-01: 실패 원인을 구분한다. 네트워크/서버 문제로 null 이 왔다고
    // 세션을 폐기(persistUser(null))하면, 일시적 장애에 사용자가 강제 로그아웃된다.
    void refreshAccessTokenResult().then((result) => {
      if (result.ok) {
        set({ accessToken: result.token, isAuthenticated: true, isInitialized: true, sessionError: null });
        return;
      }
      if (result.reason === 'invalid') {
        // refresh 토큰이 실제로 만료/폐기된 경우(4xx)에만 세션을 폐기한다.
        tokenStorage.clear();
        persistUser(null);
        set({
          user: null,
          accessToken: null,
          isAuthenticated: false,
          isInitialized: true,
          sessionError: null,
        });
        return;
      }
      // network/server: 세션 만료가 아니므로 사용자 정보를 유지한 채 안내 + 재시도를 노출한다.
      // 메모리 access token 은 없지만, 연결이 복구되면 다음 API 401 이 refresh 로 자가 복구된다.
      set({
        accessToken: null,
        isAuthenticated: true,
        isInitialized: true,
        sessionError: recoveryNotice(result.reason),
      });
    });
  },

  retryInitialize: (): void => {
    get().initialize();
  },

  login: async (email, password, role, rememberMe = true): Promise<User> => {
    const res = await apiLogin(email, password, role, rememberMe);
    const user = applyLogin(res, role);
    set({ user, accessToken: res.access_token, isAuthenticated: true, sessionError: null });
    return user;
  },

  loginGoogle: async (idToken, inviteToken, role, rememberMe = true, consents): Promise<User> => {
    const res = await apiLoginGoogle(
      { access_token: idToken, invite_token: inviteToken, role, consents },
      rememberMe,
    );
    const user = applyLogin(res, role);
    set({ user, accessToken: res.access_token, isAuthenticated: true, sessionError: null });
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
    set({ user, accessToken: res.access_token, isAuthenticated: true, sessionError: null });
    return user;
  },

  registerClient: async (data, rememberMe = true): Promise<User> => {
    const res = await apiRegisterClient(data, rememberMe);
    const user = applyLogin(res);
    set({ user, accessToken: res.access_token, isAuthenticated: true, sessionError: null });
    return user;
  },

  refreshAuth: async (): Promise<boolean> => {
    try {
      const res = await apiRefresh();
      tokenStorage.set(res.access_token);
      set({ accessToken: res.access_token, sessionError: null });
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
    set({ user: null, accessToken: null, isAuthenticated: false, sessionError: null });

    // STORE-07: 로그아웃 시 사용자 종속 스토어(알림·채팅)를 초기화하여
    // 이전 사용자의 알림/메시지가 다음 로그인 사용자에게 노출되지 않게 한다.
    // authStore ↔ notificationStore/chatStore 순환 import 를 피하려고
    // 정적 import 대신 동적 import 로 지연 로드한다.
    try {
      const [{ useNotificationStore }, { useChatStore }] = await Promise.all([
        import('./notificationStore'),
        import('./chatStore'),
      ]);
      useNotificationStore.getState().reset();
      useChatStore.getState().reset();
    } catch (error) {
      console.warn('로그아웃 중 클라이언트 스토어 초기화 실패:', error);
    }
  },

  setUser: (user): void => {
    persistUser(user);
    set({ user });
  },
}));
