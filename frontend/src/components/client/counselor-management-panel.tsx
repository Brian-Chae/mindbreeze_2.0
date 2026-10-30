// 설정 > 상담사 관리: 연결 목록 + 코드로 추가 (SDD-256, client 전용)
import { useState } from 'react';
import { useClientCounselors } from '../../hooks/use-client-counselors';
import { COUNSELOR_COPY as T } from '../../lib/client-counselor-copy';
import { CounselorAddSheet } from './counselor-add-sheet';

export function CounselorManagementPanel() {
  const { counselors, loading, error, refresh, addCounselor } = useClientCounselors();
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 p-3 text-[14px] text-red-700">
          {T.loadFailed}{' '}
          <button type="button" onClick={() => void refresh()} className="min-h-11 font-semibold underline">{T.retry}</button>
        </div>
      )}
      {counselors.length > 0 ? (
        <ul className="divide-y divide-[#F0EBF2]">
          {counselors.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5F0080] to-[#8A4FB8] text-[13px] font-bold text-white">
                {c.name?.charAt(0) ?? '상'}
              </div>
              <div className="min-w-0">
                <div className="break-words text-[15px] font-semibold text-[#1F1F1F]">{c.name}</div>
                <div className="break-words text-[13px] text-[#776D7B]">{c.org_name || T.noOrg}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        !error && <p className="text-[14px] text-[#776D7B]">{loading ? '불러오는 중…' : T.emptyList}</p>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-12 w-full items-center justify-center rounded-xl border border-[#DDD0EA] text-[15px] font-bold text-[#5B1A8A]"
      >
        + {T.settingsAddButton}
      </button>
      <CounselorAddSheet open={open} onOpenChange={setOpen} addCounselor={addCounselor} />
    </div>
  );
}
