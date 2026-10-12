import { useEffect, useRef, useState } from 'react';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import * as api from '../../lib/api/agent-counselor';
import type { BriefingSettings } from '../../lib/api/agent-counselor';
import { serializeSettings } from './counselor-agent-utils';

export default function BriefingSettingsSheet({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<BriefingSettings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  const dialogRef = useDialogA11y(true, () => { if (!lock.current) onClose(); });
  useEffect(() => {
    let active = true;
    setError('');
    api.getSettings().then((value) => { if (active) setSettings(value); })
      .catch(() => { if (active) setError('설정을 불러오지 못했습니다. 다시 시도해 주세요.'); });
    return () => { active = false; };
  }, [reload]);
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="briefing-settings-title" tabIndex={-1} className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl">
      <div className="flex items-center justify-between"><h2 id="briefing-settings-title" className="text-xl font-bold">브리핑 설정</h2><button disabled={busy} onClick={onClose} className="rounded-lg border px-3 py-2">닫기</button></div>
      <p className="my-4 text-sm text-[#6F6F6F]">브리핑 시각은 한국 시간(KST) 기준입니다.</p>
      {error && <p role="alert" className="my-3 text-sm text-red-700">{error}{!settings && <button onClick={() => setReload((value) => value + 1)} className="ml-2 underline">다시 시도</button>}</p>}
      {!settings ? !error && <p role="status">설정을 불러오는 중…</p> : <form className="space-y-6" onSubmit={(event) => {
        event.preventDefault();
        if (lock.current) return;
        lock.current = true;
        setBusy(true); setError('');
        void (async () => {
          try { await api.putSettings(serializeSettings(settings)); onClose(); }
          catch (err) { setError(err instanceof Error ? err.message : '설정을 저장하지 못했습니다.'); }
          finally { lock.current = false; setBusy(false); }
        })();
      }}>
        <fieldset disabled={busy} className="space-y-6">
          <div className="space-y-3"><label className="flex gap-2"><input type="checkbox" checked={settings.morning_enabled} onChange={(event) => setSettings({ ...settings, morning_enabled: event.target.checked })} />아침 브리핑 사용</label>
            <label className="flex items-center justify-between">아침 시각<input required aria-label="아침 시각" type="time" value={settings.morning_time} onChange={(event) => setSettings({ ...settings, morning_time: event.target.value })} className="rounded-lg border p-2" /></label></div>
          <div className="space-y-3"><label className="flex gap-2"><input type="checkbox" checked={settings.evening_enabled} onChange={(event) => setSettings({ ...settings, evening_enabled: event.target.checked })} />저녁 브리핑 사용</label>
            <label className="flex items-center justify-between">저녁 시각<input required aria-label="저녁 시각" type="time" value={settings.evening_time} onChange={(event) => setSettings({ ...settings, evening_time: event.target.value })} className="rounded-lg border p-2" /></label></div>
          <label className="flex gap-2"><input type="checkbox" checked={settings.skip_no_session_days} onChange={(event) => setSettings({ ...settings, skip_no_session_days: event.target.checked })} />일정 없는 날 건너뛰기</label>
          <button type="submit" className="w-full rounded-xl bg-[#5F0080] px-4 py-3 font-semibold text-white disabled:opacity-40">{busy ? '저장 중…' : '저장'}</button>
        </fieldset>
      </form>}
    </div>
  </div>;
}
