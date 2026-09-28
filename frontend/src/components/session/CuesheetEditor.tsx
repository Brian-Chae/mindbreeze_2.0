// 개선 7: 진행 큐시트(타임라인 대본) 작성기 — 클래스 생성 폼의 단계별 편집 UI.
//
// 상담사가 명상 클래스 흐름(도입 호흡 → 바디스캔 → 마무리 등)을 단계별 라벨·목표시간(분)·메모로
// 적어 둔다. 저장된 큐시트는 상담사 플레이어에서 현재 단계 하이라이트·남은 시간 진행바로 쓰인다.
import type { CuesheetStep } from '../../lib/api/session';
import {
  CUESHEET_MAX_STEPS,
  CUE_LABEL_MAX_LEN,
  CUE_NOTE_MAX_LEN,
  cuesheetTotalMin,
} from '../../lib/class/cuesheet';

interface CuesheetEditorProps {
  value: CuesheetStep[];
  onChange: (steps: CuesheetStep[]) => void;
  /** 클래스 소요 시간(분) — 큐시트 합계와 다르면 안내한다(차단하지 않음) */
  classDurationMin?: number;
}

/** 명상 클래스 기본 흐름 — 빈 큐시트에서 원클릭으로 시작점을 제공한다 */
export const MEDITATION_CUE_PRESET: CuesheetStep[] = [
  { label: '도입 호흡', duration_min: 5, note: '편안히 앉아 4-7-8 호흡' },
  { label: '바디스캔', duration_min: 20, note: '발끝에서 머리까지 천천히 훑기' },
  { label: '마무리', duration_min: 5, note: '느린 심호흡 후 천천히 눈 뜨기' },
];

const inputCls =
  'w-full px-3 py-2 border border-[#DDDEE7] rounded-lg bg-white text-[#1F1F1F] text-sm focus:outline-none focus:ring-2 focus:ring-[#5F0080]/15 focus:border-[#5F0080]';

export function CuesheetEditor({ value, onChange, classDurationMin }: CuesheetEditorProps) {
  const totalMin = cuesheetTotalMin(value);
  const atMax = value.length >= CUESHEET_MAX_STEPS;
  const diff = classDurationMin != null ? totalMin - classDurationMin : 0;

  /** 불변 갱신 — 지정한 단계만 교체한 새 배열을 만든다 */
  const updateStep = (index: number, patch: Partial<CuesheetStep>): void => {
    onChange(value.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  };

  const removeStep = (index: number): void => {
    onChange(value.filter((_, i) => i !== index));
  };

  const addStep = (): void => {
    if (atMax) return;
    onChange([...value, { label: '', duration_min: 5, note: '' }]);
  };

  return (
    <div className="rounded-xl border border-[#E6E1DA] bg-[#FAF9F7] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#1F1F1F]">진행 큐시트 (타임라인 대본)</p>
          <p className="mt-1 text-xs text-[#6F6F6F]">
            단계별 목표 시간을 적어 두면 진행 화면에서 현재 단계와 남은 시간을 볼 수 있습니다.
            회원에게는 표시되지 않습니다.
          </p>
        </div>
        {value.length > 0 && (
          <span className="shrink-0 rounded-full bg-[#F5EDFC] px-3 py-1 text-xs font-medium text-[#5F0080]">
            {value.length}단계 · {totalMin}분
          </span>
        )}
      </div>

      {value.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-[#DDD0EA] bg-white px-4 py-4 text-center">
          <p className="text-sm text-[#6F6F6F]">아직 단계가 없습니다.</p>
          <div className="mt-2 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => onChange(MEDITATION_CUE_PRESET.map((s) => ({ ...s })))}
              className="mb-btn mb-btn--ghost text-sm"
            >
              명상 기본 흐름 넣기
            </button>
            <button type="button" onClick={addStep} className="mb-btn mb-btn--ghost text-sm">
              빈 단계 추가
            </button>
          </div>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {value.map((step, index) => (
            <li
              key={index}
              className="rounded-lg border border-[#EAE6F0] bg-white px-3 py-3"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F5EDFC] text-xs font-bold text-[#5F0080]">
                  {index + 1}
                </span>
                <input
                  type="text"
                  aria-label={`${index + 1}단계 라벨`}
                  maxLength={CUE_LABEL_MAX_LEN}
                  placeholder="단계 이름 (예: 도입 호흡)"
                  value={step.label}
                  onChange={(e) => updateStep(index, { label: e.target.value })}
                  className={inputCls}
                />
                <div className="flex shrink-0 items-center gap-1">
                  <input
                    type="number"
                    aria-label={`${index + 1}단계 목표 시간(분)`}
                    min={1}
                    max={600}
                    value={step.duration_min}
                    onChange={(e) =>
                      updateStep(index, {
                        duration_min: e.target.value === '' ? 0 : Number(e.target.value),
                      })
                    }
                    className={`${inputCls} w-20 text-center`}
                  />
                  <span className="text-xs text-[#6F6F6F]">분</span>
                </div>
                <button
                  type="button"
                  aria-label={`${index + 1}단계 삭제`}
                  onClick={() => removeStep(index)}
                  className="shrink-0 rounded-lg px-2 py-1 text-sm text-[#B3261E] transition hover:bg-[#FDF1F0]"
                >
                  ✕
                </button>
              </div>
              <input
                type="text"
                aria-label={`${index + 1}단계 메모`}
                maxLength={CUE_NOTE_MAX_LEN}
                placeholder="메모 (선택) — 예: 4-7-8 호흡으로 몸 이완"
                value={step.note ?? ''}
                onChange={(e) => updateStep(index, { note: e.target.value })}
                className={`${inputCls} mt-2 text-xs`}
              />
            </li>
          ))}
        </ul>
      )}

      {value.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={addStep}
            disabled={atMax}
            className="mb-btn mb-btn--ghost text-sm disabled:opacity-50"
          >
            {atMax ? `단계는 최대 ${CUESHEET_MAX_STEPS}개` : '+ 단계 추가'}
          </button>
          {classDurationMin != null && diff !== 0 && (
            <p className="text-xs text-[#8A6B1F]">
              {diff > 0
                ? `큐시트 합계가 클래스 소요 시간보다 ${diff}분 깁니다.`
                : `큐시트 합계가 클래스 소요 시간보다 ${-diff}분 짧습니다.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default CuesheetEditor;
