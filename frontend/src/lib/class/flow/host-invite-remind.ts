// SDD-209 H6 — 로비 `회원 초대` 시트의 재발송 결과 문구. 서버의 InviteRemindResult.status 는 "요청 결과"이며
// 푸시 수신·전달 완료를 뜻하지 않는다(P7). 문구에 받았다·전달됐다를 쓰지 않는다.
import type { InviteRemindResponse } from '../../api/class-flow-host';
import type { LobbyRosterEntry } from './host-lobby-model';

/** 서버 status 가 아직 없으면 null(= 초대 등록만 된 상태) */
export type AwayRemindStatus = string | null;

export interface AwayRow {
  id: string;
  name: string;
  status: AwayRemindStatus;
}

/** 시트 행 문구. null(재발송 전)은 초대 등록 성공이다 */
export function remindStatusText(status: AwayRemindStatus): string {
  switch (status) {
    case null:
      return '초대했어요';
    case 'queued':
      return '요청했어요 · 잠시 후 다시 할 수 있어요';
    case 'skipped_cooldown':
      return '잠시 후 다시 할 수 있어요';
    case 'skipped_no_account':
      return '알림을 요청할 수 없는 회원이에요';
    case 'skipped_notification_off':
      return '알림을 받지 않도록 설정한 회원이에요';
    case 'skipped_waitlisted':
      return '대기열에 있어요';
    case 'not_found':
      return '찾을 수 없는 회원이에요';
    default:
      return '요청하지 못했어요';
  }
}

/** `재시도` 를 보일 수 있는 결과(서버 오류·알 수 없는 상태) */
export function isRemindRetryable(status: AwayRemindStatus): boolean {
  if (status === null) return false;
  return !['queued', 'skipped_cooldown', 'skipped_no_account', 'skipped_notification_off', 'skipped_waitlisted', 'not_found'].includes(status);
}

/** 이번에 다시 알릴 수 있는 사람(재발송 직후 요청·쿨다운 중인 사람은 제외) */
export function isRemindable(status: AwayRemindStatus): boolean {
  return status === null || isRemindRetryable(status);
}

export function buildAwayRows(away: readonly LobbyRosterEntry[], results: ReadonlyMap<string, string>): AwayRow[] {
  return away.map((a) => ({ id: a.participantId, name: a.name, status: results.get(a.participantId) ?? null }));
}

/** 재발송 응답 → participant_id 별 status (응답에 없는 대상은 건드리지 않는다) */
export function remindResultsById(response: InviteRemindResponse): Map<string, string> {
  return new Map(response.results.map((r) => [r.participant_id, r.status]));
}

/** `N명에게 다시 알림` 에 들어갈 대상 id (등록만 된 사람 + 실패한 사람) */
export function remindTargets(rows: readonly AwayRow[]): string[] {
  return rows.filter((r) => isRemindable(r.status)).map((r) => r.id);
}

/** 쿨다운 안내(초) → 문구 */
export function cooldownText(sec: number): string {
  if (sec <= 0) return '';
  return sec >= 60 ? `${Math.ceil(sec / 60)}분 뒤에 다시 할 수 있어요` : `${sec}초 뒤에 다시 할 수 있어요`;
}
