// 내담자 리포트: '수업 전 → 수업 후' 사전·사후 설문(집중·편안함·감정 3축) 변화 + EEG 두뇌휴식도 병기
//
// 사전(before)·사후(after)가 같은 축이므로 차이(delta)를 보여 변화를 읽게 한다.
// 밴드 미착용(EEG not_measured) 세션은 주관 값만 보여준다 — 없는 지표를 해석하지 않는다.

import { SAM_AXES, type SubjectiveStateDto } from '../../lib/api/checkin';

interface SubjectiveCheckinCardProps {
  /** 참여자 스코프 주관 상태(사전·사후 설문). 미입력이면 부모가 카드를 마운트하지 않는다. */
  subjective: SubjectiveStateDto;
  /** 두뇌휴식도(relaxation_score) — 미측정이면 null */
  relaxationScore?: number | null;
  /** EEG 이완도 추이(세션 시작 지점 → 마지막 지점) — 표본 부족이면 null */
  relaxationTrend?: { first: number; last: number } | null;
  /** EEG가 측정되었는지 — false면 '주관 기록만' 안내 */
  eegMeasured?: boolean;
}

type AxisKey = 'arousal' | 'valence' | 'emotion';

function AxisDeltaRow({
  axisKey,
  before,
  after,
}: {
  axisKey: AxisKey;
  before: number | null;
  after: number | null;
}) {
  const axis = SAM_AXES.find((item) => item.key === axisKey);
  if (!axis || (before === null && after === null)) return null;

  const delta = before !== null && after !== null ? after - before : null;
  const deltaLabel = delta === null ? null : delta > 0 ? `+${delta}` : `${delta}`;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#EFEFEF] bg-white px-4 py-3">
      <p className="text-[12px] font-semibold text-[#6F6F6F]">{axis.label}</p>
      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
        {before !== null && (
          <span className="text-[12px] text-[#9B9B9B]">
            수업 전 <span className="font-bold text-[#1F1F1F]">{before}단계</span>
          </span>
        )}
        {before !== null && after !== null && <span className="text-[#9B9B9B]">→</span>}
        {after !== null && (
          <span className="text-[12px] text-[#9B9B9B]">
            수업 후 <span className="font-bold text-[#1F1F1F]">{after}단계</span>
            <span className="ml-1 text-[#9B9B9B]">{axis.steps[after as 1 | 2 | 3 | 4 | 5]}</span>
          </span>
        )}
        {deltaLabel !== null && (
          <span
            className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${
              delta! > 0
                ? 'bg-[#F1FAF5] text-[#1F7A4C]'
                : delta! < 0
                  ? 'bg-[#FDF2F2] text-[#B3433C]'
                  : 'bg-[#F5F5F5] text-[#6F6F6F]'
            }`}
          >
            {deltaLabel}
          </span>
        )}
      </div>
    </div>
  );
}

export default function SubjectiveCheckinCard({
  subjective,
  relaxationScore = null,
  relaxationTrend = null,
  eegMeasured = false,
}: SubjectiveCheckinCardProps) {
  const before = subjective.before;
  const after = subjective.after;
  const note = after?.note ?? null;
  const hasAnyValue =
    (before?.arousal ?? null) !== null ||
    (before?.valence ?? null) !== null ||
    (before?.emotion ?? null) !== null ||
    (after?.arousal ?? null) !== null ||
    (after?.valence ?? null) !== null ||
    (after?.emotion ?? null) !== null;

  return (
    <section
      data-testid="subjective-checkin-card"
      className="bg-white border border-[#EFEFEF] rounded-2xl p-6"
    >
      <h3 className="text-[15px] font-bold text-[#1F1F1F] mb-1 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-sm bg-[#5F0080]" />
        수업 전 → 수업 후
      </h3>
      <p className="mb-4 text-[12px] leading-5 text-[#6F6F6F]">
        회원님이 남긴 사전·사후 설문 기록입니다. 수업 전 대비 수업 후의 변화를 함께 읽어보세요.
      </p>

      {hasAnyValue ? (
        <div className="space-y-2">
          <AxisDeltaRow axisKey="arousal" before={before?.arousal ?? null} after={after?.arousal ?? null} />
          <AxisDeltaRow axisKey="valence" before={before?.valence ?? null} after={after?.valence ?? null} />
          <AxisDeltaRow axisKey="emotion" before={before?.emotion ?? null} after={after?.emotion ?? null} />
        </div>
      ) : (
        <p className="text-[12px] text-[#9B9B9B]">설문 기록이 없습니다.</p>
      )}

      {note && (
        <p className="mt-4 rounded-xl bg-[#FAFAFA] px-4 py-3 text-[15px] leading-relaxed text-[#1F1F1F]">
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
                시작 {relaxationTrend.first} → 마지막 {relaxationTrend.last}
              </span>
            )}
            <span className="w-full text-[12px] leading-5 text-[#9B9B9B]">
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
