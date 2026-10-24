import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import PersonalInfoSection from '../../components/settings/PersonalInfoSection';
import ProfileSection from '../../components/settings/ProfileSection';
import { getCounselorProfile, updateCounselorProfile, type CounselorProfile, type CounselorProfileUpdate } from '../../lib/api/counselor';
import { useAuthStore } from '../../stores/authStore';
export default function ProfessionalProfilePage() {
  const role = useAuthStore(s => s.user?.role);
  const [profile, setProfile] = useState<CounselorProfile | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { let active = true; if (role === 'counselor' || role === 'org_admin') void getCounselorProfile().then(value => { if (active) setProfile(value); }).catch(() => { if (active) setError('프로필을 불러오지 못했어요. 설정의 기본 정보를 이용해 주세요.'); }); return () => { active = false; }; }, [role]);
  async function save(data: CounselorProfileUpdate) { try { setProfile(await updateCounselorProfile({...data, version: profile?.version})); setSaved(true); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '프로필 저장 실패'); throw e; } }
  const allowed = role === 'counselor' || (role === 'org_admin' && Boolean(profile?.counselor_code));
  return <AppShell title="상담사 프로필 관리" sub="PROFESSIONAL PROFILE"><div className="mx-auto max-w-2xl space-y-6"><Link to="/settings" className="inline-flex min-h-11 items-center text-[#5B1A8A]">← 설정으로 돌아가기</Link><p className="text-[14px] text-[#776D7B]">선택 입력한 개인·전문 정보를 관리해요. 이 화면은 공개 프로필이 아니에요.</p>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{saved && <p role="status" className="text-sm text-green-700">프로필 저장됨</p>}{profile && allowed ? <><PersonalInfoSection profile={profile} onSave={save} /><ProfileSection profile={profile} onSave={save} /></> : !error && <p>{profile ? '상담사 프로필이 있는 계정만 편집할 수 있어요.' : '프로필 불러오는 중...'}</p>}</div></AppShell>;
}
