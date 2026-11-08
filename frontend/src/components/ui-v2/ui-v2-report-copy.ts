// SDD-318 F-B — 리포트 시트 문구·커버 계산(순수 함수). 컴포넌트 파일과 분리해 단위 시험한다.
import type { ReportDto } from '../../lib/api/reports';

/** 세션 유형 영문 내부값 → 회원용 한글 라벨. 알 수 없는 값은 노출하지 않고 일반 라벨로 대체한다. */
const SESSION_TYPE_LABELS: Record<string, string> = {
  meditation: '명상수업',
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  custom: '수업',
};
export function sessionTypeLabel(type: string | null | undefined): string {
  return (type && SESSION_TYPE_LABELS[type]) || '리포트';
}

export const NO_BAND_NOTICE = '이번 시간에는 밴드를 착용하지 않았어요. 측정 기록 없이도 함께 나눈 이야기와 코치의 기록을 볼 수 있어요.';

export interface UiV2ReportCover { eyebrow: string; title: string }

/** 커버 문구 — 같은 문구가 eyebrow·제목·본문에 반복되지 않도록 헤드라인 유무로 분기한다(B4). */
export function buildReportCover(report: ReportDto, headline: string | null): UiV2ReportCover {
  const sessionTitle = report.session_title?.trim() || '';
  const head = headline?.trim() || '';
  if (head && head !== sessionTitle) return { eyebrow: sessionTitle || sessionTypeLabel(report.session_type), title: head };
  return { eyebrow: sessionTypeLabel(report.session_type), title: sessionTitle || head || '리포트 상세' };
}
