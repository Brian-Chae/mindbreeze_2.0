// 내담자 온보딩 페이지 (4단계) — 로그인 페이지와 동일한 다크 테마

import { useEffect, useState, useRef } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { StepIndicator } from '../../components/onboarding/StepIndicator';
import { useAuthStore } from '../../stores/authStore';
import { useRequireAuth } from '../../hooks/useAuth';
import { ApiError } from '../../lib/api/client';
import {
  getOnboardingProgress,
  saveClientStep1,
  saveClientStep2,
  saveClientStep3,
  matchClientWithCounselor,
  completeClientOnboarding,
  type ClientMatchResponse,
} from '../../lib/api/onboarding';

const CONCERN_OPTIONS = [
  '우울',
  '불안',
  '스트레스',
  '대인관계',
  '자존감',
  '진로',
  '가족문제',
  '학업',
  '기타',
];

const INTEREST_OPTIONS = ['명상', '인지행동', '마음챙김', '수용전념', '미술치료'];

const STEP_LABELS = ['기본 정보', '상세 정보', '프로필', '상담사 매칭'];

interface FormState {
  name: string;
  phone: string;
  gender: string;
  birthDate: string;
  concerns: string[];
  interests: string[];
  profileImageUrl: string;
  bio: string;
  counselorCode: string;
}

const initialForm: FormState = {
  name: '',
  phone: '',
  gender: '',
  birthDate: '',
  concerns: [],
  interests: [],
  profileImageUrl: '',
  bio: '',
  counselorCode: '',
};

interface MatchInfo extends ClientMatchResponse {
  counselor_code?: string;
  specialties?: string[];
}

const inputClass =
  'w-full h-[52px] rounded-full bg-white/90 backdrop-blur border border-white/30 px-5 text-[15px] text-[#1F1F1F] placeholder:text-[#9A9BA8] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/20 focus:bg-white disabled:opacity-50';

export default function ClientOnboardingPage() {
  useRequireAuth();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [searchParams] = useSearchParams();
  const autoCode = searchParams.get('code') ?? '';
  const autoMatchTriggered = useRef(false);

  const [step, setStep] = useState<number>(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchedCounselor, setMatchedCounselor] = useState<MatchInfo | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getOnboardingProgress();
        if (cancelled) return;
        setStep(Math.min(Math.max(p.current_step, 1), 4));
        const d = p.step_data ?? {};
        setForm((prev) => ({
          ...prev,
          name: (d.name as string) ?? user?.name ?? prev.name,
          phone: (d.phone as string) ?? prev.phone,
          gender: (d.gender as string) ?? prev.gender,
          birthDate: (d.birth_date as string) ?? prev.birthDate,
          concerns: (d.concerns as string[]) ?? prev.concerns,
          interests: (d.interests as string[]) ?? prev.interests,
          profileImageUrl: (d.profile_image_url as string) ?? prev.profileImageUrl,
          bio: (d.bio as string) ?? prev.bio,
        }));
      } catch {
        // 진행 상태 없음
      }
      // 초대 링크에서 전달된 상담사 코드 자동 입력
      if (!cancelled && autoCode.length === 6) {
        setForm((prev) => ({ ...prev, counselorCode: autoCode }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 초대 링크로 들어온 경우 step 4에서 자동 매칭
  useEffect(() => {
    if (step === 4 && form.counselorCode.length === 6 && !autoMatchTriggered.current && !matchedCounselor) {
      autoMatchTriggered.current = true;
      handleMatch();
    }
  }, [step, form.counselorCode]);

  const toggleItem = (field: 'concerns' | 'interests', item: string): void => {
    setForm((f) => ({
      ...f,
      [field]: f[field].includes(item)
        ? f[field].filter((s) => s !== item)
        : [...f[field], item],
    }));
  };

  const markCompleted = (n: number): void => {
    setCompletedSteps((prev) => (prev.includes(n) ? prev : [...prev, n]));
  };

  const handlePhoneChange = (value: string): void => {
    // 숫자만 추출
    const digits = value.replace(/\D/g, '');
    // 자동 형식: 010-XXXX-XXXX
    let formatted = '';
    if (digits.length <= 3) {
      formatted = digits;
    } else if (digits.length <= 7) {
      formatted = `${digits.slice(0, 3)}-${digits.slice(3)}`;
    } else {
      formatted = `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
    }
    setForm({ ...form, phone: formatted });
  };

  const isValidPhone = (phone: string): boolean => {
    return /^010-\d{4}-\d{4}$/.test(phone);
  };

  const handleNext = async (): Promise<void> => {
    setError(null);
    setLoading(true);
    try {
      if (step === 1) {
        if (!form.phone || !isValidPhone(form.phone)) {
          setError('연락처를 010-0000-0000 형식으로 입력해주세요');
          setLoading(false);
          return;
        }
        await saveClientStep1({ phone: form.phone, name: form.name });
        markCompleted(1);
        setStep(2);
      } else if (step === 2) {
        if (!form.gender || !form.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(form.birthDate)) {
          setError('성별과 생년월일을 모두 선택해주세요');
          return;
        }
        await saveClientStep2({
          gender: form.gender,
          birth_date: form.birthDate,
          concerns: form.concerns,
          interests: form.interests,
        });
        markCompleted(2);
        setStep(3);
      } else if (step === 3) {
        await saveClientStep3({
          profile_image_url: form.profileImageUrl,
          bio: form.bio,
        });
        markCompleted(3);
        setStep(4);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handleMatch = async (): Promise<void> => {
    setError(null);
    const code = form.counselorCode.trim();
    if (code.length !== 6) {
      setError('6자리 상담사 코드를 입력해주세요');
      return;
    }
    setLoading(true);
    try {
      const res = await matchClientWithCounselor(code);
      setMatchedCounselor({ ...res, counselor_code: code });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          setError('상담사 코드를 찾을 수 없습니다');
        } else if (err.status === 403) {
          setError('해당 상담사는 아직 인증이 완료되지 않아 매칭할 수 없습니다');
        } else {
          setError(err.message || '매칭에 실패했습니다');
        }
      } else {
        setError('네트워크 오류가 발생했습니다');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async (): Promise<void> => {
    setError(null);
    setLoading(true);
    try {
      await completeClientOnboarding();
      markCompleted(4);

      // 매칭된 상담사 정보로 authStore 업데이트 → /app 에서 연결됨으로 인식
      if (matchedCounselor?.matched_counselor && user) {
        const mc = matchedCounselor.matched_counselor;
        setUser({
          ...user,
          counselors: [
            ...(user.counselors ?? []),
            { id: mc.id, name: mc.name, profile_image: mc.profile_image },
          ],
          onboarding_completed: true,
        });
      }

      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '완료 처리에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handlePrev = (): void => {
    setError(null);
    if (step > 1) setStep(step - 1);
  };

  if (done) {
    return (
      <div className="relative min-h-screen font-sans">
        <img
          src="/mb-design/assets/images/background3.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/40" />
        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center gap-5 px-6">
          {/* 상단 헤더 */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-5">
            <Link
              to="/"
              className="flex items-center gap-2.5 group"
              aria-label="랜딩 페이지로 이동"
            >
              <img
                src="/mb-design/assets/logo_symbol_dark.svg"
                width={32}
                height={14}
                alt=""
                className="brightness-0 invert"
              />
              <span className="font-extrabold text-[17px] text-white tracking-tight opacity-90 group-hover:opacity-100 transition-opacity">
                mind&nbsp;breeze
              </span>
            </Link>
          </div>

          {/* 중앙 로고 */}
          <img
            src="/mb-design/assets/logo_symbol_dark.svg"
            width={84}
            height={38}
            alt=""
            className="brightness-0 invert"
          />
          <div className="font-extrabold text-[32px] text-white tracking-tight">
            mind&nbsp;breeze
          </div>

          <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">온보딩 완료</h1>
          <p className="text-[15px] text-white/70 text-center">
            상담사와 매칭되었습니다. 이제 세션을 시작할 수 있습니다.
          </p>
          <button
            type="button"
            onClick={() => navigate('/app')}
            className="h-[52px] w-[280px] rounded-full bg-[#5F0080] hover:bg-[#4B0066] text-white font-semibold text-[15px] transition-colors"
          >
            대시보드로 이동
          </button>
        </div>
      </div>
    );
  }

  const concernBtnClass = (selected: boolean) =>
    `rounded-full px-4 py-2.5 text-[14px] font-medium transition-colors ${
      selected
        ? 'bg-[#5F0080] text-white'
        : 'bg-white/10 text-white/80 border border-white/20 hover:bg-white/20'
    }`;

  return (
    <div className="relative min-h-screen font-sans">
      <img
        src="/mb-design/assets/images/background3.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/40" />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center gap-6 px-6 py-10">
        {/* 상단 헤더 — 로그인 페이지와 동일 */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-5">
          <Link
            to="/"
            className="flex items-center gap-2.5 group"
            aria-label="랜딩 페이지로 이동"
          >
            <img
              src="/mb-design/assets/logo_symbol_dark.svg"
              width={32}
              height={14}
              alt=""
              className="brightness-0 invert"
            />
            <span className="font-extrabold text-[17px] text-white tracking-tight opacity-90 group-hover:opacity-100 transition-opacity">
              mind&nbsp;breeze
            </span>
          </Link>
          <Link
            to="/login"
            className="text-[13px] text-white/90 hover:text-white font-medium px-4 py-2 rounded-full border border-white/30 hover:border-white/60 transition-colors"
          >
            상담사 로그인
          </Link>
        </div>

        {/* 중앙 로고 — 로그인 페이지와 동일 */}
        <img
          src="/mb-design/assets/logo_symbol_dark.svg"
          width={84}
          height={38}
          alt=""
          className="brightness-0 invert"
        />
        <div className="font-extrabold text-[32px] text-white tracking-tight">
          mind&nbsp;breeze
        </div>
        <p className="text-[15px] text-white/85">내담자 온보딩</p>

        {/* 카드 */}
        <div className="w-full max-w-[360px] bg-white/10 backdrop-blur-xl border border-white/20 rounded-[28px] p-6 shadow-2xl shadow-black/20">
          {/* Step 인디케이터 */}
          <div className="mb-5">
            <StepIndicator currentStep={step} completedSteps={completedSteps} labels={STEP_LABELS} />
          </div>

          <h2 className="text-lg font-bold text-white mb-5">
            {step === 1 && '기본 정보'}
            {step === 2 && '상세 정보'}
            {step === 3 && '프로필'}
            {step === 4 && '상담사 코드 매칭'}
          </h2>

          {/* Step 1: 기본 정보 */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-[13px] text-white/60 mb-1.5 ml-1">이름</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="이름을 입력해주세요"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[13px] text-white/60 mb-1.5 ml-1">
                  연락처
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  placeholder="010-0000-0000"
                  maxLength={13}
                  className={inputClass}
                />
              </div>
            </div>
          )}

          {/* Step 2: 상세 정보 */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-[13px] text-white/60 mb-1.5 ml-1">성별</label>
                <select
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  className={inputClass}
                >
                  <option value="">선택해주세요</option>
                  <option value="male">남성</option>
                  <option value="female">여성</option>
                  <option value="other">기타</option>
                </select>
              </div>
              <div>
                <label className="block text-[13px] text-white/60 mb-1.5 ml-1">생년월일</label>
                <div className="flex gap-2">
                  <select
                    value={form.birthDate ? form.birthDate.split('-')[0] : ''}
                    onChange={(e) => {
                      const [_, m, d] = (form.birthDate || '--').split('-');
                      setForm({ ...form, birthDate: `${e.target.value}-${m || ''}-${d || ''}` });
                    }}
                    className="flex-1 h-[52px] rounded-full bg-white/90 backdrop-blur border border-white/30 px-3 text-[15px] text-[#1F1F1F] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/20 focus:bg-white appearance-none text-center"
                  >
                    <option value="">년</option>
                    {Array.from({ length: 100 }, (_, i) => 2026 - i).map((y) => (
                      <option key={y} value={y}>{y}년</option>
                    ))}
                  </select>
                  <select
                    value={form.birthDate ? form.birthDate.split('-')[1] : ''}
                    onChange={(e) => {
                      const [y, _, d] = (form.birthDate || '--').split('-');
                      setForm({ ...form, birthDate: `${y || ''}-${e.target.value}-${d || ''}` });
                    }}
                    className="flex-1 h-[52px] rounded-full bg-white/90 backdrop-blur border border-white/30 px-3 text-[15px] text-[#1F1F1F] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/20 focus:bg-white appearance-none text-center"
                  >
                    <option value="">월</option>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={String(m).padStart(2, '0')}>{m}월</option>
                    ))}
                  </select>
                  <select
                    value={form.birthDate ? form.birthDate.split('-')[2] : ''}
                    onChange={(e) => {
                      const [y, m] = (form.birthDate || '--').split('-');
                      setForm({ ...form, birthDate: `${y || ''}-${m || ''}-${e.target.value}` });
                    }}
                    className="flex-1 h-[52px] rounded-full bg-white/90 backdrop-blur border border-white/30 px-3 text-[15px] text-[#1F1F1F] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/20 focus:bg-white appearance-none text-center"
                  >
                    <option value="">일</option>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={String(d).padStart(2, '0')}>{d}일</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <p className="text-[13px] text-white/70 font-semibold mb-2">주요 호소 (다중 선택)</p>
                <div className="flex flex-wrap gap-2">
                  {CONCERN_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggleItem('concerns', opt)}
                      className={concernBtnClass(form.concerns.includes(opt))}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[13px] text-white/70 font-semibold mb-2">관심 영역 (선택)</p>
                <div className="flex flex-wrap gap-2">
                  {INTEREST_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggleItem('interests', opt)}
                      className={concernBtnClass(form.interests.includes(opt))}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: 프로필 */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-[13px] text-white/60 mb-1.5 ml-1">
                  프로필 사진 URL <span className="text-white/30">(선택)</span>
                </label>
                <input
                  type="url"
                  value={form.profileImageUrl}
                  onChange={(e) => setForm({ ...form, profileImageUrl: e.target.value })}
                  placeholder="https://..."
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-[13px] text-white/60 mb-1.5 ml-1">
                  한줄 소개 <span className="text-white/30">(선택)</span>
                </label>
                <textarea
                  value={form.bio}
                  onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  rows={3}
                  placeholder="자기소개를 입력해주세요"
                  className="w-full rounded-2xl bg-white/90 backdrop-blur border border-white/30 px-5 py-3 text-[15px] text-[#1F1F1F] placeholder:text-[#9A9BA8] resize-none outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/20 focus:bg-white"
                />
              </div>
            </div>
          )}

          {/* Step 4: 상담사 코드 매칭 */}
          {step === 4 && (
            <div className="space-y-4">
              {!matchedCounselor ? (
                <>
                  <div>
                    <label className="block text-[13px] text-white/60 mb-1.5 ml-1">
                      상담사 코드 (6자리)
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      value={form.counselorCode}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          counselorCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                        })
                      }
                      placeholder="ABC123"
                      className="w-full h-[52px] rounded-full bg-white/90 backdrop-blur border border-white/30 px-5 text-center text-xl font-bold tracking-[0.3em] text-[#1F1F1F] placeholder:text-[#9A9BA8] placeholder:tracking-normal outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/20 focus:bg-white"
                    />
                  </div>
                  <p className="text-[13px] text-white/60 text-center">
                    상담사로부터 전달받은 6자리 코드를 입력해주세요.
                  </p>
                </>
              ) : (
                <div className="rounded-2xl bg-white/10 border border-white/20 p-5 space-y-3">
                  <p className="text-sm font-semibold text-[#C38BFF]">매칭된 상담사</p>
                  <div>
                    <p className="text-xs text-white/40">이름</p>
                    <p className="text-lg font-semibold text-white">
                      {matchedCounselor.matched_counselor?.name}
                    </p>
                  </div>
                  {matchedCounselor.counselor_code && (
                    <div>
                      <p className="text-xs text-white/40">코드</p>
                      <p className="text-base font-mono text-white tracking-widest">
                        {matchedCounselor.counselor_code}
                      </p>
                    </div>
                  )}
                  {matchedCounselor.specialties && matchedCounselor.specialties.length > 0 && (
                    <div>
                      <p className="text-xs text-white/40">전문분야</p>
                      <p className="text-sm text-white/80">
                        {matchedCounselor.specialties.join(', ')}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 에러 표시 */}
          {error && (
            <div className="mt-4">
              <p className="text-[13px] text-white bg-red-500/70 backdrop-blur rounded-full px-4 py-1.5 text-center" role="alert">
                {error}
              </p>
            </div>
          )}

          {/* 버튼 영역 */}
          <div className="flex items-center gap-3 mt-5">
            <button
              type="button"
              onClick={handlePrev}
              disabled={loading || step === 1}
              className="flex-shrink-0 h-[44px] px-5 rounded-full bg-white/10 border border-white/20 hover:bg-white/20 hover:border-white/30 disabled:opacity-30 text-white/80 text-[14px] font-medium transition-colors"
            >
              이전
            </button>

            <div className="flex-1">
              {step < 4 && (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={loading}
                  className="w-full h-[44px] rounded-full bg-[#5F0080] hover:bg-[#4B0066] active:bg-[#3F0055] disabled:opacity-60 text-white font-semibold text-[15px] transition-colors"
                >
                  {loading ? '저장 중...' : '다음'}
                </button>
              )}
              {step === 4 && !matchedCounselor && (
                <button
                  type="button"
                  onClick={handleMatch}
                  disabled={loading}
                  className="w-full h-[44px] rounded-full bg-[#5F0080] hover:bg-[#4B0066] active:bg-[#3F0055] disabled:opacity-60 text-white font-semibold text-[15px] transition-colors"
                >
                  {loading ? '매칭 중...' : '매칭하기'}
                </button>
              )}
              {step === 4 && matchedCounselor && (
                <button
                  type="button"
                  onClick={handleComplete}
                  disabled={loading}
                  className="w-full h-[44px] rounded-full bg-[#5F0080] hover:bg-[#4B0066] active:bg-[#3F0055] disabled:opacity-60 text-white font-semibold text-[15px] transition-colors"
                >
                  {loading ? '처리 중...' : '완료'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
