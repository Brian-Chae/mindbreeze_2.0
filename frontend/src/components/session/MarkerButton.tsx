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

  const submit = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      const ts = (Date.now() - startedAt) / 1000;
      await addMarker(sessionId, ts, note);
      setNote('');
      setCount((c) => c + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="마커 메모 입력"
        className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      />
      <button
        type="button"
        onClick={submit}
        disabled={busy || !note.trim()}
        className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
      >
        마커 추가 ({count})
      </button>
    </div>
  );
}
