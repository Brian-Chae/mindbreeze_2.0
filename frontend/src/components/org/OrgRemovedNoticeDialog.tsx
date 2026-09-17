// SDD-081: 기관 소속 해제 → 개인 상담소 전환 안내 팝업 (로그인 후 최초 1회)
//
// 미읽음 `org_removed` 알림이 있으면 팝업으로 안내하고, 확인 시 읽음 처리해
// 다시 노출하지 않는다. 알림 조회 실패는 조용히 무시한다 (대시보드 차단 금지).

import { useEffect, useState } from 'react';
import { listNotifications, markRead, type NotificationDto } from '../../lib/api/notifications';

function extraString(notice: NotificationDto, key: string): string | null {
  const value = notice.extra?.[key];
  return typeof value === 'string' ? value : null;
}

export default function OrgRemovedNoticeDialog() {
  const [notice, setNotice] = useState<NotificationDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await listNotifications(true);
        const found = res.notifications.find((n) => n.type === 'org_removed' && !n.is_read);
        if (!cancelled && found) setNotice(found);
      } catch {
        /* 알림 조회 실패 시 팝업 없이 진행 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!notice) return null;

  const orgName = extraString(notice, 'org_name');
  const officeName = extraString(notice, 'office_name');

  const handleConfirm = async (): Promise<void> => {
    try {
      await markRead(notice.id);
    } catch {
      /* 읽음 처리 실패해도 이번 세션에서는 닫는다 */
    }
    setNotice(null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 max-w-md mx-4 w-full">
        <h2 className="text-[17px] font-bold text-[#1F1F1F] mb-3">소속 변경 안내</h2>
        <p className="text-[14px] leading-relaxed text-[#4A4A4A] whitespace-pre-line">
          {orgName ? `'${orgName}' 기관에서 소속이 해제되어` : '기관 소속이 해제되어'}
          {'\n'}
          {officeName ? `'${officeName}'(개인 상담소)로 등록되었습니다.` : '개인 상담소로 등록되었습니다.'}
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-[#6F6F6F]">
          계정과 상담사 코드, 기존 상담 기록은 그대로 유지되며 개인 상담소 소속으로 계속
          이용하실 수 있습니다.
        </p>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => void handleConfirm()}
            className="px-5 py-2 text-[14px] bg-[#5F0080] text-white font-semibold rounded-lg hover:bg-[#3F0055] transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
