import { useEffect, useRef, useState } from 'react';
import { getCheckinPrefs, putCheckinPrefs, type CheckinPrefs } from '../../../lib/api/agent-checkin';

export default function CheckinPreferences() {
  const [prefs, setPrefs] = useState<CheckinPrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (lock.current) return;
      const version = revision.current;
      void getCheckinPrefs().then((value) => { if (active && !lock.current && version === revision.current) setPrefs(value); })
        .catch(() => { /* 다음 조회에서 설정을 다시 확인한다. */ });
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  if (!prefs?.available) return null;
  return <div className="rounded-xl bg-white p-3 text-sm">
    <label className="flex items-center justify-between gap-3">AI 안부 일시 중지
      <input type="checkbox" role="switch" checked={prefs.paused} disabled={busy} onChange={async (event) => {
        if (lock.current) return;
        lock.current = true; revision.current += 1; setBusy(true); setError('');
        try { setPrefs(await putCheckinPrefs(event.target.checked)); }
        catch { setError('설정을 저장하지 못했어요. 다시 시도해 주세요.'); }
        finally { lock.current = false; setBusy(false); }
      }} />
    </label>
    {error && <p role="alert" className="mt-2 text-sm">{error}</p>}
  </div>;
}
