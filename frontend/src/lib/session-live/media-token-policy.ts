// SDD-246 T06 — LiveKit 토큰 재발급 정책.
// 손 상태(hand_raised)만 바뀐 경우는 미디어 권한과 무관하므로 토큰을 다시 받지 않는다.
// (현행 useMemberLiveKit.ts:118 은 모든 speaking_changed 에서 재발급 → 늦은 응답이 can_publish 를 되돌릴 수 있었다.)

export interface MediaGrant {
  participantId: string;
  canPublish: boolean;
  grantVersion: string;
}

/** 재발급 필요 여부: can_publish 가 바뀌었거나 grant_version 이 앞으로 갔을 때만 true. */
export function shouldRefreshMediaToken(prev: MediaGrant | null, next: MediaGrant): boolean {
  if (!prev) return false;
  if (prev.participantId !== next.participantId) return false;
  if (prev.canPublish !== next.canPublish) return true;
  return BigInt(next.grantVersion) > BigInt(prev.grantVersion);
}

/** 토큰 응답 세대 가드 — 늦게 도착한 이전 요청 응답이 최신 권한을 되돌리지 못하게 한다. */
export class TokenRequestGate {
  private latest = 0;
  begin(): number {
    this.latest += 1;
    return this.latest;
  }
  isCurrent(ticket: number): boolean {
    return ticket === this.latest;
  }
}
