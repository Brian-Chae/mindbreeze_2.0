// SDD-261: 회차 하나의 현황 본문(실시간 표시줄 + 공유 표 + 오류 상태). 세 진입점이 같은 컴포넌트를 쓴다.
import { Link } from 'react-router-dom';
import { useUploadStatus } from '../../hooks/use-upload-status';
import { UploadStatusLiveBar } from './upload-status-live-bar';
import { UploadStatusTable } from './upload-status-table';

export function UploadStatusScreen({ classId, sessionId }: { classId: string | null; sessionId: string | null }) {
  const v = useUploadStatus(classId, sessionId);
  if (!classId || !sessionId) return <p role="status" className="rounded-2xl border border-[#E9E2EB] bg-white p-6 text-center text-[#776D7B]">클래스와 회차를 선택해 주세요</p>;
  if (v.forbidden) return <p role="alert" className="rounded-2xl border border-[#E9E2EB] bg-white p-6 text-[#4A3F52]">이 회차의 업로드 현황을 볼 권한이 없어요. 담당 코치 또는 기관 관리자에게 문의해 주세요.</p>;
  if (v.notFound) return <p role="alert" className="rounded-2xl border border-[#E9E2EB] bg-white p-6 text-[#4A3F52]">회차를 찾을 수 없어요. <Link className="text-[#5B1A8A] underline" to="/classes">클래스 목록</Link></p>;
  if (v.error?.status === 401) return <p role="alert" className="rounded-2xl border border-[#E9E2EB] bg-white p-6 text-[#4A3F52]">로그인이 필요해요. 다시 로그인해 주세요.</p>;
  return (
    <div className="space-y-4">
      <UploadStatusLiveBar paused={v.paused} loading={v.loading} error={v.error} forbidden={v.forbidden} offline={v.offline}
        lastFetchedAt={v.lastFetchedAt} lastReceivedAt={v.lastReceivedAt} onPause={v.pause} onResume={v.resume} onRefresh={v.refresh} />
      {v.data ? <UploadStatusTable data={v.data} /> : <p role="status" className="text-[#776D7B]">불러오는 중이에요…</p>}
    </div>
  );
}
