# SDD-154 — 계정·초대·일정 정합 (5건)

## 배경

기능 오류 전수조사 하(하) 17건 중 백엔드 계정·초대·일정 정합 5건.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | MB2-AUTH-04 | 내담자 생년월일 미래 날짜 허용(가입 경로와 불일치) |
| 2 | MB2-ONB-02 | client step4-match 상담사 코드 정규화 누락 |
| 3 | MB2-CLIENT-02 | 공개 초대 조회 만료·사용 검증 누락 |
| 4 | MB2-CLIENT-03 | 초대 토큰 single-use 보장 불완전 |
| 5 | FUNC-08 | 일정 수정 시 과거 일시 검증 누락 |

## 변경

1. update_user_me / update_client_profile → `_parse_birth_date` 재사용(미래 422).
2. step4-match → `code_service.normalize_code()` 조회·저장.
3. get_invite → status != pending 또는 만료 시 404.
4. link_invited_client → status != pending 이면 None(재사용 차단).
5. update_session → 과거 scheduled_at 400.

## 검증

- 백엔드 1055 passed (+신규 7)
