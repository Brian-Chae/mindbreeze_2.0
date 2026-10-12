# SDD-143 — 구현 계획

13건을 2개 그룹(백엔드 4 · 프론트 9)으로 병렬 구현.

| 그룹 | 건 | 방식 |
|---|---|---|
| A. 백엔드 | PERF-03, RPT-02, STT-02, PERF-01 | Celery 위임 · 다운샘플 · with 핸들 · DB 집계 |
| B. 프론트 | UX-01, PERF-01, API-01, UX-04~07, FE-JOIN-002, FE-THEME-001 | 라우트·디바운스·계약·쿼리·뱃지·dedupe·권한·연도·테마 |

## 건별 설계

1. **PERF-03** — `request_report_email` 생성 Celery 위임 + 202.
2. **RPT-02** — timeline 300포인트 초과 시 버킷 평균 다운샘플.
3. **STT-02** — tempfile with 컨텍스트 + OSError 명시 처리.
4. **PERF-01** — list_users 일괄 IN 조회, get_review_queue DB 정렬·LIMIT/OFFSET.
5. **UX-01** — 링크 `/org/:id` 수정 + NotFoundPage catch-all.
6. **PERF-01(FE)** — 300ms 디바운스 + requestSeq 가드.
7. **API-01** — onboarding_completed 필드 제거.
8. **UX-04** — setSearchParams 함수형으로 기존 파라미터 유지.
9. **UX-05** — 알림 항목 뱃지 렌더.
10. **UX-06** — counselors id 기준 upsert.
11. **UX-07** — isOrgAdmin role==='org_admin' 만.
12. **FE-JOIN-002** — new Date().getFullYear() 기준.
13. **FE-THEME-001** — system 일 때 matchMedia change + storage 구독.

## 검증

- 백엔드 `pytest -q` → 1009 passed / 0 failed
- 프론트 `vitest run` → 44 files / 318 tests
- 프론트 `npm run build` → 0 errors
