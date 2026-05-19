// 상담사 온보딩 페이지 (4단계)

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StepIndicator } from '../../components/onboarding/StepIndicator';
import { useAuthStore } from '../../stores/authStore';
import { useRequireAuth } from '../../hooks/useAuth';
import {
  getOnboardingProgress,
  saveCounselorStep1,
  saveCounselorStep2,
  saveCounselorStep3,
  saveCounselorStep4,
  completeCounselorOnboarding,
  type CounselorCompleteResponse,
} from '../../lib/api/onboarding';

const SPECIALTY_OPTIONS = [
  '우울증',
  '불안',
  '트라우마',
  '관계',
  '중독',
  '진로',
  '자존감',
  '가족',
  '기타',
];

const STEP_LABELS = ['기본 정보', '상세 정보', '자격 증빙', '프로필'];

interface FormState {
  // Step 1
  phone: string;
  // Step 2
  gender: string;
  birthDate: string;
  experienceYears: string;
  specialties: string[];
  // Step 3
  affiliationType: string;
  // Step 4
  profileImageUrl: string;
  bio: string;
}

const initialForm: FormState = {
  phone: '',
  gender: '',
  birthDate: '',
  experienceYears: '',
  specialties: [],
  affiliationType: '',
  profileImageUrl: '',
  bio: '',
};

export default function CounselorOnboardingPage() {
  useRequireAuth();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [step, setStep] = useState<number>(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CounselorCompleteResponse | null>(null);

  // 마운트 시 진행 상태 복원
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getOnboardingProgress();
        if (cancelled) return;
        if (p.role === 'counselor') {
          setStep(Math.min(Math.max(p.current_step, 1), 4));
          setCompletedSteps(p.completed_steps ?? []);
          const d = p.data ?? {};
          setForm((prev) => ({
            ...prev,
            phone: (d.phone as string) ?? prev.phone,
            gender: (d.gender as string) ?? prev.gender,
            birthDate: (d.birth_date as string) ?? prev.birthDate,
            experienceYears:
              d.experience_years != null ? String(d.experience_years) : prev.experienceYears,
            specialties: (d.specialties as string[]) ?? prev.specialties,
            affiliationType: (d.affiliation_type as string) ?? prev.affiliationType,
            profileImageUrl: (d.profile_image_url as string) ?? prev.profileImageUrl,
            bio: (d.bio as string) ?? prev.bio,
          }));
        }
      } catch {
        // 진행 상태 없음 → step 1 유지
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSpecialty = (item: string): void => {
    setForm((f) => ({
      ...f,
      specialties: f.specialties.includes(item)
        ? f.specialties.filter((s) => s !== item)
        : [...f.specialties, item],
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
        await saveCounselorStep1({ phone: form.phone });
        markCompleted(1);
        setStep(2);
      } else if (step === 2) {
        if (!form.gender || !form.birthDate || !form.experienceYears) {
          setError('성별, 생년월일, 경력연수를 모두 입력해주세요');
          return;
        }
        await saveCounselorStep2({
          gender: form.gender,
          birth_date: form.birthDate,
          experience_years: Number(form.experienceYears),
          specialties: form.specialties,
        });
        markCompleted(2);
        setStep(3);
      } else if (step === 3) {
        if (!form.affiliationType) {
          setError('소속형태를 선택해주세요');
          return;
        }
        await saveCounselorStep3({ affiliation_type: form.affiliationType });
        markCompleted(3);
        setStep(4);
      } else if (step === 4) {
        await saveCounselorStep4({
          profile_image_url: form.profileImageUrl,
          bio: form.bio,
        });
        markCompleted(4);
        const res = await completeCounselorOnboarding();
        setResult(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handlePrev = (): void => {
    setError(null);
    if (step > 1) setStep(step - 1);
  };

  // 완료 결과 화면
  if (result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-canvas p-4">
        <div className="w-full max-w-[480px] bg-surface-raised rounded-2xl border border-border-default p-8 space-y-6 text-center">
          <h1 className="text-2xl font-bold text-ink-primary">온보딩 완료</h1>
          <p className="text-sm text-ink-secondary">
            상담사 등록이 완료되었습니다. 아래 코드를 내담자에게 공유하세요.
          </p>
          <div className="bg-surface-raised rounded-lg border border-border-default p-6 space-y-2">
            <p className="text-xs text-ink-tertiary">상담사 코드</p>
            <p className="text-3xl font-bold tracking-widest text-brand-deep">
              {result.counselor_code}
            </p>
            <p className="text-xs text-ink-tertiary">인증 등급: {result.verified_tier}</p>
          </div>
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
          <p className="text-sm text-ink-tertiary">상담사 온보딩</p>
        </div>

        <div className="bg-surface-raised rounded-2xl border border-border-default p-6 sm:p-8 space-y-6">
          <StepIndicator currentStep={step} completedSteps={completedSteps} labels={STEP_LABELS} />

          <h2 className="text-2xl font-bold text-ink-primary">
            {step === 1 && '기본 정보'}
            {step === 2 && '상세 정보'}
            {step === 3 && '자격 증빙'}
            {step === 4 && '프로필'}
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
                <label htmlFor="phone" className="block text-sm font-medium text-ink-secondary">
                  연락처 (선택)
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="010-0000-0000"
                  className="w-full rounded-lg border border-border-default bg-surface-raised px-4 py-3 text-sm text-ink-primary outline-none focus:border-brand-primary"
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
                <label className="block text-sm font-medium text-ink-secondary">경력연수</label>
                <input
                  type="number"
                  min="0"
                  value={form.experienceYears}
                  onChange={(e) => setForm({ ...form, experienceYears: e.target.value })}
                  className="w-full rounded-lg border border-border-default bg-surface-raised px-4 py-3 text-sm text-ink-primary"
                />
              </div>
              <div className="space-y-2">
                <p className="text-base font-semibold text-accent-warm">전문분야 (다중 선택)</p>
                <div className="grid grid-cols-2 gap-2">
                  {SPECIALTY_OPTIONS.map((opt) => (
                    <label
                      key={opt}
                      className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-sm text-ink-primary cursor-pointer hover:border-brand-primary"
                    >
                      <input
                        type="checkbox"
                        checked={form.specialties.includes(opt)}
                        onChange={() => toggleSpecialty(opt)}
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
                <label className="block text-sm font-medium text-ink-secondary">소속형태</label>
                <select
                  value={form.affiliationType}
                  onChange={(e) => setForm({ ...form, affiliationType: e.target.value })}
                  className="w-full rounded-lg border border-border-default bg-surface-raised px-4 py-3 text-sm text-ink-primary"
                >
                  <option value="">선택해주세요</option>
                  <option value="center">센터 소속</option>
                  <option value="freelance">프리랜서</option>
                </select>
              </div>
              <div className="space-y-2">
                <p className="text-base font-semibold text-accent-warm">자격증 업로드</p>
                <div className="rounded-lg border border-dashed border-border-default bg-surface-raised px-4 py-6 text-center text-sm text-ink-tertiary">
                  자격증 파일 업로드 기능은 준비 중입니다.
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
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
            <button
              type="button"
              onClick={handleNext}
              disabled={loading}
              className="flex-1 h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {loading ? '저장 중...' : step === 4 ? '완료' : '다음'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
