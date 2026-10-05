// 클래스 코드 참여 — code → details → waiting(3단계 준비·시작 대기) → meditation → complete

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '../lib/api/client';
import {
  getSessionByCode,
  getSessionByCodeState,
  joinSessionByCode,
  type SessionByCodeResponse,
} from '../lib/api/session';
import { useAuthStore } from '../stores/authStore';
import { GuestCompletePanel } from '../components/class/GuestCompletePanel';
import { type ClassWaitingRoomEnterPayload } from '../components/class/ClassWaitingRoom';
import { clearStoredNickname } from '../lib/class/class-waiting-room';
// SDD-088: waiting/meditation 렌더는 플레이어 씬 컴포넌트로 이전 (join 게이트는 이 페이지가 유지)
import { MemberWaitingScene } from '../components/player/MemberWaitingScene';
import { MemberSessionScene } from '../components/player/MemberSessionScene';
import { useWakeLock } from '../hooks/useWakeLock';
import { bluetoothService } from '../lib/eeg/bluetoothService';

type JoinStep = 'code' | 'details' | 'waiting' | 'meditation' | 'complete';

const TYPE_LABELS: Record<SessionByCodeResponse['type'], string> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상 수업',
  custom: '맞춤 클래스',
};

const STATUS_LABELS: Record<SessionByCodeResponse['status'], string> = {
  ready: '오픈 전',
  scheduled: '예정',
  open: '입장 가능',
  in_progress: '진행 중',
  completed: '종료됨',
  cancelled: '취소됨',
};

/** SDD-088: 상담사가 아직 클래스를 열지 않은 상태 — 입장 게이트에서 차단 + 자동 재시도 */
function isPreOpen(session: SessionByCodeResponse): boolean {
  return session.status === 'ready' || session.status === 'scheduled';
}

const PARTICIPANT_STORAGE_KEY = 'mb_join_participant';

interface StoredJoinContext {
  code: string;
  participantId: string;
  participantToken?: string | null;
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
    // SDD-088: 오픈 전 참여 시도 — 상담사가 클래스를 열면 자동으로 참여 가능해진다
    if (error.status === 400 && error.message.includes('오픈 전')) {
      return '상담사가 아직 클래스를 열지 않았습니다. 클래스가 열리면 자동으로 참여할 수 있습니다.';
    }
  }
  return fallback;
}

function restoreStoredParticipant(code: string): StoredJoinContext | null {
  try {
    const raw = sessionStorage.getItem(PARTICIPANT_STORAGE_KEY);
    if (!raw) return null;
    const ctx = JSON.parse(raw) as StoredJoinContext;
    return ctx.code === code ? ctx : null;
  } catch {
    return null;
  }
}

function persistParticipant(
  code: string,
  participantId: string,
  participantToken: string | null,
): void {
  const payload: StoredJoinContext = { code, participantId, participantToken };
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
  // 회원 세션 상세 "세션 입장하기"에서 /join?code=... 로 진입 — query code를 초기값으로 사용
  const [searchParams] = useSearchParams();
  const queryCode = searchParams.get('code') ?? '';
  const [code, setCode] = useState(queryCode);
  const [guestName, setGuestName] = useState('');
  /** SDD-062: 게스트 성별·생년월일 (선택, 온보딩 규약과 동일) */
  const [guestGender, setGuestGender] = useState('');
  const [guestBirthDate, setGuestBirthDate] = useState('');
  const [session, setSession] = useState<SessionByCodeResponse | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(
    () => restoreStoredParticipant(code)?.participantId ?? null,
  );
  /** join 응답의 소유 증명 — 게스트 report-email 필수 */
  const [participantToken, setParticipantToken] = useState<string | null>(
    () => restoreStoredParticipant(code)?.participantToken ?? null,
  );
  const [durationMin, setDurationMin] = useState(50);
  // SDD-096: 세션 최신 EEG 두뇌휴식도 — 종료 화면이 주관 체크인과 병기한다(밴드 미착용이면 null)
  const [relaxationIndex, setRelaxationIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isLoggedIn = isInitialized && isAuthenticated;

  // 회원 세션 상세 "세션 입장하기"에서 /join?code=... 로 진입 시 자동 클래스 확인
  useEffect(() => {
    if (queryCode.length !== 6) return;
    let cancelled = false;
    setError(null);
    setIsLoading(true);
    getSessionByCode(queryCode)
      .then((foundSession) => {
        if (cancelled) return;
        setSession(foundSession);
        if (isClosed(foundSession)) {
          setError('이 클래스는 이미 종료되었거나 취소되어 참여할 수 없습니다.');
          return;
        }
        setStep('details');
      })
      .catch((e) => {
        if (cancelled) return;
        setSession(null);
        setError(errorMessage(e, '클래스 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryCode]);

  // 대기·명상·입장 준비 중 화면 꺼짐 방지 (Wake Lock)
  useWakeLock(step === 'waiting' || step === 'meditation');

  // SDD-088: details 단계에서 아직 오픈 전이면 3초 폴링으로 오픈을 감지해 자동 활성화
  const sessionStatus = session?.status ?? null;
  const sessionId = session?.id ?? null;
  useEffect(() => {
    if (step !== 'details' || !sessionId) return undefined;
    if (sessionStatus !== 'ready' && sessionStatus !== 'scheduled') return undefined;
    const intervalId = window.setInterval(() => {
      getSessionByCode(code)
        .then((refreshed) => {
          setSession(refreshed);
          if (isClosed(refreshed)) {
            setError('이 클래스는 이미 종료되었거나 취소되어 참여할 수 없습니다.');
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [step, sessionStatus, sessionId, code]);

  /** 개선 3: 대기실 [입장] — 확정 닉네임을 반영하고 진행 중이면 바로 라이브로 들어간다 */
  const handleWaitingRoomEnter = useCallback(
    (payload: ClassWaitingRoomEnterPayload) => {
      if (!isLoggedIn && payload.nickname) setGuestName(payload.nickname);
      if (session?.status === 'in_progress') {
        setStep('meditation');
        return;
      }
      // 시작 전에는 같은 대기실 인스턴스와 준비 상태를 유지한다.
    },
    [isLoggedIn, session?.status],
  );

  // waiting: 세션 상태 폴링 → in_progress 시 meditation으로 자동 전환
  useEffect(() => {
    if (step !== 'waiting' || !session) return undefined;

    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        // participant_id가 있으면 by-code/state 우선 사용
        if (participantId) {
          try {
            const state = await getSessionByCodeState(code, participantId);
            if (cancelled) return;
            setSession((prev) =>
              prev
                ? {
                    ...prev,
                    status:
                      state.guest_state === 'meditation' && !['completed', 'cancelled'].includes(state.status)
                        ? 'in_progress'
                        : state.status,
                    started_at: state.started_at ?? prev.started_at,
                    title: state.title ?? prev.title,
                  }
                : prev,
            );

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
        if (cancelled) return;
        setSession(refreshed);
        if (isClosed(refreshed)) {
          if (refreshed.status === 'completed') {
            setStep('complete');
          } else {
            setError('이 클래스는 이미 종료되었거나 취소되었습니다.');
          }
          return;
        }
      } catch (refreshError) {
        if (cancelled) return;
        if (refreshError instanceof ApiError && refreshError.status === 404) {
          setError('클래스 정보를 더 이상 찾을 수 없습니다.');
        }
      }
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 3000);

    return () => { cancelled = true; window.clearInterval(intervalId); };
  }, [code, participantId, session?.id, step]);

  // meditation 중 completed 감지
  useEffect(() => {
    if (step !== 'meditation' || !session) return undefined;

    const refresh = async (): Promise<void> => {
      try {
        if (participantId) {
          try {
            const state = await getSessionByCodeState(code, participantId);
            if (typeof state.relaxation_index === 'number') {
              setRelaxationIndex(state.relaxation_index);
            }
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

  // 실제 참여(join) 수행 — 게스트는 이름 검증 후, 회원은 자동 참여 경로에서도 공용으로 쓴다
  const performJoin = useCallback(async (): Promise<void> => {
    if (!session) return;

    const trimmedGuestName = guestName.trim();
    if (!isLoggedIn && !trimmedGuestName) {
      setError('게스트 참여를 위해 이름을 입력해 주세요.');
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      const birthDateComplete = /^\d{4}-\d{2}-\d{2}$/.test(guestBirthDate)
        ? guestBirthDate
        : undefined;
      const joined = await joinSessionByCode(
        code,
        isLoggedIn
          ? {}
          : {
              name: trimmedGuestName,
              ...(guestGender ? { gender: guestGender } : {}),
              ...(birthDateComplete ? { birth_date: birthDateComplete } : {}),
              ...(participantToken ? { participant_token: participantToken } : {}),
            },
      );
      const nextParticipantId = joined.participant_id;
      const nextToken = joined.participant_token ?? null;
      setParticipantId(nextParticipantId);
      setParticipantToken(nextToken);
      if (nextParticipantId) {
        persistParticipant(code, nextParticipantId, nextToken);
      }
      if (joined.session.duration_min > 0) {
        setDurationMin(joined.session.duration_min);
      }
      // 이미 진행 중이면 세션 상태만 반영한다 — 입장은 대기실 셀프체크(개선 3)를 거친 뒤 결정된다
      if (joined.session.status === 'in_progress' || session.status === 'in_progress') {
        setSession({
          ...session,
          status: 'in_progress',
          started_at: joined.session.started_at ?? session.started_at,
        });
      }
      // 코드 확인 직후 바로 라이브로 들어가지 않는다 — 대기실에서 닉네임·기기·주변을 확인한다
      setStep('waiting');
    } catch (joinError) {
      setError(errorMessage(joinError, '클래스 참여에 실패했습니다. 클래스 상태를 확인한 뒤 다시 시도해 주세요.'));
    } finally {
      setIsLoading(false);
    }
  }, [session, isLoggedIn, guestName, guestGender, guestBirthDate, code]);

  const handleJoinSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await performJoin();
  };

  // 로그인 회원은 details 단계에서 자동 참여 — "세션 입장하기"→"클래스 참여하기" 이중 확인 제거.
  // 오픈 전이면 3초 폴링이 session.status 를 갱신해 이 effect가 재실행되며 자동 입장된다.
  useEffect(() => {
    if (step !== 'details' || !session || !isLoggedIn) return;
    if (isClosed(session) || isPreOpen(session)) return;
    // effect 본문에서 동기 setState를 호출하지 않도록 다음 틱으로 미룬다(react-hooks/set-state-in-effect 회피).
    const timer = window.setTimeout(() => {
      void performJoin();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, session?.id, session?.status, isLoggedIn]);

  const resetJoin = (): void => {
    // 명시적 종료 시 전역 BLE 연결 정리 (unmount에선 끊지 않으므로 여기서 명시적으로 해제)
    void bluetoothService.disconnect().catch(() => undefined);
    setStep('code');
    setSession(null);
    setGuestName('');
    setGuestGender('');
    setGuestBirthDate('');
    setParticipantId(null);
    setParticipantToken(null);
    setDurationMin(50);
    setRelaxationIndex(null);
    setError(null);
    clearPersistedParticipant();
    // 개선 3: 대기실에서 확정한 닉네임도 함께 정리 — 다음 참여는 입력 단계부터 시작한다
    clearStoredNickname();
  };

  // 진행 씬 — 검정 풀블리드 immersive (SDD-029, SDD-088: 플레이어 씬으로 이전)
  if (step === 'meditation' && session) {
    return (
      <MemberSessionScene
        title={session.title}
        startedAt={session.started_at}
        durationMin={durationMin}
        sessionId={session.id}
        participantId={participantId}
        error={error}
        onLeave={resetJoin}
        classCode={code}
        participantToken={participantToken}
        locationType={session.location_type}
        participantMode={session.participant_mode}
        maxParticipants={session.max_participants}
      />
    );
  }

  // 완료 화면 — #F5EDFC + 리포트 메일 (SDD-029 P1)
  if (step === 'complete') {
    return (
      <GuestCompletePanel
        sessionId={session?.id ?? null}
        sessionTitle={session?.title ?? null}
        participantId={participantId}
        participantToken={participantToken}
        accountEmail={isLoggedIn ? (user?.email ?? null) : null}
        isLoggedIn={isLoggedIn}
        error={error}
        onReset={resetJoin}
        relaxationIndex={relaxationIndex}
      />
    );
  }

  // 준비와 시작 대기는 하나의 씬으로 유지해 설문·BLE·미리보기 상태를 보존한다.
  if (step === 'waiting' && session) {
    return (
      <MemberWaitingScene
        title={session.title}
        classCode={code}
        statusLabel={STATUS_LABELS[session.status]}
        sessionId={session.id}
        participantId={participantId}
        memberName={isLoggedIn ? (user?.name ?? null) : null}
        initialNickname={guestName}
        participantToken={participantToken}
        isLoggedIn={isLoggedIn}
        sessionLive={session.status === 'in_progress'}
        error={error}
        onEnter={handleWaitingRoomEnter}
        onLeave={resetJoin}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#FAFAFA] px-5 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-xl">
        <Link to="/" className="inline-flex items-center text-sm font-semibold text-[#5F0080] hover:text-[#4B0066]">
          ← Mind Breeze 홈으로
        </Link>

        <section className="mt-8 rounded-[20px] border border-[#EFEFEF] bg-white p-6 sm:p-10">
          {step === 'code' && (
            <>
              <p className="text-sm font-bold text-[#5F0080]">클래스 코드 참여</p>
              <h1 className="mt-3 text-2xl font-bold tracking-tight text-[#1F1F1F]">클래스에 바로 참여하세요</h1>
              <p className="mt-3 text-base leading-7 text-[#6F6F6F]">
                진행자에게 받은 6자리 클래스 코드를 입력하면, 로그인 또는 게스트로 참여할 수 있습니다.
              </p>

              <form className="mt-8 space-y-5" onSubmit={(e) => void handleCodeSubmit(e)}>
                <div>
                  <label htmlFor="class-code" className="block text-sm font-semibold text-[#1F1F1F]">
                    클래스 코드
                  </label>
                  <input
                    id="class-code"
                    value={code}
                    onChange={(event) => setCode(normalizeCode(event.target.value))}
                    placeholder="예: A1B2C3"
                    maxLength={6}
                    autoComplete="off"
                    className="mt-2 w-full rounded-xl border border-[#D4D4D4] px-4 py-4 text-center font-mono text-2xl font-bold tracking-[0.35em] text-[#1F1F1F] outline-none transition focus:border-[#5F0080] focus:ring-2 focus:ring-[#F5EDFC]"
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
              <p className="text-sm font-bold text-[#5F0080]">참여할 클래스</p>
              <h1 className="mt-3 text-2xl font-bold tracking-tight text-[#1F1F1F]">
                {session.title ?? '제목 없는 클래스'}
              </h1>
              <div className="mt-6 space-y-3 rounded-2xl bg-[#F5EDFC] p-5 text-sm text-[#1F1F1F]">
                <p><span className="font-semibold">유형</span> · {session.custom_type_name ?? TYPE_LABELS[session.type]}</p>
                <p><span className="font-semibold">진행자</span> · {session.host_name ?? '진행자'}</p>
                <p><span className="font-semibold">상태</span> · {STATUS_LABELS[session.status]}</p>
                <p><span className="font-semibold">참여 인원</span> · {session.participant_count} / {session.max_participants}명</p>
              </div>

              {isLoggedIn ? (
                <div className="mt-7 space-y-4">
                  <p className="rounded-xl bg-[#F5EDFC] px-4 py-3 text-sm text-[#5F0080]">
                    {user?.name
                      ? `프로필에 등록된 이름(${user.name})으로 참여합니다`
                      : '로그인된 계정으로 참여합니다.'}
                  </p>
                  {/* SDD-088: 오픈 전에는 입장 차단 — 3초 폴링으로 오픈을 감지하면 자동 입장 */}
                  {isPreOpen(session) && (
                    <p className="rounded-xl bg-[#FFF4DC] px-4 py-3 text-sm font-medium text-[#8A6B1F]">
                      상담사가 아직 클래스를 열지 않았습니다. 클래스가 열리면 자동으로 입장합니다.
                    </p>
                  )}
                  {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
                  <div className="flex items-center justify-center gap-2 py-2 text-sm text-[#6F6F6F]">
                    {isLoading && (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#5F0080] border-t-transparent" />
                        참여 처리 중...
                      </>
                    )}
                    {!isLoading && isPreOpen(session) && '클래스 오픈 대기 중...'}
                  </div>
                  {error && !isLoading && (
                    <button
                      type="button"
                      onClick={() => void performJoin()}
                      className="mb-btn h-[52px] w-full justify-center rounded-xl px-6 text-base"
                    >
                      다시 시도
                    </button>
                  )}
                  <button type="button" onClick={resetJoin} className="w-full py-2 text-sm font-semibold text-[#6F6F6F] hover:text-[#1F1F1F]">
                    다른 코드 입력하기
                  </button>
                </div>
              ) : (
                <form className="mt-7 space-y-5" onSubmit={(e) => void handleJoinSubmit(e)}>
                  <div>
                    <label htmlFor="guest-name" className="block text-sm font-semibold text-[#1F1F1F]">
                      이름
                    </label>
                    <input
                      id="guest-name"
                      value={guestName}
                      onChange={(event) => setGuestName(event.target.value)}
                      placeholder="클래스에서 사용할 이름"
                      maxLength={80}
                      autoComplete="name"
                      className="mt-2 w-full rounded-xl border border-[#D4D4D4] px-4 py-3 text-base text-[#1F1F1F] outline-none transition focus:border-[#5F0080] focus:ring-2 focus:ring-[#F5EDFC]"
                    />
                    <p className="mt-2 text-xs leading-5 text-[#6F6F6F]">로그인하지 않아도 이름만 입력하면 게스트로 참여할 수 있습니다.</p>
                  </div>

                  {/* SDD-062: 성별·생년월일 — 선택 필드, 온보딩 값 규약 동일 / 모바일 1열·md+ 2열 */}
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div>
                      <label htmlFor="guest-gender" className="block text-sm font-semibold text-[#1F1F1F]">
                        성별 <span className="font-normal text-[#9B9B9B]">(선택)</span>
                      </label>
                      <select
                        id="guest-gender"
                        value={guestGender}
                        onChange={(event) => setGuestGender(event.target.value)}
                        className="mt-2 w-full rounded-xl border border-[#D4D4D4] px-4 py-3 text-base text-[#1F1F1F] outline-none transition focus:border-[#5F0080] focus:ring-2 focus:ring-[#F5EDFC]"
                      >
                        <option value="">선택해주세요</option>
                        <option value="male">남성</option>
                        <option value="female">여성</option>
                        <option value="other">기타</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-[#1F1F1F]">
                        생년월일 <span className="font-normal text-[#9B9B9B]">(선택)</span>
                      </label>
                      <div className="mt-2 grid grid-cols-3 gap-2 max-[360px]:grid-cols-1">
                        <select
                          aria-label="생년"
                          value={guestBirthDate ? guestBirthDate.split('-')[0] : ''}
                          onChange={(event) => {
                            const [, m, d] = (guestBirthDate || '--').split('-');
                            setGuestBirthDate(`${event.target.value}-${m || ''}-${d || ''}`);
                          }}
                          className="w-full rounded-xl border border-[#D4D4D4] px-2 py-3 text-center text-sm text-[#1F1F1F] outline-none transition focus:border-[#5F0080] focus:ring-2 focus:ring-[#F5EDFC] sm:text-base"
                        >
                          <option value="">년</option>
                          {Array.from({ length: 100 }, (_, i) => 2026 - i).map((y) => (
                            <option key={y} value={y}>{y}년</option>
                          ))}
                        </select>
                        <select
                          aria-label="생월"
                          value={guestBirthDate ? guestBirthDate.split('-')[1] : ''}
                          onChange={(event) => {
                            const [y, , d] = (guestBirthDate || '--').split('-');
                            setGuestBirthDate(`${y || ''}-${event.target.value}-${d || ''}`);
                          }}
                          className="w-full rounded-xl border border-[#D4D4D4] px-2 py-3 text-center text-sm text-[#1F1F1F] outline-none transition focus:border-[#5F0080] focus:ring-2 focus:ring-[#F5EDFC] sm:text-base"
                        >
                          <option value="">월</option>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                            <option key={m} value={String(m).padStart(2, '0')}>{m}월</option>
                          ))}
                        </select>
                        <select
                          aria-label="생일"
                          value={guestBirthDate ? guestBirthDate.split('-')[2] : ''}
                          onChange={(event) => {
                            const [y, m] = (guestBirthDate || '--').split('-');
                            setGuestBirthDate(`${y || ''}-${m || ''}-${event.target.value}`);
                          }}
                          className="w-full rounded-xl border border-[#D4D4D4] px-2 py-3 text-center text-sm text-[#1F1F1F] outline-none transition focus:border-[#5F0080] focus:ring-2 focus:ring-[#F5EDFC] sm:text-base"
                        >
                          <option value="">일</option>
                          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                            <option key={d} value={String(d).padStart(2, '0')}>{d}일</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* SDD-088: 오픈 전에는 입장 차단 — 3초 폴링으로 오픈을 감지하면 자동 활성화 */}
                  {isPreOpen(session) && (
                    <p className="rounded-xl bg-[#FFF4DC] px-4 py-3 text-sm font-medium text-[#8A6B1F]">
                      상담사가 아직 클래스를 열지 않았습니다. 클래스가 열리면 자동으로 참여
                      버튼이 활성화됩니다.
                    </p>
                  )}
                  {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
                  <button
                    type="submit"
                    disabled={isLoading || isPreOpen(session)}
                    className="mb-btn h-[52px] w-full justify-center rounded-xl px-6 text-base disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isLoading
                      ? '참여 처리 중...'
                      : isPreOpen(session)
                        ? '클래스 오픈 대기 중...'
                        : '클래스 참여하기'}
                  </button>
                  <button type="button" onClick={resetJoin} className="w-full py-2 text-sm font-semibold text-[#6F6F6F] hover:text-[#1F1F1F]">
                    다른 코드 입력하기
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
};

export default ClassJoinPage;
