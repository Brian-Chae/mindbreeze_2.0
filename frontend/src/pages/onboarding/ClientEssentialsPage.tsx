// Google OAuth 회원가입 직후 필수 정보 입력 페이지
// 내담자 온보딩의 마지막 단계

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useRequireAuth } from '../../hooks/useAuth';
import { apiClient, ApiError } from '../../lib/api/client';

interface EssentialsForm {
  name: string;
  gender: string;
  birthDate: string;
  phone: string;
}

export default function ClientEssentialsPage() {
  useRequireAuth();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [form, setForm] = useState<EssentialsForm>({
    name: user?.name ?? '',
    gender: '',
    birthDate: '',
    phone: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 이름, 성별, 생년월일 모두 입력 + 전화번호 선택
  const isFormValid = form.name.trim() !== '' && form.gender !== '' && form.birthDate !== '';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;

    setError(null);
    setLoading(true);
    try {
      // PATCH /api/v1/auth/users/me — 필수 정보 저장 + 온보딩 완료
      const updatedUser = await apiClient.patch<{
        id: string;
        email: string;
        name: string;
        role: string;
        verified_tier: string;
        onboarding_completed: boolean;
        auth_provider: string;
        counselors: Array<{ id: string; name: string; profile_image: string | null }>;
      }>('/auth/users/me', {
        name: form.name,
        gender: form.gender,
        birth_date: form.birthDate,
        phone: form.phone || undefined,
        onboarding_completed: true,
      });

      // authStore 사용자 정보 갱신
      setUser({
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role as 'counselor' | 'client' | 'admin' | 'org_admin' | 'platform_admin',
        verified_tier: updatedUser.verified_tier as 'unverified' | 'email_verified' | 'fully_verified',
        onboarding_completed: updatedUser.onboarding_completed,
        auth_provider: updatedUser.auth_provider,
        counselors: updatedUser.counselors,
      });

      navigate('/app');
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : '저장에 실패했습니다. 다시 시도해주세요.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
      <div className="w-full max-w-md mx-auto">
        {/* 카드 */}
        <div className="bg-white rounded-2xl shadow-lg p-8 space-y-6">
          {/* 헤더 */}
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-[#1F1F1F]">마지막 단계예요!</h1>
            <p className="text-[15px] text-[#6F6F6F] leading-relaxed">
              원활한 서비스 이용을 위해
              <br />
              아래 정보를 입력해주세요
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 이름 (Google에서 받은 값 pre-fill, readonly) */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[#1F1F1F]">
                이름
              </label>
              <input
                type="text"
                value={form.name}
                readOnly
                className="w-full px-4 py-3 border border-[#D4D4D4] rounded-xl bg-gray-50 text-[#6F6F6F] outline-none cursor-not-allowed"
              />
            </div>

            {/* 성별 */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[#1F1F1F]">
                성별
              </label>
              <select
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
                disabled={loading}
                className="w-full px-4 py-3 border border-[#D4D4D4] rounded-xl text-[#1F1F1F] bg-white focus:ring-2 focus:ring-[#5F0080] focus:border-transparent outline-none disabled:opacity-50"
              >
                <option value="">선택해주세요</option>
                <option value="male">남성</option>
                <option value="female">여성</option>
                <option value="other">기타</option>
                <option value="prefer_not_to_say">선택 안 함</option>
              </select>
            </div>

            {/* 생년월일 */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[#1F1F1F]">
                생년월일
              </label>
              <input
                type="date"
                value={form.birthDate}
                onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                disabled={loading}
                className="w-full px-4 py-3 border border-[#D4D4D4] rounded-xl text-[#1F1F1F] bg-white focus:ring-2 focus:ring-[#5F0080] focus:border-transparent outline-none disabled:opacity-50"
              />
            </div>

            {/* 휴대전화번호 (선택) */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[#1F1F1F]">
                휴대전화번호 <span className="text-[#6F6F6F] font-normal">(선택)</span>
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="010-0000-0000"
                disabled={loading}
                className="w-full px-4 py-3 border border-[#D4D4D4] rounded-xl text-[#1F1F1F] bg-white placeholder:text-[#9A9BA8] focus:ring-2 focus:ring-[#5F0080] focus:border-transparent outline-none disabled:opacity-50"
              />
            </div>

            {/* 에러 메시지 */}
            {error && (
              <p className="text-[13px] text-red-500 text-center" role="alert">
                {error}
              </p>
            )}

            {/* 제출 버튼 */}
            <button
              type="submit"
              disabled={!isFormValid || loading}
              className="w-full rounded-xl px-6 py-3 font-semibold text-white bg-[#5F0080] hover:bg-[#4A0066] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '저장 중...' : '시작하기'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
