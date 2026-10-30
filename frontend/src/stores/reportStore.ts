// 리포트 배지 전역 상태 — 하단 탭바·데스크탑 사이드바 공용
// 역할별 기준이 다르다: 내담자=미열람(is_read), 상담사=검토중(pending_review).
// 전체 읽음/일괄 승인/단일 열람 시 즉시 갱신해 두 뷰에서 일관되게 표시한다.

import { create } from 'zustand';
import { getReportBadgeCounts } from '../lib/api/reports';

interface ReportState {
  /** 미열람 수 (내담자 배지 기준) */
  unread: number;
  /** 검토중 수 (상담사 배지 기준) */
  pendingReview: number;
  /** 서버에서 미열람/검토중 수를 재계산해 동기화 (멱등) */
  refresh: () => Promise<void>;
  setUnread: (n: number) => void;
  setPendingReview: (n: number) => void;
  reset: () => void;
}

export const useReportStore = create<ReportState>((set) => ({
  unread: 0,
  pendingReview: 0,
  refresh: async () => {
    try {
      // 서버가 목록과 같은 권한 범위로 집계한다(승인 전 행은 NEW 제외, 클래스 상담사 리포트는 검토중 제외).
      const counts = await getReportBadgeCounts();
      set({ unread: counts.unread, pendingReview: counts.pending_review });
    } catch {
      // 조용히 실패 — 배지는 보조 정보이므로 차단하지 않는다.
    }
  },
  setUnread: (n) => set({ unread: Math.max(0, n) }),
  setPendingReview: (n) => set({ pendingReview: Math.max(0, n) }),
  reset: () => set({ unread: 0, pendingReview: 0 }),
}));
