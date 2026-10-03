# [SDD-108] feature_ack 구현 — WS feature 저장 확정 ACK

## Goal
참가자가 WS(`feature`)로 보낸 1초 EEG feature가 서버에 저장된 직후 `feature_ack`를 돌려줘, WS 저장 확정을 실시간으로 알리고 REST 5초 배치의 상시 중복 재전송을 제거한다.

## Context
- SDD-107 리뷰(Codex) 핵심 지적: **`feature_ack` 미구현**. 프론트는 `subscribeSessionLiveFeatureAck` + `handleFeatureAck` → `removeAckedFeature`(IndexedDB 큐 제거)까지 전부 구현돼 있으나, 백엔드가 `feature_ack`를 한 번도 emit하지 않아 이 경로가 **죽은 코드**다.
- 현재 참가자의 WS feature는 저장 성공 여부를 전혀 알 수 없어, IndexedDB 큐가 REST 배치(5초)로만 정리된다 → **정상 저장돼도 5초마다 REST 중복 재전송**.
- 백엔드 `on_feature`는 `_store_feature`로 `(saved, resolved_participant_id, feature_out)`을 이미 확보하므로, 이 값으로 ACK를 emit하면 된다(stream_id·sequence는 payload에서 읽음).

## Scope
### ✅ In-scope
- [BE] `on_feature`에서 저장 성공 시 `feature_ack` emit (stream_id/sequence/participant_id/second_offset/feature/saved)
- [BE] 저장 실패 시 `feature_ack` emit (`saved: 0`) → 클라이언트가 REST 폴백 유지
- [BE] payload에서 `stream_id`·`sequence` 읽기(현재 무시 중)

### ❌ Out-of-scope (후속 SDD)
- DB 멱등 키 보강(nullable `play_group_id` 유니크 제약) — 동시 저장 중복 방어
- join/leave 소유권 단일화
- `transports: ['websocket']` 단일화

## Acceptance Criteria
- [ ] WS feature 저장 성공 시 발신자(sid)에게 `feature_ack`(saved≥0) emit
- [ ] 저장 실패 시 발신자에게 `feature_ack`(saved=0) emit
- [ ] `stream_id`·`sequence`가 payload에서 읽혀 ACK에 그대로 반환됨
- [ ] `pytest` 전체 통과

## Dependencies
- SDD-107(WS 이벤트 루프 비블로킹) — `_store_feature`가 `asyncio.to_thread`로 격리된 상태 위에서 구현

## Risks
- ACK emit 추가가 기존 `eeg_feature` 브로드캐스트·집계 흐름을 방해하지 않아야 함 → emit 순서(저장→ACK→브로드캐스트) 유지
- 기존 테스트가 `on_feature`의 emit 목록을 단언할 수 있음 → `feature_ack` 추가 반영 필요
