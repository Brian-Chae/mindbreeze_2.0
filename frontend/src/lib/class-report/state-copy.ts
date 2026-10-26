import type { ClassReportStatus } from './types';
export const STATE_COPY: Record<ClassReportStatus, string> = {
  measured: '측정한 참여자의 수업 흐름을 기록했어요.',
  partial: '측정한 사람 기준으로 정리했어요. 전체 참석자를 대표하지는 않아요.',
  single: '측정은 1명이라 클래스 평균은 보여드리지 않아요. 참여자별 결과에서 확인해 주세요.',
  poor_signal: '신호가 고르지 않아 일부 지표는 계산하지 못했어요.',
  lost: '일부 구간은 연결이 끊겨 제외됐어요.',
  unworn: '이번 수업은 LINK BAND 없이 진행됐어요. 참여 기록과 코멘트로 리포트를 이어갈 수 있어요.',
  pending: '수업 분석이 진행 중이에요. 완료되면 이 자리에 이야기가 채워져요.',
  error: '요약을 불러오지 못했어요.', zero: '이번 수업에는 참석 기록이 없어요.',
};
export const stateCopy = (status: ClassReportStatus): string => STATE_COPY[status];
