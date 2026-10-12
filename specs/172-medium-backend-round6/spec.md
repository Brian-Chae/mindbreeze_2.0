# SDD-172 — 중(중) 백엔드 20건 (6차)

## 배경

6차 전수조사 중(중) 백엔드 20건 — 입력검증 9 · ORM 7 · WS 4.

## 대상

| 군 | 건수 | 내용 |
|---|---|---|
| 입력검증 | 9 | title·limit·page/size·email·name/phone·chunk_index |
| ORM | 7 | 채팅/윈도우/룸 N+1, notifications·reports 인덱스, join 유니크, 리포트 멱등키 |
| WS | 4 | 토큰 type·계정 상태·on_leave 검증·동기 DB 블로킹 |

## 구현

- 스키마 max_length/EmailStr/ge·le 상한, DB 페이징 이관
- 배치 조회(selectinload/캐시) N+1 제거, 인덱스 3종 + 부분 유니크 + alembic e036a0000034
- WS 토큰 type 검사, 계정 상태 차단, on_leave 대조, asyncio.to_thread 격리
