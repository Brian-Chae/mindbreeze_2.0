// SDD-094: 발언권 관리 패널 — 온라인 그룹(≤20) 상담사 콘솔.
// 손든 참여자를 위로 올리고 [발언권 부여]/[해제]로 speaking 을 토글한다.
// 부여/해제는 수 초 내 WS speaking_changed 로 확정되며, 목록에는 응답 즉시 반영한다.

import { memo, useMemo } from 'react';
import { Hand, Mic } from 'lucide-react';
import type { SessionLiveMetric } from '../../lib/api/session';

interface SpeakingRightsPanelProps {
  participants: SessionLiveMetric[];
  /** 부여/해제 요청 진행 중인 participant_id */
  busyId: string | null;
  onGrant: (participantId: string) => void;
  onRevoke: (participantId: string) => void;
  onLowerHand?: (participantId: string) => void;
  lowerHandBusyId?: string | null;
  lowerHandError?: { participantId: string; message: string } | null;
}

/** 각 그룹 안에서는 이름순으로 정렬한다. 요청 순서나 대기 시간은 표시하지 않는다. */
function sortForSpeaking(rows: SessionLiveMetric[]): SessionLiveMetric[] {
  return [...rows].sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'ko'));
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
  onLowerHand,
  lowerHandError,
}: {
  row: SessionLiveMetric;
  busy: boolean;
  onGrant: (participantId: string) => void;
  onRevoke: (participantId: string) => void;
  onLowerHand?: (participantId: string) => void;
  lowerHandError?: string;
}) {
  const canToggle = !isSyntheticParticipantId(row.participant_id);
  return (
    <div
      data-participant-id={row.participant_id}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
        row.raise_hand
          ? 'border-[#F5D48B] bg-[#FDF6E5]'
          : 'border-[#EFEFEF] bg-white'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-[#1F1F1F]">
          {row.display_name || (row.is_guest ? '게스트' : '참가자')}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {row.is_guest && (
            <span className="rounded-full bg-[#F2F3F8] px-1.5 py-0.5 text-[13px] font-medium text-[#6F6F6F]">
              게스트
            </span>
          )}
          {row.raise_hand && (
            <span className="rounded-full bg-[#F5E2B8] px-1.5 py-0.5 text-[13px] font-semibold text-[#8A6B1F]">
              <Hand aria-hidden="true" size={15} className="inline-block" /> 손들기
            </span>
          )}
          {row.speaking && (
            <span className="rounded-full bg-[#59CE9026] px-1.5 py-0.5 text-[13px] font-semibold text-[#2F9E68]">
              <Mic aria-hidden="true" size={15} className="inline-block" /> 발언권 있음
            </span>
          )}
          {!row.raise_hand && !row.speaking && (
            <span className="text-[13px] font-medium text-[#9B9B9B]">발언권 없음</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-1.5">
        {row.raise_hand && onLowerHand && (
          <button
            type="button"
            aria-label={`${row.display_name || '참가자'} 손 내리기`}
            onClick={() => onLowerHand(row.participant_id)}
            disabled={busy || !canToggle}
            className="mb-btn mb-btn--ghost min-h-11 !px-3 !py-1.5 text-[15px] disabled:cursor-not-allowed"
          >
            {busy ? '처리 중…' : '손 내리기'}
          </button>
        )}
        {row.speaking ? (
          <button
            type="button"
            onClick={() => onRevoke(row.participant_id)}
            disabled={busy || !canToggle}
            className="mb-btn mb-btn--ghost !px-3 !py-1.5 min-h-11 text-[15px] disabled:cursor-not-allowed"
          >
            {busy ? '처리 중…' : '발언권 해제'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onGrant(row.participant_id)}
            disabled={busy || !canToggle}
            className="mb-btn !px-3 !py-1.5 min-h-11 text-[15px] disabled:cursor-not-allowed"
          >
            {busy ? '처리 중…' : '발언권 부여'}
          </button>
        )}
        {lowerHandError && <p role="alert" className="max-w-40 text-[13px] text-[#B42318]">{lowerHandError}</p>}
      </div>
    </div>
  );
});

export function SpeakingRightsPanel({
  participants,
  busyId,
  onGrant,
  onRevoke,
  onLowerHand,
  lowerHandBusyId,
  lowerHandError,
}: SpeakingRightsPanelProps) {
  const rows = useMemo(() => sortForSpeaking(participants), [participants]);
  // 두 상태를 모두 가진 회원은 손든 목록에 한 번만 표시하고 두 조치를 함께 제공한다.
  const groups = [
    { key: 'hands', label: '손든 회원', rows: rows.filter((p) => p.raise_hand) },
    { key: 'speakers', label: '발언권 있는 회원', rows: rows.filter((p) => p.speaking && !p.raise_hand) },
    { key: 'others', label: '그 외 회원', rows: rows.filter((p) => !p.speaking && !p.raise_hand) },
  ];

  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[#EFEFEF] bg-[#FAFAFA] p-3">
      <h3 className="text-[15px] font-semibold text-[#6F6F6F]">발언권 관리</h3>
      {groups.map((group) => (
        <div key={group.key} data-speaking-group={group.key} className="mt-3 space-y-1.5">
          <h4 className="text-[15px] font-semibold text-[#6F6F6F]">{group.label} {group.rows.length}명</h4>
          {group.rows.length === 0 ? <p className="text-[13px] text-[#9B9B9B]">해당 회원이 없어요.</p> : null}
          {group.rows.map((row) => (
            <ParticipantRow
              key={row.participant_id}
              row={row}
              busy={busyId === row.participant_id || lowerHandBusyId === row.participant_id}
              onGrant={onGrant}
              onRevoke={onRevoke}
              onLowerHand={onLowerHand}
              lowerHandError={lowerHandError?.participantId === row.participant_id ? lowerHandError.message : undefined}
            />
          ))}
        </div>
      ))}
    </section>
  );
}
