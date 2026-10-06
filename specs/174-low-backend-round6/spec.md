# SDD-174 — 하(하) 백엔드 15건 (6차)

## 배경

6차 전수조사 하(하) 백엔드 15건 — 입력검증 4 · ORM 8 · WS 3.

## 대상

| 군 | 건수 | 내용 |
|---|---|---|
| 입력검증 | 4 | action Literal·토큰 상한·검색 q 상한·rollup 파라미터 범위 |
| ORM | 8 | mark_read N+1·인덱스 3종·TXN 단일화 2·모델 등록·읽음 단일소스 |
| WS | 3 | feature session 대조·group_average 집계·new_message id/created_at |

## 구현

- 스키마 Literal/max_length/ge·le 상한, 결과 상한
- N+1 배치, 인덱스 3종 + alembic e036a0000035, 단일 트랜잭션, ChatRoomParticipant 등록, chat_message_reads 단일 진실원
- WS payload 보강·대조·집계 일치
