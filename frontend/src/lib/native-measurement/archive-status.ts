// SDD-246 T06 — 업로드 상태 표시: '보류'(자동 재시도 중, 사용자 조치 불필요) vs '확인 필요'(사람/권한/저장소 조치 필요).
// 데이터 유실 단정 금지: 둘 다 로컬 보존 중이라는 의미만 전달한다.
import type { QueueCounts, BlockedReason } from './types';

export type ArchiveStatusKind = 'ok' | 'hold' | 'needs_review';

export interface ArchiveStatusView {
  kind: ArchiveStatusKind;
  label: '정상' | '보류' | '확인 필요';
  detail: string;
}

const REVIEW_BLOCKS: readonly BlockedReason[] = [
  'storage_full', 'auth_expired', 'account_mismatch', 'consent_missing', 'owner_fenced',
];

export function describeArchiveStatus(queue: QueueCounts, blocked: BlockedReason | null): ArchiveStatusView {
  if (queue.pending_authorization > 0 || queue.pending_time_review > 0 || (blocked && REVIEW_BLOCKS.includes(blocked))) {
    return {
      kind: 'needs_review',
      label: '확인 필요',
      detail: '기기에 보관 중입니다. 로그인·동의·저장 공간 또는 시각 검토가 필요해 자동으로 올라가지 않습니다.',
    };
  }
  if (queue.archive_pending > 0 || queue.live_pending > 0) {
    return {
      kind: 'hold',
      label: '보류',
      detail: '기기에 보관 중이며 연결이 되면 자동으로 올라갑니다.',
    };
  }
  return { kind: 'ok', label: '정상', detail: '모두 올라갔습니다.' };
}
