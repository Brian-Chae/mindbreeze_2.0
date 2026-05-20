// 상담사 온보딩 페이지 (4단계) — UI Kit 보라색 스타일

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
  phone: string;
  gender: string;
  birthDate: string;
  experienceYears: string;
  specialties: string[];
  affiliationType: string;
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

const INPUT_CLS =
  'w-full rounded-xl border border-[#DDDEE7] bg-white px-4 py-3 text-sm text-[#1F1F1F] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-purple-900/15 transition';

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
          experienceYears:
            d.experience_years != null ? String(d.experience_years) : prev.experienceYears,
          specialties: (d.specialties as string[]) ?? prev.specialties,
          affiliationType: (d.affiliation_type as string) ?? prev.affiliationType,
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

  if (result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5EDFC] p-4 font-sans">
        <div className="w-full max-w-[480px] bg-white rounded-[20px] border border-[#EFEFEF] shadow-sm p-8 space-y-6 text-center">
          <h1 className="text-2xl font-bold text-[#1F1F1F]">온보딩 완료</h1>
          <p className="text-sm text-[#6F6F6F]">
            상담사 등록이 완료되었습니다. 아래 코드를 내담자에게 공유하세요.
          </p>
          <div className="bg-[#F5EDFC] rounded-xl border border-[#EFEFEF] p-6 space-y-2">
            <p className="text-xs text-[#6F6F6F] font-mono uppercase tracking-wider">상담사 코드</p>
            <p className="text-3xl font-bold tracking-widest text-[#5F0080]">
              {result.counselor_code}
            </p>
            <p className="text-xs text-[#6F6F6F]">인증 등급: {result.verified_tier}</p>
          </div>
          <button type="button" onClick={() => navigate('/')} className="mb-btn w-full">
            대시보드로 이동
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5EDFC] p-4 sm:p-8 font-sans text-[#1F1F1F]">
      <div className="w-full max-w-[600px] space-y-8">
        <div className="text-center space-y-2">
          <Link to="/" className="inline-block">
            <h1 className="text-3xl font-extrabold tracking-tight text-[#5F0080]">
              mind breeze
            </h1>
          </Link>
          <p className="text-sm text-[#6F6F6F]">상담사 온보딩</p>
        </div>

        <div className="bg-white rounded-[20px] border border-[#EFEFEF] shadow-sm p-6 sm:p-8 space-y-6">
          <StepIndicator currentStep={step} completedSteps={completedSteps} labels={STEP_LABELS} />

          <h2 className="text-2xl font-bold text-[#1F1F1F]">
            {step === 1 && '기본 정보'}
            {step === 2 && '상세 정보'}
            {step === 3 && '자격 증빙'}
            {step === 4 && '프로필'}
          </h2>

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-[#6F6F6F]">이름</label>
                <input
                  type="text"
                  value={user?.name ?? ''}
                  readOnly
                  className={`${INPUT_CLS} opacity-70`}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="phone" className="block text-sm font-semibold text-[#6F6F6F]">
                  연락처 (선택)
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="010-0000-0000"
                  className={INPUT_CLS}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-[#6F6F6F]">성별</label>
                <select
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  className={INPUT_CLS}
                >
                  <option value="">선택해주세요</option>
                  <option value="male">남성</option>
                  <option value="female">여성</option>
                  <option value="other">기타</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-[#6F6F6F]">생년월일</label>
                <input
                  type="date"
                  value={form.birthDate}
                  onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                  className={INPUT_CLS}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-[#6F6F6F]">경력연수</label>
                <input
                  type="number"
                  min="0"
                  value={form.experienceYears}
                  onChange={(e) => setForm({ ...form, experienceYears: e.target.value })}
                  className={INPUT_CLS}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold text-[#6F6F6F]">전문분야 (다중 선택)</p>
                <div className="grid grid-cols-2 gap-2">
                  {SPECIALTY_OPTIONS.map((opt) => (
                    <label
                      key={opt}
                      className="flex items-center gap-2 rounded-xl border border-[#DDDEE7] bg-white px-3 py-2.5 text-sm text-[#1F1F1F] cursor-pointer hover:border-[#5F0080] transition"
                    >
                      <input
                        type="checkbox"
                        checked={form.specialties.includes(opt)}
                        onChange={() => toggleSpecialty(opt)}
                        className="accent-purple-900"
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
                <label className="block text-sm font-semibold text-[#6F6F6F]">소속형태</label>
                <select
                  value={form.affiliationType}
                  onChange={(e) => setForm({ ...form, affiliationType: e.target.value })}
                  className={INPUT_CLS}
                >
                  <option value="">선택해주세요</option>
                  <option value="center">센터 소속</option>
                  <option value="freelance">프리랜서</option>
                </select>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold text-[#6F6F6F]">자격증 업로드</p>
                <div className="rounded-xl border border-dashed border-[#DDDEE7] bg-[#F5EDFC]/40 px-4 py-8 text-center text-sm text-[#6F6F6F]">
                  자격증 파일 업로드 기능은 준비 중입니다.
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-[#6F6F6F]">
                  프로필 사진 URL (선택)
                </label>
                <input
                  type="url"
                  value={form.profileImageUrl}
                  onChange={(e) => setForm({ ...form, profileImageUrl: e.target.value })}
                  placeholder="https://..."
                  className={INPUT_CLS}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-[#6F6F6F]">
                  한줄 소개 (선택)
                </label>
                <textarea
                  value={form.bio}
                  onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  rows={3}
                  className={`${INPUT_CLS} resize-none`}
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
              className="mb-btn mb-btn--ghost flex-1 disabled:opacity-40"
            >
              이전
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={loading}
              className="mb-btn flex-1 disabled:opacity-50"
            >
              {loading ? '저장 중...' : step === 4 ? '완료' : '다음'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
