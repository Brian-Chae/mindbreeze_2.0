import { buttonClass } from '../../components/ui';
import ParticipationProfilePage from '../settings/participation-profile-page';
// 내담자 앱 메인 페이지
// 상담사 연결 안 됨 → 코드 입력 화면
// 상담사 연결 됨 → ClientShell + 탭별 페이지

import ClientNotificationPage from './ClientNotificationPage';
import { useState, useEffect, lazy, Suspense } from 'react';
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
import { CounselorCodeScreen, CounselorLinkErrorScreen } from './counselor-code-screen';

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

// SDD-318: UI_V2 는 빌드 시 상수 — 운영 빌드에서는 D안 분기가 제거된다.
const UiV2ReportsPage = lazy(() => import.meta.env.VITE_UI_V2 === 'true'
  ? import('./ui-v2/ui-v2-reports-page').then((module) => ({ default: module.UiV2ReportsPage }))
  : Promise.resolve({ default: () => <></> }));

const UiV2ChatPage = lazy(() => import.meta.env.VITE_UI_V2 === 'true'
  ? import('./ui-v2/ui-v2-chat-page').then((module) => ({ default: module.UiV2ChatPage }))
  : Promise.resolve({ default: () => <></> }));
const UiV2SettingsPage = lazy(() => import.meta.env.VITE_UI_V2 === 'true'
  ? import('./ui-v2/ui-v2-settings-page').then((module) => ({ default: module.UiV2SettingsPage }))
  : Promise.resolve({ default: () => <></> }));
const UiV2NotificationsPage = lazy(() => import.meta.env.VITE_UI_V2 === 'true'
  ? import('./ui-v2/ui-v2-notifications-page').then((module) => ({ default: module.UiV2NotificationsPage }))
  : Promise.resolve({ default: () => <></> }));
const UiV2ParticipationProfilePage = lazy(() => import.meta.env.VITE_UI_V2 === 'true'
  ? import('./ui-v2/ui-v2-participation-profile-page').then((module) => ({ default: module.UiV2ParticipationProfilePage }))
  : Promise.resolve({ default: () => <></> }));

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
          err instanceof Error ? err.message : '코치 연결 정보를 불러오지 못했습니다',
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
  if (pathname.startsWith('/app/chat')) {
    // SDD-318: 채팅 D안
    if (import.meta.env.VITE_UI_V2 === 'true') return <Suspense fallback={null}><UiV2ChatPage /></Suspense>;
    return <ClientChatPage />;
  }

  // SDD-322: 알림 D안 (상담사 연결 전에도 열린다 — 아래 코드 입력 게이트보다 먼저 처리)
  if (import.meta.env.VITE_UI_V2 === 'true' && pathname.startsWith('/app/notifications')) {
    return <Suspense fallback={null}><UiV2NotificationsPage /></Suspense>;
  }

  // 본인 설정은 상담사 연결 여부와 무관하게 열 수 있다.
  // SDD-320 K: ui-v2 에서 /app/settings 는 설정(/app/profile)과 같은 D안 쉘로 연다(레거시 셸로 새지 않게)
  if (pathname === '/app/profile' || pathname === '/app/profile/' || (import.meta.env.VITE_UI_V2 === 'true' && (pathname === '/app/settings' || pathname === '/app/settings/'))) {
    // SDD-318: 설정 D안
    if (import.meta.env.VITE_UI_V2 === 'true') return <Suspense fallback={null}><UiV2SettingsPage /></Suspense>;
    return <ClientShell title="설정" sub="SETTINGS"><ClientSettingsPage /></ClientShell>;
  }
  if (pathname === '/app/participation-profile' || pathname === '/app/participation-profile/') {
    if (import.meta.env.VITE_UI_V2 === 'true') return <Suspense fallback={null}><UiV2ParticipationProfilePage /></Suspense>;
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

  // 상담사 목록 조회 실패 + 캐시 없음 → 코드 입력 화면 대신 에러 + 재시도(뒤로·로그인 전환 포함)
  if (counselors === null && fetchError && !pathname.startsWith('/app/notifications')) {
    return <CounselorLinkErrorScreen message={fetchError} onRetry={() => setFetchKey((k) => k + 1)} />;
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

  // SDD-318: 리포트 탭 D안 (자체 쉘 사용)
  if (import.meta.env.VITE_UI_V2 === 'true' && pathname.startsWith('/app/reports')) {
    return <Suspense fallback={null}><UiV2ReportsPage /></Suspense>;
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
