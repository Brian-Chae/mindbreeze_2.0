// SDD-096 — 내담자 리포트: '수업 전 예상 ↔ 수업 후' 주관 대비 + EEG 두뇌휴식도 병기
//
// 밴드 미착용(EEG not_measured) 세션은 주관 값만 보여준다 — 없는 지표를 해석하지 않는다.

import {
  SAM_AXES,
  buildSubjectiveComparison,
  type SubjectiveSlotDto,
  type SubjectiveStateDto,
} from '../../lib/api/checkin';

interface SubjectiveCheckinCardProps {
  /** 참여자 스코프 주관 상태(셀프 체크인). 미입력이면 부모가 카드를 마운트하지 않는다. */
  subjective: SubjectiveStateDto;
  /** 두뇌휴식도(relaxation_score) — 미측정이면 null */
  relaxationScore?: number | null;
  /** EEG 이완도 추이(세션 시작 지점 → 마지막 지점) — 표본 부족이면 null */
  relaxationTrend?: { first: number; last: number } | null;
  /** EEG가 측정되었는지 — false면 '주관 기록만' 안내 */
  eegMeasured?: boolean;
}

function AxisRow({ axisKey, before, after }: {
  axisKey: 'arousal' | 'valence';
  before: number | null;
  after: number | null;
}) {
  const axis = SAM_AXES.find((item) => item.key === axisKey);
  if (!axis) return null;
  const hasDelta = before !== null && after !== null;
  const delta = hasDelta ? after - before : null;
  const deltaLabel = delta === null ? null : delta > 0 ? `+${delta}` : `${delta}`;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#EFEFEF] bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-[#6F6F6F]">{axis.label}</p>
        <p className="mt-1 text-[13px] text-[#1F1F1F]">
          {before === null ? (
            <span className="text-[#9B9B9B]">수업 전 예상 없음</span>
          ) : (
            <span>예상 {before}단계</span>
          )}
          <span aria-hidden="true" className="mx-2 text-[#9B9B9B]">→</span>
          {after === null ? (
            <span className="text-[#9B9B9B]">수업 후 기록 없음</span>
          ) : (
            <span className="font-bold">수업 후 {after}단계</span>
          )}
        </p>
      </div>
      {deltaLabel && (
        <span
          data-testid={`checkin-delta-${axisKey}`}
          className="shrink-0 rounded-full bg-[#F5EDFC] px-3 py-1 text-[12px] font-bold text-[#5F0080]"
        >
          {deltaLabel}
        </span>
      )}
    </div>
  );
}

export default function SubjectiveCheckinCard({
  subjective,
  relaxationScore = null,
  relaxationTrend = null,
  eegMeasured = false,
}: SubjectiveCheckinCardProps) {
  const before: SubjectiveSlotDto | null = subjective.before;
  const after: SubjectiveSlotDto | null = subjective.after;
  const comparison = buildSubjectiveComparison(before, after);
  const note = after?.note ?? before?.note ?? null;

  return (
    <section
      data-testid="subjective-checkin-card"
      className="bg-white border border-[#EFEFEF] rounded-2xl p-6"
    >
      <h3 className="text-[15px] font-bold text-[#1F1F1F] mb-1 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-sm bg-[#5F0080]" />
        수업 전 예상 ↔ 수업 후
      </h3>
      <p className="mb-4 text-[12px] leading-5 text-[#6F6F6F]">
        회원님이 직접 남긴 체크인 기록입니다. 뇌파 지표와 함께 읽어보세요.
      </p>

      <div className="space-y-2">
        <AxisRow axisKey="arousal" before={before?.arousal ?? null} after={after?.arousal ?? null} />
        <AxisRow axisKey="valence" before={before?.valence ?? null} after={after?.valence ?? null} />
      </div>

      {comparison.summary && (
        <p data-testid="checkin-comparison-summary" className="mt-3 text-[13px] font-semibold text-[#5F0080]">
          {comparison.summary}
        </p>
      )}

      {note && (
        <p className="mt-4 rounded-xl bg-[#FAFAFA] px-4 py-3 text-[14px] leading-relaxed text-[#1F1F1F]">
          “{note}”
        </p>
      )}

      <div className="mt-4 border-t border-[#EFEFEF] pt-4 text-[13px] text-[#1F1F1F]">
        {eegMeasured && relaxationScore !== null ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-[#6F6F6F]">두뇌휴식도(뇌파)</span>
            <span className="rounded-full bg-[#F1FAF5] px-3 py-1 font-bold text-[#1F7A4C]">{relaxationScore}</span>
            {relaxationTrend && (
              <span className="text-[12px] text-[#6F6F6F]">
                시작 {relaxationTrend.first} → 마음 {relaxationTrend.last}
              </span>
            )}
            <span className="w-full text-[11px] leading-5 text-[#9B9B9B]">
              지표는 회원님의 느낌과 함께 읽어주세요. 측정 정보가 없는 항목은 해석하지 않습니다.
            </span>
          </div>
        ) : (
          <p className="text-[12px] leading-5 text-[#6F6F6F]">
            LINK BAND 미착용 세션입니다. 뇌파 지표 없이 회원님이 남긴 주관 기록만 표시합니다.
          </p>
        )}
      </div>
    </section>
  );
}
