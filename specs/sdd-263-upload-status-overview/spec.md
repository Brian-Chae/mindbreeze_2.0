# SDD-263 — 상담사 데이터 현황 정식 메뉴·전체 회차 목록

- 상태: Stage ① Spec (대표 요청 11/1 반영) / 구현 전
- 브랜치: `sdd/263-upload-status-overview` (develop `dc2f84d6` 기준)
- 선행: SDD-261(회차 단위 참여자별 수신 현황, 머지됨). 본 SDD 는 그 위에 **전체 회차 목록**과 **정식 진입점**을 얹는다.
- 범위: BE 집계 API 1개 + FE(사이드바·설정·홈 진입, `/upload-status` 목록). 수집 경로·SDD-261 단일 회차 API 불변.

## 1. 문제

SDD-261 화면은 클래스→회차를 직접 골라야 현황이 보이고, 진입점이 설정 맨 아래 링크 한 줄·회차 행 링크뿐이다. 현장 운영자(코치·기관관리자)는 "지금 어느 회차에서 수신이 비었는지"를 한눈에 보고 싶다.

## 2. 목표

1. 코치·기관관리자 웹/앱에 "데이터 현황"을 정식 메뉴로 노출한다.
2. 선택 없이 **내가 볼 수 있는 전체 회차를 최근순 목록**으로 바로 보여 준다. 진행 중 회차 우선. 행마다 회차별 요약(참여자 수·수신 확인·업로드 중·확인 필요·미수신 건수, 마지막 수신 시각, 상태 배지). 행 클릭 → 기존 SDD-261 상세 표.
3. 목록은 테이블 우선 + 검색·필터(클래스/상태/기간)·그룹핑.

## 3. 비목표

- 점수·종합점수·좋음/나쁨·"완료/100%/보증" 표현. 서버 수신 기준(`basis=server_received`) 유지.
- 기대 수·폰 대기량 판정(null/unknown 고정), 미착용 확정(미수신≠미착용).
- 수집 경로·SDD-260/261 단일 회차 API 변경, 소켓 push, 마이그레이션(목표: 없음).

## 4. BE 요구 (신규 집계 API)

`GET /api/v1/upload-status/overview?limit=&since=&org_id=&class_id=&status=` — JWT 필수.

| 항목 | 규칙 |
|---|---|
| 권한(SDD-261 3분기) | 담당 코치=자기가 host 인 회차 + 활성 counselor membership / org_admin=자기 기관(활성 membership·활성 기관) / platform_admin=전체(+`org_id` 필터). 비담당 코치는 목록에 노출되지 않음(0건). client·그 외 role 403 `upload_status_forbidden`, 미인증 401. org_admin 이 자기 것이 아닌 `org_id` 를 주면 404 `upload_status_not_found` |
| 후보 회차 | `class_id` 있는 회차, hidden 제외, 템플릿 제외, 상태 `open`/`in_progress`/`completed`, `since` 이후(기본 30일, 최대 90일), `limit` 기본 30·최대 50. 정렬: 진행 중 우선 → 유효시각(`coalesce(started_at, scheduled_at, created_at)`) 내림차순 → id |
| 회차 요약 | SDD-261 `_build_participant` 규칙을 그대로 재사용해 참여자별 status 를 구한 뒤 회차별로 센다: `participants`, `needs_attention`, `uploading`, `received_unreconciled`, `no_data`, `excluded`, `band_not_connected`(eligible 이며 band_connected=false; **미착용 확정 아님**), `last_received_at` |
| 회차 상태 배지 | 위쪽 우선: `needs_attention` > `uploading` > `received_unreconciled` > `no_data`(참여자 0명 포함). 완료·보증 값 없음 |
| `status` 필터 | 후보 회차 내 사후 필터(후보 상한은 필터 전 적용). `total_candidates`·`truncated` 로 잘림 여부 노출 |
| 성능 | 50회차 기준 SQL ≤ 10회(목표 4회: 후보+권한 1, 참여자 1, feature 1, raw 1; 캐시 적중 시 1~2). 결측은 윈도 함수 대신 스트림별 `max-min+1-count`(유일 제약 하의 내부 결측과 동일). p95 < 1.5s, 304(캐시 적중) < 0.15s |
| 캐시·ETag | 회차별 요약 프로세스 내 캐시(진행 중 2s / 종료 30분 내 10s / 그 외 60s). 본문 내용 해시 `ETag: W/"…"`(시각 필드 제외), `If-None-Match` 일치 시 304. `Cache-Control: no-store, private`, `Vary: Authorization`, `X-Poll-Interval` |
| 폴링 주기 | 진행 중 회차 있음 3s / 종료 30분 내 수신 중·대기 있음 7s / 그 외 60s |
| 마이그레이션 | 없음(기존 `ix_eeg_feature_windows_session_id`·`ix_eeg_raw_chunks_session_id` 활용). 필요 시 EXPLAIN 근거 기록 후 가산 인덱스 |

계약 정본: `contract.md`. 전체 회차 로드는 40명×수십 회차를 상세 집계하지 않도록 회차당 요약만 계산한다.

## 5. FE 요구 (요약, FE 워커 소유)

사이드바 "데이터 현황"(counselor/org_admin → `/upload-status`, platform_admin → `/admin/upload-status`), 설정 정식 그룹 카드, 홈 바로가기 카드. 하단 탭 5개·스와이프 순서(`lib/mobile-menu-swipe.ts`) 불변. 390px 카드형·데스크톱 테이블. 행 → `/classes/:classId/sessions/:sessionId/upload-status`. SDD-261 의 설정 하단 링크·picker 는 목록으로 대체/리다이렉트. 갱신은 서버 poll 주기+ETag, 정지/재개·오프라인·403(데이터 제거) 훅 재사용. 리포트 칩이 이 API 로 호출 수를 줄이는지는 검토 후 이득이 명확할 때만 적용.

## 6. 결정 사항

| # | 결정 | 근거 |
|---|---|---|
| 1 | 전용 라우터 `/api/v1/upload-status/overview`(classes 라우터 비수정) | 클래스 경로 비종속, 라우터 파일 충돌 최소화 |
| 2 | 윈도 함수 lag 대신 스트림별 `max-min+1-count` | 유일 제약 하에서 동일값, 정렬·윈도 비용 제거 |
| 3 | 회차 요약 캐시는 회차 단위 + TTL 차등 | 진행 중은 실시간, 오래된 회차는 재계산 억제 |
| 4 | `status` 필터는 후보 상한 후 적용 | 필터가 상한을 우회해 대형 스캔을 만들지 않게 |
| 5 | 예정(scheduled)·취소 회차 제외 | 수신이 있을 수 없는 회차가 목록을 오염 |
| 6 | 비즈니스 결정 필요 없음 | — |
