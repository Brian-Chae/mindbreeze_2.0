# 학교·기관 비회원 입장 수정 결과

## 결론과 승인 범위

Brian의 2026-10-24 확정 D3에 따라 비회원 코드 입장과 장기 비회원 가입을 수정했다. 작업 위치는 `mindbreeze_2.0-fix-guest-minor`, 브랜치는 `fix/guest-institution-minor`이다. plan·verify는 구현 전 `3fea2dd6`에 커밋했다. 메인 체크아웃의 미커밋 결정 문서는 읽기만 했다.

- 이름 가까이에 `실명이 아니어도 됩니다(별명·반 번호 가능)` 안내를 추가했다.
- 새 비회원 요청은 `birth_year_month: YYYY-MM`만 보낸다. 백엔드 양 입장 경로가 이를 기존 `birth_date` 컬럼의 해당 월 1일로 정규화한다. 일자는 실제 생일이 아니다. DB 마이그레이션·기존 데이터 수정 없이 이전 `birth_date` 요청을 계속 받는다.
- 과거 요청에 새 필드 null이 추가되어 멱등 요청 해시가 달라지지 않도록 장기 비회원 서비스의 정규화 이후 해당 필드를 제거한다.
- 2018년생 별명 참여자의 실제 테스트 API 입장과 장기 비회원 서비스 저장을 확인했다. 비회원 연령 차단을 추가하지 않았고 회원가입 14세 정책은 유지했다.
- 개인정보 처리방침은 2.2로 개정했다. 기존 2.1과 같은 날인 2026-10-24에 개정하여 시행일은 그대로이며 개정 이력에 이유를 적었다.
- 독립 리뷰에서 준비 완료 요약의 연구 선택 행과 약관의 서비스 전체 14세 제한 문구가 발견되어 비회원 예외에 맞게 최소 수정했다. 재리뷰에서 Important 잔여 0건.

## 연구 제외 기준과 방어 경계

기관 소속 여부와 관계없이 **`SessionParticipant.user_id IS NULL`인 모든 비회원**을 연구 사본에서 제외한다. 비회원은 회원 연구 동의의 주체가 아니며, 기관 연결 누락·이전 데이터도 차단하는 가장 단순하고 안전한 기준이다.

- 신규 장기 비회원이 이전 앱에서 연구 동의 true를 보내도 false로 정규화한다.
- 회차 연구 동의 API와 클래스 기본 동의 갱신은 비회원의 동의 true를 거절한다. 이전 동의의 철회는 허용한다.
- 과거 guest 기본 동의 true를 미래 회차로 복사하지 않는다.
- 연구 큐 등록·pending 선정·번들 생성·자동 및 강제 재시도에서 비회원을 제외한다. 기존 연구 테스트는 회원 동의 주체로 구성해 Parquet·메타데이터 검증을 유지하고 실제 비회원 제외 테스트를 별도 추가했다.
- 과거 비회원 포함 uploaded 배치는 반출 목록에서 숨기고 ack를 409로 차단한다. 저장소 객체·기존 배치 기록은 삭제하지 않는다.
- 비회원의 입장 고지·준비 완료 요약·장기 가입·선택 설정에서 연구 UI를 숨긴다. 회원 UI·반출은 유지한다.

## 변경 파일 범위

- 백엔드: guest 생년월 공통 파서, EnterRequest·GuestJoin, guest 가입 서비스, 클래스 연구 선택·회차 연구 동의·연구 반출 서비스, 관련 회귀 테스트.
- 프론트: 코드 입장 프로필·연월 로직·요청 타입·fixture, EntryPage 및 연구 고지·요약, 장기 guest 가입·선택 설정, 방침·약관, 관련 테스트.
- 문서·증거: 이 디렉터리의 plan·verify·summary, `contract-clause-draft.md`, 합성 브라우저 검증 스크립트·캡처.
- 계약 초안에는 목적·항목·90일 기준·위탁 관계·기관의 법정대리인 서면 동의 확보와 확인 책임·가정통신문 예시·법무 검토 필요를 명시했다. 현재 가공 리포트는 원본과 보관 정책이 달라 모든 결과물 자동 90일 삭제를 약속하지 않는다.

## 검증

- RED: 백엔드 핵심 4실패/5통과로 연월 입력 거절·과거 비회원 연구 포함 재현, 프론트 11실패/62통과로 새 계약 재현. 추가 준비 요약·약관도 RED 확인 후 수정했다.
- 관련 pytest: **97 passed**. 비회원·연구 동의·반출·SDD-241·리포트 목록 날짜를 포함한다.
- 백엔드 전체: **3991 passed, 463 skipped, 79 warnings**, 실패 0(449.81초). SQLite 인메모리 및 격리된 저장소 테스트이며 PostgreSQL 검증이 아니다.
- 관련 vitest(다이얼 포함): **11파일 146 passed**. 방침 금지어 검사 포함.
- 전체 vitest: **250파일 2808 passed / 기존 4파일 10 failed**(총 254파일·2818테스트, 105.42초). 실패 파일은 `agent-counselor-page`, `chat-message-deeplink`, `sdd220-native-release`, `sdd234-a-mobile-home`이며 이외 신규 실패 0.
- `npx tsc -b`, `npm run build`, `git diff --check` 통과. 기존 번들 크기·동적 import 경고는 남아 있다.
- 의존성은 기존 Storybook/Vite peer 충돌 때문에 `npm ci --legacy-peer-deps`로 설치했으며 package/lock은 변경하지 않았다.
- 브라우저 하네스의 Vite 8 모듈별 hash 불일치는 로컬 캐시를 유지한 채 본인 개발 서버만 재시작해 해결했다. 테스트 단언·제품 코드는 바꾸지 않았다. 별도 브라우저 4파일 7테스트 통과 후 전체를 다시 실행했다. 후속 다이얼 전체 회귀에서는 디스크 metadata 덮어쓰기가 재현되어 검증 서버의 metadata 응답만 실행 중인 hash로 제공했다(`verification-env.md`). 중간 실패·중단 실행은 최종 통과 증거로 사용하지 않는다.

## 390px 직접 확인

`node fix-notes/guest-institution-minor/capture-entry.mjs`로 실제 React 화면과 합성 API만 사용했다. Chrome headless 390×844, `scrollWidth=390`, 안내문 13px, date 입력 0, 연구 선택 컨트롤 0, pageerror 0을 확인했다. 2018-03·별명으로 입장한 실제 브라우저 요청에 일자 필드가 없음을 독립 확인했다.

- `screenshots/entry-390.png`: 폼 상단, 이름·별명 안내·연월 입력.
- `screenshots/entry-consent-390.png`: 폼 하단과 필수 녹음 동의.
- `screenshots/notice-390.png`: 비회원 기록 고지·연구 동의 미노출.
- `screenshots/membership-390.png`: 장기 비회원 가입 폼.
- `screenshots/metrics-390.json`: 합성 요청·DOM 측정 결과.

캡처 4장을 직접 열어 확인했다. 이 증거는 데스크톱 Chrome의 390px 렌더이며 실제 기관 패드·iOS/Android 네이티브 증거가 아니다.

## 남은 위험·후속

- 초기 구현에서는 실DB·PostgreSQL, 실 저장소·연구 파이프라인, 실기기 검증을 실행하지 않았다(로컬 PG 후속 검증은 아래에 기록). 463건 건너뜀을 통과로 간주하지 않는다.
- 정확한 생일 일자를 수집하지 않으므로 새 비회원의 월 1일은 저장 호환용이다. 기존 날짜 반환·리포트 목록 표시 계약은 유지되지만 생일 월 안에서 하루 단위 실제 만 나이를 확정하는 용도로 쓰면 안 된다. null·월 1일·기존 실제 생일 3종을 리포트 API 회귀로 확인했다.
- 과거 이미 외부에 적재된 사본은 회수·삭제하지 않았다. 과거 회원·비회원 혼합 업로드 배치도 안전상 전체 차단되어 회원분 재반출은 별도 운영 후속 과제다.
- 보호자 서면 동의 확인은 기관 운영·계약 책임이며 앱이 동의서를 수집하거나 검증하지 않는다. 계약·동의서의 법적 적정성은 법무 검토가 필요하다.
- 서버·실DB·.env·회원가입 정책 수정, 파일·데이터·브랜치 삭제, 메일 발송, 머지·develop push·배포는 하지 않았다. 로컬 Vite는 합성 화면 검증 용도로만 사용했다.

## 전달

- 구현 커밋: `90e9265c` (한글 메시지).
- `git push -u origin fix/guest-institution-minor` 완료.
- PR: https://github.com/Brian-Chae/mindbreeze_2.0/pull/85 (base: develop, 요청 제목 그대로).
- 로컬 합성 검증용 Vite만 실행 후 종료했다.

## 후속 요청: 연도·월 분리 다이얼

- Brian의 후속 요청에 따라 단일 month 입력을 두 개의 독립 스크롤 다이얼로 교체했다. 공통 `BirthYearMonthWheel`을 코드 입장과 장기 비회원 폼에서 사용한다. 회원의 읽기 전용 생일 표시는 유지한다.
- 각 다이얼은 44px 항목 3행, 중앙 선택 강조, 터치 스크롤·클릭·방향키·Home/End를 제공한다. 연도와 월을 모두 선택해야 YYYY-MM이 완성되며 미래월은 선택할 수 없다.
- 미선택 상태와 부분 선택을 보존한다. 지연된 스크롤 타이머는 최신 상태를 참조하여 다른 열의 새 선택을 덮지 않는다. 어두운 입장 화면의 도움말은 기존 색상 토큰으로 대비를 유지한다.
- 후속 plan·verify는 구현 전 `fb30a056`에 커밋했다. 다이얼 회귀 테스트의 구현 전 실패를 확인했고, 관련 11파일 **146 passed**, `tsc -b` 및 최종 build가 통과했다. 소스 및 대비 수정까지 독립 재리뷰에서 Important 0건.
- 390px Chrome에서 연도 2018·월 3을 선택하고, 실제 스크롤 위치 변경으로 4월에 정착한 뒤 ArrowUp으로 3월을 다시 선택했다. 실제 전송은 여전히 `birth_year_month: 2018-03`이며 date/month 입력 0, 각 다이얼 1, overflow 0, pageerror 0이다. 외부 HTTP·WebSocket을 차단하며 로컬 Vite HMR만 허용한다.
- `screenshots/entry-390.png`와 `membership-390.png`를 다이얼 화면으로 갱신하고 직접 확인했다. 실기기의 관성 스크롤 감각은 미검증이다. 백엔드는 후속 요청에서 수정하지 않았으므로 앞서 완료한 전체 pytest 결과가 유효하다.

- 다이얼 포함 최종 전체 vitest: **2808 passed / 기존 4파일 10 failed**, 신규 실패 0. 최종 build·diff 검사 통과.

## PR #85 backend-pg-smoke 후속 진단과 수정 (2026-10-24)

### 9건 판정표

기준 head `7c082557`의 해당 PG 파일을 로컬 PostgreSQL 16에서 실행하여 **9 failed, 12 passed**를 재현했다. 모두 **(a) D3 정책에 따른 기대 동작 변경**이다. 조사·회원 경로 검증에서 (b) 회원 동의/보관 정책의 의도치 않은 회귀는 발견하지 못했으며 제품 코드는 수정하지 않았다. 테스트를 단순히 제거하지 않고 아래와 같이 주체별 검증으로 갱신했다.

| 테스트명 | 원인 | 조치 |
|---|---|---|
| `test_v22_join_choice_evidence_and_future_copy` | 비회원 가입 true가 false로 정규화되어 연구 사본 없음 | 실제 회원 코드 가입·본인 동의로 원선택 시각/ID·이력·사본 검증 유지. 별도 비회원 가입/미래 회차 사본 0건·PII/연월 저장 검증 추가 |
| `test_v21_future_only_override_and_historical_preserved` | 비회원 미래 사본을 연구 동의로 간주 | 회원으로 전환. override·과거/입장완료 동의 보존·미래 false·변경 대상 ID 단언 유지/강화 |
| `test_v39_explicit_withdrawal_reaches_ended_and_preserves_evidence` | 신규 비회원 동의가 없어 철회할 사본 없음 | 회원 및 명시적으로 재현한 과거 비회원 동의 양쪽에서 종료 회차 철회·원증거·append-only 이력 검증 |
| `test_real_http_login_guest_scope_and_payload` | 비회원 true 정책 금지 403을 고지 누락 422/정상 200으로 기대 | 비회원은 고지 유무 모두 403과 `guest_research_not_applicable`, 회원 고지 누락422/정상200/실제 사본 저장, extra422를 분리 검증 |
| `test_makeup_new_participant_copies_origin_and_pii` | 비회원 보강도 연구 사본이 생긴다고 가정 | 비회원 PII 복사 유지·연구 사본/원본 ID 없음. 별도 회원 보강에서 원본 ID·시각·동의 사본 복사 검증 |
| `test_class_withdrawal_same_subject_other_class_and_export_unchanged` | 비회원 동일인 동의·pending 반출을 기대 | 동일 실제 회원을 두 클래스에 가입. 한 클래스 철회·타 클래스 pending/동의·전역 철회 없음 유지 |
| `test_withdrawal_hidden_removed_copy_and_default_false_keep_withdrawn` | 신규 비회원 동의 없음으로 affected_count 0 | 회원/과거 비회원 양쪽 숨김·제거 회차 철회1건과 false 기본값 재복사 후 withdrawn 유지 검증 |
| `test_class_withdrawal_cancels_existing_uploaded_batch_without_global_request` | 신규 비회원 연구 사본으로 uploaded 배치를 구성 | 회원/과거 비회원 동의·배치를 명시 구성하여 철회 후 배치 취소와 합성 cleanup 호출 단언 유지 |
| `test_research_notice_cannot_rewrite_original_selection_without_choice` | 비회원 고지 원본이 None으로 정규화됨 | 회원으로 전환. 선택 없는 고지 변경422·원본 불변·재선택 시각/ID 갱신·이력2건 유지 |

### 검증 환경과 중간 실패

- 원격/dev DB와 환경파일을 사용하지 않았다. `/tmp/guest-minor-pg85-data`에 PostgreSQL 16 전용 클러스터를 초기화하고 `127.0.0.1:55485/smoke`에 빈 DB 마이그레이션을 적용했다. 기존 DB/파일/브랜치는 삭제하지 않았다.
- 검증 Python은 `/tmp/mb237-venv/bin/python`. `/tmp/guest-minor-pg85-isolation/sitecustomize.py`에서 `DotEnvSettingsSource.__call__ = lambda self: {}`로 환경파일 값 주입을 차단했고 자식 alembic 프로세스에도 동일 PYTHONPATH를 전달했다. 워크트리에 환경파일이 없는 것도 확인했다. 이후 `_read_env_files`까지 빈 매핑으로 고정해 초기화 단계의 읽기도 차단했다. DATABASE_URL은 합성 로컬 URL만 주입했다. 백엔드 전체 실행은 `DATABASE_URL=sqlite://`, PG_SMOKE 미설정이다.
- 1차 수정 후 해당 파일 **26 passed**. PG 전체에서는 기존 테스트가 가져오는 SQLite 전용 ARRAY 전역 변환기가 신규 ClientProfile ORM fixture를 `"[]"`로 바꾸어 **8 failed, 468 passed**가 발생했다. 합성 프로필 준비를 PG 명시 INSERT와 `ARRAY[]::varchar[]`로 바꾸어 제품 코드/단언 변경 없이 해결했다. 이 중간 결과를 최종 통과로 취급하지 않는다.
- 독립 검증자는 정책/응답 계약·회원 경로 보존·최종 fixture diff를 재검토했으며 **Important 0건**이다. 최종 테스트 결과는 아래에 기록한다.
- 같은 PG DB를 재사용한 중간 전체 실행은 **2 failed, 474 passed**였다. 앞선 전체 실행이 남긴 합성 세션/효과 행 때문에 기존 M0 전체 집계(13 기대→62)와 이메일 효과 건수(1 기대→2)가 달라진 것으로 확인했다. 해당 DB는 지우지 않고 보존했으며, 최종 검증은 새 빈 `smoke_ci_final` DB에서 CI와 같은 `-m pg -p no:cacheprovider` 명령으로 수행한다. 중간 `tests/pg` 무마커 실행에는 CI가 선택하지 않는 21건도 포함된다.

### 최종 로컬 검증

- 빈 PG16 DB의 `alembic upgrade head` 통과, head `e036a0000061`.
- CI 동일 PG 전체: **455 passed, 21 deselected, 11 warnings**, 63.52초. 실행: `PG_SMOKE=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55485/smoke_ci_final PYTHONPATH=/tmp/guest-minor-pg85-isolation:. /tmp/mb237-venv/bin/python -m pytest --confcutdir=tests/pg tests/pg -q -m pg -p no:cacheprovider` (backend). 21건은 CI 마커 필터에 의한 비-PG 테스트 제외이며 건너뜀을 통과로 세지 않는다.
- PG fixture 위생: **2파일 위반 0건**.
- 백엔드 전체: **3991 passed, 468 skipped, 75 warnings**, 377.49초. 실행: `DATABASE_URL=sqlite:// PYTHONPATH=/tmp/guest-minor-pg85-isolation:. /tmp/mb237-venv/bin/python -m pytest -q` (backend). PG 등 468 skip은 별도 PG 결과와 구분한다.
- `git diff --check` 통과. 변경 범위는 PG 테스트와 이 수정 기록 3종이며 제품 서비스/회원 보관 코드는 그대로다. 같은 브랜치에 한글 커밋·push 후 PR #85 CI의 실제 head 결과를 최종 답변으로 보고한다.
- 로그: `/tmp/guest-minor-pg85-red.log`, `/tmp/guest-minor-pg85-ci-final.log`, `/tmp/guest-minor-pg85-backend.log`. 중간 실패 로그는 `/tmp/guest-minor-pg85-all.log`, `/tmp/guest-minor-pg85-all-final.log`이다.
