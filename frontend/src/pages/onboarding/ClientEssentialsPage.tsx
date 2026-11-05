// 기존 회원의 누락 필수정보만 보완한다. 선택 전화는 설정에서 관리한다.
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { BirthDateInput } from '../../components/auth/BirthDateInput';
import AuthShell from '../../components/auth/AuthShell';
import { useAuthStore } from '../../stores/authStore';
import { updateUserMe, type UpdateUserMePayload } from '../../lib/api/auth';
import { completeClientOnboarding } from '../../lib/api/onboarding';
import { checkBirthDate } from '../../lib/auth/age';

export default function ClientEssentialsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [form, setForm] = useState({ name: user?.name ?? '', gender: user?.gender ?? '', birthDate: user?.birth_date ?? '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  if (!user) return null;
  if (user.client_required_fields?.length === 0) return <Navigate to="/app" replace />;
  const missing = user.client_required_fields ?? ['name', 'gender', 'birth_date'];
  const valid = (!missing.includes('name') || Boolean(form.name.trim())) && (!missing.includes('gender') || Boolean(form.gender)) && (!missing.includes('birth_date') || checkBirthDate(form.birthDate) === 'ok');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    setLoading(true); setError('');
    try {
      const payload: UpdateUserMePayload = {};
      if (missing.includes('name')) payload.name = form.name.trim();
      if (missing.includes('gender')) payload.gender = form.gender as UpdateUserMePayload['gender'];
      if (missing.includes('birth_date')) payload.birth_date = form.birthDate;
      const updated = await updateUserMe(payload);
      await completeClientOnboarding();
      setUser({ ...updated, onboarding_completed: true });
      navigate('/app', { replace: true });
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요. 다시 시도해 주세요.'); }
    finally { setLoading(false); }
  }
  return <AuthShell variant="member" title="필수 정보 확인">
    <main className="space-y-5">
      <h2 className="text-2xl font-semibold">이 정보만 확인할게요</h2>
      <p className="text-sm text-white/80">서비스 이용에 필요한 정보를 채워 주세요. 이미 저장한 정보는 그대로 사용해요.</p>
      <form onSubmit={submit} className="space-y-5">
        {missing.includes('name') && <label className="block text-sm">이름<input aria-label="이름" className="mt-2 w-full" required maxLength={100} value={form.name} disabled={loading} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>}
        {missing.includes('gender') && <label className="block text-sm">성별<select aria-label="성별" className="mt-2 w-full" required value={form.gender} disabled={loading} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="">선택해 주세요</option><option value="male">남성</option><option value="female">여성</option><option value="other">기타</option></select></label>}
        {missing.includes('birth_date') && <BirthDateInput value={form.birthDate} onChange={(birthDate) => setForm({ ...form, birthDate })} disabled={loading} />}
        {error && <p role="alert" className="text-red-300">{error}</p>}
        <button type="submit" disabled={!valid || loading} className="h-[52px] w-full rounded-full bg-[#5F0080] font-semibold disabled:opacity-50">{loading ? '저장 중…' : '저장하고 시작하기'}</button>
      </form>
    </main>
  </AuthShell>;
}
