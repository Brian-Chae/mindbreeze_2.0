import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api/client';
import {
  getSessionByCode,
  joinSessionByCode,
  type SessionByCodeResponse,
} from '../lib/api/session';
import { useAuthStore } from '../stores/authStore';

type JoinStep = 'code' | 'details' | 'waiting';

const TYPE_LABELS: Record<SessionByCodeResponse['type'], string> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상 수업',
  custom: '맞춤 클래스',
};

const STATUS_LABELS: Record<SessionByCodeResponse['status'], string> = {
  ready: '시작 대기',
  scheduled: '예정',
  in_progress: '진행 중',
  paused: '일시 정지',
  completed: '종료됨',
  cancelled: '취소됨',
};

function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function isClosed(session: SessionByCodeResponse): boolean {
  return session.status === 'completed' || session.status === 'cancelled';
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return '입력한 클래스 코드를 찾을 수 없습니다. 코드를 다시 확인해 주세요.';
    if (
      error.status === 409 ||
      error.status === 410 ||
      (error.status === 400 && (error.message.includes('이미 종료된 클래스') || error.message.includes('이미 취소된 클래스')))
    ) {
      return '이 클래스는 이미 종료되었거나 취소되어 참여할 수 없습니다.';
    }
  }
  return fallback;
}

const ClassJoinPage: React.FC = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const [step, setStep] = useState<JoinStep>('code');
  const [code, setCode] = useState('');
  const [guestName, setGuestName] = useState('');
  const [session, setSession] = useState<SessionByCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isLoggedIn = isInitialized && isAuthenticated;

  useEffect(() => {
    if (step !== 'waiting' || !session) return undefined;

    const refreshSession = async (): Promise<void> => {
      try {
        const refreshed = await getSessionByCode(code);
        setSession(refreshed);
        if (isClosed(refreshed)) {
          setError('이 클래스는 이미 종료되었거나 취소되었습니다.');
        }
      } catch (refreshError) {
        if (refreshError instanceof ApiError && refreshError.status === 404) {
          setError('클래스 정보를 더 이상 찾을 수 없습니다.');
        }
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshSession();
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [code, session, step]);

  const handleCodeSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (code.length !== 6) {
      setError('6자리 클래스 코드를 입력해 주세요.');
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      const foundSession = await getSessionByCode(code);
      setSession(foundSession);
      if (isClosed(foundSession)) {
        setError('이 클래스는 이미 종료되었거나 취소되어 참여할 수 없습니다.');
        return;
      }
      setStep('details');
    } catch (lookupError) {
      setSession(null);
      setError(errorMessage(lookupError, '클래스 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!session) return;

    const trimmedGuestName = guestName.trim();
    if (!isLoggedIn && !trimmedGuestName) {
      setError('게스트 참여를 위해 이름을 입력해 주세요.');
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      await joinSessionByCode(code, isLoggedIn ? {} : { name: trimmedGuestName });
      setStep('waiting');
    } catch (joinError) {
      setError(errorMessage(joinError, '클래스 참여에 실패했습니다. 클래스 상태를 확인한 뒤 다시 시도해 주세요.'));
    } finally {
      setIsLoading(false);
    }
  };

  const resetJoin = (): void => {
    setStep('code');
    setSession(null);
    setGuestName('');
    setError(null);
  };

  return (
    <main className="min-h-screen bg-[#F8F6FA] px-5 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-xl">
        <Link to="/" className="inline-flex items-center text-sm font-semibold text-purple-900 hover:text-purple-700">
          ← Mind Breeze 홈으로
        </Link>

        <section className="mt-8 rounded-3xl border border-purple-100 bg-white p-6 shadow-sm sm:p-10">
          {step === 'code' && (
            <>
              <p className="text-sm font-bold text-purple-800">클래스 코드 참여</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-950">클래스에 바로 참여하세요</h1>
              <p className="mt-3 text-base leading-7 text-gray-600">
                진행자에게 받은 6자리 클래스 코드를 입력하면, 로그인 또는 게스트로 참여할 수 있습니다.
              </p>

              <form className="mt-8 space-y-5" onSubmit={handleCodeSubmit}>
                <div>
                  <label htmlFor="class-code" className="block text-sm font-semibold text-gray-800">
                    클래스 코드
                  </label>
                  <input
                    id="class-code"
                    value={code}
                    onChange={(event) => setCode(normalizeCode(event.target.value))}
                    placeholder="예: A1B2C3"
                    maxLength={6}
                    autoComplete="off"
                    className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-4 text-center font-mono text-2xl font-bold tracking-[0.35em] text-gray-900 outline-none transition focus:border-purple-700 focus:ring-2 focus:ring-purple-100"
                  />
                </div>
                {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="mb-btn h-[52px] w-full justify-center rounded-xl px-6 text-base disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? '클래스 확인 중...' : '클래스 확인하기'}
                </button>
              </form>
            </>
          )}

          {step === 'details' && session && (
            <>
              <p className="text-sm font-bold text-purple-800">참여할 클래스</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-950">
                {session.title ?? '제목 없는 클래스'}
              </h1>
              <div className="mt-6 space-y-3 rounded-2xl bg-purple-50 p-5 text-sm text-gray-700">
                <p><span className="font-semibold text-gray-900">유형</span> · {session.custom_type_name ?? TYPE_LABELS[session.type]}</p>
                <p><span className="font-semibold text-gray-900">진행자</span> · {session.host_name ?? '진행자'}</p>
                <p><span className="font-semibold text-gray-900">상태</span> · {STATUS_LABELS[session.status]}</p>
                <p><span className="font-semibold text-gray-900">참여 인원</span> · {session.participant_count} / {session.max_participants}명</p>
              </div>

              <form className="mt-7 space-y-5" onSubmit={handleJoinSubmit}>
                {!isLoggedIn && (
                  <div>
                    <label htmlFor="guest-name" className="block text-sm font-semibold text-gray-800">
                      이름
                    </label>
                    <input
                      id="guest-name"
                      value={guestName}
                      onChange={(event) => setGuestName(event.target.value)}
                      placeholder="클래스에서 사용할 이름"
                      maxLength={80}
                      autoComplete="name"
                      className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-purple-700 focus:ring-2 focus:ring-purple-100"
                    />
                    <p className="mt-2 text-xs leading-5 text-gray-500">로그인하지 않아도 이름만 입력하면 게스트로 참여할 수 있습니다.</p>
                  </div>
                )}
                {isLoggedIn && <p className="rounded-xl bg-purple-50 px-4 py-3 text-sm text-purple-900">로그인된 계정으로 참여합니다.</p>}
                {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="mb-btn h-[52px] w-full justify-center rounded-xl px-6 text-base disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? '참여 처리 중...' : '클래스 참여하기'}
                </button>
                <button type="button" onClick={resetJoin} className="w-full py-2 text-sm font-semibold text-gray-500 hover:text-gray-800">
                  다른 코드 입력하기
                </button>
              </form>
            </>
          )}

          {step === 'waiting' && session && (
            <div className="text-center">
              <p className="text-sm font-bold text-purple-800">참여가 완료되었습니다</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-950">{session.title ?? '클래스'}</h1>
              <p className="mt-7 text-sm font-medium text-gray-500">클래스 코드</p>
              <p className="mt-2 font-mono text-5xl font-bold tracking-[0.22em] text-purple-900 sm:text-6xl">{code}</p>
              <div className="mt-8 rounded-2xl bg-purple-50 px-5 py-6">
                <p className="text-lg font-bold text-purple-950">호스트가 시작할 때까지 대기</p>
                <p className="mt-2 text-sm leading-6 text-purple-800">
                  현재 상태: {STATUS_LABELS[session.status]}. 클래스 상태를 자동으로 확인하고 있습니다.
                </p>
              </div>
              {session.status === 'in_progress' && (
                <p className="mt-5 text-sm font-semibold text-emerald-700">호스트가 클래스를 시작했습니다.</p>
              )}
              {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
              <button type="button" onClick={resetJoin} className="mt-7 text-sm font-semibold text-gray-500 hover:text-gray-800">
                다른 클래스 코드 입력하기
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
};

export default ClassJoinPage;
