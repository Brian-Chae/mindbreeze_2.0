# SDD-243 — 플랫폼·기관 데이터 센터 구현 결과 (BE + FE + 244 통합)

- 최종 갱신: 2026-10-24 / 브랜치 `sdd/243-platform-data-center` (243 BE·FE + 244 전체 + develop `371789b0` 통합). PR은 SDD-244와 한 건 `[SDD-243·244] 데이터 센터와 생체신호 원데이터 전체 저장`.
- 이 문서는 통합 기준 요약이다. 아래 "FE 구현 결과" 절은 FE 워커(F01~F03)의 원 기록이며 증거 수준(합성 API fixture)은 그대로다.

## 구성

| 영역 | 커밋 | 내용 |
|---|---|---|
| B01 계약·인가 | `aa052d4b` | 데이터 센터 DTO·역할/기관 범위 재검증(`data_center_policy`), 비활성 시 403 `data_center_disabled` |
| B02~B03 탐색·동의·보관 | `19d69ff1`, `dda140df` | 클래스→회차→참여자 집계, 동의·연구·보관 현황 |
| B04 측정 상세 | `1f7371b7` | 파형·feature·표시 6지표·PSD (`data_center_measurement`, `MeasurementBackend` 경계) |
| B05 작업·큐 | `d1e57e66` | preview 고정 → 작업 → outbox → `exports` 큐, fencing·lease |
| B06 ZIP | `395b4df1` | 참여자 폴더·분할 part·data_dictionary/manifest, 정책별 가명·정확시각 |
| B07 감사 | `5e0201ab` | part URL 발급 통제(재인증·재검사)·다운로드 감사 |
| FE F01~F03 | `b086cea2`, `c1564df1`, `536f8d2b` | 탐색·측정 그래프·반출 대화상자·작업/감사 |
| **통합(이번)** | `e07d1e14` | 244 실제 어댑터 연결(아래) |
| **운영 설정(이번)** | `3134d423` | dev 기본 활성 · outbox cron |
| PG 격리 수정 | `1eb78ba2` | 아래 "통합" 참고 |

## 244 통합 (런타임 연결)

- `backend/app/services/data_center_runtime.py` — 243의 두 주입점에 244 실제 구현을 등록한다.
  - `dm.register_backend(BiosignalMeasurementBackend)`: 244 manifest revision + `eeg_raw_chunks` + `biosignal_decoder` 로 파형/PSD/반출 대상 판정. 청크 시간은 manifest `time_range`(ms 반올림, 마지막 샘플이 잘림 — 통합 테스트로 발견)가 아니라 헤더 앵커의 정확한 유리수 시간에서 계산한다. 청크 무결성(크기·SHA-256) 불일치는 502, 저장소 읽기 실패는 503, 디코드 실패는 502 로 응답하고 파형을 만들지 않는다.
  - `dcx.set_raw_artifact_source(RawExportSource)`: 244 T12 `SDD243ArtifactSource` 를 job/대상 단위로 만들어 위임한다. 요청 구간·형식은 preview 원장에서 읽고, **파일마다** 현재 동의(`consent_eeg`, 연구 목적이면 연구 동의·철회)를 다시 확인한다(작업 도중 철회 반영).
  - `install()` 은 앱(`app/main.py`)과 Celery 워커(`app/tasks/export_task.py`) 양쪽에서 호출된다(멱등). 신규 프로세스에서 두 진입점이 실제 구현을 등록하는지 서브프로세스 테스트로 고정했다(fake 로 폴백하지 않음).
- B06 indices 훅 확장: `indices_sidecars` 추가 — indices 만 선택해도 `indices.jsonl`·`display-status.jsonl`·정규화/알고리즘 스냅샷이 함께 나간다(raw 신호 선택과 무관).
- 서버 남은 결함 수정(244 B 리뷰 인계): `fix(sdd-244)` `40918696` — 별도 절은 SDD-244 summary 참고.

## 운영 설정 — dev 에서만 켜지는 방식

- `config.py`: `data_center_enabled` 를 명시하지 않았고 `ENVIRONMENT=development` 이면 기본 `true`. deploy-dev 워크플로가 배포마다 `.env.dev` 의 `ENVIRONMENT=development` 를 보장하므로 서버 `.env` 는 건드리지 않는다. 운영은 `ENVIRONMENT=production`(기본) → 꺼짐. `DATA_CENTER_ENABLED` 를 명시하면 환경과 무관하게 그 값이 이긴다(**롤백 = `DATA_CENTER_ENABLED=false`**).
- `deploy/dev/register-crons.sh`: `process_data_export_outbox_cron.py` 매 1분 등록(기존 cron 형식, 멱등). `deploy-dev.yml` 번들 목록에 스크립트 추가. `deploy-dev.yml` script 길이 테스트 통과.
- 244 수집(capability)은 서버 기능 스위치가 없다 — `GET /sessions/{id}/biosignal-capabilities` 가 참여자 동의·업로드 자격으로 `upload_allowed` 를 계산하며 dev 에서 별도 설정 없이 동작한다.
- 메뉴: `/admin/data-center`(플랫폼), `/org/data-center`(기관 관리자)는 사이드바 상시 노출, 비활성 환경에서는 페이지가 비활성 안내를 보인다.
- **운영(prod) 반영 시 남은 일**: `deploy/jobs.tsv` 에 outbox 재전달 timer 추가(현재 dev cron 만), `DATA_CENTER_ENABLED` 정책 결정. 이번 범위 밖(prod 승인 별도).

## 검증 (통합 기준)

| 항목 | 결과 |
|---|---|
| 백엔드 전체(SQLite, `tests/pg` 제외) | **4,258 passed / 14 skipped / 0 failed** (439초) |
| PG(`tests/pg`, 빈 DB→head, 로컬 임시 PG16) | **512 passed / 0 failed** |
| 마이그레이션 | 빈 DB→head 적용 OK(테이블 113 = 112 + alembic_version), develop head(`e036a0000061`)→head upgrade OK(96→113), head 1개 `e036a0243003` |
| 프론트 vitest 전체 | 2,990 tests: **2,973 passed / 17 failed**, 실패 8파일·17건 — 244 기준선(`2,904/17`, 최종 `2,930/17`)과 **파일·테스트 이름 모두 동일**(신규 실패 0, 해소 0) |
| `tsc --noEmit -p tsconfig.app.json` | 종료 0 |
| `npm run build` | 성공(기존 청크 크기·동적 import 경고만) |
| 이번 신규 테스트 | `test_sdd243_244_runtime.py` 12건(등록·골든 파형·무결성·반출·동의 재검사·indices-only·dev 기본값·cron), `test_sdd244_manifest.py` +4건(RED 4/4 확인 후 GREEN) |

- PG 격리 수정(`1eb78ba2`): 243 PG 경합 테스트가 공유 DB 를 `TEMPLATE` 으로 복제해, 앞선 테스트의 잔여 연결 때문에 7건이 `ObjectInUse` 로 에러였다(전체 실행에서만 재현, 단독 실행은 통과). 전용 head 템플릿 DB 를 만들어 복제하도록 바꿨다. 같은 DB 에서 PG 스위트를 반복 실행하면 누적 데이터로 일부 테스트가 실패하므로 실행마다 새 DB 를 쓴다.

## 미검증 (성공으로 표시하지 않음)

- 실제 S3: presign 불변성·재PUT 거절·`ChecksumSHA256`·버전 ID·실제 객체 읽기(`storage_service.download_bytes`)와 1GB part 업로드/서명 URL. 테스트는 모의 저장소다.
- 실기기 LINK BAND(BLE) 60분 수집, 앱(iOS/Android) 수집·백그라운드.
- dev 서버 배포 후 실제 화면·API(데이터 센터 메뉴, 측정 상세, ZIP 생성·다운로드) 동작은 DEPLOY 창구 검증 대상이다.
- 대량 부하(20명·60분 합성), 목록·preview 에서 대상 수만큼 manifest 를 조회할 때의 성능.
- PG 위 API 전 구간(인가 포함) 시험.

## 알려진 위험

- `BiosignalMeasurementBackend.get_manifest(revision=None)` 는 판정 갱신(새 immutable revision)을 위해 쓰기를 동반한다 — preview/목록 GET 이 revision 을 만들 수 있다(내용이 같으면 새로 만들지 않음).
- 연구 목적 반출의 동의 재검사는 `ResearchConsent`(참여자 단위) 기준이다. 신호별 연구 동의 범위는 244에서도 미정의(`unknown`).

---

# FE 구현 결과 (원 기록)


- 실행일: 2026-10-24 / 워크트리 `mindbreeze_2.0-sdd243fe` / 브랜치 `sdd/243-fe`.
- 승인 범위: 사용자 요청에 따른 F01 → F02 → F03 구현·FE 검증·Task별 커밋·브랜치 push. PR·배포·서버·DB·.env·메일·삭제 실행 없음.
- 선행 동기화: `git fetch && git merge origin/sdd/243-be`, `06fde10a → 1f7371b7` fast-forward, 충돌 없음. B01~B04·계약·합성 fixture 유입이며 BE 파일의 FE 자체 수정은 없음.
- 증거 수준: **실제 React production build + Chrome + 합성 API fixture**. 실제 API/DB/244 저장·ZIP·운영 인증 인수 완료가 아니다.

## Task 결과

### F01 — 공통 탐색 (`b086cea2`)

- `/admin/data-center`와 `/org/data-center`, 역할별 메뉴·기관명·capabilities 탭.
- 보라/크림 토큰, 전역 집계 카드, 테이블·검색·상태·기관/유형 그룹·cursor·빈 상태.
- 클래스 → 회차 → 참여자, 회원/상담사 단위 탐색. 상담사는 조회 기간 필수, 회원 모드는 client 필터.
- 개요 inventory, 사용자, 클래스, 동의·연구 배치, 보관 실행·후보·탈퇴, 표준 baseline, 작업·감사 탭. 제한 DTO의 한국어 allowlist 투영만 사용.
- 기관/탭/대상/필터/페이지 변경 시 민감 상세·반출 선택 폐기, 요청 abort, 늦은 개인정보 응답 폐기.

### F02 — 측정 그래프 (`c1564df1`, 최종 메타 보완은 F03 커밋)

- EEG fp1/fp2, PPG red/ir, ACC xyz 원파형, 원 float feature 표, PSD, 당시 표시 6지표. HRV는 SDNN(ms).
- 10/30/60초 및 `[from,to)` 선택을 파형·feature·표시값·PSD·다운로드에 공유.
- 채널별 숫자 시간축, segment/gap 미연결, 단일 샘플 점, envelope 방법·원천/응답 수 표시. 미수집/null을 0으로 채우지 않음.
- 단건 상세 별칭·밴드·manifest/revision·동의·보관·신호 상태·포맷·시각·출처 표시.
- B04 indices API에는 범위 필터가 없어 FE가 `[from,to)`를 적용하고 다음 cursor를 유지한다. 과거값 재구성이나 종합점수·순위·판정 생성 없음.

### F03 — 다운로드·작업·감사

- 클래스/회차/선택 참여자/참여자 단건·측정 구간/회원/상담사 대화상자. 선택 회차·기간·50회차 묶음, 신호 5종과 bin 별도.
- 가명 기본, 사유 trim·길이, 기관 운영 목적/capabilities, preview 제외 범위 확인, POST 재인증 proof → 작업 생성. 체크박스로 인증을 대신하지 않음.
- 같은 생성 payload 재시도에 멱등키 유지, 새 preview·사유 변경 시 교체. 429 기존 작업 이동.
- 작업 상태·실제/예상 part·만료·재조회·cursor, part 재인증·링크 발급. 취소/part 교체/기관 변경 시 늦은 응답 폐기.
- 감사 actor_id/role/기관/목적/사유/결과/정책·cursor. 링크 발급과 실제 파일 수신 완료를 구별.
- 원본 파일 구조는 계약의 README_ko·dictionary·manifest 및 class/session/participant 경로 안내.
- 메뉴 회귀: 센터 항목의 report 키 재사용을 제거해 리포트 배지 복제를 차단. 기존 메뉴 골든에 승인된 새 센터 항목만 추가하며 기존 단언·키별 배지 검증 유지.

## 검증

- 신규 SDD-243 focused: **34/34 통과** (탐색 8, 측정 12, 반출 14). 모듈 부재·동작 RED 후 GREEN, DOM 전환·늦은 응답/취소·50/51·기관·범위·재인증·cursor 등 검증.
- 메뉴 관련: **29/29 통과**. 신규 메뉴 계약 골든과 센터 배지 비복제 회귀 포함.
- `npx tsc --noEmit -p tsconfig.app.json`: 통과.
- `npm run build`: 통과. 기존 대형 청크 및 정적/동적 import 혼용 경고는 남음.
- 기준선 전체: 257파일, **2,835 통과 / 기존 실패 17 / 총 2,852**.
- 최종 전체: **259파일(251 통과/8 실패), 2,867 통과 / 기존 실패 17 / 총 2,884**, 168.79초. 실패 파일·건수는 기준선과 정확히 일치. 메뉴 추가로 변경된 골든 5건은 새 항목을 추가하고 배지 키 중복을 수정하여 해소했다.
- Chrome `channel:'chrome'`: 실제 빌드 정적 파일을 Playwright route로 HTTPS 합성 origin에 제공. 서버 프로세스·외부 API 호출 없이 모든 요청 차단/fixture 응답. 플랫폼/기관 각각 1440×1000,390×844.
- Chrome 결과: **68장 / 108검사 통과 / 브라우저 예외0 / 페이지 가로 넘침0**. 390px 모달 생성 CTA가 하단 메뉴에 가려진 문제는 body portal로 수정하고 실제 클릭 재확인.
- 캡처 및 자동 검사: `captures-impl/`, `capture-results.json` (각 화면 가로 넘침·역할 탭·빈 검색·공유 범위·재인증 전 생성 차단 기록). 스크립트 `frontend/e2e/sdd243-capture.mjs`.
- node_modules는 요청한 메인 frontend 경로의 심볼릭 링크, 추적/커밋 제외. 전체 테스트가 덮어쓴 SDD-234 캡처는 `git checkout --`로 원복.

기존 실패 17건(이번 FE 수정과 분리):

- `org-management-browser.test.cjs` 2: 기관 모달/목록 필터·포커스.
- `org-counselor-management-browser.test.cjs` 1: 상담사 보호·확인 사유·역할/소속.
- `sdd234-a-mobile-home.test.tsx` 4: member/host 768·1440 계산 스타일 골든.
- `report-modal-pdf.test.cjs` 2, `report-server-pdf.test.cjs` 2: 모달/PDF/서버 다운로드.
- `agent-counselor-page.test.tsx` 2: 상담사 CTA/메시지 표시.
- `chat-message-deeplink.test.ts` 2: missing/failure 복귀.
- `sdd220-native-release.test.ts` 2: native 버전·Privacy Resources·서명.

## Mock 및 남은 인수

- B01~B04 조회는 계약 경로와 typed client를 연결하고 fixture로 검증했으며 실제 API 권한·데이터 응답은 미검증.
- B05~B07 미연결: `POST /exports/preview`, `POST /exports`, `GET /exports[/{id}]`, `POST /export-reauth`, `POST /exports/{id}/download-url`, `GET /download-audits`. 기본 제품 client는 정본 경로를 사용하고 테스트/캡처에서만 mock transport를 주입/가로챈다. 인증정보·proof·URL은 저장소에 보관하지 않는다.
- 실제 ZIP 생성/독립 복원·1GB part·서명 URL·실제 재인증·영속 감사·서버 정책/TOCTOU·PG·스토리지·244 T06/T12·실기기는 후속 BE/QA 인수 범위다. 성공으로 표시하지 않았다.
- preview/status fixture의 고정 만료 시각은 캡처 합성 응답에서 현재시각 기준 미래로 조정한다. 실환경 기한을 연장한 작업이 아니다.
- verify.md의 V01~V12 체크박스는 복합 실API/BE 조건을 포함하므로 통째로 완료 처리하지 않고 이 FE mock 실행 증거와 구별한다.
