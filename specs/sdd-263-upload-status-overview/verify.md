# SDD-263 — verify.md (Stage ③, 구현 전 QA 체크리스트)

- 작성: 2026-11-01, 구현 전. 사후 수정 금지(추가는 하단 변경 이력). 정본: `spec.md`, `contract.md`.
- 합격 판정은 실제 API 응답·DOM·SQL 로그로 한다. 빌드·타입 통과는 증거가 아니다. 합성 데이터만 사용(운영 DB·개인정보 금지).
- 시나리오 41건 (A 필수 33 / B 8). 담당: BE=백엔드 pytest(+PG), FE=vitest/실화면.

| ID | 영역 | 시나리오 | 검증 방법 | 합격선 | 우선 | 담당 |
|---|---|---|---|---|---|---|
| V-O01 | 권한 | 담당 코치 × overview | 코치가 host 인 회차 3 + 타 코치 host 회차 2 | host 3건만 | A | BE |
| V-O02 | 권한 | 비담당 코치(같은 기관, lead/assistant 포함) | 호스트 아닌 코치 호출 | 200 + 회차 0건(타 회차 노출 0) | A | BE |
| V-O03 | 권한 | org_admin × overview | 기관 A·B 회차 혼재 | 자기 기관 회차만 | A | BE |
| V-O04 | 권한 | org_admin 이 타 기관 `org_id` 지정 | `org_id=B` | 404 `upload_status_not_found`, 본문에 타 데이터 없음 | A | BE |
| V-O05 | 권한 | platform_admin × overview (+`org_id` 필터) | 전체 / 기관 A 필터 | 전체 → 모든 기관, 필터 → A 만 | A | BE |
| V-O06 | 권한 | client·미인증·비활성 사용자 | 각각 호출 | 403 `upload_status_forbidden` / 401 / 401·403 | A | BE |
| V-O07 | 권한 | 비활성 기관·탈퇴 membership | membership 비활성 후 호출 | 해당 기관 회차 0건 | A | BE |
| V-O08 | 권한 | 숨김(hidden) 회차·숨김 클래스 | hidden_at 설정 | 목록 제외 | A | BE |
| V-O09 | 정확성 | 회차별 참여자 수·status 별 건수 vs 독립 COUNT | 합성 DB 에 SQL 직접 COUNT/GROUP BY | 전 회차 0 오차 | A | BE |
| V-O10 | 정확성 | 요약 vs SDD-261 상세 API 교차 | 같은 회차 상세 `summary` 와 overview 항목 비교 | 모든 건수 일치 | A | BE |
| V-O11 | 정확성 | 스트림 내부 결측(`max-min+1-count`) | feature 1,2,4 / 1,3, raw 0,2 → 상세와 같은 확인 필요 판정 | 상세 API 와 status 일치 | A | BE |
| V-O12 | 정확성 | JOIN 행 곱셈 방지 | feature N × raw M 참여자 | 건수 불부풀음 | A | BE |
| V-O13 | 정확성 | 0건 회차·참여자 0명 회차 | 참여자 0 / 수신 0 | 목록에 존재, status `no_data`, 건수 0 | A | BE |
| V-O14 | 정확성 | 미착용≠미수신 | band_connected=false·수신 0 | `band_not_connected` 로만 집계, 미착용 확정 키/문구 없음 | A | BE |
| V-O15 | 정확성 | 대기열·제외 참여자 | waitlisted/excluded 포함 | 상세와 동일하게 excluded, 수신 기록 있으면 다른 status | A | BE |
| V-O16 | 정렬 | 진행 중 우선 → 최신순 | in_progress 1(오래됨) + completed 최신 다수 | 첫 항목 in_progress, 이후 유효시각 내림차순, 동률 id | A | BE |
| V-O17 | 한도 | `limit` 기본 30 / 최대 50 / 초과 | limit 미지정·50·500 | 30 / 50 / 422 또는 50 로 제한(계약 기재대로), `truncated`·`total_candidates` 정확 | A | BE |
| V-O18 | 한도 | `since` 기본 30일 / 최대 90일 | 40일 전 회차 | 기본 제외, `since` 지정 시 포함, 90일 초과 422 | A | BE |
| V-O19 | 필터 | `status` / `class_id` 필터 | needs_attention 만, 특정 클래스만 | 해당 회차만, 후보 상한은 필터 전 적용, 잘못된 값 422 | A | BE |
| V-O20 | 필터 | 예정(scheduled)·취소 회차 제외 | 상태별 회차 | open/in_progress/completed 만 | B | BE |
| V-O21 | 성능 | SQL 횟수 상수 | 40명×50회차 합성에서 쿼리 카운트 | 본문 ≤ 10(목표 4), 회차 수 증가해도 불변 | A | BE |
| V-O22 | 성능 | p95 응답시간 (PG) | 임시 PG 50회차×40명×feature 1h | p95 < 1.5s (200), 실측 기록 | A | BE |
| V-O23 | 성능 | EXPLAIN | 합성 PG | 대형 테이블 seq scan 없음(회차 id 인덱스 사용) | B | BE |
| V-O24 | 캐시 | ETag/304 | 같은 데이터 재호출 `If-None-Match` | 304, 본문 없음, 헤더(ETag·X-Poll-Interval·Cache-Control) 유지, 권한 먼저 | A | BE |
| V-O25 | 캐시 | 304 지연 | 캐시 적중 304 반복 | p95 < 0.15s | A | BE |
| V-O26 | 캐시 | 데이터 변화 시 ETag 변경 | 진행 중 회차에 feature 추가 후 TTL 경과 | ETag 변경, 새 건수 반영 | A | BE |
| V-O27 | 캐시 | 시각 필드가 ETag 에 영향 없음 | 시간만 경과 | ETag 동일 | A | BE |
| V-O28 | 캐시 | 권한 변경이 캐시로 가려지지 않음 | 캐시 적중 상태에서 membership 회수 | 즉시 0건/404 | A | BE |
| V-O29 | 폴링 | `X-Poll-Interval` | 진행 중 있음 / 종료 직후 수신 중 / 전부 오래됨 | 3 / 7 / 60 | B | BE |
| V-O30 | 금지어 | 응답 전체 문자열 검사 | JSON 직렬화 후 검색 | 점수·score·완료·100%·보증 값/키 0건, `basis=server_received` | A | BE |
| V-O31 | 회귀 | SDD-261 단일 회차 API·수집 경로 불변 | `test_upload_status*.py` 29건 + 관련 | 전부 통과, 수정 diff 없음 | A | BE |
| V-O32 | 진입 | 사이드바 "데이터 현황" 역할별 노출 | counselor/org_admin → `/upload-status`, platform_admin → `/admin/upload-status`, client 숨김 | 역할별 링크 정확 | A | FE |
| V-O33 | 진입 | 설정 정식 그룹 카드 + 홈 바로가기 카드 | 렌더 테스트 | 두 진입 노출, 기존 하단 한 줄 링크 제거/통합 | A | FE |
| V-O34 | 회귀 | 하단 탭 5개·스와이프 순서 불변 | `mobile-menu-swipe`·BottomTabBar 기존 테스트 | 전부 통과 | A | FE |
| V-O35 | 회귀 | 설정 그룹 수 단정 테스트 갱신 | 설정 컴포넌트 테스트 | 새 정본 수와 일치 | A | FE |
| V-O36 | 화면 | 목록 테이블(데스크톱)·카드(390px) | 렌더 + 실화면 | 컬럼: 클래스·회차·상태·참여자·수신 확인·업로드 중·확인 필요·마지막 수신 | A | FE |
| V-O37 | 화면 | 검색·필터(클래스/상태/기간)·그룹핑 | 상호작용 테스트 | 조건 반영, 0건 안내 문구 | A | FE |
| V-O38 | 화면 | 행 클릭 → 기존 상세 라우트 | 클릭 | `/classes/:classId/sessions/:sessionId/upload-status` | A | FE |
| V-O39 | 실시간 | 서버 poll 주기+ETag, 정지/재개, 오프라인, 403 시 이전 데이터 DOM 제거 | 훅 테스트 | SDD-261 동작 동일 | A | FE |
| V-O40 | 문구 | 금지 문구(완료·100%·보증·점수) | DOM 텍스트 검색 | 0건 | A | FE |
| V-O41 | 이득 검토 | 리포트 칩이 overview 로 호출 수 감소하는지 | impl-notes 기록 | 이득 명확 시만 적용, 아니면 사유 기록 | B | FE |

## 변경 이력

- 2026-11-01 최초 작성(구현 전).
