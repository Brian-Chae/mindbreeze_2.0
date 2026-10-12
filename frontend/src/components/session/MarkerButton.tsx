// 마커 추가 버튼

import { useState } from 'react';
import { addMarker } from '../../lib/api/session';

interface Props {
  sessionId: string;
  startedAt: number; // ms epoch
}

export function MarkerButton({ sessionId, startedAt }: Props) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const ts = (Date.now() - startedAt) / 1000;
      await addMarker(sessionId, ts, note);
      setNote('');
      setCount((c) => c + 1);
    } catch {
      setError('마커 추가에 실패했습니다. 네트워크 상태를 확인해주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="마커 메모 입력"
          className="flex-1 min-w-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !note.trim()}
          className="shrink-0 min-h-11 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          마커 추가 ({count})
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-500 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
