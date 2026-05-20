// AI 기록지 뷰어 + 편집

import { useState } from 'react';
import { updateRecord, type RecordResponse } from '../../lib/api/audio';

interface Props {
  record: RecordResponse;
  onUpdated: (r: RecordResponse) => void;
}

export function RecordView({ record, onUpdated }: Props) {
  const [notes, setNotes] = useState(record.counselor_notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summary = record.ai_summary as { headline?: string; sections?: Record<string, string> };
  const sections = summary.sections ?? {};

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await updateRecord(record.session_id, { counselor_notes: notes });
      onUpdated(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
          상태: {record.status}
        </span>
        {record.is_edited && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            편집됨 ({record.edit_history.length}회)
          </span>
        )}
      </div>

      {summary.headline && (
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{summary.headline}</h3>
      )}

      <div className="grid gap-3">
        {Object.entries(sections).map(([title, body]) => (
          <div key={title} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <h4 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{title}</h4>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{body}</p>
          </div>
        ))}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          상담사 메모
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          className="w-full rounded-lg border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          placeholder="추가 메모를 작성하세요"
        />
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            메모 저장
          </button>
        </div>
      </div>
    </div>
  );
}
