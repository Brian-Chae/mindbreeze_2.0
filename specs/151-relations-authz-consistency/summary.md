# SDD-151 — 관계·권한·정합 요약

## 구현 결과

7건 완료. alembic `e036a0000031`(memo 컬럼) 추가.

| # | ID | 변경 |
|---|---|---|
| 1 | MB2-CLIENT-01 | memo 컬럼 + 실제 저장 |
| 2 | MB2-AUTH-03 | 재사용 정책 적용 |
| 3 | MB2-ONB-01 | ended 링크 재활성화 |
| 4 | MB2-SIGNUP-01 | 반려 정리 + 재신청 |
| 5~6 | MB2-ORG-02/03 | membership 통일 |
| 7 | MB2-ORG-04 | 역할 제한 |

## 검증

- 백엔드 `pytest -q` **1033 passed / 12 skipped / 0 failed**
