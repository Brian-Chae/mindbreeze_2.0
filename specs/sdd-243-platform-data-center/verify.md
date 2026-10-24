# SDD-243 — 플랫폼·기관 관리자 데이터 센터 구현 전 검증 계획

- Stage ③, 작성일 2026-10-24. **제품 구현 전 작성, 모든 제품 검증 미실행.** 이번 요청은 plan/verify만 작성·커밋·push이며 실행·제품 완료 승인이 아니다.
- 정본: [spec.md](spec.md)(`9a5a098c`), [plan.md](plan.md), [시안](../../designs/platform-data-center/index.html). 244 G1 `56fbc926`, T03 `7f654f12`; T06/T12 실제 연결 인수는 대기.
- 환경 경계: 이번에는 서버·DB·.env·실데이터·앱·메일·삭제·배포 접근/실행 없음. 아래 pytest/Playwright/PG/부하 명령은 **후속 승인된 격리 합성 환경용**이다. conftest가 DB/config를 자동 로드할 수 있으므로 현재 문서 작업에서 실행하지 않는다.
- 근거 수준: 문서/fixture/mock 성공 ≠ 실제 API/PG/스토리지/웹/앱 성공. 244 웹 W4와 앱 W5는 따로 인수한다. 미실행 체크박스는 체크하지 않고 실패·기준선·환경 제한을 그대로 기록한다.

## 1. 선행조건과 담당

| 게이트 | 필요 증거 | 소유 |
|---|---|---|
| 구현 시작 | Brian의 구현 범위 승인, D1~D3 잠정 설정/정책버전 확인 | 감독 |
| 계약 병렬 | B01 typed API/정책·고정 fixture, BE/FE 별도 워크트리·경로 분리 | BE/FE |
| 파형 실연결 | 244 T03 decoder + T06 get_manifest/불변 revision/실제 ACK·close 인수 | 244 A/C + BE |
| ZIP 실연결 | 244 T12 iter_export_artifacts·reader·policy 계약, 실제 hash fixture | 244 C + BE |
| 실제 웹 인수 | 244 W4 지원 프로필의 수신/저장 증거, Q01 API→ZIP→독립 복원 | QA |
| 앱 제공 | 244 W5 해당 iOS/Android 실기기 결과; 구 앱 미수집 안내 | 244 + QA |

테스트 데이터는 합성만 사용: platform_admin, 두 기관의 org_admin, 다기관 진행자, 일반 counselor/client/guest, 비활성 계정/기관, 개인상담소, 귀속미상 클래스, canonical/claim·스크럽 guest, 정상/철회/구고지·기한경과, EEG-v1/불명1.0/v2 3신호, 미착용·미수집·손상·pending/partial/complete+gap·레거시 indices null. 회원/진행자 회차0/1/49/50/51/101, 클래스51회차·회차101참여자를 준비한다. 개인정보는 example.invalid 등 명백한 합성값만 사용한다.

## 2. 수용 시나리오

### V01 — 문서·경계·회귀 (B01/Q01)

- [ ] 제품 변경 경로가 plan §6 소유권과 일치하고244 decoder/저장/manifest/수집/retention/research 파일을243이 수정하지 않았다.
- [ ] 공통32개 API(GET27/POST5) 모두 spec 번호→Task→테스트에 연결된다. #33/34 수집은244 담당이며 중복 구현하지 않았다.
- [ ] 기존 SDD-071 단건 생성/상태/URL·feature/report 동작은 유지되고 센터 요청의 report include만 거절된다. 밴드 없이 기존 상담·AI 요약·리포트 흐름 정상.
- [ ] D1~D3는 잠정 상태가 명시되고 FE는 서버 설정을 사용한다. org 식별 false/동시한도 변경/TTL 축소 시 서버가 실제 반영하며 과거 job 만료를 연장하지 않는다.

### V02 — 역할·기관·필드 통제 (B01/B02/B03/B07)

- [ ] platform_admin 전역 허용 조회; counselor/client/guest·비활성 계정은 센터 API403. org_admin은 active membership+활성기관+귀속확인 meditation 회차의 교집합만 조회.
- [ ] 목록/집계/검색/단건/파형/preview/create/status/part URL/감사 각각에 타기관·개인상담소·상담세션·불명귀속 ID를 주입하면404이며 개수/오류로 존재 유출 없음.
- [ ] 기관 연구 purpose 및 #9~15 플랫폼 전용 API 직접 호출403. 소속 상담사의 타기관·개인상담소 회차, 기관회원의 다른 회차는 제외. 기관간 묶음도 불가.
- [ ] 플랫폼 감사에서 기관관리자 작업은 보이지만 타 요청자 파일/URL 접근은 불가. 기관 감사는 본인+현재 기관만.
- [ ] 기본 DTO에 전화·생일 원문/상담본문/비공개 메모/리포트본문/토큰/저장소 key/자유 JSON 없음. 이름·이메일 기존 허용 정책 유지; reveal만 인가된 필드 일시 반환하고 화면 전환 즉시 폐기.
- [ ] 연구 배치에서 가명-사용자 역연결·진행자 실명·HMAC 없음. baseline PII/장비ID·개별 feature 없음. 개인정보 logger에는 actor/대상/시각/필드/허용만, 다운로드 감사와 혼동 없음.

### V03 — TOCTOU·재인가 (B05/B07/F01)

- [ ] preview 직후, 생성 직후, worker 시작 직후, 완료 후 URL 직전에 각각 소속해제·계정/기관 비활성·귀속변경·철회·기한경과·정책강화를 주입한다. 모든 부적격 산출물 발급 차단, warning 우회0.
- [ ] actor/role/org/목적/request_hash/job_id를 바꾼 preview·proof·멱등키 사용은 실패. 다른 관리자와 part_id 교환도 실패한다.
- [ ] 기관/대상/탭/필터/페이지 변경 시 요청 취소·선택/preview/proof/PII/파형 버퍼 초기화; 늦은 응답이 새 화면에 나타나지 않는다. no-store, localStorage/분석 로그에 민감값0.

### V04 — 탐색·범위·기간·집계 (B02/B05/F01/F03)

- [ ] 클래스→회차→참여자, 회차 전체/선택/참여자 단건이 정확한 집합으로 preview된다. 클래스 전체51회차·회차101참여자도 임의 한도로 거절하지 않는다. 미종료 회차는 제외사유 표시.
- [ ] 회원0/50/51/101회차에서 0건 요청불가, 50건 허용, 51건 전체요청413, 묶음1~50/51~100/101 선택 정확. 회원은 각 회차 자기 참여자만 포함.
- [ ] 상담사는 필수 기간 누락/역전 거절; 직접 진행 관계+기관 범위만. KST 시작00:00 포함/종료 다음날00:00 제외, 동일시각 ID tie-break 안정 정렬. 기간/대상 변경 시 묶음 초기화.
- [ ] 페이지 크기와 export 대상 독립, preview 고정 이후 새 회차/후발 ACK가 자동 추가되지 않음. 고정 ID/revision과 최종 manifest 일치.
- [ ] summary/목록/상세 같은 as_of·필터에서 일치; users 고유계정과 guest 구분, canonical/claim만 병합, 다기관 중복 의미 표시. 측정 raw+feature 중복집계0, unknown과 확인된0 구분, storage 부분집계 표기.

### V05 — 원파형·시간·결측 (B04/F02, 244 T03/T06)

- [ ] G1 golden CSV와 EEG fp1/fp2 µV·PPG red/ir 정수 count·ACC xyz g가 일치. 지원 v1/v2만 decode, 불명1.0·손상 SHA/size·truncated/nonfinite는 오류·가짜 파형0.
- [ ] 250/50/30Hz의 간격4/20/1000÷30ms 및 ACC index108000=3600초, 검증된25Hz=40ms 확인. 장비 rate와 observed rate·host_estimated/unknown 구분, 수신/업로드시각을 측정시각으로 대체하지 않음.
- [ ] wrap/reset/reconnect/overlap·3초 gap·unknown tail은 segment/끊김으로 표시, 연결/보간/묵시 중복제거0. complete+gap을 무손실로 표시하지 않음.
- [ ] 10/30/60초·스크롤·범위입력 `[from,to)` 동일 선택. max_points 기본2000/최대4000 채널별 검사, envelope 극값·원천 수/반환 수·방법 표기. 전체 회차 raw를 FE로 먼저 내려받지 않음.
- [ ] PPG/ACC 저장 이전·구 앱·미착용·만료·철회·lost/unknown 상태 각각 구별. missing 신호 파형/0값 파일 없음. legacy 원점불명은 null+legacy_time_origin_unknown.

### V06 — 전체 feature·표시6·PSD (B04/B06/F02)

- [ ] features.csv 키+27개 정확, total_neural_activity/faa·null·quality·원 float 값 보존. 상세 JSONL은 실제 emit inventory/source_windows를 빠짐없이 보존; scalar1Hz와 전체 emit 혼동 없음.
- [ ] indices 6개: focus/relaxation/emotional/bpm/respiration/hrv, HRV=SDNN(ms), RMSSD 별도. 당시 snapshot 정수·display input·model/version/hash/게이트/null/held/stale/source 일치. participant_player 우선 fallback view 메타 표시.
- [ ] 레거시 display_history_missing은 null/unverified; reconstructed/report_aggregate를 당시 표시값으로 섞지 않음. 미렌더 초·호흡 첫60초 insufficient_window가0으로 변하지 않음. 종합점수/순위/판정 생성0.
- [ ] PSD 합성10Hz·알려진 진폭에서 주파수 bin 오차≤1 bin, 적분파워 A²/2 ±5%. 2초 미만/30초 초과·gap/unknown 시간축은 계산 거부. Hann/Welch2초·50%/detrend·버전/µV²/Hz 명시, 저장 대역파워 미확인 단위는 별도.

### V07 — 파일·가명·독립 복원 (B06/Q01, 244 T12)

- [ ] 각 참여자 eeg_raw/ppg_raw/acc_raw/features/indices/meta/README 및 G1 additive raw/packet/JSONL/sidecar가 선택·정책 범위대로 존재. 없는 신호는 manifest 사유만, root README/dictionary/manifest는 매 part 필수.
- [ ] EEG CSV→float32 bit 왕복(유효숫자9자리), Parquet float32 및 timestamp schema, PPG 정수, UTF-8/RFC4180·null 빈칸·JSON null, NaN/Inf0. 원천 row count/hash/범위·단위 일치.
- [ ] 모든 신호 공통 상대초, t_rel_ms 동일원점. 정확시각 권한 없는 가명본은 UTC/tick/device_timestamp_ms/날짜 비노출, date-withheld·job별 가명 일관. 식별 운영도 최소필드 밖 PII0.
- [ ] 원본 bin/packet header 내 UUID/tick/UTC까지 탐색. lossless 권한 없으면 차단+redacted_packet_view 명시; ‘무손실 원본’ 오표기0. 허용 원본의 SHA-256은 서버 원본과 일치하며 서버 바이트 변경0.
- [ ] `[from,to)` CSV/Parquet 정확 선택, bin은 전체 경계청크+extra_range 확인. feature/source/indices provenance·raw-derived retention 분리, 재시작 segment 재결합 시 누락/중복0.
- [ ] fixture placeholder hash를 실제 artifact로 취급하면 검증 실패. 독립 verifier는 제품 decoder/package를 oracle로 사용하지 않으며 손상/누락/PII 주입 음성 fixture에 실패한다.

### V08 — ZIP 분할·1GB 경계 (B06/Q01)

- [ ] 작은 cap 단위시험과 별도로 최종1,000,000,000B 이하/초과 fixture를 실행. headers·central directory·반복 root metadata 포함해서 **모든 최종 part** 상한 준수, 재패킹 후 재검사.
- [ ] 각 part 단독 unzip 성공, `.z01` 분할압축/중첩ZIP0. 클래스 회차 폴더 유지, 큰 회차는 참여자/큰 파일은 CSV행·Parquet row group·JSONL 레코드 경계로 분할. header/schema 반복·continuation 범위/순번 정확.
- [ ] 단독 초과 bin은 원바이트 분할 없이 명시 차단/대체포맷. path traversal·절대경로·중복 파일명은 거절.
- [ ] 각 manifest 전체 part 목록/개수·해당 파일hash/rows/bytes·제외사유/source revision 일치. 자기 ZIP hash 순환 없음, DB status의 최종 ZIP hash 대조. 한 part 실패면 전체 ready 금지·URL0.

### V09 — 재인증·감사·만료·동의 (B07)

- [ ] 사유 trim 후1/2/500/501자 경계, 항목 전체 미선택, 식별+연구, 기관+연구, 미동의/철회/구고지/비회원 연구 차단. 운영도 수집·민감 처리근거 불명 시 차단.
- [ ] proof 299초 허용/300초 만료, 잘못된 export binding·탈퇴 proof·auth_epoch 변경 거절. 생성·URL 각각 재인증 검사, UI 체크박스만으로 성공 불가.
- [ ] job 요청+24h 기준(늦은 완료 연장0), 원천 조기 deadline 우선, URL≤60초/남은기한 최솟값, 만료 GET에 URL 없음·발급410. 연구 미ACK 보류로 남은90일 초과 객체도 반출 불가.
- [ ] requested/denied/preparing/ready/failed/expired/url_issued/url_denied 영속 감사. 감사 insert/commit 실패 시 생성·URL 발급0, signer 실패를 발급 성공으로 기록하지 않음. 이벤트 중복 전달은 식별 가능한 멱등 처리.
- [ ] 감사에는 URL/비밀/원시 생체값0, 원천 삭제 cascade0. UI ‘링크 발급’과 ‘실제 다운로드 완료’ 구분. S3 링크가 일회용·즉시 회수 가능하다고 표시하지 않음.

### V10 — 작업 경합·실패 복구 (B05/B06/B07)

- [ ] PG 동시 actor 요청2개(역할/기관 다른 경우 포함)에서 활성1개만 생성, 나머지429+본인 job ID. 같은 key/hash는 동일 job, 다른 hash409. 여러 part는 활성1개.
- [ ] DB commit 뒤 enqueue 실패·worker 중단/중복 delivery·lease 만료를 주입: outbox cron 직접 실행으로 재전달·fencing을 검증하고 후속 운영 스케줄 등록은 별도 증거로 남김, 완료part 재사용, 중복 발급/감사 누락0. 새 설정 한도2에서도 직렬화 검사 정상.
- [ ] missing 객체 등 기술 실패는 명시 allow_partial일 때만 warnings+누락사유; checksum 손상/권한변경은 failed/차단. terminal 실패 재요청은 새 preview/job, expired job 재개0.
- [ ] 오래 걸린 작업·브라우저 종료·재접속에서 본인 status 재조회 가능, 완료 전 URL0. 오류에 원문 경로/PII/스택트레이스 노출0.

### V11 — 보관 조회·마이그레이션 (B03/BE/Q01)

- [ ] retention GET에서 run_retention_sweep(dry_run 포함) 호출0, DB/객체/알림 쓰기0. 저장 dry_run/execute 기록·후보평가·물리삭제 미확인을 구분한다.
- [ ] 공개 삭제접수와 실제 탈퇴원장 구별, 이메일로 자동 연결/삭제예정 추정0. 연구 ack를 영구보관/재식별 불가 증거로 표시하지 않음.
- [ ] M243-1→2→3 및244 M1~M3 통합 계보 단일 head, legacy NOT NULL 의미와 bulk nullable/CHECK·unique/index 검사. source 삭제가 감사/작업증거에 cascade되지 않음.
- [ ] 격리 PG upgrade 전후 legacy job/구 서버 읽기·멱등/part1 호환·신규 bulk 입력·동시 race 검증. 실제 적용시간/lock 기록; rollback은 capability off, 자동 downgrade/컬럼삭제0.

### V12 — 실제 UI·API·성능 (F01~F03/Q01)

- [ ] 실제 브라우저1440/390에서 플랫폼8탭·기관 제한 탭, 테이블검색/필터/그룹·회차 탐색·상세·모달·키보드 focus·닫기/복귀 확인. page 가로 넘침/겹침/잘림0(표 내부 스크롤은 허용), 스크린샷 직접 확인.
- [ ] mock를 끈 실제 API에서 권한별 응답·그래프·작업 생성·part 파일 다운로드를 검증. 서버인가 실패를 UI 숨김 성공으로 대체하지 않는다.
- [ ] 합성60분×1명/20명 및50회차·클래스51회차 부하: warm waveform p95≤2초, create202≤1초, worker peak RSS≤256MiB 목표. 최소30회 측정·payload/객체수/ZIP·디스크/RSS 기록, 목표 미달 시 범위/구조 재검토.
- [ ] 대량 처리 중 전회차 `.all()`·전체ZIP 메모리 적재 없음. 244 상세 feature 증가량 포함, 임의 필드 누락/다운샘플로 예산 통과 금지. 실제1GB 경계는V08 별도 수행.
- [ ] 웹 실제 수신→ACK→T06 revision→T12 artifact→243 ZIP 독립 대조. 앱은 W5 미인수면 명확히 미검증으로 남긴다.

## 3. 후속 실행 명령·증거 계약

아래 파일은 plan에 따라 생성될 예정이며 현재 존재/통과를 주장하지 않는다. 테스트 환경 세팅은 별도 승인 범위이고 운영 DB/.env를 사용하지 않는다.

```bash
# BE: 승인된 격리 합성 환경, backend cwd
pytest tests/test_sdd243_policy.py tests/test_sdd243_queries.py tests/test_sdd243_governance.py tests/test_sdd243_measurements.py tests/test_sdd243_jobs.py tests/test_sdd243_package.py tests/test_sdd243_delivery.py -q
pytest tests/pg/test_sdd243_jobs.py tests/pg/test_sdd243_audit.py tests/pg/test_sdd243_schema.py -q
# FE: frontend cwd
npx vitest run tests/sdd243-navigation.test.tsx tests/sdd243-measurement.test.tsx tests/sdd243-export.test.tsx
npm run build
npx playwright test e2e/sdd243-data-center.spec.ts
# repo cwd: 읽기 전용 head 검사 및 독립 산출물 검사
python3 scripts/check-alembic-heads.py
python3 scripts/verify-sdd243-package.py --artifacts <합성-산출물-디렉터리> --expected <독립-기대값-json>
```

BE 변경에 models/config/migration/router가 포함되므로 focused 이후 전체 BE 회귀가 필요하다. 실제 기존 SDD-071 테스트명을 `rg --files backend/tests`로 찾아 함께 실행하고 결과 목록을 기록한다. FE focused·build 이후 기존 admin/org 라우트 회귀와 전체 테스트 범위를 변경영향에 맞춰 기록한다. 기준선 실패를 삭제/skip해서 green으로 만들지 않는다.

각 V 항목 기록 형식: `실행 commit / 담당 / 환경(합성·PG·mock·실API·웹·앱) / 명령 / 결과·건수 / 증거경로 / 실패·미실행 이유`. 구현자와 검증자는 분리한다. QA는 구현 diff와 실제 산출물을 직접 재검증하고 상태를 summary에 인계한다. 문서 검토만으로 위 체크를 완료 처리하지 않는다.

## 4. 이번 문서 검증 기록

- 제품 시나리오 V01~V12: **전부 미실행**.
- 확인 범위: spec/HTML/244 계약·decoder 정적 읽기, Task/경로·의존·마이그레이션·잠정 결정·검증 매핑 검토. 실제 서버/DB/장치 저장의 성공 증거가 아니다.
- 문서 diff/공백·링크·미실행 체크박스·변경경로 검사는 커밋 전 수행하고 대화 최종 보고에 결과를 남긴다. 문서 완료는 Stage ②·③ 산출물 작성 완료만 의미한다.
