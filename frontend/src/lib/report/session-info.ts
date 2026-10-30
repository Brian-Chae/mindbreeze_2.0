// 리포트 커버 요약(클래스·진행 시간·기록된 신호·날짜·품질)용 세션 정보 — ReportDto + content 에서 만드는 순수 함수.
// 값을 만들 수 없는 항목은 undefined 로 남겨 커버가 자체 안내 문구를 쓰게 한다(임의 값 생성 금지).
import type { ReportSessionInfo } from '../../components/reports/NarrativeSections';
import { reliabilityLabel, type AdaptedReportContent, type EegQualityStatus } from '../api/report';
import type { ReportDto } from '../api/reports';

/** 참가자가 리포트 제외를 선택해 표시하지 않는 경우의 안내(실제 미측정 문구와 구분) */
export const REPORT_EXCLUDED_NOTICE = '참가자가 리포트 제외를 선택해 표시하지 않아요 (측정 데이터는 보관 중)';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

const QUALITY_STATUS_LABELS: Record<EegQualityStatus, string> = {
  valid: '측정 상태가 안정적이었어요.',
  degraded: '일부 구간의 측정 품질이 낮아 참고용으로 봐 주세요.',
  invalid: '측정 품질이 낮아 수치는 참고용으로만 봐 주세요.',
  insufficient: '측정 시간이 짧아 수치는 참고용으로만 봐 주세요.',
  lost: '측정이 중간에 끊겨 일부 구간만 기록됐어요.',
  not_measured: '밴드 측정 없이 진행된 세션이에요.',
};

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => String(n).padStart(2, '0');

function clockLabel(d: Date): string {
  const h = d.getHours();
  const period = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${h12}:${pad(d.getMinutes())}`;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 진행 시간(분): 서버가 준 값 → 없으면 EEG 타임라인의 마지막 분. */
function resolveDurationMinutes(report: ReportDto, adapted: AdaptedReportContent): number | undefined {
  const content = report.content ?? {};
  const explicit =
    finitePositive(content.duration_min) ??
    finitePositive(content.duration_minutes) ??
    finitePositive(content.session_duration_min);
  if (explicit != null) return Math.round(explicit);
  const last = adapted.eeg_timeline.reduce((max, p) => (Number.isFinite(p.min) && p.min > max ? p.min : max), 0);
  return last > 0 ? Math.max(1, Math.round(last)) : undefined;
}

function hasValue(values: Array<number | null | undefined>): boolean {
  return values.some((v) => v != null && Number.isFinite(v));
}

/** 실제 기록된 신호만 나열한다. 측정이 없으면 그에 맞는 문구를 돌려준다. */
function resolveRecordedSignals(adapted: AdaptedReportContent): string {
  const eeg = adapted.eeg;
  if (adapted.eegExcluded) return REPORT_EXCLUDED_NOTICE;
  if (!eeg || eeg.status === 'not_measured') return '밴드 측정 없음';
  const timeline = adapted.eeg_timeline;
  const signals: string[] = [];
  const eegRecorded =
    hasValue(timeline.flatMap((p) => [p.concentration, p.relaxation, p.stress])) ||
    hasValue(Object.values(eeg.metrics));
  if (eegRecorded) signals.push('뇌파');
  if (hasValue(timeline.flatMap((p) => [p.heart_rate, p.sdnn, p.hrv]))) signals.push('맥파');
  if (hasValue(timeline.map((p) => p.respiratory_rate))) signals.push('호흡');
  return signals.length > 0 ? signals.join(' · ') : '기록된 신호 없음';
}

function resolveQualityLabel(adapted: AdaptedReportContent): string | undefined {
  if (adapted.eegExcluded) return REPORT_EXCLUDED_NOTICE;
  const eeg = adapted.eeg;
  if (!eeg) return undefined;
  if (eeg.status === 'valid') return reliabilityLabel(eeg.reliability) ?? QUALITY_STATUS_LABELS.valid;
  return QUALITY_STATUS_LABELS[eeg.status];
}

export function buildReportSessionInfo(report: ReportDto, adapted: AdaptedReportContent): ReportSessionInfo {
  const when = parseDate(report.scheduled_at) ?? parseDate(report.created_at);
  const durationMinutes = resolveDurationMinutes(report, adapted);

  let dateLabel: string | undefined;
  let shortDate: string | undefined;
  let timeLabel: string | undefined;
  if (when) {
    dateLabel = `${when.getFullYear()}년 ${when.getMonth() + 1}월 ${when.getDate()}일 ${WEEKDAYS[when.getDay()]}요일`;
    shortDate = `${when.getFullYear()}. ${pad(when.getMonth() + 1)}. ${pad(when.getDate())}`;
    // 예정 시각이 있을 때만 시각 범위를 만든다(생성 시각은 세션 시작과 무관).
    const start = parseDate(report.scheduled_at);
    if (start) {
      if (durationMinutes != null) {
        const end = new Date(start.getTime() + durationMinutes * 60_000);
        timeLabel = `${clockLabel(start)}–${clockLabel(end)} · ${durationMinutes}분`;
      } else {
        timeLabel = clockLabel(start);
      }
    }
  }
  if (!timeLabel && durationMinutes != null) timeLabel = `${durationMinutes}분`;

  return {
    participantName: report.participant_name?.trim() || undefined,
    dateLabel,
    shortDate,
    className: report.session_title?.trim() || undefined,
    timeLabel,
    durationMinutes,
    recordedSignals: resolveRecordedSignals(adapted),
    qualityLabel: resolveQualityLabel(adapted),
  };
}
