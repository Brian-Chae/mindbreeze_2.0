// 입장 확인 화면(/class/:sessionId/enter) 뒤로가기 목적지 판정.
// 로그인 회원은 들어온 곳(history)으로, 기록이 없으면(푸시·딥링크·새 탭) 회원 홈으로 보낸다.
// 비로그인·게스트(코드 입장)만 입장 코드 화면으로 보낸다.

export type EntryBackTarget = { kind: 'history' } | { kind: 'path'; path: string };

export interface EntryBackInput {
  /** window.history.state.idx (react-router 가 기록). 없으면 undefined */
  historyIdx: number | undefined;
  isAuthenticated: boolean;
  /** 입장 자격이 게스트(코드 입장)인지 */
  isGuest: boolean;
}

export function resolveEntryBack({ historyIdx, isAuthenticated, isGuest }: EntryBackInput): EntryBackTarget {
  if (!isAuthenticated || isGuest) return { kind: 'path', path: '/join' };
  if (typeof historyIdx === 'number' && historyIdx > 0) return { kind: 'history' };
  return { kind: 'path', path: '/app' };
}
