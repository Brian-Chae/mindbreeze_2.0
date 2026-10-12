# [SDD-110] join 단일화 — 재연결 시 join 1회 보장 (module-level dedup + snapshot cache)

## Goal
재연결 1회당 `join`이 4회(4개 훅 각자) emit 되는 것을 module-level dedup으로 1회로 줄여, 재연결 폭풍의 잔여 부하(DB 조회 ×4, snapshot ×4, host aggregate force publish ×4)를 제거한다.

## Context (정밀 추적 결과)
- `/session-live` 소켓은 싱글톤(`getSessionLiveSocket`)이며 4개 훅이 공유한다.
- **join emit 4곳**: `useSessionLiveSocket`(202), `useBand`(1056), `useWaitingRoomPresence`(71·104+heartbeat), `useMemberLiveKit`(118, `ownsJoin`일 때만).
- **leave emit 1곳**: `useSessionLiveSocket` cleanup(334). `useBand`는 이미 위임(1163 주석 "room leave는 useSessionLiveSocket(UI)가 담당").
- 서버 `on_join`(297)은 매 join마다 `_resolve_join`(DB) → `save_session`(Redis) → `enter_room` → `joined` snapshot emit → (host) `publish_group_aggregate(force=True)` → (비호스트) audio replay를 수행한다. **N join = N배 부하**.
- **leave 소유권은 이미 단일화됨**, `useSessionLiveSocket` 내부 콜백(`acceptVersion`·`applySnapshot`·`handleFeature`)은 전부 `useCallback` memoized라 dep-change flap은 없음. → SDD-110은 **join dedup만**이 대상.

## Out of scope
- full reference-count(모든 훅 acquire/release 균형): `useWaitingRoomPresence`의 heartbeat join(재공지)이 refcount를 불균형하게 만들므로 채택하지 않음.
- O(T²) feature 저장(`_persist_feature_items`의 `.all()` 전체 키 로드), sequence 충돌, raw→S3 미연결 — 별도 SDD 후보.

## Acceptance
- 재연결(disconnect→connect) 시 서버 `on_join`이 1회만 호출된다(서버 로그로 확인).
- join dedup에도 late-subscriber(나중에 mount된 훅)가 snapshot을 받는다(캐시 재배달).
- leave/재연결 후 새 join이 정상 재발동한다(disconnect 시 상태 클리어).
