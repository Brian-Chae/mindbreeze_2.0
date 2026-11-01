# SDD-263 — 구현 계획

**목표:** 전체 회차 요약 목록 API(BE) + 정식 메뉴·목록 화면(FE). 수집 경로·SDD-261 단일 회차 API 불변.
**정본:** `spec.md`, `contract.md`(BE 가 45분 내 선행 커밋). 계약 변경은 contract.md 부터 고치고 FE 에 알린다.

## 파일 소유 (같은 워크트리 동시 사용 — 자기 경로만 수정, `git add <경로>` + `git commit -- <경로>`)

| 트랙 | 단독 소유 |
|---|---|
| BE | 신규 `backend/app/api/v1/upload_status.py`, `backend/app/services/upload_status_overview_service.py`, `backend/app/schemas/upload_status_overview.py`, 신규 `backend/tests/test_upload_status_overview.py`·`backend/tests/test_upload_status_overview_pg.py`; 기존 `backend/app/api/v1/__init__.py`(라우터 등록 1줄), `specs/sdd-263-*/`(spec·plan·verify·contract·sample-response.json·impl-notes-be.md) |
| FE | `frontend/**` 전부(사이드바·설정·홈·`/upload-status` 페이지·훅·테스트·라우트), `specs/sdd-263-*/impl-notes-fe.md` |

공유 읽기 전용: `upload_status_service.py`(SDD-261, 수정 금지 — 헬퍼 import 만).

## BE 작업 (TDD: RED → GREEN)

- [ ] B0 spec/plan/verify 커밋(`docs(sdd-263):`) → contract.md 커밋(45분 내)
- [ ] B1 RED: `test_upload_status_overview.py` — 권한 6역할, 정확성(독립 COUNT 대조), 정렬·필터·상한, 304, SQL 횟수, 금지 키
- [ ] B2 스키마 + 서비스: 후보 쿼리(권한·필터·정렬·limit, `count() over()`), 참여자 일괄, feature 스트림 집계, raw 스트림 집계 → `_build_participant` 재사용 → 회차 요약
- [ ] B3 회차별 TTL 캐시, ETag(내용 해시)·304, 폴링 주기
- [ ] B4 라우터 + `__init__` 등록, 헤더 계약
- [ ] B5 GREEN → PG 임시 인스턴스로 `PG_SMOKE=1` 시험(합성 50회차×40명): SQL 횟수·p95·EXPLAIN
- [ ] B6 합성 실응답 `sample-response.json`(19:00), `impl-notes-be.md`, 21:00 완료 보고

## FE 작업 (FE 워커 plan 은 자체 보강)

- [ ] F1 `lib/api/upload-status-overview.ts` + 훅(SDD-261 `use-upload-status` 폴링 로직 재사용)
- [ ] F2 `/upload-status` 목록 페이지(테이블+카드, 검색·필터·그룹핑), 라우트·가드
- [ ] F3 사이드바·설정 그룹 카드·홈 바로가기, 하단 탭/스와이프 불변 회귀
- [ ] F4 SDD-261 설정 링크·picker 대체/리다이렉트, 설정 그룹 수 테스트 갱신
- [ ] F5 리포트 칩 이득 검토

## 위험

| 위험 | 대응 |
|---|---|
| 50회차×대형 회차 스캔 비용 | 후보 상한 50, 회차별 TTL 캐시, 윈도 함수 제거, PG 실측 |
| 권한 누설(비담당 코치·타 기관) | SQL 단계에서 범위 제한 + 6역할 테스트 |
| 요약이 상세와 어긋남 | `_build_participant` 재사용 + 상세 API 와 교차 대조 테스트 |
| FE 가 계약 이전에 착수 | contract.md 45분 내 선행, 19:00 샘플 |
