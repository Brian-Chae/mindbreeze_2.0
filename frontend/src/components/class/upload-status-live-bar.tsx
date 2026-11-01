// SDD-261: 실시간 표시줄 — "실시간 · N초 전 갱신" + 정지/재개 + 새로고침. "마지막 조회"와 "마지막 수신"을 라벨로 분리한다.
import { useEffect, useState } from 'react';
import type { ApiError } from '../../lib/api/client';
import { formatClock, secondsAgo } from '../../lib/upload-status/view';

export interface UploadStatusLiveBarProps {
  paused: boolean;
  loading: boolean;
  error: ApiError | null;
  forbidden: boolean;
  offline: boolean;
  lastFetchedAt: Date | null;
  lastReceivedAt: string | null;
  onPause: () => void;
  onResume: () => void;
  onRefresh: () => void;
  /** 390px 목록처럼 세로 공간이 귀한 화면: 보조 한 줄(마지막 조회·도착)을 모바일에서 숨긴다. */
  compactMobile?: boolean;
}

export function UploadStatusLiveBar({ paused, loading, error, forbidden, offline, lastFetchedAt, lastReceivedAt, onPause, onResume, onRefresh, compactMobile = false }: UploadStatusLiveBarProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (paused || !lastFetchedAt) return undefined;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [paused, lastFetchedAt]);
  const ago = secondsAgo(lastFetchedAt, now);
  const live = !paused && !offline && !error && !forbidden;
  return (
    <div className="space-y-2" data-testid="upload-live-bar">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold ${live ? 'bg-[#F3E9F8] text-[#5B1A8A]' : 'bg-gray-100 text-gray-600'}`} role="status">
          <span aria-hidden="true">{live ? '●' : '○'}</span>
          {paused ? '정지됨' : `실시간${ago === null ? ' · 조회 중' : ` · ${ago}초 전 갱신`}`}
        </span>
        <button type="button" data-testid="live-toggle" onClick={paused ? onResume : onPause} className="min-h-11 rounded-xl border border-[#E8E2ED] bg-white px-4 text-[14px] font-semibold text-[#5B1A8A]">
          {paused ? '▶ 재개' : 'Ⅱ 정지'}
        </button>
        <button type="button" data-testid="live-refresh" disabled={loading} onClick={onRefresh} className="min-h-11 rounded-xl border border-[#E8E2ED] bg-white px-4 text-[14px] text-[#5B1A8A] disabled:opacity-50">
          ↻ 새로고침
        </button>
      </div>
      <p className={`text-[13px] text-[#776D7B] ${compactMobile ? 'hidden md:block' : ''}`}>
        마지막 조회 {formatClock(lastFetchedAt)} · 마지막 도착 {formatClock(lastReceivedAt)}
      </p>
      {offline && (
        <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          ⌁ 관리자 브라우저 오프라인 · 인터넷 연결 후 다시 확인해 주세요. 이전 조회 결과를 표시하고 있어요. 참여자 폰의 오프라인 여부는 알 수 없어요.
        </p>
      )}
      {error && !forbidden && (
        <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          조회 실패 · 마지막 확인 {formatClock(lastFetchedAt)}의 결과를 표시하고 있어요. 자동으로 다시 시도해요.
        </p>
      )}
    </div>
  );
}
