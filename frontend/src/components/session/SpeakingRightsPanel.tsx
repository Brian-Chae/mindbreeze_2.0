// SDD-094: 발언권 관리 패널 — 온라인 그룹(≤20) 상담사 콘솔.
// 손든 참여자를 위로 올리고 [발언권 부여]/[해제]로 speaking 을 토글한다.
// 부여/해제는 수 초 내 WS speaking_changed 로 확정되며, 목록에는 응답 즉시 반영한다.

import { memo, useMemo } from 'react';
import type { SessionLiveMetric } from '../../lib/api/session';

interface SpeakingRightsPanelProps {
  participants: SessionLiveMetric[];
  /** 부여/해제 요청 진행 중인 participant_id */
  busyId: string | null;
  onGrant: (participantId: string) => void;
  onRevoke: (participantId: string) => void;
}

/** 손들기 → 발언 중 → 나머지 순으로 정렬 (동일 순위는 이름순) */
function sortForSpeaking(rows: SessionLiveMetric[]): SessionLiveMetric[] {
  const rank = (row: SessionLiveMetric): number => {
    if (row.raise_hand) return 0;
    if (row.speaking) return 1;
    return 2;
  };
  return [...rows].sort((a, b) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return (a.display_name || '').localeCompare(b.display_name || '', 'ko');
  });
}

/**
 * live-metrics 실패 시 세션 참가자로 만든 대체 행은 실제 participant_id 가 아니라
 * `guest-<index>-<name>` 합성 id 를 쓴다(ClassPlayerPage.participantsToMetrics).
 * 서버 participant_id 가 아니면 부여/해제할 수 없으므로 버튼을 막는다.
 */
function isSyntheticParticipantId(participantId: string): boolean {
  return participantId.startsWith('guest-');
}

const ParticipantRow = memo(function ParticipantRow({
  row,
  busy,
  onGrant,
  onRevoke,
}: {
  row: SessionLiveMetric;
  busy: boolean;
  onGrant: (participantId: string) => void;
  onRevoke: (participantId: string) => void;
}) {
  const canToggle = !isSyntheticParticipantId(row.participant_id);
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
        row.raise_hand
          ? 'border-[#F5D48B] bg-[#FDF6E5]'
          : 'border-[#EFEFEF] bg-white'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#1F1F1F]">
          {row.display_name || (row.is_guest ? '게스트' : '참가자')}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {row.is_guest && (
            <span className="rounded-full bg-[#F2F3F8] px-1.5 py-0.5 text-[12px] font-medium text-[#6F6F6F]">
              게스트
            </span>
          )}
          {row.raise_hand && (
            <span className="rounded-full bg-[#F5E2B8] px-1.5 py-0.5 text-[12px] font-semibold text-[#8A6B1F]">
              🙋 손들기
            </span>
          )}
          {row.speaking && (
            <span className="rounded-full bg-[#59CE9026] px-1.5 py-0.5 text-[12px] font-semibold text-[#2F9E68]">
              🎤 발언 중
            </span>
          )}
          {!row.raise_hand && !row.speaking && (
            <span className="text-[12px] font-medium text-[#9B9B9B]">발언권 없음</span>
          )}
        </div>
      </div>
      {row.speaking ? (
        <button
          type="button"
          onClick={() => onRevoke(row.participant_id)}
          disabled={busy || !canToggle}
          className="mb-btn mb-btn--ghost !px-3 !py-1.5 text-xs disabled:cursor-not-allowed"
        >
          {busy ? '처리 중…' : '발언권 해제'}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onGrant(row.participant_id)}
          disabled={busy || !canToggle}
          className="mb-btn !px-3 !py-1.5 text-xs disabled:cursor-not-allowed"
        >
          {busy ? '처리 중…' : '발언권 부여'}
        </button>
      )}
    </div>
  );
});

export function SpeakingRightsPanel({
  participants,
  busyId,
  onGrant,
  onRevoke,
}: SpeakingRightsPanelProps) {
  const rows = useMemo(() => sortForSpeaking(participants), [participants]);
  const raisedCount = participants.filter((p) => p.raise_hand).length;
  const speakingCount = participants.filter((p) => p.speaking).length;

  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[#EFEFEF] bg-[#FAFAFA] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
          발언권 관리
        </h3>
        <div className="flex items-center gap-1.5 text-[12px] font-semibold">
          {raisedCount > 0 && (
            <span className="rounded-full bg-[#F5E2B8] px-2 py-0.5 text-[#8A6B1F]">
              🙋 손들기 {raisedCount}명
            </span>
          )}
          {speakingCount > 0 && (
            <span className="rounded-full bg-[#59CE9026] px-2 py-0.5 text-[#2F9E68]">
              🎤 발언 중 {speakingCount}명
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
        {rows.map((row) => (
          <ParticipantRow
            key={row.participant_id}
            row={row}
            busy={busyId === row.participant_id}
            onGrant={onGrant}
            onRevoke={onRevoke}
          />
        ))}
      </div>
    </section>
  );
}
