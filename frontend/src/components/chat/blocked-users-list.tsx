// 차단한 사용자 목록 — 해제 / 신고 철회. 설정 화면에서 사용한다.
import { useCallback, useEffect, useState } from 'react';
import {
  listChatBlocks,
  unblockChatUser,
  withdrawChatReport,
  type ChatBlockItem,
} from '../../lib/api/chat';

const btn =
  'min-h-11 rounded-lg border border-[#DDDEE7] px-3 py-2 text-[13px] text-[#5B1A8A] disabled:opacity-50';

// 신고자에게 보이는 운영 처리 상태(접수는 별도 표시 없이 철회 버튼만). [MB261026][FIX]
const REPORT_STATUS_LABELS: Readonly<Record<string, string>> = {
  withdrawn: '신고 철회됨',
  reviewing: '운영 검토 중',
  actioned: '처리 완료',
  dismissed: '처리 완료',
};

export function BlockedUsersList() {
  const [items, setItems] = useState<ChatBlockItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await listChatBlocks();
      setItems(res.blocks);
      setError(null);
    } catch {
      setError('차단 목록을 불러오지 못했어요.');
      setItems((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (id: string, action: () => Promise<unknown>, failMsg: string): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await load();
    } catch {
      setError(failMsg);
    } finally {
      setBusyId(null);
    }
  };

  if (items === null) return <p className="text-[13px] text-[#776D7B]">불러오는 중…</p>;

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-[14px] text-[#776D7B]">차단한 사용자가 없어요.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.user_id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[#F0EBF2] p-3">
              <span className="min-w-0 flex-1 text-[14px]">
                {item.name ?? '알 수 없는 사용자'}
                {item.report_status && REPORT_STATUS_LABELS[item.report_status] && (
                  <span className="ml-2 text-[12px] text-[#776D7B]">{REPORT_STATUS_LABELS[item.report_status]}</span>
                )}
              </span>
              {item.report_id && item.report_status === 'submitted' && (
                <button
                  type="button"
                  className={btn}
                  disabled={busyId === item.user_id}
                  onClick={() =>
                    void run(item.user_id, () => withdrawChatReport(item.report_id as string), '신고를 철회하지 못했어요.')
                  }
                >
                  신고 철회
                </button>
              )}
              <button
                type="button"
                className={btn}
                disabled={busyId === item.user_id}
                onClick={() => void run(item.user_id, () => unblockChatUser(item.user_id), '차단을 해제하지 못했어요.')}
              >
                차단 해제
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
