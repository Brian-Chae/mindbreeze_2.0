import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { getCounselorProfile, updateCounselorProfile, type CounselorProfile, type CounselorProfileUpdate } from '../../lib/api/counselor';
import { getClientProfile, updateClientProfile, type ClientProfile, type ClientProfileUpdate } from '../../lib/api/client-profile';
import { updateUserMe, type UpdateUserMePayload } from '../../lib/api/auth';
import AccountSection from './AccountSection';
import ClientAccountSection from './ClientAccountSection';
import SelfInfoSection, { type SelfInfoValue } from './SelfInfoSection';

export default function AccountSettings() {
  const user = useAuthStore(s => s.user);
  const [counselor, setCounselor] = useState<CounselorProfile | null>(null);
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [fallback, setFallback] = useState<SelfInfoValue | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const role = user?.role;
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setCounselor(null); setClient(null); setFallback(null);
    async function load() {
      try {
        if (role === 'client') { const value = await getClientProfile(); if (active) setClient(value); }
        else if (role === 'counselor' || role === 'org_admin') { const value = await getCounselorProfile(); if (active) setCounselor(value); }
      } catch (e) {
        if (!active) return;
        if (role === 'org_admin') { const current = useAuthStore.getState().user; setFallback({name: current?.name ?? '', email: current?.email ?? '', phone: null}); }
        setError(e instanceof Error ? e.message : '계정 정보를 불러오지 못했어요.');
      } finally { if (active) setLoading(false); }
    }
    void load(); return () => { active = false; };
  }, [role, user?.id, reload]);
  function syncName(name: string) { const current = useAuthStore.getState().user; if (current && current.name !== name) useAuthStore.getState().setUser({...current, name}); }
  async function saveCounselor(data: CounselorProfileUpdate) { try { const value = await updateCounselorProfile({...data, version: counselor?.version}); setCounselor(value); syncName(value.name); setSaved(true); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요.'); throw e; } }
  async function saveClient(data: ClientProfileUpdate) { try { const value = await updateClientProfile(data); setClient(value); syncName(value.name); setSaved(true); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요.'); throw e; } }
  async function saveFallback(data: UpdateUserMePayload) { try { const value = await updateUserMe(data); setFallback(previous => previous ? {...previous, name: value.name, phone: data.phone ?? previous.phone} : previous); syncName(value.name); setSaved(true); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요.'); throw e; } }
  return <div className="space-y-4">
    <div className="min-w-0 py-2"><strong className="text-[16px]">{user?.name}</strong><p className="break-all text-[13px] text-[#776D7B]">{user?.email}</p><p className="text-[13px] text-[#776D7B]">{{client: '회원', counselor: '상담사', org_admin: '기관관리자', platform_admin: '플랫폼관리자', admin: '관리자'}[role ?? 'client']}</p></div>
    {error && <p role="alert" className="text-sm text-red-700">{error} <button type="button" onClick={() => setReload(n => n + 1)} className="min-h-11 underline">다시 시도</button></p>}
    {loading && <p className="text-sm text-[#776D7B]">계정 정보 불러오는 중...</p>}
    {saved && <p role="status" className="text-sm text-green-700">저장됨</p>}
    {counselor && <AccountSection profile={counselor} onSave={saveCounselor} />}
    {client && <ClientAccountSection profile={client} onSave={saveClient} />}
    {fallback && <SelfInfoSection value={fallback} showPersonal={false} onSave={saveFallback} />}
    {role === 'client' && <Link className="flex min-h-12 items-center text-[15px] text-[#5B1A8A] underline underline-offset-4" to="/app/participation-profile">참여 프로필 관리 ↗</Link>}
    {(role === 'counselor' || (role === 'org_admin' && counselor?.counselor_code)) && <Link className="flex min-h-12 items-center text-[15px] text-[#5B1A8A] underline underline-offset-4" to="/profile/professional">상담사 프로필 관리 ↗</Link>}
    {role === 'counselor' && <Link className="flex min-h-12 items-center text-[15px] text-[#5B1A8A] underline underline-offset-4" to="/clients/invite">회원 초대 · 초대 코드 복사 ↗</Link>}
    {role === 'org_admin' && <Link className="flex min-h-12 items-center text-[15px] text-[#5B1A8A] underline underline-offset-4" to="/org/counselors">기관 구성원 관리 ↗</Link>}
  </div>;
}
