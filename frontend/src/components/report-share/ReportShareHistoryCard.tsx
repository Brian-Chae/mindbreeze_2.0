// 발송 이력 카드 (SDD-327 T15) — 시각·마스킹 주소·형태. 회원 상세 하단.
import { useCallback, useEffect, useState } from 'react';
import { getMyReportShareHistory, type ReportShareHistoryItem } from '../../lib/api/report-share';
import { formatShareDate } from './report-share-utils';

export interface ReportShareHistoryCardProps {
  reportId: string;
  /** 값이 바뀌면 다시 불러온다(발송 직후 갱신용) */
  refreshKey?: number;
}

export default function ReportShareHistoryCard({ reportId, refreshKey = 0 }: ReportShareHistoryCardProps) {
  const [items, setItems] = useState<ReportShareHistoryItem[]>([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getMyReportShareHistory(reportId);
      setItems(res.items);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [reportId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (!failed && items.length === 0) return null;

  return (
    <section data-print-exclude aria-label="보낸 기록" className="rounded-2xl border border-[#E8D9F5] bg-[#FDFAFF] p-5">
      <h3 className="text-[15px] font-bold text-[#5F0080]">보낸 기록</h3>
      <p className="mt-1 text-[12px] text-[#6D547A]">받는 주소는 일부만 표시해요.</p>
      {failed ? (
        <p role="alert" className="mt-3 text-[13px] text-[#B3264B]">보낸 기록을 불러오지 못했어요.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[#EFE6F5]">
          {items.map((it) => (
            <li key={it.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="text-[13px] text-[#282430]">
                <b>{formatShareDate(it.sent_at ?? it.created_at)}</b>
                <div className="text-[#6D547A]">{it.recipient_masked}</div>
              </div>
              <span className="shrink-0 rounded-full bg-[#F5EDFC] px-2.5 py-1 text-[12px] text-[#5F0080]">
                {it.status === 'failed' ? '발송 실패' : it.status === 'queued' ? '보내는 중' : it.attached ? '열람 링크 + PDF' : '열람 링크'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
