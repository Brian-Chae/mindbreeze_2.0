# SDD-278 — 24시간 폰 보고 없는 회차를 비정상 종료 의심으로 분리

- 상태: Stage ① Spec
- 브랜치: `sdd/278-abnormal-exit-suspected` (기준 origin/develop, 앱 빌드 없음 · 서버+웹만, dev 까지)
- 작성일: 2026-11-03

## 1. 배경 (대표 결정 11/3)
코치 데이터 현황에서 "집계 대기"·"전송 중"·"확인할 사람"이 코치가 해결할 수 없는 채로 남는다.
폰 보고(`session_ingest_expected`)가 없으면 서버는 영원히 `expected_unknown`("집계 대기")으로 둔다.
비회원도 보고하므로(SDD-275~277) **종료 후 24시간이 지나도 폰 보고가 없으면 폰이 강제 종료됐거나 종료를 인식하지 못한 "비정상 종료 의심"** 으로 본다.
단 데이터가 빠졌다는 단정은 금지(구버전 앱·정상 종료 실패 포함). 도착한 데이터는 확인된다.

## 2. 규칙
- 상수 `ABNORMAL_EXIT_AFTER_END_SEC = 24*3600` (`upload_progress_service.py` 상단, STALL/FINAL 상수 옆).
- 참여자가 다음을 모두 만족하면 `abnormal_exit_suspected = True`:
  1. `session_status == "completed"` 이고 `ended_at` 이 있으며 `as_of - ended_at >= 기한`
  2. 서버에 도착한 데이터가 있음(`has_data`) — 데이터 없음/수집 제외는 기존 `not_collected`·제외 규칙이 우선
  3. 폰 보고가 없음(`expected is None`) 또는 보고는 있으나 final 미도달이면서 `state == expected_unknown`
- 판정은 **읽기 시 계산**. DB 변경·마이그레이션 없음(SDD-271 방식).
- `state` 열거값은 **추가하지 않는다**. 의심이어도 `state` 는 기존대로 `expected_unknown`.

## 3. 응답 (additive, 하위호환)
| 위치 | 필드 | 형 |
|---|---|---|
| 참여자 `progress` (상세 `participants[].progress`) | `abnormal_exit_suspected` | bool (기본 false) |
| 회차 합계 `progress.participants` (상세·개요 항목·개요 최상위) | `abnormal_exit_suspected` | int (기본 0, `expected_unknown` 과 겹치는 부분집합) |
| 회원 본인 목록 행 | `abnormal_exit_suspected` | bool (기본 false) |
- 회차 합계의 수치 합(`feature/raw/overall`)에서 의심 참여자를 제외 → 진행 막대(%) 분모에서 빠진다.
- 구버전 앱의 내장 웹 번들 파서는 새 필드를 무시하고 `expected_unknown`("집계 대기")로 읽는다.

## 4. 화면 (코치)
- 회차 상황판·업로드 현황 개요·리포트 칩: 의심 참여자는 "확인할 사람" 수와 진행 막대 분모에서 제외, 별도 줄 "비정상 종료 의심 N명" + 설명 "앱이 정상 종료되지 않아 총량 보고가 없어요. 도착한 데이터는 확인돼요."
- 행 상세는 접힌 목록. `all_received` 와 섞지 않는다. 회원 본인 화면은 구버전 호환만 점검(문구 추가 없음).
- 금지 표현: 점수·종합점수·좋음/나쁨·완료·보증·100% 단정.

## 5. dev 시험용 오버라이드
`Settings.upload_abnormal_exit_after_sec` (env `UPLOAD_ABNORMAL_EXIT_AFTER_SEC`, 기본 86400). prod 는 설정하지 않아 24h.
