# SDD-277 Verify (구현 전 작성)

| ID | 시나리오 | 기대 | 시험 |
|---|---|---|---|
| V1 | journalPacket 이 일시적 InvalidStateError 를 1~2회 던진다 | 수집이 멈추지 않고(`running`) 모든 패킷이 결국 영속된다 | sdd277/journal-resilience |
| V2 | 수집 중 모든 IndexedDB 연결이 닫힌다(iOS 연결 소실 모사) | 다음 패킷에서 연결을 다시 열어 영속, `journal_failed` 아님 | 〃 |
| V3 | 계속 실패(3회 초과) | `journal_failed` 로 멈추고 `stopDetail` 에 오류 이름이 남는다(실제 유실 신호는 유지) | 〃 |
| V4 | feature outbox 쓰기가 실패한다 | raw 수집은 `running` 유지(격리) | 〃 |
| V5 | 관측 스윕을 5회 반복 | 새로 여는 IndexedDB 연결 수가 스윕 횟수에 비례해 늘지 않는다 | 〃 |
| V6 | 밴드 없는 입장 종료 | `ingest-expected` 에 feature 0·raw 0/0/0·final=true 1건, 입장 자격 사본 포함 | sdd277/no-band-final |
| V7 | 입장 정보 삭제(홈으로) 뒤 재전송 | 사본 자격으로 전송 | 〃 |
| V8 | 오프라인 후 online | 보존했다가 전송 | 〃 |
| V9 | 같은 scope 에 outbox 창 또는 raw 사본이 있다 | 0 final 을 보내지 않는다 | 〃 |
| V10 | 회귀 | tests/sdd275 sdd274 sdd273 sdd264 sdd266 sdd267 sdd260-web sdd246-web 통과, tsc -b 0, eslint 0 | 전체 |
