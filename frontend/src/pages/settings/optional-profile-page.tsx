import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthShell from '../../components/auth/AuthShell';
import { dismissClientProfile, updateUserMe } from '../../lib/api/auth';
import { useAuthStore } from '../../stores/authStore';
export default function OptionalProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    if (e && phone && !/^010-?\d{4}-?\d{4}$/.test(phone)) { setError('전화번호를 010-0000-0000 형식으로 입력해 주세요.'); return; }
    setBusy(true); setError('');
    try { setUser(e ? await updateUserMe({ phone }) : await dismissClientProfile()); navigate('/app'); }
    catch { setError('선택을 저장하지 못했어요. 다른 기기에는 아직 반영되지 않았어요. 연결을 확인한 뒤 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  return <AuthShell variant="member" title="선택 프로필"><main className="space-y-5">
    <h2 className="text-2xl font-semibold">지금 입력하지 않아도 돼요</h2><p className="text-sm text-white/80">원할 때 설정에서 추가해 주세요.</p>
    <form onSubmit={(e) => void save(e)} className="space-y-5"><label className="block text-sm">전화번호 · 선택<input aria-label="전화번호 · 선택" type="tel" autoComplete="tel" className="mt-2 w-full" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} placeholder="010-0000-0000" /></label>
      <p className="text-sm text-white/80">나중에 하기를 누르면 다음 로그인부터 다시 묻지 않아요.</p>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      <button disabled={busy} type="submit" className="h-[52px] w-full rounded-full bg-[#5F0080] font-semibold disabled:opacity-50">입력한 정보 저장</button>
      <button disabled={busy} type="button" onClick={() => void save()} className="h-[52px] w-full rounded-full border border-white/30">{error ? '다시 시도하기' : '나중에 하기'}</button>
      {error && <Link to="/app" className="block text-center underline">이번에는 홈으로</Link>}
    </form></main></AuthShell>;
}
