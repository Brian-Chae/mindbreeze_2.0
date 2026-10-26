import { useEffect, useState } from 'react';
import { SettingsSwitch } from './settings-switch';
import { sessionNotePromptApi } from '../../lib/api/class-summary';

/** 진행 기록 안내는 계정에 저장하며 실패한 낙관적 변경은 되돌린다. */
export function SessionNotePromptToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void sessionNotePromptApi.get().then((value) => { if (active) setEnabled(value.enabled); }).catch(() => { if (active) setError('진행 기록 안내 설정을 불러오지 못했어요.'); });
    return () => { active = false; };
  }, []);
  async function toggle() {
    if (enabled === null || saving) return;
    const previous = enabled;
    setEnabled(!previous); setSaving(true); setError('');
    try { const result = await sessionNotePromptApi.set(!previous); setEnabled(result.enabled); }
    catch { setEnabled(previous); setError('설정을 저장하지 못했어요. 다시 시도해 주세요.'); }
    finally { setSaving(false); }
  }
  return <section className="rounded-2xl border border-[#EFEFEF] bg-white p-6 mobile:p-4">
    <h3 className="text-[18px] mobile:text-mb-subtitle font-bold">진행 기록 안내</h3>
    <div className="mt-3 flex items-center justify-between gap-4">
      <span id="session-note-prompt-label" className="text-[16px] mobile:text-mb-body">진행 기록 안내 받기</span>
      <SettingsSwitch checked={enabled === true} label="진행 기록 안내 받기" disabled={enabled === null || saving} onChange={() => void toggle()} />
    </div>
    <p className="mt-2 text-[13px] mobile:text-mb-caption text-[#6F6F6F]">안내를 다시 켜면 아직 안내하지 않은 회차에서만 보여요. 진행 기록은 언제든 남길 수 있어요.</p>
    {error && <p role="alert" className="mt-2 text-[13px] mobile:text-mb-caption">{error}</p>}
  </section>;
}
