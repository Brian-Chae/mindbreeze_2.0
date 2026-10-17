// SDD-209 H8 — 하니스 픽스처: FH10 닫힘·오류 7케이스
import type { FlowCaseEntry } from '../../../../lib/class/flow/types';
import type { HostStateKind } from '../../../../lib/class/flow/host-state-model';
import { LOBBY_TITLE } from '../../../../lib/class/flow/host-lobby-fixtures';
import { HostStateScreen } from './HostStateScreen';

function stateCase(description: string, kind: HostStateKind, extra: { waiting?: number; closedAtText?: string } = {}): FlowCaseEntry {
  return { description, render: (ctx) => <HostStateScreen kind={kind} title={LOBBY_TITLE} backdropSrc={ctx.backdropSrc} onAction={() => undefined} {...extra} /> };
}

export const hostStateCases: Record<string, FlowCaseEntry> = {
  'FH10:closed': stateCase('방금 닫음 — 회원 3명 안내', 'closed', { waiting: 3, closedAtText: '오늘 오후 2:41' }),
  'FH10:closed-0': stateCase('방금 닫음 — 대기 회원 없음', 'closed-0', { waiting: 0, closedAtText: '오늘 오후 2:41' }),
  'FH10:closed-revisit': stateCase('닫힌 클래스 재진입(닫은 시각·인원 없음)', 'closed-revisit'),
  'FH10:error': stateCase('오류 — 일반', 'error'),
  'FH10:error-notfound': stateCase('오류 — 찾을 수 없음', 'error-notfound'),
  'FH10:error-forbidden': stateCase('오류 — 내 클래스 아님', 'error-forbidden'),
  'FH10:error-network': stateCase('오류 — 연결 끊김', 'error-network'),
};
