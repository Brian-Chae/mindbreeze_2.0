// SDD-289 — 정원 늘리기 순수 규칙(검증·오류 문구·성공 안내). 화면과 시험이 같은 규칙을 쓴다.
import { ApiError } from '../api/client';

export const ONLINE_CAPACITY_MAX = 50;
export const OFFLINE_CAPACITY_MAX = 100;

export const capacityMax = (online: boolean): number => (online ? ONLINE_CAPACITY_MAX : OFFLINE_CAPACITY_MAX);

export type CapacityInputError = 'not_integer' | 'not_increase' | 'below_occupied' | 'over_max' | null;

/** 입력 검증: 정수만, 현재 정원 초과(늘리기만), 현재 입장 인원 이상, 방식별 상한 이하 */
export function validateCapacityInput(raw: string, ctx: { current: number; occupied: number; online: boolean }): { value: number | null; error: CapacityInputError } {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return { value: null, error: 'not_integer' };
  const value = Number(text);
  if (value < ctx.occupied) return { value, error: 'below_occupied' };
  if (value <= ctx.current) return { value, error: 'not_increase' };
  if (value > capacityMax(ctx.online)) return { value, error: 'over_max' };
  return { value, error: null };
}

export function capacityInputMessage(error: Exclude<CapacityInputError, null>, ctx: { current: number; occupied: number; online: boolean }): string {
  switch (error) {
    case 'not_integer': return '정원은 숫자로 입력해 주세요.';
    case 'below_occupied': return `현재 입장 인원(${ctx.occupied}명)보다 적게 정할 수 없어요.`;
    case 'not_increase': return `현재 정원(${ctx.current}명)보다 큰 숫자를 입력해 주세요. 정원은 늘리기만 할 수 있어요.`;
    case 'over_max': return `${ctx.online ? '온라인' : '오프라인'} 클래스는 최대 ${capacityMax(ctx.online)}명까지 정할 수 있어요.`;
  }
}

const SERVER_MESSAGES: Record<string, string> = {
  capacity_below_occupied: '현재 입장 인원보다 적게 정할 수 없어요.',
  capacity_not_increase: '현재 정원보다 큰 숫자만 입력할 수 있어요.',
  online_capacity_exceeded: '온라인 클래스는 최대 50명까지 정할 수 있어요.',
  reason_required: '센터 관리자는 변경 사유를 입력해 주세요.',
  stale_class: '다른 변경이 있었어요. 최신 정원을 불러온 뒤 다시 시도해 주세요.',
  class_not_active: '진행 중인 클래스만 정원을 바꿀 수 있어요.',
  operation_key_reused: '같은 요청이 다른 내용으로 보내졌어요. 닫았다가 다시 시도해 주세요.',
};

export function capacityServerMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = (error.data as { detail?: unknown } | null)?.detail;
    const code = typeof detail === 'object' && detail !== null ? (detail as { code?: unknown }).code : undefined;
    if (typeof code === 'string' && SERVER_MESSAGES[code]) return SERVER_MESSAGES[code];
    if (error.status === 403) return '정원을 바꿀 권한이 없어요.';
  }
  return '정원을 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요.';
}

export function capacitySuccessMessage(newCapacity: number, promoted: number): string {
  return promoted > 0
    ? `정원을 ${newCapacity}명으로 늘렸어요. 대기 중이던 ${promoted}명을 입장 처리했어요. 실제 입장 인원은 접속을 확인한 뒤 갱신돼요.`
    : `정원을 ${newCapacity}명으로 늘렸어요.`;
}
