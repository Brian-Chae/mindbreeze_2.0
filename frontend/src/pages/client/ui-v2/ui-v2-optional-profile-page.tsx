// SDD-318 — 선택 프로필(D안). 전화번호 검증·저장·나중에 하기 로직은 optional-profile-page.tsx 와 같은 호출·같은 문구를 쓴다.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UiV2ClientShell } from '../../../components/ui-v2/ui-v2-client-shell';
import { dismissClientProfile, updateUserMe } from '../../../lib/api/auth';
import { useAuthStore } from '../../../stores/authStore';

export function UiV2OptionalProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failedAction, setFailedAction] = useState<'save' | 'dismiss' | null>(null);
  async function save(action: 'save' | 'dismiss') {
    if (busy) return;
    if (action === 'save' && phone && !/^010-?\d{4}-?\d{4}$/.test(phone)) { setError('전화번호를 010-0000-0000 형식으로 입력해 주세요.'); return; }
    setBusy(true); setError(''); setFailedAction(null);
    try { setUser(action === 'save' ? await updateUserMe({ phone }) : await dismissClientProfile()); navigate('/app'); }
    catch { setFailedAction(action); setError('선택을 저장하지 못했어요. 다른 기기에는 아직 반영되지 않았어요. 연결을 확인한 뒤 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  return (
    <UiV2ClientShell title="선택 프로필" back={{ to: '/app/profile', label: '설정으로 돌아가기' }} heading hideBottomNav>
      <p className="u2-footnote">지금 입력하지 않아도 돼요. 원할 때 설정에서 추가해 주세요.</p>
      <form className="u2-card u2-form" onSubmit={(e) => { e.preventDefault(); void save('save'); }}>
        <label className="u2-field">
          <span>전화번호 · 선택</span>
          <input aria-label="전화번호 · 선택" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} placeholder="010-0000-0000" />
        </label>
        <p className="u2-footnote">나중에 하기를 누르면 다음 로그인부터 다시 묻지 않아요.</p>
        {error && <p role="alert" className="u2-error">{error}</p>}
        <button disabled={busy} type="submit" className="u2-primary">입력한 정보 저장</button>
        <button disabled={busy} type="button" onClick={() => void save(failedAction ?? 'dismiss')} className="u2-secondary u2-gap-sm">{failedAction ? '다시 시도하기' : '나중에 하기'}</button>
        {error && <Link to="/app" className="u2-textlink">이번에는 홈으로</Link>}
      </form>
    </UiV2ClientShell>
  );
}
