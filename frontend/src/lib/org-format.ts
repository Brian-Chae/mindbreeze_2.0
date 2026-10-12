// 기관 종류·생성일 표시 포맷 — 기관 관리 화면이 공유한다.

export const orgKindLabel = (kind: string): string =>
  ({ institution: '일반 기관', individual: '개인 기관' })[kind] ?? '확인 필요';

export function orgDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '확인 필요' : new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}
