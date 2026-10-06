# SDD-172 — 중(중) 백엔드 20건 요약

## 구현 결과

20건 완료.

| 영역 | 변경 |
|---|---|
| 입력검증 | max_length·EmailStr·ge/le·DB 페이징 |
| ORM | N+1 배치·인덱스 3종·부분 유니크·멱등키 |
| WS | 토큰 type·계정 상태·on_leave·to_thread |

## 검증

- 백엔드 `pytest -q` **1265 passed / 12 skipped / 0 failed**
- alembic head e036a0000034
