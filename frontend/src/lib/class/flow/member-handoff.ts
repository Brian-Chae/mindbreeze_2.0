// SDD-209 M0 — 코드 입장 화면 → 입장 흐름 화면으로 넘기는 일회성 메모리 전달.
// 이름처럼 저장소(sessionStorage·URL·history state)에 남기면 안 되는 값을 모듈 변수로만 잇는다. 새로고침하면 사라진다.
interface EntryHandoff {
  sessionId: string;
  displayName: string;
}

let pending: EntryHandoff | null = null;

export function setEntryHandoff(handoff: EntryHandoff): void {
  pending = handoff;
}

/** 해당 클래스용 전달값을 한 번 꺼낸다(다른 클래스용이면 null) */
export function takeEntryHandoff(sessionId: string): EntryHandoff | null {
  if (!pending || pending.sessionId !== sessionId) return null;
  const value = pending;
  pending = null;
  return value;
}

export function clearEntryHandoff(): void {
  pending = null;
}
