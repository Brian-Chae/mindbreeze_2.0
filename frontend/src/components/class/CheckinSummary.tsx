// 입장 전 체크인 요약 표시 — 상담사 화면(대기실 목록·세션 시작 카드)에서 공용으로 쓴다.
// 집중·편안함·감정 3축 라벨 + 상담사 전달 메시지를 다크 톤으로 표시한다.

import { SAM_AXES, samStepLabel } from '../../lib/api/checkin';

interface CheckinSummaryProps {
  arousal: number | null;
  valence: number | null;
  emotion: number | null;
  note: string | null;
}

export function CheckinSummary({ arousal, valence, emotion, note }: CheckinSummaryProps) {
  const values = { arousal, valence, emotion } as const;
  const hasAxis = SAM_AXES.some((axis) => values[axis.key] !== null);

  if (!hasAxis && !note) return null;

  return (
    <div className="space-y-1.5">
      {hasAxis && (
        <div className="flex flex-wrap gap-1.5">
          {SAM_AXES.map((axis) => {
            const value = values[axis.key];
            if (value === null) return null;
            const label = samStepLabel(axis.key, value);
            return (
              <span
                key={axis.key}
                className="rounded-full bg-[#5F0080]/25 px-2.5 py-1 text-[11px] font-medium text-[#D9B8F2]"
              >
                {axis.label} {value} · {label}
              </span>
            );
          })}
        </div>
      )}
      {note && (
        <p className="text-[13px] leading-5 text-white/80">
          “{note}”
        </p>
      )}
    </div>
  );
}
