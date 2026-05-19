// 내담자 온보딩 페이지 (4단계)

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

export default function ClientOnboardingPage() {
  useRequireAuth();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

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
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const handleNext = async (): Promise<void> => {
    setError(null);
    setLoading(true);
    try {
      if (step === 1) {
        await saveClientStep1({ phone: form.phone });
        markCompleted(1);
        setStep(2);
      } else if (step === 2) {
        if (!form.gender || !form.birthDate) {
          setError('성별과 생년월일을 입력해주세요');
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
      <div className="min-h-screen flex items-center justify-center bg-surface-canvas p-4">
        <div className="w-full max-w-[480px] bg-surface-raised rounded-2xl border border-border-default p-8 space-y-6 text-center">
          <h1 className="text-2xl font-bold text-ink-primary">온보딩 완료</h1>
          <p className="text-sm text-ink-secondary">
            상담사와 매칭되었습니다. 이제 세션을 시작할 수 있습니다.
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="w-full h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90"
          >
            대시보드로 이동
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-canvas p-4 sm:p-8">
      <div className="w-full max-w-[600px] space-y-8">
        <div className="text-center space-y-2">
          <Link to="/" className="inline-block">
            <h1 className="font-display text-3xl font-light text-ink-primary tracking-tight">
              Mind Breeze
            </h1>
          </Link>
          <p className="text-sm text-ink-tertiary">내담자 온보딩</p>
        </div>

        <div className="bg-surface-raised rounded-2xl border border-border-default p-6 sm:p-8 space-y-6">
          <StepIndicator currentStep={step} completedSteps={completedSteps} labels={STEP_LABELS} />

          <h2 className="text-2xl font-bold text-ink-primary">
            {step === 1 && '기본 정보'}
            {step === 2 && '상세 정보'}
            {step === 3 && '프로필'}
            {step === 4 && '상담사 코드 매칭'}
          </h2>

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-ink-secondary">이름</label>
                <input
                  type="text"
                  value={user?.name ?? ''}
                  readOnly
                  className="w-full rounded-lg border border-border-default bg-surface-raised px-4 py-3 text-sm text-ink-primary opacity-70"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-ink-secondary">
                  연락처 (선택)
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="010-0000-0000"
                  className="w-full rounded-lg border border-border-default bg-surface-raised px-4 py-3 text-sm text-ink-primary"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-ink-secondary">성별</label>
                <select
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  className="w-full rounded-lg border border-border-default bg-surface-raised px-4 py-3 text-sm text-ink-primary"
                >
                  <option value="">선택해주세요</option>
                  <option value="male">남성</option>
                  <option value="female">여성</option>
                  <option value="other">기타</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-ink-secondary">생년월일</label>
                <input
                  type="date"
                  value={form.birthDate}
                  onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                  className="w-full rounded-lg border border-border-default bg-surface-raised px-4 py-3 text-sm text-ink-primary"
                />
              </div>
              <div className="space-y-2">
                <p className="text-base font-semibold text-accent-warm">주요 호소 (다중 선택)</p>
                <div className="grid grid-cols-2 gap-2">
                  {CONCERN_OPTIONS.map((opt) => (
                    <label
                      key={opt}
                      className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-sm text-ink-primary cursor-pointer hover:border-brand-primary"
                    >
                      <input
                        type="checkbox"
                        checked={form.concerns.includes(opt)}
                        onChange={() => toggleItem('concerns', opt)}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-base font-semibold text-accent-warm">관심 영역 (선택)</p>
                <div className="grid grid-cols-2 gap-2">
                  {INTEREST_OPTIONS.map((opt) => (
                    <label
                      key={opt}
                      className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-sm text-ink-primary cursor-pointer hover:border-brand-primary"
                    >
                      <input
                        type="checkbox"
                        checked={form.interests.includes(opt)}
                        onChange={() => toggleItem('interests', opt)}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-ink-secondary">
                  프로필 사진 URL (선택)
                </label>
                <input
                  type="url"
                  value={form.profileImageUrl}
                  onChange={(e) => setForm({ ...form, profileImageUrl: e.target.value })}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-border-default bg-surface-raised px-4 py-3 text-sm text-ink-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-ink-secondary">
                  한줄 소개 (선택)
                </label>
                <textarea
                  value={form.bio}
                  onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-border-default bg-surface-raised px-4 py-3 text-sm text-ink-primary resize-none"
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              {!matchedCounselor ? (
                <>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-ink-secondary">
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
                      className="w-full rounded-lg border border-border-default bg-surface-raised px-4 py-3 text-center text-xl font-bold tracking-widest text-ink-primary"
                    />
                  </div>
                  <p className="text-xs text-ink-tertiary">
                    상담사로부터 전달받은 6자리 코드를 입력해주세요.
                  </p>
                </>
              ) : (
                <div className="space-y-3 bg-surface-raised rounded-lg border border-border-default p-5">
                  <p className="text-base font-semibold text-accent-warm">매칭된 상담사</p>
                  <div className="space-y-1">
                    <p className="text-sm text-ink-tertiary">이름</p>
                    <p className="text-lg font-semibold text-ink-primary">
                      {matchedCounselor.matched_counselor?.name}
                    </p>
                  </div>
                  {matchedCounselor.counselor_code && (
                    <div className="space-y-1">
                      <p className="text-sm text-ink-tertiary">코드</p>
                      <p className="text-base font-mono text-ink-primary tracking-widest">
                        {matchedCounselor.counselor_code}
                      </p>
                    </div>
                  )}
                  {matchedCounselor.specialties && matchedCounselor.specialties.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-sm text-ink-tertiary">전문분야</p>
                      <p className="text-sm text-ink-primary">
                        {matchedCounselor.specialties.join(', ')}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handlePrev}
              disabled={loading || step === 1}
              className="flex-1 h-11 rounded-pill border border-border-default text-ink-secondary font-semibold hover:bg-surface-elevated disabled:opacity-40"
            >
              이전
            </button>
            {step < 4 && (
              <button
                type="button"
                onClick={handleNext}
                disabled={loading}
                className="flex-1 h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {loading ? '저장 중...' : '다음'}
              </button>
            )}
            {step === 4 && !matchedCounselor && (
              <button
                type="button"
                onClick={handleMatch}
                disabled={loading}
                className="flex-1 h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {loading ? '매칭 중...' : '매칭하기'}
              </button>
            )}
            {step === 4 && matchedCounselor && (
              <button
                type="button"
                onClick={handleComplete}
                disabled={loading}
                className="flex-1 h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {loading ? '처리 중...' : '완료'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
