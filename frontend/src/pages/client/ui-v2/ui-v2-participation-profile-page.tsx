// SDD-318 — 참여 프로필 관리(D안). 조회·저장 로직은 participation-profile-page.tsx 와 같고, 쉘·뒤로가기 헤더·폼 스킨만 바꾼다.
import { useEffect, useState } from 'react';
import { UiV2ClientShell } from '../../../components/ui-v2/ui-v2-client-shell';
import ClientProfileSection from '../../../components/settings/ClientProfileSection';
import { getClientProfile, updateClientProfile, type ClientProfile, type ClientProfileUpdate } from '../../../lib/api/client-profile';

export function UiV2ParticipationProfilePage() {
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { let active = true; void getClientProfile().then((value) => { if (active) setProfile(value); }).catch(() => { if (active) setError('참여 프로필을 불러오지 못했어요.'); }); return () => { active = false; }; }, []);
  async function save(data: ClientProfileUpdate) { try { setProfile(await updateClientProfile(data)); setSaved(true); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '프로필 저장 실패'); throw e; } }
  return (
    <UiV2ClientShell title="참여 프로필 관리" back={{ to: '/app/profile', label: '설정으로 돌아가기' }} heading hideBottomNav>
      <p className="u2-footnote">성별·생년월일을 확인하고 고민·관심 분야는 필요할 때 입력해요.</p>
      {error && <p role="alert" className="u2-error">{error}</p>}
      {saved && <p role="status" className="u2-notice">참여 프로필 저장됨</p>}
      <div className="u2-form u2-legacy">{profile ? <ClientProfileSection profile={profile} onSave={save} /> : !error && <p>프로필 불러오는 중...</p>}</div>
    </UiV2ClientShell>
  );
}
