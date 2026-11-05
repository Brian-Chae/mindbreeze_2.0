// SDD-309 — 코치 미연결 회원 화면. 클래스 화면 계열 틀(MemberFlowFrame)로 통일하고,
// 뒤로 가기 + "다른 계정으로 로그인"을 둬서 앱을 끄지 않고 빠져나올 수 있게 한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MemberFlowFrame } from '../../components/class/flow/member/MemberFlowFrame';
import { FlowButton, FlowCard, FlowH1, FlowSub } from '../../components/class/flow/shared/flow-primitives';
import { MemberBrandMark } from '../../components/class/player/member/MemberBrandMark';
import { apiClient } from '../../lib/api/client';
import { useAuthStore } from '../../stores/authStore';
import './counselor-code-screen.css';

export type CounselorLite = { id: string; name: string; profile_image: string | null };

const CODE_LENGTH = 6;

/** 이전 화면이 있으면 그리로, 없으면(앱을 막 열었을 때) 코치 코드 없이도 쓸 수 있는 클래스 코드 입장으로 보낸다. */
function useExit() {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const goBack = useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/join', { replace: true });
  }, [location.key, navigate]);
  const switchAccount = useCallback(async () => {
    try {
      await logout();
    } finally {
      navigate('/login?role=client', { replace: true });
    }
  }, [logout, navigate]);
  return { goBack, switchAccount };
}

function SwitchAccountButton({ onClick }: { onClick: () => void }) {
  return (
    <FlowButton kind="ghost" onClick={onClick}>
      <LogOut size={18} aria-hidden="true" />다른 계정으로 로그인
    </FlowButton>
  );
}

/** 코치 코드 입력 화면 */
export function CounselorCodeScreen({ onConnected }: { onConnected: (list: CounselorLite[]) => void }) {
  const { goBack, switchAccount } = useExit();
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
        const message = err instanceof Error ? err.message : '연결에 실패했습니다. 코드를 다시 확인해주세요.';
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
    const val = e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(val);
    setError(null);
    if (val.length === CODE_LENGTH) void submitCode(val);
  };

  return (
    <MemberFlowFrame
      title="코치 연결"
      onBack={goBack}
      colClassName="fm-narrow"
      foot={
        <>
          <div className="fm-fnote">코치 코드는 코치 프로필에서 확인할 수 있습니다</div>
          <SwitchAccountButton onClick={() => void switchAccount()} />
        </>
      }
    >
      <FlowCard strong>
        <section className="fm-code-card" aria-label="코치 코드 입력">
          <MemberBrandMark className="fm-logo" />
          <FlowH1>코치와 연결하기</FlowH1>
          <FlowSub>코치에게 받은 6자리 숫자를 입력하여 연결을 시작하세요.</FlowSub>
          {/* 단일 input + 시각적 6칸 (모바일 포커스 이동 시 키패드 유지) */}
          <div className="fm-codebox cc-six" onClick={() => inputRef.current?.focus()}>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              maxLength={CODE_LENGTH}
              autoFocus
              value={code}
              onChange={handleInputChange}
              disabled={loading}
              aria-label="코치 코드 6자리 숫자"
              aria-invalid={error ? true : undefined}
              className="cc-input"
            />
            {Array.from({ length: CODE_LENGTH }).map((_, i) => (
              <span
                key={i}
                aria-hidden="true"
                data-active={!error && !loading && code.length === i ? 'true' : undefined}
                data-bad={error ? 'true' : undefined}
              >
                <b>{code[i] ?? ''}</b>
              </span>
            ))}
          </div>
          {error ? (
            <div className="fm-hint" data-bad="true" role="alert">{error}</div>
          ) : loading ? (
            <div className="fm-hint" role="status">연결 중...</div>
          ) : (
            <div className="fm-hint"><KeyRound size={16} aria-hidden="true" />숫자 6자리를 모두 입력하면 연결돼요</div>
          )}
        </section>
      </FlowCard>
    </MemberFlowFrame>
  );
}

/** 코치 연결 정보 조회 실패 — 재시도와 함께 같은 탈출 수단을 둔다. */
export function CounselorLinkErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { goBack, switchAccount } = useExit();
  return (
    <MemberFlowFrame
      title="코치 연결"
      onBack={goBack}
      colClassName="fm-narrow"
      foot={
        <>
          <FlowButton kind="primary" onClick={onRetry}>다시 시도</FlowButton>
          <SwitchAccountButton onClick={() => void switchAccount()} />
        </>
      }
    >
      <FlowCard strong>
        <section className="fm-code-card" aria-label="연결 정보 오류">
          <FlowH1>연결 정보를 불러오지 못했습니다</FlowH1>
          <div className="fm-hint" data-bad="true" role="alert">{message}</div>
        </section>
      </FlowCard>
    </MemberFlowFrame>
  );
}
