// 내담자 앱 메인 페이지
// 상담사 연결 안 됨 → 코드 입력 화면
// 상담사 연결 됨 → ClientShell + 탭별 페이지

import { useState, useRef, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { apiClient } from '../../lib/api/client';
import ClientShell from '../../components/client/ClientShell';
import ClientHomePage from './ClientHomePage';
import ClientChatListPage from './ClientChatListPage';
import ClientChatRoomPage from './ClientChatRoomPage';
import ClientSessionListPage from './ClientSessionListPage';
import ClientSessionDetailPage from './ClientSessionDetailPage';
import ClientProfilePage from './ClientProfilePage';
import ClientReportListPage from './ClientReportListPage';
import ClientReportDetailPage from './ClientReportDetailPage';

/** 상담사 코드 입력 화면 */
function CounselorCodeScreen() {
  const [code, setCode] = useState<string[]>(Array(6).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);

  const handleChange = useCallback(
    (index: number, value: string) => {
      // 숫자만 허용
      if (value && !/^\d$/.test(value)) return;

      setError(null);
      const newCode = [...code];
      newCode[index] = value;
      setCode(newCode);

      // 다음 칸으로 포커스 이동
      if (value && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [code]
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      // Backspace: 현재 칸이 비어있으면 이전 칸으로 이동
      if (e.key === 'Backspace' && !code[index] && index > 0) {
        const newCode = [...code];
        newCode[index - 1] = '';
        setCode(newCode);
        inputRefs.current[index - 1]?.focus();
      }
    },
    [code]
  );

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const newCode = Array(6).fill('');
    for (let i = 0; i < pasted.length; i++) {
      newCode[i] = pasted[i];
    }
    setCode(newCode);
    setError(null);

    // 마지막 칸 또는 복사한 마지막 위치로 포커스
    const focusIdx = Math.min(pasted.length, 5);
    inputRefs.current[focusIdx]?.focus();
  }, []);

  // 6자리 모두 입력 시 자동 제출
  useEffect(() => {
    const fullCode = code.join('');
    if (fullCode.length !== 6) return;

    let cancelled = false;

    async function submit() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.post<{
          counselors: Array<{ id: string; name: string; profile_image: string | null }>;
        }>('/client/counselors', { code: fullCode });

        if (cancelled) return;

        // authStore의 user에 counselors 업데이트
        if (user) {
          setUser({
            ...user,
            counselors: res.counselors,
          });
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : '연결에 실패했습니다. 코드를 다시 확인해주세요.';
        setError(message);
        // 입력 초기화
        setCode(Array(6).fill(''));
        inputRefs.current[0]?.focus();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    submit();
    return () => {
      cancelled = true;
    };
  }, [code, user, setUser]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#FAFAFA] px-6">
      <div className="text-center w-full max-w-sm">
        <h1 className="text-2xl font-bold text-[#1F1F1F] mb-2">
          상담사와 연결하기
        </h1>
        <p className="text-[#6F6F6F] mb-8">
          상담사에게 받은 6자리 코드를 입력하여 연결을 시작하세요.
        </p>

        {/* 6자리 코드 입력 */}
        <div className="flex gap-3 justify-center mb-4">
          {code.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              autoFocus={i === 0}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={handlePaste}
              disabled={loading}
              className={`w-10 h-12 text-center text-lg font-bold rounded-lg border-2 outline-none transition-colors ${
                error
                  ? 'border-red-400 bg-red-50'
                  : digit
                    ? 'border-[#5F0080] bg-[#F3E5F5]'
                    : 'border-[#D4D4D4] bg-white focus:border-[#5F0080]'
              } text-[#1F1F1F] disabled:opacity-50`}
            />
          ))}
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
  const hasCounselors = (user?.counselors?.length ?? 0) > 0;
  const { pathname } = useLocation();

  // 상담사 연결 전 → 코드 입력 화면
  if (!hasCounselors) {
    return <CounselorCodeScreen />;
  }

  // /app/chat/:roomId → 채팅방 상세 (ClientShell 없이 풀스크린)
  const chatRoomMatch = pathname.match(/^\/app\/chat\/([^/]+)$/);
  if (chatRoomMatch) {
    return <ClientChatRoomPage />;
  }

  // /app/sessions/:id → 세션 상세 (ClientShell 없이 풀스크린)
  const sessionDetailMatch = pathname.match(/^\/app\/sessions\/([^/]+)$/);
  if (sessionDetailMatch) {
    return <ClientSessionDetailPage />;
  }

  // /app/reports/:id → 리포트 상세 (ClientShell 없이 풀스크린)
  const reportDetailMatch = pathname.match(/^\/app\/reports\/([^/]+)$/);
  if (reportDetailMatch) {
    return <ClientReportDetailPage />;
  }

  // 탭별 콘텐츠 렌더링 (ClientShell 포함)
  const renderTabContent = () => {
    if (pathname.startsWith('/app/chat')) {
      return <ClientChatListPage />;
    }
    if (pathname.startsWith('/app/sessions')) {
      return <ClientSessionListPage />;
    }
    if (pathname.startsWith('/app/reports')) {
      return <ClientReportListPage />;
    }
    if (pathname.startsWith('/app/profile')) {
      return <ClientProfilePage />;
    }
    // /app → 홈
    return <ClientHomePage />;
  };

  return <ClientShell>{renderTabContent()}</ClientShell>;
}
