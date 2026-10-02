// 상담사 대기실 — 입장 전 체크인 목록.
// 대기실(입장 전 준비)에 머무는 회원의 기분·상담사 전달 말을 실시간으로 보여준다.
// 체크인을 남기지 않은 회원은 이름만 표시한다.

import type { WaitingRoomEntry } from '../../hooks/useWaitingRoomCount';
import { CheckinSummary } from './CheckinSummary';

interface WaitingRoomCheckinListProps {
  entries: WaitingRoomEntry[];
}

export function WaitingRoomCheckinList({ entries }: WaitingRoomCheckinListProps) {
  if (entries.length === 0) return null;

  const withCheckin = entries.filter((e) => e.checkin);

  return (
    <div className="rounded-2xl bg-white/5 p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">입장 전 체크인</h3>
        <span className="rounded-full bg-[#5F0080]/25 px-2.5 py-1 text-[11px] font-semibold text-[#D9B8F2]">
          {entries.length}명 대기 중
        </span>
      </div>

      {withCheckin.length === 0 && (
        <p className="mt-3 text-[13px] leading-6 text-white/60">
          아직 체크인을 남긴 회원이 없어요. 회원이 입장 전 준비에서 기분을 남기면 여기에 표시됩니다.
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {entries.map((entry) => (
          <li
            key={entry.participantId}
            className="rounded-xl bg-black/20 p-3"
          >
            <p className="text-sm font-semibold text-white">
              {entry.nickname ?? '참가자'}
              {!entry.checkin && (
                <span className="ml-2 text-[11px] font-normal text-white/50">체크인 대기 중</span>
              )}
            </p>
            {entry.checkin && (
              <div className="mt-2">
                <CheckinSummary
                  arousal={entry.checkin.arousal}
                  valence={entry.checkin.valence}
                  note={entry.checkin.note}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
