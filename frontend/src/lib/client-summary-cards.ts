// SDD-324 — 회원 요약 카드 계산(순수 함수). 신규 집계 필드가 없으면 카드를 만들지 않는다.
import type { ClientSummaryExtra } from './api/clients';
import type { SummaryCardItem } from '../components/ui-v2/ui-v2-summary-cards';

// 상단 요약: 검색·필터 전 같은 코치 범위의 별도 total. null = 조회 실패(0 으로 표시하지 않는다).
export interface ClientSummaryState { connected: number | null; d7: number | null; d30: number | null; extra: ClientSummaryExtra | null }
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 요약 상태 → 카드(순수 함수). 신규 집계 필드가 없으면 카드를 만들지 않는다. */
export function buildClientSummaryCards(sum: ClientSummaryState, days: number | null, setDays: (d: number | null) => void): SummaryCardItem[] {
  const cards: SummaryCardItem[] = [
    { key: 'connected', label: '연결 회원', value: sum.connected, unit: '명', basis: '내가 볼 수 있는 전체 회원', active: days === null, onClick: () => setDays(null) },
    { key: 'd7', label: '최근 7일 활동', value: sum.d7, unit: '명', basis: '7일 안에 클래스·체크인·측정 활동', active: days === 7, onClick: () => setDays(7) },
    { key: 'd30', label: '최근 30일 활동', value: sum.d30, unit: '명', basis: '30일 안에 활동 (7일 활동 포함)', active: days === 30, onClick: () => setDays(30) },
  ];
  const e = sum.extra;
  if (e && isNum(e.week_attended)) cards.push({ key: 'week_attended', label: '이번 주 참여', value: e.week_attended, unit: '명', basis: '월요일 이후 실제 참여한 회원' });
  if (e && isNum(e.inactive_14d)) cards.push({ key: 'inactive_14d', label: '최근 2주 참여 없음', value: e.inactive_14d, unit: '명', basis: '14일간 수업 참여 기록 없음' });
  if (e && isNum(e.report_unread_members)) cards.push({ key: 'report_unread', label: '리포트 미열람', value: e.report_unread_members, unit: '명', basis: '공유된 리포트를 아직 열지 않은 회원' });
  if (e && isNum(e.band_worn_members) && isNum(e.attended_members)) cards.push({ key: 'band', label: '밴드 사용', value: e.band_worn_members, unit: '명', basis: `참여 ${e.attended_members.toLocaleString('ko-KR')}명 중 착용한 회원 수` });
  return cards;
}

