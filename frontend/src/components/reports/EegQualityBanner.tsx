// EEG 품질 게이트 배너 — valid/degraded/invalid/insufficient (+ not_measured는 부모에서 미마운트)
// 다크 AI 톤: slate-950 + cyan/emerald 얇은 경계

import type { EegQualityStatus, ReportEegContent } from '../../lib/api/report';
import { reliabilityLabel } from '../../lib/api/report';
import type { ReportType } from '../../lib/api/reports';

interface EegQualityBannerProps {
  eeg: ReportEegContent;
  reportType: ReportType;
}

interface StatusCopy {
  title: string;
  body: string;
  /** Tailwind 보더/텍스트 톤 */
  toneClass: string;
}

function statusCopy(
  status: Exclude<EegQualityStatus, 'not_measured'>,
  reportType: ReportType,
): StatusCopy {
  switch (status) {
    case 'valid':
      return {
        title: '뇌파 측정 품질 양호',
        body:
          reportType === 'counselor'
            ? '품질 게이트를 통과했습니다. 7지표·타임라인을 참고용으로 활용하세요.'
            : '이번 세션의 뇌파 참고 지표를 확인할 수 있어요.',
        toneClass: 'border-emerald-400/30 bg-emerald-950/40 text-emerald-200',
      };
    case 'degraded':
      return {
        title: '측정 품질 주의 (degraded)',
        body:
          reportType === 'counselor'
            ? '일부 구간 품질이 낮습니다. 지표는 포함하되 해석에 주의하세요.'
            : '일부 구간의 측정이 불안정해 참고용으로만 보여드려요.',
        toneClass: 'border-amber-400/30 bg-amber-950/40 text-amber-200',
      };
    case 'invalid':
      return {
        title: '품질 미달 — 뇌파 점수 미제공',
        body:
          reportType === 'counselor'
            ? '신뢰도가 기준 미만입니다. 종합점수·레이더를 채우지 않았습니다. EEG 제외 후 발송을 권고합니다.'
            : '이번 세션은 뇌파 참고를 생략했어요.',
        toneClass: 'border-red-400/30 bg-red-950/50 text-red-200',
      };
    case 'insufficient':
      return {
        title: '데이터 부족 — 뇌파 분석 생략',
        body:
          reportType === 'counselor'
            ? '유효 윈도우가 부족합니다. 종합점수·지표를 0으로 채우지 않았습니다.'
            : '이번 세션은 뇌파 참고를 생략했어요.',
        toneClass: 'border-orange-400/30 bg-orange-950/40 text-orange-200',
      };
  }
}

export default function EegQualityBanner({ eeg, reportType }: EegQualityBannerProps) {
  // not_measured는 섹션 자체가 마운트되지 않음
  if (eeg.status === 'not_measured') return null;

  const copy = statusCopy(eeg.status, reportType);
  const reliabilityText =
    reportType === 'counselor' && eeg.reliability !== null
      ? `reliability ${eeg.reliability.toFixed(2)}`
      : reportType === 'client'
        ? reliabilityLabel(eeg.reliability)
        : null;

  return (
    <div
      role="status"
      className={`rounded-xl border px-4 py-3 ${copy.toneClass}`}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold tracking-tight">{copy.title}</p>
          <p className="mt-1 text-[12px] leading-relaxed opacity-90">{copy.body}</p>
        </div>
        {reliabilityText && (
          <span className="shrink-0 font-mono text-[11px] opacity-80">
            {reliabilityText}
          </span>
        )}
      </div>

      {eeg.drowsiness_flag && (
        <p className="mt-2 rounded-lg border border-amber-400/25 bg-black/30 px-3 py-2 text-[12px] text-amber-100">
          졸음 구간이 감지되었습니다. 지표 해석 시 참고하세요.
        </p>
      )}

      {reportType === 'counselor' && eeg.normalization_version && (
        <p className="mt-2 font-mono text-[10px] text-slate-400">
          norm {eeg.normalization_version}
        </p>
      )}
    </div>
  );
}
