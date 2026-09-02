// 클래스 코드 참여 — code → details → waiting → meditation (1.0 게스트 패리티)

import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api/client';
import {
  getSessionByCode,
  getSessionByCodeState,
  joinSessionByCode,
  type SessionByCodeResponse,
} from '../lib/api/session';
import { useAuthStore } from '../stores/authStore';
import { GuestMeditationPanel } from '../components/class/GuestMeditationPanel';

type JoinStep = 'code' | 'details' | 'waiting' | 'meditation' | 'complete';

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

const PARTICIPANT_STORAGE_KEY = 'mb_join_participant';

interface StoredJoinContext {
  code: string;
  participantId: string;
}

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

function persistParticipant(code: string, participantId: string): void {
  const payload: StoredJoinContext = { code, participantId };
  try {
    sessionStorage.setItem(PARTICIPANT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // storage 불가 환경에서는 메모리 상태만 사용
  }
}

function clearPersistedParticipant(): void {
  try {
    sessionStorage.removeItem(PARTICIPANT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

const ClassJoinPage: React.FC = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const user = useAuthStore((state) => state.user);

  const [step, setStep] = useState<JoinStep>('code');
  const [code, setCode] = useState('');
  const [guestName, setGuestName] = useState('');
  const [session, setSession] = useState<SessionByCodeResponse | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [durationMin, setDurationMin] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isLoggedIn = isInitialized && isAuthenticated;

  // waiting: 세션 상태 폴링 → in_progress 시 meditation으로 자동 전환
  useEffect(() => {
    if (step !== 'waiting' || !session) return undefined;

    const refresh = async (): Promise<void> => {
      try {
        // participant_id가 있으면 by-code/state 우선 사용
        if (participantId) {
          try {
            const state = await getSessionByCodeState(code, participantId);
            setSession((prev) =>
              prev
                ? {
                    ...prev,
                    status: state.status,
                    started_at: state.started_at ?? prev.started_at,
                    title: state.title ?? prev.title,
                  }
                : prev,
            );

            if (state.status === 'in_progress' || state.guest_state === 'meditation') {
              setStep('meditation');
              return;
            }
            if (state.status === 'completed' || state.guest_state === 'complete') {
              setStep('complete');
              return;
            }
            if (state.status === 'cancelled') {
              setError('이 클래스는 이미 종료되었거나 취소되었습니다.');
            }
            return;
          } catch {
            // state API 미준비 시 getSessionByCode로 fallback
          }
        }

        const refreshed = await getSessionByCode(code);
        setSession(refreshed);
        if (isClosed(refreshed)) {
          if (refreshed.status === 'completed') {
            setStep('complete');
          } else {
            setError('이 클래스는 이미 종료되었거나 취소되었습니다.');
          }
          return;
        }
        if (refreshed.status === 'in_progress') {
          setStep('meditation');
        }
      } catch (refreshError) {
        if (refreshError instanceof ApiError && refreshError.status === 404) {
          setError('클래스 정보를 더 이상 찾을 수 없습니다.');
        }
      }
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [code, participantId, session?.id, step]);

  // meditation 중 completed 감지
  useEffect(() => {
    if (step !== 'meditation' || !session) return undefined;

    const refresh = async (): Promise<void> => {
      try {
        if (participantId) {
          try {
            const state = await getSessionByCodeState(code, participantId);
            if (state.status === 'completed' || state.guest_state === 'complete') {
              setStep('complete');
              return;
            }
            if (state.status === 'cancelled') {
              setError('클래스가 취소되었습니다.');
              setStep('complete');
            }
            return;
          } catch {
            // fallback
          }
        }
        const refreshed = await getSessionByCode(code);
        setSession(refreshed);
        if (refreshed.status === 'completed' || refreshed.status === 'cancelled') {
          setStep('complete');
        }
      } catch {
        // 일시 오류 무시
      }
    };

    const intervalId = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => window.clearInterval(intervalId);
  }, [code, participantId, session?.id, step]);

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
      const joined = await joinSessionByCode(code, isLoggedIn ? {} : { name: trimmedGuestName });
      const nextParticipantId = joined.participant_id;
      setParticipantId(nextParticipantId);
      if (nextParticipantId) {
        persistParticipant(code, nextParticipantId);
      }
      if (joined.session.duration_min > 0) {
        setDurationMin(joined.session.duration_min);
      }
      // 이미 진행 중이면 바로 명상 화면
      if (joined.session.status === 'in_progress' || session.status === 'in_progress') {
        setSession({
          ...session,
          status: 'in_progress',
          started_at: joined.session.started_at ?? session.started_at,
        });
        setStep('meditation');
      } else {
        setStep('waiting');
      }
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
    setParticipantId(null);
    setDurationMin(50);
    setError(null);
    clearPersistedParticipant();
  };

  // 명상 화면은 전체 폭 immersive 레이아웃
  if (step === 'meditation' && session) {
    return (
      <main className="min-h-screen bg-[#1A0B2E] px-4 py-8 sm:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <GuestMeditationPanel
            title={session.title}
            startedAt={session.started_at}
            durationMin={durationMin}
            onLeave={resetJoin}
          />
          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </p>
          )}
        </div>
      </main>
    );
  }

  if (step === 'complete') {
    return (
      <main className="min-h-screen bg-[#F8F6FA] px-5 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-xl">
          <section className="rounded-3xl border border-purple-100 bg-white p-6 text-center shadow-sm sm:p-10">
            <p className="text-sm font-bold text-purple-800">수업 종료</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-950">
              수업이 종료되었습니다
            </h1>
            <p className="mt-4 text-sm leading-6 text-gray-600">
              {session?.title ?? '클래스'} 참여해 주셔서 감사합니다.
              리포트는 상담사가 발급하면 확인할 수 있습니다.
            </p>
            {error && (
              <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </p>
            )}
            <Link
              to="/"
              className="mb-btn mt-8 inline-flex h-[52px] w-full items-center justify-center rounded-xl px-6 text-base"
            >
              홈으로
            </Link>
            <button
              type="button"
              onClick={resetJoin}
              className="mt-4 w-full py-2 text-sm font-semibold text-gray-500 hover:text-gray-800"
            >
              다른 클래스 코드 입력하기
            </button>
          </section>
        </div>
      </main>
    );
  }

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

              <form className="mt-8 space-y-5" onSubmit={(e) => void handleCodeSubmit(e)}>
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

              <form className="mt-7 space-y-5" onSubmit={(e) => void handleJoinSubmit(e)}>
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
                {isLoggedIn && (
                  <p className="rounded-xl bg-purple-50 px-4 py-3 text-sm text-purple-900">
                    {user?.name
                      ? `프로필에 등록된 이름(${user.name})으로 참여합니다`
                      : '로그인된 계정으로 참여합니다.'}
                  </p>
                )}
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
                <p className="text-lg font-bold text-purple-950">호스트가 시작할 때까지 잠시 쉬어가세요</p>
                <p className="mt-2 text-sm leading-6 text-purple-800">
                  현재 상태: {STATUS_LABELS[session.status]}. 클래스가 시작되면 명상 화면으로 자동 이동합니다.
                </p>
              </div>
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
