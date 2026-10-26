# MIND BREEZE 2.0 — 운영(prod) 전환 최종 승인안

- 작성: [MB][DEPLOY] 창구, 2026-10-26 (KST)
- 성격: **승인안(초안)**. 이 문서는 prod 배포·prod DB 쓰기·마이그레이션 실행·메일 발송을 하지 않았다. 근거는 git 이력, 저장소 코드, GitHub Actions 기록, prod/dev 공개 엔드포인트 읽기뿐이다.
- 6)항 OPS 확인 표는 TASK BOX가 띄우는 OPS 읽기 워커의 결과를 받아 채운다. 비어 있는 칸은 "미확인"이다.

## 0. 결론 요약

| 구분 | 내용 |
|---|---|
| 전환 범위 | main `addcb7e0`(10/18) → develop `3bf4c75e`(#116 머지). 스토어 FIX 카드 2건 머지 후 SHA를 갱신한다. |
| 병합 위험 | **충돌 0.** develop→main 병합 결과 트리가 develop 트리와 완전히 같다(`dd94c925…`). main 쪽 고유 변경은 없다. |
| 마이그레이션 | 18건(`e036a0000052`→`e246a0301001`), head 1개. 정적 게이트는 **destructive=true**라서 deploy-prod에서 `confirm_destructive=true`가 필요하다. |
| 플래그 | LIVE_PROTOCOL_V2·상담·AI·데이터 센터는 설정을 건드리지 않으면 prod에서 꺼진다(코드·manifest 기준). 단 서버 실제값은 OPS 확인 전까지 미확인이다. |
| 10/18 실패 | 3건 중 2건은 실제 결함(이미 수정), 1건(`494c682a`)은 **의도된 실패 주입**(롤백 리허설)이었다. |
| 차단 요소 | ① 18건을 prod 복제본에 적용해 본 기록 없음 ② prod 실행 SHA·서버 설정값 미확인 ③ 화면 렌더 검증 미실시 ④ 아래 Brian 결정 3건 |

### Brian 결정이 필요한 것
1. **CLASS_SCHEDULING_ENABLED(및 ROLLING·TEAM_READ) prod 값.** 기본은 꺼짐인데, 명상 클래스 예약 편성이 꺼져 있으면 예약 클래스 흐름(SDD-216·231)이 prod에서 동작하지 않을 수 있다. 어디까지 열지 정해야 한다.
2. **후보 SHA 잠금 시점.** 스토어 FIX 카드 2건·#115(연결 불안정 배너)를 넣을지, #116 실측 이후로 할지 정해야 한다.
3. **배포 시간대.** 마이그레이션 `0052`가 `SET NOT NULL`로 테이블을 훑는다. 진행 중 클래스가 없는 시간으로 정해야 한다.

---

## 1. 범위: main → develop 차이

### 1-1. 규모
| 항목 | 값 |
|---|---|
| 기준점(merge-base) | `88e6087e` (2026-10-18, PR #6 SDD-211 phase0) |
| develop이 앞선 커밋 | 817개 (머지된 PR #7~#116, 103건) |
| 변경 파일 | 4,961개 (대부분 `specs/`·`designs/` 문서) |
| 코드 | `backend/app` 180개(신규 90), `frontend/src` 503개(신규 269), Android 58, iOS 53 |
| 신규 SDD 스펙 | 202·203·212~235·237·238·240~246 |

### 1-2. 기능 묶음 (specs 기준)
| 묶음 | SDD | prod에 들어오는 것 |
|---|---|---|
| 클래스 구조 재설계 | 211·213~219 | 클래스·세션 상위 구조, 편성·강사, 멤버십·출석·보강, 클래스 리포트 관리. **마이그레이션 `0052`~`0058`** |
| 스토어 심사·개인정보 | 220·238·241 | 계정 삭제(30일)·소셜 연결, 채팅 신고·차단, 개인정보 처리방침 v2.2, 뇌파 원본 90일 보관·연구 동의자 예외, 연구용 비식별 사본 |
| 실시간·네이티브 | 222·224·246 | 앱 백그라운드 BLE, 실시간 지연 수정, **실시간 통신 재설계(live-v2)**. 마이그레이션 `e246a0301001` |
| 홈·클래스 진행 UX | 221·223·225~237·240·242 | 즉시 클래스, 코드 입장, 대기실, 상담사 홈, 모바일 손들기·스와이프, 설정 탭 |
| 데이터 센터·원데이터 | 243·244 | 관리자 데이터 센터, 3신호(EEG·PPG·ACC) 원데이터 저장. 마이그레이션 `0243*`·`0244*` |
| UI 통일 | 234·245 | 디자인 토큰·공용 컴포넌트 |
| 인프라·CI | 210·212·229 | 리포트 큐 분리(stt/report 워커), CI 단축. 신규 타이머 4개 |
| AI 대화 | 202·203 | 루시 대화 맥락·멀티턴 (prod 노출은 §3에서 비공개 유지) |

신규 주기 작업: `deploy/jobs.tsv` 17→21개. `report_backlog_probe`, `class_operations`, `class_rolling`, `account_deletion_sweep`이 추가되고, `retention_sweep` 타이머가 켜진다(`enabled` 0→1).

### 1-3. main에만 있는 역방향 15커밋의 처리

**판정 근거:** main의 트리가 기준점 `88e6087e`의 트리와 **동일**하다. 즉 main은 기준점 이후 고유한 파일 변경이 0이다. `git merge-tree`로 develop→main 병합을 시뮬레이션하면 충돌 0이고, 결과 트리가 develop 트리와 같다. 15커밋 중 재반영이 필요한 것은 **0개**다.

| 커밋 | 내용 | 처리 | 근거 |
|---|---|---|---|
| `addcb7e0` 10/18 | develop→main, SDD-210 컷오버 결과 | 동등 반영 | 제2부모 `88e6087e`가 develop 조상 |
| `c8d4d8bb` 10/18 | 랜딩 문의 연락처, 컷오버 준비 | 동등 반영 | 제2부모 `7d924816` 포함 |
| `90e4b3ed` 10/18 | 컷오버 스크립트·확정값 | 동등 반영 | 제2부모 `2f844c8b` 포함 |
| `89db5635` 10/18 | 개인정보 처리방침 /privacy 게시 | 동등 반영 | 제2부모 `055a7d0a` 포함. 방침은 이후 v2.2로 갱신 |
| `494c682a` 10/18 | 빈 DB 마이그레이션 체인 수정 | 동등 반영 | 제2부모 `5bf7eac6` 포함 |
| `3f6ed588` 10/18 | SSM 스크립트 bash 재실행 수정 | 동등 반영 | 제2부모 `13fc1e0d` 포함 |
| `dbf19cfa` 10/18 | T-14 서버 구성 스크립트 | 동등 반영 | 제2부모 `0dd1793e` 포함 |
| `50949b2f` 10/18 | build-release.sh 출력 경로 수정 | 동등 반영 | 제2부모 `73bc766e` 포함 |
| `511b187d` 10/18 | SDD-210 운영 환경 구축 | 동등 반영 | 제2부모 `5a39145a` 포함 |
| `ad104aeb` 10/13 | SDD-202 루시 대화 품질 | 동등 반영 | 제2부모 `a1bb36ee` 포함 |
| `a7dfaf28` 10/12 | SDD 작업 전체 반영(충돌은 develop 기준) | 동등 반영 | 제2부모 `f535597c` 포함 |
| `aaaa7f29` 6/5 | RegisterPage 디자인 수정 | **버림** | develop 이력에 없음. 트리 동일이므로 내용은 develop이 이미 대체 |
| `fd51133e` 6/5 | Sprint 4 WebSocket 통합 | **버림** | 위와 같음 |
| `c671e517` 6/5 | Sprint 3 LINK BAND 실시간 EEG | **버림** | 위와 같음 |
| `048b82bb` 6/5 | Sprint 2 LiveKit 화상 | **버림** | 위와 같음 |

- 6월 4커밋은 develop 이력에 해시로는 없지만, main이 10/12 병합에서 "충돌은 develop 기준"으로 이미 정리했다. 이 판단은 트리 동일성에서 나온 결론이고, 4커밋 각각의 diff를 줄 단위로 대조하지는 않았다.
- **병합 방식 권고:** develop→main 머지 커밋(기존 방식 유지). 시뮬레이션 결과 충돌 없음.

---

## 2. 마이그레이션 18건

실행하지 않았다. 아래는 소스 정적 분석(`deploy/ci/check_migrations.py --base-sha addcb7e0`, DB 접속 없음)과 코드 읽기 결과다.

### 2-1. 목록
`lock`은 `SET LOCAL lock_timeout`(5초) 유무다. 행 수는 prod를 보지 않아 알 수 없다(§6).

| # | revision | SDD | 내용 | 변환/잠금 위험 | 롤백(downgrade) |
|---|---|---|---|---|---|
| 1 | `e036a0000052` | 213 | 스키마 드리프트 정리: `chat_messages.read_by` ARRAY→JSONB, `users.auth_provider` 등 **NULL 채움 후 SET NOT NULL** (careers·qualifications 포함) | **높음.** UPDATE 후 NOT NULL 전환(테이블 스캔). lock 5초 | **없음(`pass`)** — 코드 revert + 스키마 유지 |
| 2 | `…0053` | 214 | 클래스군 신규 테이블 4개 | 낮음(신규 테이블) | 가역 |
| 3 | `…0054` | 214 | 상담군 신규 테이블 5개 | 낮음 | 가역 |
| 4 | `…0055` | 214 | 가드 테이블 + 기존 3개 테이블 가산 컬럼 14개 + 제약 | 중간(기존 테이블 컬럼·제약) | 가역(43줄) |
| 5 | `…0056` | 216 | 명상 편성 가산 스키마(테이블 5, 컬럼 6) | 낮음 | 가역 |
| 6 | `…0057` | 217 | 멤버십·guest·동의. 컬럼 15, 인덱스 23. **`UPDATE session_participants SET report_consent_override=true, research_consent_override=true`(WHERE 없음, 전 행)** + `checkin_state` 백필 UPDATE | **중간~높음.** 전 행 UPDATE. 행 수에 비례. lock 5초 | 가역 |
| 7 | `…0058` | 218 | 클래스 리포트 일괄 작업 테이블 2개 | 낮음 | 가역 |
| 8 | `…0059` | 220 | 계정·개인정보: `users.birth_date/deleted_at/purge_after`, `consents.withdrawn_at`, 삭제 원장 등 | 낮음(ADD COLUMN IF NOT EXISTS) | 가역(16줄) |
| 9 | `…0060` | 220 | 채팅 신고·상호 차단 테이블 | 낮음 | 가역 |
| 10 | `…0061` | 237 | 진행 기록 안내 상태 컬럼 3개 | 낮음 | 가역 |
| 11 | `e036a0244001` | 244 | 세 신호 raw v2 원장 + stream/segment/gap/manifest. `uq_eeg_raw_chunk`을 더 넓은 v2 제약으로 교체 | 중간(제약 교체. 신규 제약을 먼저 만든 뒤 구 제약 삭제) | 가역(26줄) |
| 12 | `…244002` | 244 | 산출물·화면 스냅샷 원장 | 낮음 | 가역 |
| 13 | `…244003` | 244 | 연구 영수증·객체 삭제 outbox | 낮음 | 가역 |
| 14 | `e036a0243001` | 243 | 데이터 센터 범위·preview. 컬럼 16, `data_export_jobs`의 3개 컬럼 **NOT NULL 해제** | 낮음. **lock_timeout 없음**(메타데이터 변경이지만 긴 쿼리 뒤에 대기할 수 있음) | 가역 |
| 15 | `…243002` | 243 | ZIP part 원장·큐 outbox | 낮음. lock_timeout 없음 | 가역 |
| 16 | `…243003` | 243 | 반출 감사 확장 | 낮음. lock_timeout 없음 | 가역 |
| 17 | `e036a0261001` | — | 채팅 신고 철회: `chat_reports.status`(기본 `submitted`), `withdrawn_at` | 낮음 | 가역 |
| 18 | `e246a0301001` | 246 | 실시간 원장 테이블 4개(`live_session_epoch`·`live_command_ledger`·`live_outbox`·`capture_stream`) | 낮음 | 가역 |

### 2-2. 정적 게이트 결과
- head 1개(`e246a0301001`), 검사 대상 18건, **destructive=true, 경고 14건.**
- 경고 14건의 정체(소스 대조): `0052` 8건과 `0057` 중 2건은 **실제 DML**(UPDATE). `0057`의 나머지 3건과 `244003` 1건은 `BEFORE UPDATE OR DELETE` 트리거 정의 문자열로, 게이트의 정규식에 걸린 **오탐으로 보인다**(실제 DML 아님). 이 분류는 소스를 읽어 판단한 것이다.
- 따라서 deploy-prod는 `confirm_destructive=true`를 요구한다. 의도된 동작이다.

### 2-3. 롤백 호환성 (핵심 위험)
운영 원칙은 "expand 전용"이라 **DB는 자동으로 되돌리지 않는다**(`rollback-prod.yml`). 마이그레이션 적용 후 코드를 이전 릴리스로 되돌리면, 이전 코드가 새 스키마에서 동작해야 한다.
- `0052`가 `users.auth_provider`, `chat_messages.recipient_count`, `careers.*`를 NOT NULL로 바꾼다. **이전 릴리스 코드가 이 컬럼을 채우지 않고 INSERT하면 실패할 수 있다.** 이 호환성은 읽기만으로 판정할 수 없어 복제본 리허설의 필수 검증 항목으로 둔다.

### 2-4. prod 스냅샷 복제본 리허설 (OPS 실행, 승인 후)
1. 최신 자동백업 시각과 보존(14일), 삭제방지를 확인한다.
2. 수동 스냅샷을 만든다. RDS 복원 RTO는 10/18 실측 **약 9~10분**, PITR RPO는 약 2분이다.
3. 스냅샷에서 **임시 인스턴스를 복원**한다(prod 아님, 리허설 후 삭제는 별도 승인).
4. 복제본에 `alembic upgrade head`를 실행한다. 시작·종료 시각과 구간별 소요, 잠금 대기를 기록한다.
5. 전후 행 수를 비교한다: `session_participants`, `chat_messages`, `users`, `careers`, `qualifications`.
6. 복제본에 붙인 **이전 릴리스(main `addcb7e0`) 코드**로 로그인·클래스 입장·채팅 송신 스모크를 한다(§2-3 검증).
7. 새 코드로 같은 스모크를 한다.
8. 결과(소요 시간, 잠금 대기, 오류)를 이 문서 §6에 기록한다.
- **중단 기준:** 4단계가 10분을 넘거나 잠금 대기가 5초 timeout으로 실패하면 본 배포를 보류하고 원인을 먼저 해결한다.

---

## 3. 플래그

prod 값은 서버를 보지 않아 **코드 기본값과 `deploy/env-manifest.tsv`(static)** 기준이다. 실제값은 §6에서 확인한다.

| 플래그 | 코드 기본 | prod manifest | 의도 | 비고 |
|---|---|---|---|---|
| `LIVE_PROTOCOL_V2` (서버) | false | 없음 | **off 유지** | off면 `live-v2` 경로는 handler에서 404. 단 인증 의존성이 먼저 실행되면 비로그인 호출은 401일 수 있어, 검증은 로그인 계정으로 한다. |
| `VITE_LIVE_PROTOCOL_V2` (프론트) | 미정의=off | release-build에 없음 | **off 유지** | dev는 deploy-dev가 true를 주입한다. prod 빌드에는 없다. |
| `VITE_COUNSELING_ENABLED` | 미정의=비공개 | release-build에 없음 | **비공개 유지** | 프론트만 숨긴다. **백엔드 `counseling` 라우터는 항상 등록**돼 있어 서버 측 차단 여부는 미확인이다. |
| `VITE_AI_ENABLED` / `AI_FEATURES_ENABLED` / `STT_ENABLED` | 비공개 / false / false | 없음 | **비공개 유지** | 루시·STT·요약·AI 초안 |
| `DATA_CENTER_ENABLED` | false (`ENVIRONMENT=development`일 때만 자동 true) | 없음 | off | prod 환경이면 켜지지 않는다. |
| `RETENTION_SWEEP_ENABLED` | false | static false | off | **타이머는 켜진다**(`jobs.tsv` enabled=1). false면 매일 03:00 UTC에 **보고(dry-run)만** 한다. |
| `ACCOUNT_DELETION_SWEEP_ENABLED` | false | static false | off | 타이머는 10분마다 돈다. 소셜 연결 해제 재시도·삭제 요청 알림은 실행되고, 30일 영구 삭제는 dry-run 보고만 한다. 알림 수신처(`signup_notice_email`) 설정 확인 필요. |
| `RESEARCH_EXPORT_ENABLED` | false | static false | off | |
| `PIPELINE_QUEUE_SPLIT_ENABLED` | false | static **true** | on | stt/report 워커 분리. 롤백은 false. |
| `PIPELINE_METRICS_CLOUDWATCH_ENABLED` | false | static false | off | AWS 권한 확인 전 활성 금지 |
| `CLASS_SCHEDULING_ENABLED` | false | ssm 선택 | **Brian 결정** | 미설정이면 false. 위 결정 사항 1번. |
| `CLASS_ROLLING_ENABLED` / `CLASS_TEAM_READ_ENABLED` | false | ssm 선택 | 결정 후 | |
| `DATA_CENTER_EXPORT_REAUTH_REQUIRED` | false | 없음 | 기본 유지 | #93에서 기본 false |
| `ENABLE_DEV_ROLE_SIMULATION` | false | static false | off | |

---

## 4. 10/18 Deploy Prod 실패 원인과 재발 방지

`specs/sdd-210-prod-environment/rehearsal-result.md`와 각 run 로그로 대조했다.

| run | 대상 SHA | 결과 | 원인 | 조치 |
|---|---|---|---|---|
| 39077484296 | `dbf19cfa` | 실패 | SSM `RunShellScript` 기본 셸이 dash라서 `set -o pipefail` 오류(`Illegal option -o`) | `ssm-install-cmd.sh`가 bash로 재실행하도록 수정(`13fc1e0d`) |
| 39079034212 | `3f6ed588` | 실패 | 빈 DB에 마이그레이션 체인 85개를 적용할 때 자동 생성 드리프트 마이그레이션 `30c1bfbc724f`가 `chat_room_participants`를 중복 생성(`DuplicateTable`) | `IF NOT EXISTS` 성격의 보호 추가(`494c682a`). 롤백 트랩이 정상 동작해 서버 변경 0 |
| 39082258294 | `494c682a` | 실패 | **의도된 실패 주입.** `alembic_version`을 존재하지 않는 `deadbeef0000`으로 바꾼 뒤 재배포해 롤백 동작을 검증한 것(T-16 롤백 리허설). `Can't locate revision` → 종료 코드 20, 코드·서비스 변경 없음, 주입값 원복 | 결함 아님 |
| 39098860208 | develop `7d924816` | **성공** (10/18 04:57Z) | — | prod 마지막 성공 배포 |

- 지시문의 "10/18 Deploy Prod 실패(494c682a)"는 위 세 번째 건이며, 실제 결함이 아니라 **리허설**이었다.

### 재발 방지 (이번 전환)
1. **빈 DB 체인 + prod 복제본 이중 검증.** 10/18 실패는 두 건 모두 "이전에 적용해 본 적 없는 DB 상태"에서 났다. 이번 18건은 prod 복제본에서 먼저 적용한다(§2-4).
2. **`confirm_destructive=true`를 명시 입력**하고, 입력 사유에 §2-2의 경고 분류를 적는다.
3. **관찰 시간을 기본 5분보다 길게(10분 권고)** 잡는다. 스모크·관찰 실패 시 워크플로가 직전 릴리스로 자동 롤백한다.
4. 마이그레이션 실패 시 서버가 자동 복귀하는 트랩(전환 안 함, exit 20)이 10/18에 실증됐다. 이번에도 같은 경로를 쓴다.
5. CI `backend-pg-smoke`가 PR마다 마이그레이션 체인을 PG에 적용한다. 단 **prod 데이터 규모·제약 충돌은 CI가 보지 못한다**는 한계가 있다.

---

## 5. 배포 순서·검증·롤백 기준

### 5-1. 순서
| 단계 | 내용 | 승인 |
|---|---|---|
| 0 | 후보 SHA 잠금(§0 결정 2번), §6 OPS 확인 완료 | Brian |
| 1 | prod 복제본 리허설(§2-4) 통과 | OPS 실행, Brian 승인 |
| 2 | 연구 가명 키 `RESEARCH_ID_KEY_V1` 오프라인 백업 확인, 방침 v2.2 법무 승인 확인, 사용자 공지 | Brian |
| 3 | develop→main 머지 PR (충돌 0 확인됨) | Brian |
| 4 | `release-build`로 후보 SHA 산출물 생성. MANIFEST의 `git_sha`·`migration_heads`·`destructive_migrations` 확인 | — |
| 5 | **수동 RDS 스냅샷** 생성 | OPS |
| 6 | `deploy-prod` 실행(`release_id`, `confirm_destructive=true`, `observe_minutes`≥10). `environment: production` 승인 게이트에서 Brian이 승인 | Brian |
| 7 | 서버 설치(마이그레이션 → 원자 전환 → 헬스) → 공개 스모크 → 관찰 → 성공 확정 | 자동 |
| 8 | 아래 5-2 검증 | — |
| 9 | 플래그 조정(예: CLASS_*)은 **별도 변경**으로, 검증 후 하나씩 | Brian |

### 5-2. 검증 (화면 실렌더 기준)
HTTP 200은 근거가 되지 않는다. 확인 결과 `/account-deletion`은 prod·dev 모두 **임의의 없는 경로와 같은 SPA 폴백 응답**을 돌려주고, 현재 prod 번들에는 `account-deletion` 문자열이 0건이다. 따라서 브라우저 렌더로 판정한다.

| # | 검증 | 합격 기준 |
|---|---|---|
| V-1 | 비로그인 브라우저로 `/privacy` | 제목 "개인정보 처리방침", 문구 "시행일 2026년 10월 24일 · 버전 2.2" 표시 |
| V-2 | 비로그인 브라우저로 `/account-deletion` | 제목 "MIND BREEZE 계정 삭제 요청" 표시 |
| V-3 | `/health`, `/health/ready` | 둘 다 200, `database`·`redis` ok |
| V-4 | 서비스 상태 | 워커 5종 active, 타이머 21개 중 활성 목록이 `jobs.tsv`와 일치 |
| V-5 | 마이그레이션 | 배포 로그에 `Running upgrade … → e246a0301001`, 오류 없음. prod `alembic current` 읽기 확인(OPS) |
| V-6 | 로그인·클래스 입장 | 로그인 계정(회원·상담사)으로 클래스 입장·채팅 송신 |
| V-7 | `live-v2` off | **로그인 계정**으로 `GET /api/v1/sessions/{id}/live-v2/snapshot`가 404 (§3 비고) |
| V-8 | 상담·AI 비공개 | 로그인 후 화면에 상담·AI·루시 진입점이 없음 |
| V-9 | 데이터 센터 비노출 | 관리자 메뉴에 데이터 센터가 없고 `/api/v1/data-center/summary` 응답이 비활성(404 또는 403) |
| V-10 | 보관 정리 보고 | `/var/log/mindbreeze-retention-sweep.log` 첫 실행이 `mode=dry_run`이고 삭제 0건 |

- **현재 상태:** V-1·V-2는 이번 작성 중 브라우저 연결 실패(CDP)로 **렌더를 직접 확인하지 못했다.** 따라서 위 합격 기준은 소스(`privacy-policy.ts`의 `PRIVACY_POLICY_VERSION='2.2'`, 시행일 `2026-10-24`, `account-deletion-page.tsx`의 h1)에서 가져온 기대값이다.

### 5-3. 롤백 기준
| 상황 | 조치 |
|---|---|
| 마이그레이션 실패 | 서버가 전환하지 않고 종료(exit 20). 코드·서비스 변경 없음. 원인 수정 후 재시도 |
| 스모크 또는 관찰 실패(연속 3회) | 워크플로가 직전 릴리스로 **자동 롤백** |
| 배포 후 앱 결함(5xx 증가, 로그인 실패, 클래스 입장 불가) | `Rollback Prod` 워크플로(Brian 승인). 단 DB는 되돌리지 않으므로 **§2-3 호환성이 리허설에서 통과한 경우에만** 코드 롤백을 쓴다 |
| 데이터 손상 | RDS PITR로 임시 인스턴스를 복원해 판단(RTO≈10분, RPO≈2분). 자동 롤백 금지, Brian 별도 승인 |
| 점검창 | 10/18 컷오버는 60분 한도, 초과 시 롤백 판단이었다. 이번 증분 배포의 한도는 리허설 소요 시간을 보고 정한다 |

---

## 6. OPS 확인 필요 항목 (결과는 OPS 워커가 채움)

| # | 항목 | 확인 방법(읽기만) | 결과 |
|---|---|---|---|
| O-1 | prod 실제 실행 릴리스·git SHA | 서버 `/opt/mindbreeze/current` 링크와 MANIFEST의 `git_sha`. 참고: 마지막 성공 run의 워크플로 ref는 develop `7d924816` | |
| O-2 | prod `alembic current` | 서버에서 읽기 전용 조회. 기대값 `e036a0000051` | |
| O-3 | §2-1 대상 테이블 행 수 | `session_participants`, `chat_messages`, `users`, `careers`, `qualifications`, `data_export_jobs` (건수만, 개인정보 열람 금지) | |
| O-4 | 서버 실효값: `RETENTION_SWEEP_ENABLED`, `ACCOUNT_DELETION_SWEEP_ENABLED`, `RESEARCH_EXPORT_ENABLED`, `LIVE_PROTOCOL_V2`, `DATA_CENTER_ENABLED` | 값 열람 없이 렌더된 설정의 유무·true/false만. 시크릿은 접두사·길이만 | |
| O-5 | 현재 prod 프론트 번들의 `VITE_COUNSELING_ENABLED`·`VITE_AI_ENABLED` 효과 | prod 번들 문자열 대조 + 로그인 후 화면 | |
| O-6 | `CLASS_SCHEDULING_ENABLED`·`CLASS_ROLLING_ENABLED`·`CLASS_TEAM_READ_ENABLED` 현재값 | SSM 파라미터 유무 | |
| O-7 | 삭제 요청 알림 수신처(`signup_notice_email`) 설정 유무 | 설정 유무와 도메인만 | |
| O-8 | 지원 문의·신고 접수 경로와 수신자(운영 설정) | 설정 유무 | |
| O-9 | RDS: 자동백업 최신 시각, 보존 일수, 삭제방지, 스토리지·여유 | RDS 읽기 | |
| O-10 | 설치된 systemd 타이머 목록과 `jobs.tsv`(main 17개) 비교 | `systemctl list-timers` | |
| O-11 | `FCM_PROJECT_ID`·`FCM_SERVICE_ACCOUNT_JSON` 설정 유무 (푸시) | 유무만 | |
| O-12 | 연구 가명 키 오프라인 백업 완료 여부, 개인정보 처리방침 v2.2 법무 승인 여부 | Brian 확인 | |
| O-13 | Android·iOS 앱이 prod 서버의 `live-v2` off 상태에서 동작하는지 (#116 네이티브 백그라운드 측정 포함) | APP 창구 확인 | |

---

## 7. 이 문서에서 확인하지 못한 것

- prod 서버·DB·SSM 설정값 일체(§6으로 이관).
- `/privacy`·`/account-deletion`의 브라우저 렌더(연결 실패).
- 마이그레이션 18건의 prod 적용 결과, 실행 시간, 잠금 대기.
- 이전 릴리스 코드가 새 스키마에서 동작하는지(§2-3).
- #116 실시간 프로토콜과 네이티브 백그라운드 측정의 실동작(Brian 실측 전).
- 백엔드 `counseling` 라우터의 서버 측 비공개 처리 여부.
- 6월 4커밋 각각의 줄 단위 대조(트리 동일성으로 갈음).
