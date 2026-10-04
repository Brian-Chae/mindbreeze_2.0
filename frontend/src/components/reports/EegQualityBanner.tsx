// EEG 품질 게이트 배너 — mindbreeze 라이트 토큰
// valid/degraded/invalid/insufficient/lost (+ not_measured는 부모에서 미마운트)
// SDD-122: 유실(lost) 배너 + 사유 칩 + 커버리지 + "신뢰도 매우 낮음" 고지(B2)

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
        toneClass: 'border-[#D8EFE3] bg-[#F0F9F5] text-[#26724B]',
      };
    case 'degraded':
      return {
        title: '측정 품질 주의 (degraded)',
        body:
          reportType === 'counselor'
            ? '일부 구간 품질이 낮습니다. 지표는 포함하되 해석에 주의하세요.'
            : '일부 구간의 측정이 불안정해 참고용으로만 보여드려요.',
        toneClass: 'border-amber-200 bg-amber-50 text-amber-800',
      };
    case 'invalid':
      return {
        title: '품질 미달 — 뇌파 점수 미제공',
        body:
          reportType === 'counselor'
            ? '신뢰도가 기준 미만입니다. 종합점수·레이더를 채우지 않았습니다. EEG 제외 후 발송을 권고합니다.'
            : '이번 세션은 뇌파 참고를 생략했어요.',
        toneClass: 'border-red-200 bg-red-50 text-red-700',
      };
    case 'insufficient':
      return {
        title: '데이터 부족 — 뇌파 분석 생략',
        body:
          reportType === 'counselor'
            ? '유효 윈도우가 부족합니다. 종합점수·지표를 0으로 채우지 않았습니다.'
            : '이번 세션은 뇌파 참고를 생략했어요.',
        toneClass: 'border-orange-200 bg-orange-50 text-orange-800',
      };
    case 'lost':
      // SDD-122(A1): 내담자에겐 차분한 문구 + 이유, 상담사에겐 관리 문구.
      return {
        title:
          reportType === 'counselor'
            ? '뇌파 데이터가 유실되었습니다'
            : '뇌파가 측정되지 않았어요',
        body:
          reportType === 'counselor'
            ? '측정을 시도했으나 연결이 끊겨 유효한 뇌파 데이터가 수집되지 않았습니다.'
            : '측정을 시작했지만 중간에 연결이 끊겨 이번에는 뇌파 데이터가 기록되지 않았어요. 측정된 구간으로 안내드릴게요.',
        toneClass: 'border-rose-200 bg-rose-50 text-rose-800',
      };
  }
}

const LOSS_REASON_LABELS: Record<string, string> = {
  band_disconnect: '연결 끊김',
  ws_drop: '통신 단절',
  backend_error: '시스템 오류',
  low_quality: '저품질 신호',
};

function lossReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  return LOSS_REASON_LABELS[reason] ?? null;
}

export default function EegQualityBanner({ eeg, reportType }: EegQualityBannerProps) {
  if (eeg.status === 'not_measured') return null;

  const copy = statusCopy(eeg.status, reportType);
  const reliabilityText =
    reportType === 'counselor' && eeg.reliability !== null
      ? `reliability ${eeg.reliability.toFixed(2)}`
      : reportType === 'client'
        ? reliabilityLabel(eeg.reliability)
        : null;

  const reasonChip = lossReasonLabel(eeg.loss_reason);
  // SDD-122(B2): 유효 커버리지 < 50%면 "참고용 + 신뢰도 매우 낮음" 고지.
  const veryLowConfidence =
    eeg.status !== 'lost' &&
    eeg.coverage_ratio !== null &&
    eeg.coverage_ratio < 0.5;

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

      {(reasonChip || (reportType === 'counselor' && eeg.coverage_ratio !== null)) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {reasonChip && (
            <span className="rounded-full bg-white/70 px-2.5 py-0.5 text-[11px] font-medium">
              {reasonChip}
            </span>
          )}
          {reportType === 'counselor' && eeg.coverage_ratio !== null && (
            <span className="rounded-full bg-white/70 px-2.5 py-0.5 font-mono text-[11px]">
              커버리지 {Math.round(eeg.coverage_ratio * 100)}%
            </span>
          )}
        </div>
      )}

      {veryLowConfidence && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-white/70 px-3 py-2 text-[12px] text-amber-800">
          데이터 유실로 신뢰도가 매우 낮은 상태입니다. 아래 지표는 경향 참고용입니다.
        </p>
      )}

      {eeg.drowsiness_flag && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-white/70 px-3 py-2 text-[12px] text-amber-800">
          졸음 구간이 감지되었습니다. 지표 해석 시 참고하세요.
        </p>
      )}

      {reportType === 'counselor' && eeg.normalization_version && (
        <p className="mt-2 font-mono text-[10px] text-[#9B9B9B]">
          norm {eeg.normalization_version}
        </p>
      )}
    </div>
  );
}
