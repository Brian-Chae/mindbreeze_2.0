# SDD-278 Summary — 24시간 폰 보고 없는 회차를 비정상 종료 의심으로 분리

## 결과
- 종료 후 24시간(`ABNORMAL_EXIT_AFTER_END_SEC`) 동안 폰 보고(총량)가 없거나 final 에 못 이른 채 `expected_unknown` 인 참여자(서버에 도착한 데이터가 있는 경우)를 읽기 시 계산으로 `abnormal_exit_suspected=true` 로 표시. DB·마이그레이션 없음, 앱 빌드 없음, 심사 영향 없음.
- `state` 열거값은 추가하지 않음(의심이어도 `expected_unknown`). 구버전 앱 번들은 새 필드를 무시하고 지금처럼 "집계 대기"로 본다.

## 필드 (모두 additive)
| 위치 | 필드 |
|---|---|
| 상세 `participants[].progress` | `abnormal_exit_suspected: bool` |
| 합계 `progress.participants` (상세·개요 항목·개요 최상위) | `abnormal_exit_suspected: int` (expected_unknown 의 부분집합) |
| 회원 본인 행 `/upload-status/me/sessions` | `abnormal_exit_suspected: bool` |
합계 수치(feature/raw/overall → 진행 막대 분모)에서는 의심 참여자를 뺀다. 사람 수(counted·expected_unknown)에는 남는다.

## 화면
- 상세·개요: "비정상 종료 의심 N명 · 앱이 정상 종료되지 않아 총량 보고가 없어요. 도착한 데이터는 확인돼요." 줄, 상세는 접힌 "비정상 종료 의심 N명" 목록. 남은 사람이 모두 의심이면 상태 배지 "비정상 종료 의심"(중립색), 확인할 사람 수에는 불포함.
- 리포트 칩: 확인할 사람 칩과 별도로 "비정상 종료 의심 N명" 칩.
- 회원 화면: 변경 없음(구버전 호환만 점검, `MemberKind` 에서 suspect 제외).

## 변경 파일
backend: `config.py`(+`upload_abnormal_exit_after_sec`), `services/upload_progress_service.py`, `services/upload_status_service.py`(설정 전달·ETag 기한 키), `services/upload_member_service.py`, `schemas/upload_status_overview.py`
frontend: `lib/api/upload-progress.ts`, `lib/api/my-upload-status.ts`, `lib/upload-status/{board,member-view}.ts`, `components/class/{upload-status-table,upload-overview-screen,upload-attention-chip}.tsx`
tests: `backend/tests/sdd278/{test_abnormal_logic,test_abnormal_api}.py`, `frontend/tests/sdd278/{compat.test.ts,screens.test.tsx,legacy/*}` (legacy = origin/main 파서 고정 사본)

## 시험 결과
- pytest sdd278: 20 passed. 회귀 `tests/sdd264 265 267 271 278 + *263*/upload*`: 286 passed, 21 skipped. `test_upload_status*`·`test_fix_upload_after_end`·sdd260·269: 152 passed.
- vitest sdd278: 17 passed(하위호환 V13/V14 포함). 업로드 관련(sdd261·263·264-report·265·266·267·278·upload-retry): 173 passed. `tsc -b` 0 오류, eslint(변경 영역) 0.
- 전체 vitest: 23 failed / 3989 passed — **기준선(내 변경 stash)에서 동일 13파일 23건 실패**, 업로드 현황과 무관(agent-counselor-page, chat-message-deeplink, font-scale, nav-*, org-*-browser, report-*-pdf, sdd220-native-release, sdd234-a-mobile-home 등). 이번 변경 원인 아님.
- ruff 는 환경에 설치돼 있지 않아 실행 못 함.

## 결정·함정
- 개요 요약 캐시 TTL(최대 300초) 때문에 24h 경계 표시가 최대 5분 늦을 수 있음(허용). 상세는 ETag 에 기한 경과 불리언을 넣어 304 고착을 막음(시험 포함).
- 수집 제외+데이터 없음은 기존 `not_collected` 우선, 수집 제외지만 데이터가 있고 보고가 없으면 의심으로 본다.
- 단정 금지: 문구는 "의심"·"총량 보고가 없어요"만 쓰고 유실·손실·완료·점수 표현 없음(시험으로 검증).

## dev 시험 절차 (감독이 develop 머지 후 Deploy Dev)
1. 즉시 확인(환경변수 없이): dev 에서 종료 후 24시간이 지난 비회원 시험 회차 중 폰 보고가 없는 것이 있으면 업로드 현황 개요/상세에 "비정상 종료 의심 N명"이 보인다.
2. 짧은 기한으로 눈 확인: 서버 `backend/.env.dev` 에 `UPLOAD_ABNORMAL_EXIT_AFTER_SEC=300` 추가 → backend 서비스 재시작 → 비회원 시험 회차를 만들고 종료(앱 강제 종료 또는 ingest-expected 보고 없이 종료) → 5분 뒤 개요/상세/리포트 칩 확인. 확인 후 해당 줄을 지우고 재시작(미설정 = 24h). **prod 는 설정하지 않아 24h 고정.**
3. 구버전 호환: 구버전 앱(Android vc47 이하, iOS 39 이하)에서 같은 회차가 지금처럼 "집계 대기"로 보이고 오류가 없는지 확인.

## 확인 못 한 것
- 실제 dev 서버 응답·화면(워커는 배포 금지). 로컬 pytest 픽스처와 vitest 로 대체.
- ruff 미실행, 전체 pytest 미실행(관련 영역만).
