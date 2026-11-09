// SDD-324 — 리포트 요약 카드 계산(순수 함수). 값이 없는 신규 집계는 카드를 만들지 않는다(0 으로 그리지 않음).
import type { HierarchyResponse, HierarchyTab } from './api/report-hierarchy';

export type ReportSummary = HierarchyResponse['summary'];

export interface ReportSummaryCard {
  key: string;
  label: string;
  value: number;
  unit: string;
  basis: string;
  /** 클릭하면 이 탭으로 좁힌다. 없으면 표시만 한다. */
  tab?: HierarchyTab;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 요약 응답 → 카드 목록(순수 함수). 값이 없는 항목은 만들지 않는다. */
export function buildReportSummaryCards(summary: ReportSummary | null | undefined): ReportSummaryCard[] {
  if (!summary) return [];
  const cards: ReportSummaryCard[] = [];
  if (isNum(summary.total_members)) cards.push({ key: 'all', label: '회원별 항목', value: summary.total_members, unit: '건', basis: '회차별 참여자 행 수 (같은 회원 중복 포함)', tab: 'all' });
  cards.push({ key: 'needs_review', label: '검토 대기', value: summary.needs_review, unit: '건', basis: '승인 전 회원용 리포트', tab: 'needs_review' });
  cards.push({ key: 'failed', label: '발송 실패', value: summary.failed_delivery, unit: '건', basis: '회원용 리포트 발송 실패', tab: 'failed' });
  // 새 집계 응답(created_today 가 내려올 때)에서만 아래 항목을 쓴다 — 구 응답의 생성 실패는 범위가 달라 전역 요약으로 쓰지 않는다.
  if (isNum(summary.created_today)) {
    if (isNum(summary.generation_failed)) cards.push({ key: 'generation_failed', label: '생성 실패', value: summary.generation_failed, unit: '건', basis: '일부 생성 또는 오류 상태 문서' });
    cards.push({ key: 'created_today', label: '오늘 생성', value: summary.created_today, unit: '건', basis: '오늘(한국시간) 생성된 문서' });
  }
  if (isNum(summary.member_unread)) cards.push({ key: 'member_unread', label: '회원 미열람', value: summary.member_unread, unit: '건', basis: '공유된 회원용 리포트 중 아직 열지 않음' });
  if (isNum(summary.avg_review_hours) && isNum(summary.review_sample) && summary.review_sample > 0) {
    cards.push({ key: 'avg_review_hours', label: '평균 검토 소요', value: Math.round(summary.avg_review_hours * 10) / 10, unit: '시간', basis: `최근 승인 ${summary.review_sample}건 기준` });
  }
  return cards;
}

