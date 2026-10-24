import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ClientProfileSection from '../../components/settings/ClientProfileSection';
import { getClientProfile, updateClientProfile, type ClientProfile, type ClientProfileUpdate } from '../../lib/api/client-profile';
export default function ParticipationProfilePage() {
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { let active = true; void getClientProfile().then(value => { if (active) setProfile(value); }).catch(() => { if (active) setError('참여 프로필을 불러오지 못했어요.'); }); return () => { active = false; }; }, []);
  async function save(data: ClientProfileUpdate) { try { setProfile(await updateClientProfile(data)); setSaved(true); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '프로필 저장 실패'); throw e; } }
  return <div className="mx-auto max-w-2xl space-y-6 px-4 py-5 md:px-8"><Link className="inline-flex min-h-11 items-center text-[#5B1A8A]" to="/app/profile">← 설정으로 돌아가기</Link><p className="text-[14px] text-[#776D7B]">성별·생년월일·고민·관심 분야는 필요할 때만 입력해요.</p>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{saved && <p role="status" className="text-sm text-green-700">참여 프로필 저장됨</p>}{profile ? <ClientProfileSection profile={profile} onSave={save} /> : !error && <p>프로필 불러오는 중...</p>}</div>;
}
