# [SDD-110] — Implementation Plan

> FE `socket.ts` 단일 파일 변경(훅 변경 없음). Stage ③ Verify 후 구현.

## 변경: `frontend/src/lib/socket.ts`

### 1. module-level join 상태 추적
```ts
let liveCurrentSession: string | null = null;
let liveCurrentParticipantId: string | null = null;
let liveSnapshotCache: SessionLiveJoinSnapshot | null = null; // last 'joined'
```

### 2. join dedup (`joinSessionLive`)
- 이미 `liveCurrentSession === sessionId`이고 socket.connected면 **skip**(재emit 금지).
- 아니면 emit `join` + `liveCurrentSession = sessionId`, `liveCurrentParticipantId = participantId`.

### 3. leave 클리어 (`leaveSessionLive`)
- emit `leave` 후 `liveCurrentSession`/`liveCurrentParticipantId`/`liveSnapshotCache` 클리어.

### 4. disconnect 클리어
- `getSessionLiveSocket`의 `disconnect` 핸들러에서 `liveCurrentSession = null` — 재연결 시 dedup이 오판해 join을 skip하지 않게 한다.

### 5. snapshot 캐시 + 재배달
- `getSessionLiveSocket`에 module-level `joined` 리스너로 `liveSnapshotCache` 갱신.
- `subscribeSessionLiveJoined`가 캐시 있으면 즉시 1회 재배달(후발 구독자 보장).

## 동작 흐름 (재연결)
1. disconnect → `liveCurrentSession = null`.
2. connect → 4개 훅 `onConnect` 순차 실행. 첫 `joinSessionLive`만 emit `join`(dedup 나머지 3개 skip).
3. 서버 `joined` 1회 → module 캐시 갱신 → `useSessionLiveSocket` 구독자에 전달.
4. 후발 구독자(`useSessionLiveSocket`이 늦게 mount된 경우)도 캐시 재배달로 snapshot 수신.

## 배포
- develop push → Deploy Dev. FE 번들만 변경(백엔드·마이그레이션 없음).
