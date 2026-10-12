// 상담사 메모 탭 — 자유 텍스트 편집기 + 수정 이력 타임라인

import { useState } from 'react';
import { updateRecord, type RecordResponse } from '../../lib/api/audio';

interface EditHistoryEntry {
  edited_at: string;
  editor_id: string;
  changes: Record<string, unknown>;
}

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

  const editHistory = record.edit_history as unknown as EditHistoryEntry[] | null;

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
          상담사 메모
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={8}
          className="w-full rounded-xl border border-[#DDDEE7] p-3 text-sm leading-relaxed text-[#1F1F1F] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/20 focus:border-[#5F0080]"
          placeholder="세션 중 관찰 내용, 특이사항, 다음 세션 계획 등을 자유롭게 기록하세요."
        />
        {error && <p className="mt-1.5 text-xs text-[#B3261E]">{error}</p>}
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-xl bg-[#5F0080] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B0066] disabled:opacity-50 transition-colors"
          >
            {busy ? '저장 중...' : '메모 저장'}
          </button>
        </div>
      </div>

      {editHistory && editHistory.length > 0 && (
        <div>
          <h4 className="mb-2 text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
            수정 이력 ({editHistory.length}회)
          </h4>
          <div className="space-y-2 border-l-2 border-[#DDDEE7] pl-4">
            {[...editHistory].reverse().map((entry, i) => (
              <div key={i} className="text-xs text-[#6F6F6F]">
                <span className="font-medium text-[#1F1F1F]">
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
