// 입장 전 체크인 요약 표시 — 상담사 화면(대기실 목록·세션 시작 카드)에서 공용으로 쓴다.
// SAM 2축(각성·정서) 라벨 + 상담사 전달 메시지를 다크 톤으로 표시한다.

import { samStepLabel } from '../../lib/api/checkin';

interface CheckinSummaryProps {
  arousal: number | null;
  valence: number | null;
  note: string | null;
}

export function CheckinSummary({ arousal, valence, note }: CheckinSummaryProps) {
  const arousalLabel = samStepLabel('arousal', arousal);
  const valenceLabel = samStepLabel('valence', valence);

  if (!arousalLabel && !valenceLabel && !note) return null;

  return (
    <div className="space-y-1.5">
      {(arousalLabel || valenceLabel) && (
        <div className="flex flex-wrap gap-1.5">
          {arousalLabel && (
            <span className="rounded-full bg-[#5F0080]/25 px-2.5 py-1 text-[11px] font-medium text-[#D9B8F2]">
              각성 {arousal} · {arousalLabel}
            </span>
          )}
          {valenceLabel && (
            <span className="rounded-full bg-[#5F0080]/25 px-2.5 py-1 text-[11px] font-medium text-[#D9B8F2]">
              정서 {valence} · {valenceLabel}
            </span>
          )}
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
