// 개선 8: 상담사 상단 — 그룹 익명 집계 상태를 **단일 게이지**로 차분하게 표시한다.
//
// - 축 하나(0-100)에 이완·집중 두 마커만 얹는다: 개인별 카드·순위·경고색을 쓰지 않는다.
// - 가운데 눈금이 개인 baseline(=50)이며, 마커가 어느 쪽으로 얼마나 벗어났는지만 보여준다.
// - 착용자가 부족하면(표본 적음) 흐리게 표시하고 점수를 숨긴다(근거 없는 숫자 금지).
// - 집계 자체가 아직 도착하지 않았으면(aggregate=null) "집계 대기" 흐린 상태로 자리를 지킨다.

import { buildGaugeModel, type ClassAggregateEvent } from '../../lib/class/group-aggregate';

interface GroupAggregateGaugeProps {
  /** 서버(`class:aggregate`) 집계 — 아직 없으면 null */
  aggregate: ClassAggregateEvent | null;
  className?: string;
}

export function GroupAggregateGauge({ aggregate, className = '' }: GroupAggregateGaugeProps) {
  const model = buildGaugeModel(aggregate);
  const sampleState = aggregate ? (model.dimmed ? 'insufficient' : 'ok') : 'pending';

  return (
    <section
      data-testid="group-aggregate-gauge"
      data-sample={sampleState}
      data-dimmed={model.dimmed ? 'true' : 'false'}
      data-pace={model.pace}
      aria-label={model.ariaLabel}
      className={`rounded-2xl bg-white p-4 transition-opacity ${
        model.dimmed ? 'opacity-45 saturate-50' : 'opacity-100'
      } ${className}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F]">
            그룹 상태
          </span>
          <span className="text-[11px] text-[#9B9B9B]">익명 집계 · 기준선 대비</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#F2F3F8] px-2.5 py-1 text-[11px] font-medium tabular-nums text-[#6F6F6F]">
            {model.sampleLabel}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${model.paceChipClass}`}
          >
            {model.paceLabel}
          </span>
        </div>
      </header>

      {/* 단일 게이지 — 축 하나에 두 마커. 가운데 눈금 = 개인 기준선(50) */}
      <div className="relative mt-4 h-6" role="img" aria-label={model.ariaLabel}>
        <div className="absolute inset-x-0 top-2 h-2 rounded-full bg-[#F2F3F8]" />
        {/* 기준선 눈금 */}
        <div
          data-testid="gauge-baseline"
          className="absolute top-0 h-6 w-px bg-[#9B9B9B]/70"
          style={{ left: '50%' }}
        />
        {model.markers.map((marker) => (
          <div
            key={marker.key}
            data-marker={marker.key}
            data-value={marker.value === null ? '' : String(marker.value)}
            className="absolute top-1 h-4 w-[3px] rounded-full"
            style={{ left: `calc(${marker.percent}% - 1.5px)` }}
          >
            <span className={`block h-4 w-[3px] rounded-full ${marker.lineClass}`} />
            <span
              className={`absolute -top-0.5 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full ${marker.dotClass}`}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-[#9B9B9B]">
        <span>기준선 아래</span>
        <span className="tabular-nums">기준선 0</span>
        <span>기준선 위</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#3F3F46]">
        {model.markers.map((marker) => (
          <span key={marker.key} data-marker-text={marker.key} className="tabular-nums">
            <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${marker.dotClass}`} />
            {marker.text}
          </span>
        ))}
      </div>

      {model.hint && (
        <p className="mt-2 text-[12px] leading-relaxed text-[#6F6F6F]">{model.hint}</p>
      )}

      {/* 표본이 적으면 근거가 약하다는 사실을 문장으로 남긴다(숫자로 눈속임하지 않는다) */}
      {aggregate && model.dimmed && (
        <p className="mt-1 text-[11px] text-[#9B9B9B]">
          착용자가 {aggregate.min_wearers}명 이상이고 2분 기준선이 쌓이면 그룹 지표가 표시됩니다
          (현재 캘리브레이션 완료 {aggregate.calibrated_count}명).
        </p>
      )}
    </section>
  );
}

export default GroupAggregateGauge;
