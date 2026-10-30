import { buttonClass } from '../../components/ui';
import ParticipationProfilePage from '../settings/participation-profile-page';
// 내담자 앱 메인 페이지
// 상담사 연결 안 됨 → 코드 입력 화면
// 상담사 연결 됨 → ClientShell + 탭별 페이지

import ClientNotificationPage from './ClientNotificationPage';
import { useState, useRef, useCallback, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { apiClient } from '../../lib/api/client';
import ClientShell from '../../components/client/ClientShell';
import ClientHomePage from './ClientHomePage';
import ClientChatPage from './ClientChatPage';
import ClientSessionListPage from './ClientSessionListPage';
import ClientSessionDetailPage from './ClientSessionDetailPage';
import ClientSettingsPage from '../settings/ClientSettingsPage';
import ClientReportListPage from './ClientReportListPage';
import { isAiEnabled } from '../../lib/feature-flags';

// ── 헬퍼 ──────────────────────────────────────────────────────────

const WEEK_LABELS = ['첫째', '둘째', '셋째', '넷째', '다섯째'];

/** 오늘 날짜 → "2026년 5월 · 5월 넷째 주" 형식 */
function formatKoreanSub(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const firstDay = new Date(y, m - 1, 1).getDay(); // 0=일
  const weekNum = Math.ceil((d + firstDay) / 7);
  const label = WEEK_LABELS[Math.min(weekNum - 1, 4)];
  return `${y}년 ${m}월 · ${m}월 ${label} 주`;
}

/** 상담사 코드 입력 화면 */
type CounselorLite = { id: string; name: string; profile_image: string | null };

export function CounselorCodeScreen({ onConnected }: { onConnected: (list: CounselorLite[]) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 6자리 완성 시 1회 제출 (effect 아님 — user 변경으로 cleanup/재실행되지 않게 명시 호출)
  const submitCode = useCallback(
    async (fullCode: string) => {
      if (submittingRef.current) return; // 중복 제출 방지
      submittingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        let fallback: CounselorLite[] = [];
        try {
          // 서버는 연결된 상담사 1명(CounselorInfo 단건)을 돌려준다.
          const added = await apiClient.post<CounselorLite>('/client/counselors', { code: fullCode });
          if (added && typeof added === 'object' && 'id' in added) fallback = [added];
        } catch (err: unknown) {
          // 409: 이미 연결된 상담사 → 아래 GET 으로 목록 새로고침
          const is409 = err instanceof Error && 'status' in err && (err as { status: number }).status === 409;
          if (!is409) throw err;
        }
        // 전체 목록은 GET 으로 다시 받는다 (실패 시 POST 결과로 대체)
        let list = fallback;
        try {
          const fetched = await apiClient.get<CounselorLite[]>('/client/counselors');
          if (Array.isArray(fetched) && fetched.length > 0) list = fetched;
        } catch {
          if (list.length === 0) throw new Error('연결 정보를 불러오지 못했습니다. 다시 시도해주세요.');
        }
        if (list.length === 0) throw new Error('연결 정보를 불러오지 못했습니다. 다시 시도해주세요.');
        onConnected(list);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : '연결에 실패했습니다. 코드를 다시 확인해주세요.';
        if (mountedRef.current) {
          setError(message);
          setCode('');
          inputRef.current?.focus();
        }
      } finally {
        submittingRef.current = false;
        if (mountedRef.current) setLoading(false);
      }
    },
    [onConnected],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 숫자 외 입력 제거, 최대 6자리
    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(val);
    setError(null);
    if (val.length === 6) {
      void submitCode(val);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh bg-[#FAFAFA] px-6">
      <div className="text-center w-full max-w-sm">
        <h1 className="text-2xl font-bold text-[#1F1F1F] mb-2">
          상담사와 연결하기
        </h1>
        <p className="text-[#6F6F6F] mb-8">
          상담사에게 받은 6자리 숫자를 입력하여 연결을 시작하세요.
        </p>

        {/* 6자리 코드 입력: 단일 input + 시각적 6칸 (모바일 포커스 이동 시 키패드 유지) */}
        <div
          className="relative flex justify-center mb-4 cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={6}
            autoFocus
            value={code}
            onChange={handleInputChange}
            disabled={loading}
            aria-label="상담사 코드 6자리 숫자"
            className="absolute inset-0 w-full h-full opacity-0 cursor-text"
          />
          <div className="flex gap-2 sm:gap-3 pointer-events-none" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => {
              const digit = code[i] || '';
              const isFocused = !loading && (code.length === i || (code.length === 6 && i === 5));
              return (
                <div
                  key={i}
                  className={`w-9 sm:w-10 h-12 shrink-0 flex items-center justify-center text-lg font-bold rounded-lg border-2 transition-colors ${
                    error
                      ? 'border-red-400 bg-red-50'
                      : digit
                        ? 'border-[#5F0080] bg-[#F3E5F5]'
                        : isFocused
                          ? 'border-[#5F0080] bg-white ring-2 ring-[#5F0080]/20'
                          : 'border-[#D4D4D4] bg-white'
                  } text-[#1F1F1F]`}
                >
                  {digit}
                </div>
              );
            })}
          </div>
        </div>

        {/* 에러 메시지 */}
        {error && (
          <p className="text-red-500 text-sm mb-4">{error}</p>
        )}

        {/* 로딩 표시 */}
        {loading && (
          <p className="text-[#6F6F6F] text-sm">연결 중...</p>
        )}

        <p className="text-xs text-[#6F6F6F] mt-6">
          상담사 코드는 상담사 프로필에서 확인할 수 있습니다
        </p>
      </div>
    </div>
  );
}

export default function ClientAppPage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const { pathname } = useLocation();

  // counselors: null = 로딩중, [] = 상담사 없음, [...] = 상담사 있음
  const [counselors, setCounselors] = useState<Array<{ id: string; name: string; profile_image: string | null }> | null>(() => {
    // store에 이미 있으면 그걸로 초기화 (깜빡임 방지)
    return (user?.counselors?.length ?? 0) > 0 ? user!.counselors : null;
  });
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  // 마운트 시 상담사 목록 API 호출
  useEffect(() => {
    let cancelled = false;

    async function fetchCounselors() {
      setFetchError(null);
      try {
        const res = await apiClient.get<
          Array<{ id: string; name: string; profile_image: string | null }>
        >('/client/counselors');

        if (cancelled) return;

        const list = Array.isArray(res) ? res : [];
        setCounselors(list);

        if (user) {
          setUser({ ...user, counselors: list });
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to fetch counselors:', err);
        // 실패 시 counselors를 null로 유지 — '상담사 코드 입력' 화면 오표시를 막고 에러+재시도 노출
        setFetchError(
          err instanceof Error ? err.message : '상담사 연결 정보를 불러오지 못했습니다',
        );
      }
    }

    fetchCounselors();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  // 코드 연결 성공 → 로컬 state 와 store 둘 다 갱신해 즉시 홈으로 전환
  function handleConnected(list: Array<{ id: string; name: string; profile_image: string | null }>) {
    setCounselors(list);
    const current = useAuthStore.getState().user;
    if (current) setUser({ ...current, counselors: list });
  }

  // SDD-220: AI 비공개면 루시 직접 진입(구 경로·푸시 딥링크 포함)을 일반 채팅 목록으로 보낸다(루프 없음).
  if (!isAiEnabled() && (pathname === '/app/ai' || pathname.startsWith('/app/ai/') || pathname.startsWith('/app/chat/lucy'))) {
    return <Navigate to="/app/chat" replace />;
  }
  // AI 대화는 채팅 목록의 루시(AI) 채널로 통합 — 구 경로·푸시 딥링크는 리다이렉트
  if (pathname === '/app/ai' || pathname === '/app/ai/') return <Navigate to="/app/chat/lucy" replace />;
  // 채팅(루시 채널 포함)은 상담사 연결 전에도 접근 가능 — 코드 입력 게이트보다 먼저 처리
  if (pathname.startsWith('/app/chat')) return <ClientChatPage />;

  // 본인 설정은 상담사 연결 여부와 무관하게 열 수 있다.
  if (pathname === '/app/profile' || pathname === '/app/profile/') {
    return <ClientShell title="설정" sub="SETTINGS"><ClientSettingsPage /></ClientShell>;
  }
  if (pathname === '/app/participation-profile' || pathname === '/app/participation-profile/') {
    return <ClientShell title="참여 프로필 관리" sub="PARTICIPATION PROFILE"><ParticipationProfilePage /></ClientShell>;
  }

  // 로딩 중
  if (counselors === null && !fetchError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#FAFAFA]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#5F0080] border-t-transparent" />
      </div>
    );
  }

  const hasCounselors = counselors !== null && counselors.length > 0;

  // 상담사 목록 조회 실패 + 캐시 없음 → 코드 입력 화면 대신 에러 + 재시도
  if (counselors === null && fetchError && !pathname.startsWith('/app/notifications')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#FAFAFA] px-6">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-xl font-bold text-[#1F1F1F] mb-2">연결 정보를 불러오지 못했습니다</h1>
          <p className="text-sm text-red-600 mb-6">{fetchError}</p>
          <button
            type="button"
            onClick={() => setFetchKey((k) => k + 1)}
            className={buttonClass({ className: 'w-full' })}
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  // 상담사 연결 전 → 코드 입력 화면
  if (!hasCounselors && !pathname.startsWith('/app/notifications')) {
    return <CounselorCodeScreen onConnected={handleConnected} />;
  }

  // /app/chat 또는 /app/chat/:roomId → ClientChatPage (자체 ClientShell 보유, 상담사 ChatPage와 동일 패턴)
  if (pathname.startsWith('/app/chat')) {
    return <ClientChatPage />;
  }

  // /app/sessions/:id → 클래스 상세 (ClientShell 없이 풀스크린)
  const sessionDetailMatch = pathname.match(/^\/app\/sessions\/([^/]+)$/);
  if (sessionDetailMatch) {
    return <ClientSessionDetailPage />;
  }

  // 탭별 콘텐츠 + ClientShell (AppShell과 동일 구조)
  let shellTitle = '홈';
  let shellSub: string | undefined = 'HOME';

  if (pathname === '/app' || pathname === '/app/') {
    // 홈: 대시보드 스타일 헤더
    shellTitle = `안녕하세요, ${user?.name ?? '내담자'}님`;
    shellSub = formatKoreanSub();
  } else if (pathname.startsWith('/app/sessions')) {
    shellTitle = '클래스';
    shellSub = 'SESSIONS';
  } else if (pathname.startsWith('/app/reports')) {
    shellTitle = '리포트';
    shellSub = 'REPORTS';
  } else if (pathname.startsWith('/app/notifications')) {
    shellTitle = '알림';
    shellSub = 'NOTIFICATIONS';
  } else if (pathname.startsWith('/app/profile')) {
    shellTitle = '설정';
    shellSub = 'SETTINGS';
  }

  const renderTabContent = () => {
    if (pathname.startsWith('/app/sessions')) {
      return <ClientSessionListPage />;
    }
    if (pathname.startsWith('/app/reports')) {
      return <ClientReportListPage />;
    }
    if (pathname.startsWith('/app/notifications')) {
      return <ClientNotificationPage />;
    }
    if (pathname.startsWith('/app/profile')) {
      return <ClientSettingsPage />;
    }
    // /app → 홈
    return <ClientHomePage />;
  };

  const handleSessionRequest = () => {
    window.dispatchEvent(new CustomEvent('open-session-request'));
  };

  // 클래스 탭이면 rightSlot에 신청하기 버튼
  const rightSlot = pathname.startsWith('/app/sessions') ? (
    <button
      data-header-action="primary"
      type="button"
      onClick={handleSessionRequest}
      className={buttonClass()}
    >
      클래스 신청하기
    </button>
  ) : undefined;

  return (
    <ClientShell title={shellTitle} sub={shellSub} rightSlot={rightSlot} wide={pathname.startsWith('/app/sessions') || pathname.startsWith('/app/reports')}>
      {renderTabContent()}
    </ClientShell>
  );
}
