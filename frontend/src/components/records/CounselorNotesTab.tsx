// 상담사 메모 탭 — 자유 텍스트 편집기 + 수정 이력 타임라인

import { useState } from 'react';
import { updateRecord, type RecordResponse } from '../../lib/api/audio';

interface Props {
  record: RecordResponse;
  onUpdated: (r: RecordResponse) => void;
}

export function CounselorNotesTab({ record, onUpdated }: Props) {
  const [notes, setNotes] = useState(record.counselor_notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const editHistory = record.edit_history as Array<{
    edited_at: string;
    editor_id: string;
    changes: Record<string, unknown>;
  }> | null;

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          상담사 메모
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={8}
          className="w-full rounded-lg border border-neutral-300 p-3 text-sm leading-relaxed dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          placeholder="세션 중 관찰 내용, 특이사항, 다음 세션 계획 등을 자유롭게 기록하세요."
        />
        {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? '저장 중...' : '메모 저장'}
          </button>
        </div>
      </div>

      {editHistory && editHistory.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            수정 이력 ({editHistory.length}회)
          </h4>
          <div className="space-y-2 border-l-2 border-neutral-200 pl-4 dark:border-neutral-700">
            {[...editHistory].reverse().map((entry, i) => (
              <div key={i} className="text-xs text-neutral-500 dark:text-neutral-400">
                <span className="font-medium text-neutral-600 dark:text-neutral-300">
                  {new Date(entry.edited_at).toLocaleString('ko-KR')}
                </span>
                {entry.changes && typeof entry.changes === 'object' && (
                  <span className="ml-2">
                    {Object.keys(entry.changes).join(', ')} 수정됨
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
