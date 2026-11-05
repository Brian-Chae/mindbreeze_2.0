import { useBetaUpdate } from '../../lib/beta/use-beta-update';

/** 앱 안 "새 버전 있음" 안내 (SDD-254). beta.json 의 updateBannerEnabled 가 켜져 있고 설치본이 낮을 때만 보인다. */
export default function BetaUpdateBanner() {
  const { notice, dismiss } = useBetaUpdate();
  if (!notice) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 bg-[#5F0080] px-4 py-2 text-sm text-white">
      <span>새 버전({notice.latestLabel})이 있어요. 업데이트하고 이어서 사용해 주세요.</span>
      <span className="flex shrink-0 gap-2">
        <button type="button" className="rounded bg-white px-3 py-1 font-medium text-[#5F0080]" onClick={() => { window.open(notice.landingUrl, '_blank', 'noopener'); }}>
          업데이트 방법
        </button>
        <button type="button" aria-label="닫기" className="px-2" onClick={dismiss}>닫기</button>
      </span>
    </div>
  );
}
