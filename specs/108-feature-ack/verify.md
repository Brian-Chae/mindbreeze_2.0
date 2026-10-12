# [SDD-108] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 저장 성공 시 feature_ack emit
1. 참가자 소켓으로 `feature` emit(stream_id·sequence 포함).
2. 저장 성공 시 발신자(sid)에게 `feature_ack`가 emit됨.
- **Expected:** `feature_ack` payload에 `stream_id`·`sequence`·`participant_id`·`saved`가 담기고, `to=sid`.

### TS2: 저장 실패 시 feature_ack(saved=0) emit
1. 비참가자/미식별로 feature emit → 저장 실패.
2. 발신자에게 `feature_ack`(saved=0) emit.
- **Expected:** `saved == 0`, REST 폴백 유지 신호.

### TS3: 계약 정합
1. emit payload 필드가 `SessionLiveFeatureAck`(socket.ts)와 일치(session_id/stream_id/sequence/participant_id/second_offset/feature/saved).
- **Expected:** FE `handleFeatureAck`가 `removeAckedFeature`를 정상 호출할 수 있는 필드명.

## Edge Cases
- [ ] `stream_id`·`sequence`가 payload에 없으면(null) ACK에 null로 반환되고 FE가 무시(soft-ACK 경로와 충돌 없음)
- [ ] ACK emit이 `eeg_feature` 브로드캐스트·그룹 집계 순서를 깨지 않음

## Security Review
- [ ] ACK는 발신자 본인(sid)에게만 emit — 타 참가자 노출 없음
- [ ] `participant_id`는 `_store_feature`가 해석한 `resolved_participant_id`만 사용(클라이언트 입력 신뢰 금지)
