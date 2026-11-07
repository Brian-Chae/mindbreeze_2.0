# SDD-308 — 3차 sessions·epoch 잠금 순서 수정 계획

작성: 2026-11-07. 구현 전 결정. 작업: sdd/308-epoch-lock-order 전용 워크트리, backend 및 이 스펙 문서만.
브리프의 구현·로컬 커밋 지시에 따라 진행하며 푸시·PR·배포·서버 변경·dev 부하시험은 하지 않는다.

## 원인과 정합성 계약

기존 입장/상태 전이는 users → classes → class_members → sessions FOR UPDATE를 획득한다.
반면 metric/device/seed/rebuild는 epoch FOR UPDATE를 먼저 획득한 뒤 live_outbox/ledger INSERT의
sessions FK 검사(KEY SHARE)를 수행한다. sessions를 가진 입장이 epoch를 기다리면 양방향 대기가 된다.
제공된 dev 샘플은 epoch SELECT와 outbox INSERT의 sessions 대기를 보여 주지만, 252건 전체의
요청 kind/트랜잭션 대응표는 없으므로 전체를 단일 경로 쌍으로 확정하지 않는다. 로컬 실제 PG 재현으로 고리를 확인한다.
SQLAlchemy `with_for_update(key_share=True)`는 FOR NO KEY UPDATE이다. KEY SHARE는 read=True도 필요하다.

## 후보 비교와 결정

| 후보 | revision 단조 | 부수효과 1회 | 방송 누락 | 위험·선택 |
|---|---|---|---|---|
| A 공통 lock_epoch에서 sessions NO KEY UPDATE → epoch UPDATE | 기존 epoch 직렬화 유지 | ledger/savepoint/commit 유지 | outbox 원자성 유지 | 선택. 모든 epoch 진입점을 한 곳에서 통일. FK KEY SHARE와 호환, session 비키 UPDATE도 직렬화 |
| A2 sessions KEY SHARE만 선행 | epoch 유지 | 기존 계약 유지 | 기존 계약 유지 | 미선택. handler의 sessions UPDATE 승격과 다른 선행 KEY SHARE 보유자 사이 교착 가능 |
| A3 sessions FOR UPDATE 선행 | epoch 유지 | 기존 계약 유지 | 기존 계약 유지 | 미선택. feature INSERT 등 FK KEY SHARE까지 불필요하게 차단 |
| B renew/presence/metric 무잠금·advisory/CAS | 별도 revision 할당 설계 필요 | 재시도 부수효과 재검증 필요 | durable pending/replay 재설계 필요 | 이번 수정 범위 초과 |
| C 기존 REST 잠금을 모두 NO KEY UPDATE로 완화 | epoch 유지 | 광범위 상태 전이 재검증 필요 | 기존 계약 유지 | epoch→sessions UPDATE/participant 역순은 남을 수 있어 미선택 |
| D outbox INSERT를 트랜잭션 끝으로 이동 | 같은 commit이면 유지 | 유지 | 유지 | 대기 순서는 그대로라 고리 제거가 안 됨 |

## 구현 순서

1. 삭제 없는 로컬 PG 재현·회귀 하네스로 기준선 확보. 실행 SQL과 PG deadlock DETAIL을 보존한다.
2. `lock_epoch`에서 sessions FOR NO KEY UPDATE를 먼저 획득한다. 없는 session은 기존 epoch INSERT FK 오류 계약을 유지한다.
3. capture 전용 sessions 선행 분기를 공통 함수로 흡수한다. 클래스 잠금이 필요한 entry.enter뿐 아니라
   session.open/start/end/cancel도 users/classes/sessions를 epoch보다 먼저 획득한다.
   system actor의 상태 전이는 실제 host_id를 선행 잠금에 사용해 handler와 동일하게 한다.
4. 오래된 잠금 순서 주석을 바로잡는다. ledger/outbox 스키마·revision·commit·재시도·방송 코드는 바꾸지 않는다.
5. 재현 테스트 RED→GREEN, 100명/40명 30초 이상 측정, 회귀 묶음 전후 비교, 독립 diff 리뷰.

## 범위·위험·롤백

sessions와 epoch를 동시에 보유하는 기간 및 SQL 1회가 늘어난다. 기존 epoch 직렬화는 원래 존재했으므로
성능 향상은 교착 제거에서 기대하며 수치로만 판정한다. 클래스 편성의 다중 회차 잠금은 기존 정렬 순서를 유지한다.
호출자가 이미 participant를 갱신한 뒤 처음 lock_epoch를 호출하는 새 경로를 만들면 규칙을 위반하므로 금지한다.
rollback은 이 작업의 서비스 코드 커밋을 후속 승인하에 revert하는 것으로 충분하며 DB 마이그레이션은 없다.
