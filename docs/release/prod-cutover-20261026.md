# MIND BREEZE 2.0 — 운영(prod) 전환 최종 승인안

- 작성: [MB][DEPLOY] 창구, 2026-10-26 (KST). 개정: 같은 날 보완판(게이트 분리·코드 근거 보강).
- 성격: **승인안(초안)**. prod 배포·prod DB 쓰기·마이그레이션 실행·메일 발송을 하지 않았다. 근거는 git 이력, 저장소 코드, GitHub Actions 기록, prod/dev 공개 페이지 읽기뿐이다.
- 표기: 코드 근거는 `파일:줄`(develop `3bf4c75e` 기준). "main"으로 표시한 것은 prod 기준 브랜치 `addcb7e0`다.

## 0. 요약과 게이트

| 구분 | 내용 |
|---|---|
| 전환 범위 | main `addcb7e0`(10/18) → develop `3bf4c75e`(#116). 스토어 FIX 카드 머지 후 SHA 갱신 |
| 병합 위험 | **충돌 0.** develop→main 병합 결과 트리 = develop 트리 (A-1) |
| 마이그레이션 | 18건, head 1개. 정적 게이트 destructive=true → `confirm_destructive=true` 필요 (A-2) |
| 큰 위험 3개 | ① `0052` NOT NULL 전환(downgrade 없음) ② `0057` 전 행 UPDATE ③ **상담 API 서버 측 플래그 가드 없음** (A-3, A-4, A-10) |
| 현재 prod 화면 | `/privacy`는 **버전 1.0**, `/account-deletion`은 **"페이지를 찾을 수 없습니다"** (실렌더, A-11) |

### 게이트 정의

| 게이트 | 뜻 | 진입 조건 | 현재 |
|---|---|---|---|
| **A** 코드·문서로 확정 | 저장소와 공개 페이지만으로 판정된 항목 | 없음(이 문서가 근거) | 완료 (A-1~A-12) |
| **B** OPS 읽기 점검 | prod 서버·DB·SSM의 읽기 전용 확인이 필요한 항목 | Production Reads 권한 게이트 해제 + 읽기 전용 범위 확인. 값 열람 금지(유무·true/false·건수만) | **공란.** 해제 전 채우지 않음 |
| **C** prod 복제 DB 리허설 | prod 스냅샷 복제본에서 마이그레이션·호환성 검증 | Brian 승인 + OPS 실행 + 복제본 격리(운영 연결 정보 미포함, 외부 발송 함수 호출 0) | 미실행 |
| **D** Brian 사업 결정 | 기술로 정할 수 없는 선택 | Brian 답변 | 대기 |

착수 순서: **B → C → D → 후보 SHA 잠금 → 배포.** B가 채워져야 C의 합격 기준(행 수, 실효값)을 정할 수 있다.

---

## A. 코드·문서로 확정된 항목

### A-1. 범위와 main 역방향 15커밋

| 항목 | 값 |
|---|---|
| 기준점(merge-base) | `88e6087e` (2026-10-18, PR #6 SDD-211 phase0) |
| develop이 앞선 커밋 | 817개 (머지 PR #7~#116, 103건) |
| 변경 파일 | 4,961개 (대부분 `specs/`·`designs/`). 코드: `backend/app` 180(신규 90), `frontend/src` 503(신규 269), Android 58, iOS 53 |

기능 묶음:

| 묶음 | SDD | 내용 |
|---|---|---|
| 클래스 구조 재설계 | 211·213~219 | 클래스·세션 상위 구조, 편성·강사, 멤버십·출석·보강, 리포트 관리. 마이그레이션 `0052`~`0058` |
| 스토어 심사·개인정보 | 220·238·241 | 계정 삭제(30일)·소셜 연결, 채팅 신고·차단, 처리방침 v2.2, 뇌파 원본 90일 보관, 연구용 비식별 사본 |
| 실시간·네이티브 | 222·224·246 | 앱 백그라운드 BLE, 실시간 지연 수정, live-v2. 마이그레이션 `e246a0301001` |
| 홈·클래스 진행 UX | 221·223·225~237·240·242 | 즉시 클래스, 코드 입장, 대기실, 상담사 홈, 손들기·스와이프, 설정 탭 |
| 데이터 센터·원데이터 | 243·244 | 관리자 데이터 센터, 3신호 원데이터. 마이그레이션 `0243*`·`0244*` |
| UI 통일 | 234·245 | 디자인 토큰·공용 컴포넌트 |
| 인프라·CI | 210·212·229 | stt/report 워커 분리, 신규 주기 작업 4개 |
| AI 대화 | 202·203 | 루시 멀티턴 (prod 노출은 비공개 유지, A-8) |

**main에만 있는 15커밋: 재반영 0건.** main의 트리가 기준점 트리와 **동일**하다(고유 파일 변경 0). `git merge-tree`로 develop→main 병합을 시뮬레이션하면 충돌 0이고 결과 트리가 develop 트리와 같다.

| 커밋 | 내용 | 처리 | 근거 |
|---|---|---|---|
| `addcb7e0` `c8d4d8bb` `90e4b3ed` `89db5635` `494c682a` `3f6ed588` `dbf19cfa` `50949b2f` `511b187d` `ad104aeb` `a7dfaf28` (11개, 10/12~10/18) | develop→main 머지 커밋들 | **동등 반영** | 각 제2부모(`88e6087e`, `7d924816`, `2f844c8b`, `055a7d0a`, `5bf7eac6`, `13fc1e0d`, `0dd1793e`, `73bc766e`, `5a39145a`, `a1bb36ee`, `f535597c`)가 모두 develop 조상 |
| `aaaa7f29` `fd51133e` `c671e517` `048b82bb` (4개, 6/5 Sprint 2~4) | 초기 스프린트 커밋 | **버림** | develop 이력에 해시 없음. main이 10/12 머지(`a7dfaf28`, "충돌은 develop 기준")에서 이미 정리해 트리 동일. 4개 각각의 줄 단위 대조는 하지 않았고 트리 동일성으로 갈음 |

병합 방식: develop→main 머지 커밋(기존 방식).

### A-2. 마이그레이션 18건 — 대상 테이블·작업·잠금·가역성

`deploy/ci/check_migrations.py --base-sha addcb7e0`(정적, DB 접속 없음) 결과: head 1개(`e246a0301001`), 검사 18건, **destructive=true, 경고 14건.** 경고 분류(소스 대조 판단): `0052` 8건 + `0057` 2건은 **실제 UPDATE**, `0057` 3건 + `244003` 1건은 `BEFORE UPDATE OR DELETE` 트리거 정의 문자열로 정규식에 걸린 **오탐으로 보인다.**

"예상 잠금"은 코드 읽기로 추정한 값이며 실제 소요는 행 수(B-3)와 복제본 리허설(C-3)로 확정한다. `lock_timeout` 5초는 **잠금 획득 대기**만 제한하고, 잠금을 얻은 뒤의 문장 실행 시간은 제한하지 않는다.

| # | revision | 대상 테이블 | 작업 | 예상 잠금 | 가역성(downgrade) |
|---|---|---|---|---|---|
| 1 | `e036a0000052` | `chat_messages`(조건부 타입 변경), `users`, `careers`, `qualifications` | NULL 채움 UPDATE → `SET NOT NULL`, ARRAY→JSONB(조건부) | **높음.** ACCESS EXCLUSIVE + 전체 스캔(NOT NULL 검증), 타입 변경 시 테이블 재작성. `lock_timeout` 5s | **없음** (`downgrade: pass`, 파일 주석: 코드 revert + 스키마 유지) |
| 2 | `…0053` | 신규 `classes`·`class_instructors`·`class_members`·`class_member_events` | 테이블 4 + 인덱스 9 | 낮음(신규) | 있음 |
| 3 | `…0054` | 신규 상담 테이블 5개(`counseling_*`, `guest_claim_events`) | 테이블 5 + 인덱스 12 | 낮음 | 있음 |
| 4 | `…0055` | 신규 `session_host_history`; **기존** `reports`·`session_participants`·`sessions`에 컬럼 14 | 컬럼 추가 + 제약 + 인덱스 5 | 중간(기존 테이블 ALTER, 짧은 ACCESS EXCLUSIVE) | 있음(43줄) |
| 5 | `…0056` | 신규 5개; 기존 `classes`·`sessions` 컬럼 6 | 가산 | 낮음 | 있음 |
| 6 | `…0057` | 신규 9개; 기존 `class_members`·`research_consents`·`session_participants`·`sessions`에 컬럼 15 | 가산 + **`session_participants` 전 행 UPDATE 2건** + 인덱스 23 + 트리거 | **중간~높음.** 전 행 UPDATE(행 잠금, 행 수 비례), 기존 테이블 인덱스 비동시 생성(A-4) | 있음(3줄) |
| 7 | `…0058` | 신규 `class_report_jobs`·`class_report_job_items` | 가산 | 낮음 | 있음 |
| 8 | `…0059` | 신규 5개(삭제 원장·소셜 등); 기존 `users`·`consents`·`session_participants` 컬럼 | `ADD COLUMN IF NOT EXISTS` 10건(`recording_consented boolean NOT NULL DEFAULT false` 포함) | 낮음. NOT NULL+상수 DEFAULT는 PG≥11에서 메타데이터 변경 — **RDS 엔진 버전은 B-8** | 있음(16줄) |
| 9 | `…0060` | 신규 `chat_blocks`·`chat_reports` | 가산 | 낮음 | 있음 |
| 10 | `…0061` | 기존 `sessions`·`users` 컬럼 3 | 가산 | 낮음 | 있음 |
| 11 | `e036a0244001` | 신규 6개; 기존 `eeg_raw_chunks` 컬럼 1 | `uq_eeg_raw_chunk` → 더 넓은 `uq_eeg_raw_chunk_v2`(신규 제약 생성 후 구 제약 삭제) | 중간(제약 교체 시 `eeg_raw_chunks` 인덱스 빌드) | 있음(26줄) |
| 12 | `…244002` | 신규 4개; 기존 `eeg_feature_windows` 컬럼 | 가산 | 낮음 | 있음 |
| 13 | `…244003` | 신규 `object_deletion_outbox`·`research_signal_receipts`; 기존 `research_export_items` 컬럼 | 가산 + 트리거 | 낮음 | 있음 |
| 14 | `e036a0243001` | 신규 2개; 기존 `data_export_jobs` 컬럼 16, **3개 NOT NULL 해제** | 가산 + `alter_column nullable=True`(`:37-39`) | 낮음(메타데이터). **`lock_timeout` 없음** | 있음 |
| 15 | `…243002` | 신규 `data_export_parts`·`data_export_dispatch_outbox` | 가산 | 낮음. **`lock_timeout` 없음** | 있음 |
| 16 | `…243003` | 신규 1개; 기존 `data_export_audits` 컬럼 1 + 컬럼 변경 | 가산 | 낮음. **`lock_timeout` 없음** | 있음 |
| 17 | `e036a0261001` | 기존 `chat_reports` 컬럼 2(`status` 기본 `submitted`, `withdrawn_at`) | `ADD COLUMN IF NOT EXISTS` | 낮음 | 있음 |
| 18 | `e246a0301001` | 신규 `live_session_epoch`·`live_command_ledger`·`live_outbox`·`capture_stream` | 가산 | 낮음 | 있음 |

- 신규 테이블의 FK가 기존 테이블을 참조하면 참조 대상에 짧은 잠금이 걸린다. FK별 대상은 이번에 전수 확인하지 않았다.
- "있음"은 downgrade 본문이 있다는 뜻이며, UPDATE로 바뀐 데이터를 복원한다는 뜻이 아니다.
- 운영 롤백 원칙은 "expand 전용, DB 자동 되돌림 없음"이다(`.github/workflows/rollback-prod.yml` 머리말).

### A-3. `0052` NOT NULL 전환 전 기존 코드(main) 호환성

판정 대상: prod가 지금 돌리는 main 코드가 `0052` 적용 후 스키마(NOT NULL)에서 동작하는가. `git grep`은 `origin/main` 기준이다.

| 컬럼 | main 코드 근거 | 판정 |
|---|---|---|
| `users.auth_provider` | `backend/app/models/user.py:112` 모델이 이미 `nullable=False, default="email", server_default="email"`. `User(` 생성 경로 8곳(`auth.py:356`, `auth.py:882`의 `auth_provider="google"` 등), raw `INSERT INTO users` 0건 | 호환(기본값이 항상 채움) |
| `chat_messages.recipient_count` | `models/chat.py:50` 모델이 `nullable=False, default=0`. 생성 `chat_service.py:1472`, `system_message_service.py:13`이 값을 안 줘도 ORM 기본값 0 적용 | 호환 |
| `chat_messages.read_by` | `models/chat.py:49` 모델이 이미 JSONB, `chat_service.py:175`가 `m.read_by or []`로 읽음 | 호환(DB가 ARRAY로 남은 드리프트만 `0052`가 맞춤) |
| `careers.organization` | `models/career.py:18` `nullable=False`, 입력 검증 `counselor_info_service.py:122`가 빈 값을 거부 | 호환 |
| `careers.is_current` | `career.py:22` `default=False, server_default="false"` | 호환 |
| `careers`·`qualifications`의 `created_at`·`updated_at` | `career.py:23-24`, `qualification.py:21-22` `server_default=func.now()` | 호환 |

- 결론: **main 코드는 `0052`가 NOT NULL로 만드는 모든 컬럼을 이미 NOT NULL 계약으로 쓴다.** 코드 롤백 후에도 새 NOT NULL에 막힐 경로는 코드상 찾지 못했다. raw `INSERT INTO`(users·chat_messages·careers·qualifications)도 `backend/app`·`backend/scripts`에서 0건이다.
- 못 보는 것: 앱 코드 밖의 쓰기(운영 스크립트, 수동 SQL), prod DB가 실제로 가진 NULL 행 수 → B-3, C-5.
- 이 호환성은 `0052` 한정이다. 이후 마이그레이션의 NOT NULL 컬럼은 신규 테이블이거나 기본값이 있는 가산이다.

### A-4. `0057` 전 행 UPDATE — 잠금·배치화·`lock_timeout` 권고

- 원문(`backend/alembic/versions/e036a0000057_sdd217_membership.py:48-49`): `UPDATE session_participants SET report_consent_override = true, research_consent_override = true` — **WHERE 없음.** `:51`의 `UPDATE … SET checkin_state='completed' WHERE EXISTS(session_records …)`도 `session_participants`를 훑는다.
- `:44`: 기존 테이블 대상 `CREATE INDEX ix_session_participants_superseded_by_participant_id ON session_participants(…)`는 **CONCURRENTLY가 아니다.** 빌드 동안 해당 테이블 쓰기가 막힌다.
- 영향: UPDATE 중 `session_participants` 행 잠금이 걸려 클래스 입장·참가 기록이 대기할 수 있다. 행 수는 B-3.
- 권고(판정은 C-3 소요 시간 이후):
  1. 소요가 짧으면 그대로 두고 **진행 중 클래스가 없는 시간**에만 배포한다.
  2. 길면 UPDATE를 id 구간별 배치로 나눠 마이그레이션 밖의 별도 작업으로 옮기는 안이 있다. 새 코드 변경이므로 **Brian 결정(D-5)**이며 이 문서는 구현하지 않는다.
  3. `lock_timeout` 5초는 이미 설정돼 있다(`SET LOCAL`). 문장 실행 시간 제한이 필요하면 배포 세션에 `statement_timeout`을 별도로 거는 방법이 후보다(미구현).
  4. `0243001`·`0243002`·`0243003`에는 `lock_timeout`이 없다. 메타데이터 변경 위주라 위험은 낮지만, 긴 쿼리 뒤에 줄을 서면 다른 쿼리를 막을 수 있어 배포 시간대 선택(D-3)에 반영한다.

### A-5. `0057` 연구 동의 백필 — 동의 위험 판독

**쟁점:** `0057:48-49`가 기존 참여자 전부에 `research_consent_override = true`를 쓴다. 이것이 "연구 동의함"으로 취급되는가.

**마이그레이션 주석(`:45-47`):** "056 이전에는 회차별 선택과 기본값 사본을 구별하는 표시가 없었다. … 원값을 보수적으로 보존한다 … 가입 연구 동의/원선택 ID를 추정하지 않는다." → 의도는 동의 부여가 아니라 **회차 행의 원래 값을 보존**하는 것이다.

**코드로 확인한 결과:** `research_consent_override`를 읽는 곳은 아래뿐이며 **어느 곳도 동의로 취급하지 않는다.**

| 위치 | 하는 일 | override=true의 효과 |
|---|---|---|
| `models/session.py:231` | 컬럼 정의 `default False, server_default "false"` | — |
| `class_member_consent_service.py:78` | `if research_choice and not participant.research_consent_override: copy_class_choice(...)` | **멤버십 기본값을 회차 행에 덮어쓰지 않음**(보존) |
| `class_member_consent_service.py:145-146` | 멤버십 기본값 변경 시 `research_change = research_changed and not p.research_consent_override` | 위와 같음(덮어쓰기 차단) |
| `research_consent_service.py:183` | 회원이 회차 연구 동의를 **직접 선택**하면 `p.research_consent_override = True` 설정 | 직접 선택 이력의 표시 |
| `class_report_job_service.py:134` | **report** override(연구 아님) — 리포트 철회 판정 | 해당 없음 |

**실효 연구 동의 판정식(predicate).** 연구 이용·내보내기·보관 유예·데이터 센터 반출은 모두 `research_consents` 테이블의 행으로만 판정하며, override 컬럼을 참조하지 않는다. `git grep research_consent_override`가 위 표 밖의 파일(`research_export_service.py`, `retention_sweep_service.py`, `data_center_export.py`, `data_center_governance.py`)에서 0건이다.

| 용도 | 판정식 | 위치 |
|---|---|---|
| 내보내기 대기 표시(not_applicable→pending) | `SessionParticipant.user_id IS NOT NULL` ∧ `consented IS TRUE` ∧ `withdrawn_at IS NULL` ∧ `export_state='not_applicable'` ∧ `research_subject_id IS NOT NULL` | `research_export_service.py:138-145` |
| 내보내기 대상 선정 | 위와 같고 `export_state = pending` | `research_export_service.py:417-424` |
| 90일 보관 유예 대상 | `consented IS TRUE` ∧ `withdrawn_at IS NULL` ∧ `export_state NOT IN (_NO_GATE_STATES)` | `retention_sweep_service.py:94-98` |
| 데이터 센터 연구 목적 반출 검증 | `consented IS TRUE` ∧ `withdrawn_at IS NULL`인 `participant_id`에 모든 대상이 속할 것 | `data_center_export.py:377-382` |
| 데이터 센터 보관 현황 | `consented IS TRUE` ∧ `withdrawn_at IS NULL` ∧ `export_state NOT IN NO_GATE_STATES` | `data_center_governance.py:209-211` |

- **판독 확정:** `override=true`가 동의로 취급되는 경로는 **없다.** 동의의 원천은 `research_consents.consented`와 `withdrawn_at` 두 컬럼이다.
- **간접 영향:** 새 동의 행은 `copy_class_choice`(`research_consent_service.py:362`)가 `member.research_consented`를 읽어 만든다. 이 함수는 위 `:78`이 `override=false`일 때만 호출되므로, 백필된 기존 행에는 **멤버십 기본값으로 새 동의 행이 생기지 않는다.** 즉 override=true는 동의를 늘리는 쪽이 아니라 **자동 복사를 막는 쪽**이다. 또한 `copy_class_choice`는 `participant.user_id is None`이면 즉시 반환해 비회원은 동의를 받지 못한다.
- **`0057`이 `research_consents`에 하는 일:** `ADD COLUMN origin_id uuid`(`:50`)뿐이며 `consented`·`withdrawn_at`을 바꾸지 않는다.
- **계획 합격 기준(C-6):** 복제본에서 마이그레이션 전후로 실효 연구 동의 대상 집합이 같아야 한다.
  1. 위 판정식(내보내기 대기 표시와 같은 조건)을 만족하는 `participant_id` 집합을 정렬해 **건수와 해시**를 기록한다.
  2. `0057` 전후 두 값이 **동일**해야 한다.
  3. "근거 없는 연구 이용·내보내기 대상" = 대상 집합 중 `research_consents` 행이 없거나 `consented IS NOT TRUE`이거나 `withdrawn_at IS NOT NULL`인 참여자 = **0건**이어야 한다.
- 운영 DB를 고치지 않고, 새 확장 카드를 만들지 않는다. 위는 리허설 계획이다.

### A-6. 신규 주기 작업 4개와 retention_sweep의 코드상 동작

`deploy/jobs.tsv`: main 17개 → develop 21개. 신규 4개(`report_backlog_probe`, `class_operations`, `class_rolling`, `account_deletion_sweep`)와 `retention_sweep`(0→1 활성).

| 작업 | 주기 | 플래그 off일 때 코드상 동작 | 근거 |
|---|---|---|---|
| `retention_sweep` | 매일 03:00 UTC | **삭제 없이 보고만.** `enabled = bool(settings.retention_sweep_enabled)`, `execute = enabled and dry_run is not True`, 비활성이면 `blocked_reason="sweep_disabled"` | `retention_sweep_service.py:310`, `:313`, `:319-320`; 설정 `config.py:202`(기본 False) |
| `report_backlog_probe` | 매분 | **읽기+로그 출력.** 적체 지표를 `print`하고, CloudWatch 게시는 `pipeline_metrics_cloudwatch_enabled`일 때만. off면 외부 호출 없음 | `report_backlog_probe_cron.py:39-44`; `config.py:107` |
| `class_operations` | 매분 | **즉시 종료.** `class_scheduling_enabled`가 false면 `return 0` | `class_operations_cron.py:23-25`; `class_operations_service.py:18`; `config.py:46` |
| `class_rolling` | 매시 | **즉시 종료.** `roll_classes`가 편성 또는 롤링 스위치 off면 `{"processed":0,"failed":0}` 반환. 켜져도 KST 02시에만 보충 | `class_operations_service.py:71-76`; `config.py:46-47` |
| `account_deletion_sweep` | 10분마다 | 소셜 해제·알림은 **동작**, 30일 영구 삭제는 **보고만** → A-7 | `account_deletion_sweep_cron.py:21-24` |

### A-7. 계정 삭제 sweep — 문구 분리

`account_deletion_sweep_enabled`(기본 false, `config.py:69`)가 막는 것과 막지 않는 것을 분리한다.

| 동작 | sweep=false에서 | 근거 |
|---|---|---|
| 30일 경과 사용자 **영구 삭제** | **하지 않음.** 후보만 보고(DB 쓰기·외부 호출 0) | `account_deletion_sweep_cron.py:21` `execute = bool(settings.account_deletion_sweep_enabled) and not dry_run`; `account_deletion_sweep_service.py:468-476` 독스트링 "execute=False면 보고만" |
| **소셜 연결 해제 재시도**(Apple revoke / Google 해제) | **동작한다(외부 호출).** `process_outbox`가 스위프 활성 여부와 무관 | `account_deletion_task.py:14-24` 독스트링; `account_deletion_sweep_cron.py:24` `process_outbox=not dry_run`; `account_deletion_service.py:242` `process_revoke_outbox` |
| **삭제 요청 접수 알림 메일**(`signup_notice_email`로 발송) | **동작한다(외부 발송).** 접수 건이 있을 때만 | `account_deletion_service.py:322-328` `deliver_pending_request_notices`, `_send_email(settings.signup_notice_email, …)` |

- 즉 prod 타이머(`jobs.tsv`는 `--dry-run` 미지정)는 sweep=false여도 **10분마다 소셜 해제 재시도와 접수 알림 발송을 시도**한다. 대기 건이 없으면 발송은 일어나지 않는다. 대기 건 수는 B-3로 확인한다.
- **시드 시험·복제본 리허설은 외부 발송 0건이어야 한다.** 방법: `account_deletion_sweep_cron.py`를 `--dry-run`으로 실행한다. `:20`, `:24`에서 `process_outbox=False`가 되어 `process_revoke_outbox`와 `deliver_pending_request_notices` 호출 자체가 일어나지 않는다. 서비스 함수를 직접 부를 때는 `sender`(`account_deletion_service.py:322` 인자)와 `google_revoker`(`:242` 인자)에 가짜를 주입한다.
- **운영 알림 정책은 기존 설정을 유지**한다. 수신처를 바꿀지는 사용자 결정(D-6)이다.

### A-8. 플래그 기본값 표 (코드 근거)

prod 실효값은 B-4에서 확인한다. 아래는 **코드 기본값과 manifest**다.

| 플래그 | 코드 기본값 | prod manifest(`deploy/env-manifest.tsv`) | 판정 근거 | 전환 시 의도 |
|---|---|---|---|---|
| `LIVE_PROTOCOL_V2` (서버) | False (`config.py:93`; `session_live_v2.py:32-37`은 환경변수 우선) | 없음 | `session.py:103-105`, `:1074-1076` off면 404 | **off 유지** |
| `VITE_LIVE_PROTOCOL_V2` (프론트) | 미정의=off (`feature-flags.ts:28-30` `=== 'true'`일 때만) | `release-build.yml`에 없음. dev는 `deploy-dev.yml:45`가 true 주입 | — | **off 유지** |
| `VITE_COUNSELING_ENABLED` | 미정의=비공개 (`feature-flags.ts:3-5`) | release-build에 없음 | 프론트만 숨김. **서버 가드 없음 → A-10** | 비공개 유지(화면) |
| `VITE_AI_ENABLED` / `AI_FEATURES_ENABLED` / `STT_ENABLED` | 비공개(`feature-flags.ts:9-13`) / False(`config.py:52`) / False(`config.py:57`) | 없음 | — | **비공개 유지** |
| `DATA_CENTER_ENABLED` | False(`config.py:137`). `ENVIRONMENT=development`일 때만 자동 True(`config.py:41-42`) | 없음 | prod는 `ENVIRONMENT=production` | off |
| `DATA_CENTER_EXPORT_REAUTH_REQUIRED` | False(`config.py:149`) | 없음 | — | 기본 유지 |
| `RETENTION_SWEEP_ENABLED` | False(`config.py:202`) | static false | A-6: 타이머는 켜지고 보고만 | off |
| `ACCOUNT_DELETION_SWEEP_ENABLED` | False(`config.py:69`) | static false | A-7: 해제·알림은 동작 | off |
| `RESEARCH_EXPORT_ENABLED` | False(`config.py:124`) | static false | — | off |
| `PIPELINE_QUEUE_SPLIT_ENABLED` | False(`config.py:97`) | static **true** | 코드 기본과 prod가 **다름** | on (롤백: false) |
| `PIPELINE_METRICS_CLOUDWATCH_ENABLED` | False(`config.py:107`) | static false | A-6 | off |
| `CLASS_SCHEDULING_ENABLED` | False(`config.py:46`) | ssm 선택, 미설정 | `classes.py:77` 404, `session_service.py:511,776`, `class_read_service.py:328-329` | **D-1** |
| `CLASS_ROLLING_ENABLED` | False(`config.py:47`) | ssm 선택 | `class_operations_service.py:71` | D-1 |
| `CLASS_TEAM_READ_ENABLED` | False(`config.py:48`) | ssm 선택 | — | D-1 |
| `ENABLE_DEV_ROLE_SIMULATION` | False(`config.py:198`) | static false | — | off |

### A-9. 10/18 Deploy Prod 실패 원인과 재발 방지

`specs/sdd-210-prod-environment/rehearsal-result.md`와 각 run 로그를 대조했다.

| run | 대상 SHA | 결과 | 원인 | 조치 |
|---|---|---|---|---|
| 39077484296 | `dbf19cfa` | 실패 | SSM `RunShellScript` 기본 셸이 dash → `set -o pipefail` 오류(`Illegal option -o`) | `ssm-install-cmd.sh`가 bash로 재실행(`13fc1e0d`) |
| 39079034212 | `3f6ed588` | 실패 | 빈 DB에 체인 85개를 적용할 때 드리프트 마이그레이션 `30c1bfbc724f`가 `chat_room_participants`를 중복 생성(`DuplicateTable`) | `IF NOT EXISTS` 보호(`494c682a`). 롤백 트랩 정상, 서버 변경 0 |
| 39082258294 | `494c682a` | 실패 | **의도된 실패 주입**: `alembic_version`을 없는 `deadbeef0000`으로 바꿔 재배포 → `Can't locate revision`, exit 20, 코드·서비스 변경 없음(T-16 롤백 리허설) | 결함 아님 |
| 39098860208 | develop `7d924816` | **성공**(10/18 04:57Z) | — | prod 마지막 성공 배포 |

재발 방지:
1. 10/18 실패 두 건은 모두 "이전에 적용해 본 적 없는 DB 상태"에서 났다. 이번 18건은 **prod 복제본에 먼저 적용**한다(C).
2. `confirm_destructive=true`를 명시하고 사유에 A-2의 경고 분류를 적는다.
3. 관찰 시간을 기본 5분보다 길게(10분 권고) 잡는다. 스모크·관찰 실패 시 워크플로가 직전 릴리스로 자동 롤백한다(`deploy-prod.yml`의 "관찰(연속 실패 3회)" 이후 "롤백" 단계).
4. 마이그레이션 실패 시 서버가 전환하지 않고 종료하는 트랩(exit 20)이 10/18에 실증됐다.
5. CI `backend-pg-smoke`는 체인을 PG에 적용하지만 **prod 데이터 규모·제약 충돌은 보지 못한다.**

### A-10. 위험: 상담 API 서버 측 플래그 가드 없음

- `backend/app/api/v1/counseling.py`는 GET 2개(`:14` 목록, `:26` 상세)이며 의존성은 `get_current_user`뿐이다(`:19`, `:29`). 기능 플래그 검사가 없다.
- 라우터는 항상 등록된다(`backend/app/api/v1/__init__.py:9`, `:38`).
- `VITE_COUNSELING_ENABLED`는 프론트 숨김만 한다(`frontend/src/lib/feature-flags.ts:3-5`). 따라서 **"상담 비공개 유지"는 화면에서만 지켜지고, 로그인 계정이 API를 직접 호출하면 막히지 않는다.**
- 이 두 엔드포인트 내부의 소유 범위 필터(본인 관계만 반환하는지)는 이번에 읽지 않았다 → 미확인.
- 대응: **서버 측 플래그 가드 추가 FIX 카드(Brian 결정, D-4).** 이 문서는 코드를 바꾸지 않는다.
- 참고: 상담 테이블은 `0054`에서 생성되므로 prod에는 현재 해당 테이블이 없다. 전환 직후에는 노출될 상담 데이터가 없을 가능성이 크다. 다만 prod에서 상담 관계가 생성되는 경로가 막혀 있는지는 확인하지 않았다.

### A-11. 공개 페이지 실렌더 결과 (재시도 성공)

방법: 설치된 Chrome을 `--headless=new --user-data-dir=<새 임시 폴더> --virtual-time-budget=9000 --dump-dom`으로 실행해 DOM 텍스트를 읽었다. **기존 프로필·로그인은 쓰지 않았고** 공개 페이지만 열었다. Playwright `chromium.launch`는 이 환경에 설치돼 있지 않아 같은 Chrome 바이너리를 CLI로 실행했다.

| 페이지 | prod | dev |
|---|---|---|
| `/privacy` | h1 "개인정보 처리방침", **버전 1.0, 시행일 2026년 10월 22일**(본문 3,454자) | h1 "개인정보 처리방침", **버전 2.2, 시행일 2026년 10월 24일**(본문 6,626자) |
| `/account-deletion` | h1 **"페이지를 찾을 수 없습니다"**(88자, 존재하지 않는 경로와 동일) | h1 **"MIND BREEZE 계정 삭제 요청"**(437자) |
| 없는 경로(대조) | h1 "페이지를 찾을 수 없습니다"(88자) | 동일 |

- 지난 HTTP 200 판정(SPA 폴백)을 **정정**한다: prod `/account-deletion`은 화면상 404이고 prod 처리방침은 아직 1.0이다.
- 전환 후 합격 기준은 prod가 dev와 같은 h1/버전/시행일을 보이는 것이다(A-12 V-1, V-2).

### A-12. 배포 순서·검증·롤백 기준

**순서** (사전 게이트 B·C·D 통과 후):

| 단계 | 내용 | 승인 |
|---|---|---|
| 1 | 후보 SHA 잠금(D-2) | Brian |
| 2 | develop→main 머지 PR (충돌 0) | Brian |
| 3 | `release-build`로 산출물 생성. MANIFEST의 `git_sha`·`migration_heads`·`destructive_migrations` 확인 | — |
| 4 | **수동 RDS 스냅샷** 생성 | OPS |
| 5 | `deploy-prod` 실행: `confirm_destructive=true`, `observe_minutes`≥10. `environment: production` 승인 게이트에서 Brian 승인 | Brian |
| 6 | 서버 설치(마이그레이션 → 원자 전환 → 헬스) → 공개 스모크 → 관찰 → 성공 확정 | 자동 |
| 7 | 아래 검증 | — |
| 8 | 플래그 조정(CLASS_* 등)은 **별도 변경**으로 검증 후 하나씩 | Brian |

**검증(화면 실렌더 기준, HTTP 200은 근거 아님):**

| # | 검증 | 합격 기준 |
|---|---|---|
| V-1 | 비로그인 `/privacy` 렌더 | h1 "개인정보 처리방침", "시행일 2026년 10월 24일 · 버전 2.2" |
| V-2 | 비로그인 `/account-deletion` 렌더 | h1 "MIND BREEZE 계정 삭제 요청" (현재 prod는 404 화면) |
| V-3 | `/health`, `/health/ready` | 200, database·redis ok |
| V-4 | 서비스·타이머 | 워커 5종 active, 타이머가 `jobs.tsv` 21개와 일치 |
| V-5 | 마이그레이션 | 배포 로그 `Running upgrade … → e246a0301001`, 오류 없음. prod `alembic current` 읽기 확인(OPS) |
| V-6 | 로그인·클래스 입장 | 회원·상담사 계정으로 입장·채팅 송신 |
| V-7 | live-v2 off | **로그인 계정**으로 `GET /api/v1/sessions/{id}/live-v2/snapshot`이 404 (비로그인은 인증이 먼저라 401일 수 있음) |
| V-8 | 상담·AI 비공개(화면) | 로그인 후 진입점 없음. API 비공개는 A-10에 따라 별도 |
| V-9 | 데이터 센터 비노출 | 메뉴 없음, `/api/v1/data-center/summary`가 비활성 응답 |
| V-10 | 보관 정리 보고 | `/var/log/mindbreeze-retention-sweep.log` 첫 실행 `mode=dry_run`, 삭제 0건 |

**롤백 기준:**

| 상황 | 조치 |
|---|---|
| 마이그레이션 실패 | 서버가 전환하지 않고 종료(exit 20). 원인 수정 후 재시도 |
| 스모크·관찰 실패(연속 3회) | 워크플로가 직전 릴리스로 **자동 롤백** |
| 배포 후 앱 결함 | `Rollback Prod`(Brian 승인). DB는 되돌리지 않으므로 A-3 호환성이 C-5에서 통과한 경우에만 코드 롤백 |
| 데이터 손상 | RDS PITR로 임시 인스턴스 복원 후 판단(RTO≈10분, RPO≈2분 — 10/18 실측). 자동 롤백 금지, Brian 별도 승인 |

---

## B. OPS 읽기 점검 필요 (Production Reads 권한 게이트 해제 전 **공란**)

진입 조건: Production Reads 권한 게이트 해제, 읽기 전용 범위 확인. 값 열람 금지(유무·true/false·건수·접두사·길이만). 결과는 OPS 워커가 채운다.

| # | 항목 | 확인 방법(읽기만) | 결과 |
|---|---|---|---|
| B-1 | prod 실제 실행 릴리스·git SHA | `/opt/mindbreeze/current` 링크, MANIFEST `git_sha`. 참고: 마지막 성공 run의 ref는 develop `7d924816` | |
| B-2 | prod `alembic current` | 읽기 전용 조회. 기대 `e036a0000051` | |
| B-3 | 행 수: `session_participants`, `chat_messages`, `users`, `careers`, `qualifications`, `data_export_jobs` + `account_deletion_requests`·`social_revoke_outbox` 대기 건수 | 건수만(개인정보 열람 금지). `0052`가 고칠 NULL 행 수도 건수만 | |
| B-4 | 서버 실효값 유무·true/false: `RETENTION_SWEEP_ENABLED`, `ACCOUNT_DELETION_SWEEP_ENABLED`, `RESEARCH_EXPORT_ENABLED`, `LIVE_PROTOCOL_V2`, `DATA_CENTER_ENABLED`, `ENVIRONMENT` | 값 원문 출력 없이 유무·불리언만 | |
| B-5 | `CLASS_SCHEDULING_ENABLED`·`CLASS_ROLLING_ENABLED`·`CLASS_TEAM_READ_ENABLED` 현재값 | SSM 파라미터 유무 | |
| B-6 | `signup_notice_email` 설정 유무와 도메인 (삭제 요청 접수 알림 수신처, A-7) | 유무·도메인만 | |
| B-7 | 지원 문의·신고 접수 경로와 수신자(운영 설정) | 설정 유무 | |
| B-8 | RDS: 엔진 버전, 자동백업 최신 시각·보존일, 삭제방지, 스토리지 여유 | RDS 읽기 (PG≥11이면 `0059`의 NOT NULL 상수 DEFAULT가 메타데이터 변경) | |
| B-9 | 설치된 systemd 타이머 목록 ↔ main `jobs.tsv` 17개 | `systemctl list-timers` | |
| B-10 | `FCM_PROJECT_ID`·`FCM_SERVICE_ACCOUNT_JSON` 설정 유무(푸시) | 유무만 | |
| B-11 | 현재 prod 프론트 번들의 상담·AI 노출 효과 | 공개 번들 대조 + 비로그인 화면(로그인 후 화면은 합성 계정 확보 후) | |
| B-12 | 앱(Android·iOS) × prod live-v2 off 호환 — **O13, APP 창구 검증** | 최종 prod 호환 SHA와 합성 계정 확보 후 실제 서명 산출물·화면으로 확인 | **미확인** |

## C. prod 복제 DB 리허설 필요 (OPS 실행, Brian 승인)

진입 조건: Brian 승인, B-1·B-2·B-3 완료(행 수가 있어야 소요 시간을 해석), 복제본을 prod와 분리(운영 연결 정보·SSM 값 미포함), **외부 발송 함수 호출 0건**, 리허설 후 복제본 삭제는 별도 승인.

| # | 단계 | 합격 기준 |
|---|---|---|
| C-1 | 자동백업 시각·보존·삭제방지 확인, 수동 스냅샷 생성 | 스냅샷 `available`. RTO≈9~10분(10/18 실측) |
| C-2 | 스냅샷에서 **임시 인스턴스 복원** | `alembic_version = e036a0000051`, `pg_is_in_recovery=False` |
| C-3 | 복제본에서 `alembic upgrade head` — 마이그레이션별 소요와 잠금 대기 기록 | 오류 없음. 전체 10분 이내, 5초 `lock_timeout` 실패 0건. 초과 시 본 배포를 보류하고 A-4 권고를 재검토 |
| C-4 | 전후 행 수 비교(`session_participants`, `chat_messages`, `users`, `careers`, `qualifications`) | 삭제 0, 행 수 동일(UPDATE는 값만 변경) |
| C-5 | **이전 릴리스(main `addcb7e0`) 코드**를 복제본(`0052` 적용 후)에 붙여 로그인·채팅 송신·상담사 경력/자격 저장·사용자 생성 스모크 | NOT NULL 위반 0건 (A-3 보강: 앱 코드 밖의 쓰기 경로 확인) |
| C-6 | **연구 동의 불변**(A-5): `0057` 전후 실효 연구 동의 `participant_id` 집합의 건수·해시 비교, 근거 없는 대상 수 | 건수·해시 **동일**, 근거 없는 연구 이용·내보내기 대상 **0건** |
| C-7 | 새 코드(후보 SHA)로 같은 스모크 + live-v2 off 확인 + 상담 API 직접 호출 결과 기록(A-10) | 입장·채팅 정상, live-v2 404 |
| C-8 | 외부 발송 0건 확인: `account_deletion_sweep_cron.py --dry-run`, `retention_sweep_cron.py --dry-run`만 실행 | 메일·Apple/Google 호출 0건. `mode=dry_run`, 삭제 0건 |

## D. Brian 사업 결정

진입 조건: Brian 답변. 답이 없어도 A·B·C는 진행할 수 있으나 **배포 착수는 D-1~D-4가 정해져야 한다.**

| # | 결정 | 선택지·메모 |
|---|---|---|
| D-1 | `CLASS_SCHEDULING`·`CLASS_ROLLING`·`CLASS_TEAM_READ`의 prod 개방 범위 | 미설정이면 전부 false → 예약 클래스 편성(SDD-216·231 흐름)이 prod에서 동작하지 않음(`classes.py:77` 404). 명상 클래스 중심 방침(상담·AI 비공개)과 맞춰 정한다 |
| D-2 | 후보 SHA 포함 범위 | 스토어 FIX 카드 2건, 열린 PR #115(연결 불안정 배너), #116 실측 이후 여부 |
| D-3 | 배포 시간대 | `0057` 전 행 UPDATE·`0052` NOT NULL이 진행 중 클래스를 막을 수 있어 **진행 중 클래스가 없는 시간**으로 정한다 |
| D-4 | 상담 API 서버 측 플래그 가드 추가 FIX 카드 | A-10. 하지 않으면 상담 비공개는 화면에서만 지켜짐 |
| D-5 | `0052`/`0057` 대형 테이블 대비 배치화·무잠금 변경 | C-3 결과가 기준 초과일 때만 필요. 새 코드 변경이므로 Brian 결정 |
| D-6 | 계정 삭제 접수 알림의 운영 정책 | 기존 설정(`signup_notice_email`) 유지가 기본. 수신처·발송 정책 변경은 사용자 결정 |
| D-7 | 확인 요청: 처리방침 v2.2 법무 승인, 연구 가명 키(`RESEARCH_ID_KEY_V1`) 오프라인 백업 | 10/18 컷오버 차단 요소 #2·#3(`rehearsal-result.md` §7)과 동일 |
| D-8 | **스토어 심사 제출과 공개 출시의 경계** | 아래 D-8 상세 |

### D-8. 스토어 심사 제출과 공개 출시의 경계

운영 서버 컷오버와 스토어 제출·출시는 **서로 다른 승인 게이트**다. 한쪽 승인이 다른 쪽을 대신하지 않는다.

| 게이트 | 대상 | 현재 범위 |
|---|---|---|
| 서버 컷오버 | prod 서버·DB·마이그레이션(이 문서의 A~D) | 승인안 단계. 실행 전 |
| 스토어 테스트 트랙 | Android 내부/비공개 테스트, iOS TestFlight | **여기까지가 지금 범위** |
| 스토어 심사 제출 | Play 프로덕션 트랙 검토 전송, App Store 심사 제출 | **금지.** 별도 Brian 승인 필요 |
| 공개 출시 | 사용자에게 공개 | **금지.** 별도 Brian 승인 필요 |

플랫폼별 사실:

- **Android (Google Play):** 최초 게시에는 관리형 게시(Managed Publishing)를 쓸 수 없다([Play Console 도움말](https://support.google.com/googleplay/android-developer/answer/9859654)). 현재 콘솔 값도 OFF다. 따라서 **"관리형 게시를 켜면 심사만 받고 출시는 따로 할 수 있다"고 가정하지 않는다.** 최초 프로덕션 트랙 검토 전송은 승인되면 자동 공개로 이어질 수 있다. 이 절차가 콘솔의 실제 문구에서 어떻게 보이는지는 **APP이 검증할 항목**이며, 이 문서는 확인하지 않았다(미확인).
- **iOS (App Store):** 수동 출시가 설정·저장돼 있다(APP 검증 PASS). 심사를 통과해도 출시 버튼은 별도다.
- 결정 사항: Android 프로덕션 트랙 전송 시점을 서버 컷오버 완료 이후로 고정할지, 그리고 전송 전 Brian 승인을 필수 단계로 둘지 정한다. 자동 공개 가능성이 있으므로 **서버 컷오버가 끝나고 B-12(앱 × prod 호환)가 통과하기 전에는 프로덕션 트랙 전송을 하지 않는다**를 기본 권고로 둔다.

참고 사실(Android 요건):

- target SDK 36은 2026 요건을 충족한다.
- **16KB 페이지 정렬은 충족하지 못한다.** SDD-246 소유자 3f0465c1이 별도 PR로 수정할 예정이다. 이 수정 전에는 Android 프로덕션 제출 조건이 미충족이다.

## E. 선택 항목 (의무 게이트 아님)

- **사용자 공지·점검창:** 출시 전 단독 개발 단계라 불필요하다(프로젝트 규칙). 의무 게이트에서 제외하고 선택 항목으로 둔다. 실사용자가 생기는 시점에 다시 판단한다.

## F. 이 문서에서 확인하지 못한 것

- B 전체(prod 서버·DB·SSM 값).
- 마이그레이션 18건의 prod 적용 결과, 소요, 잠금 대기(C).
- 앱 코드 밖의 쓰기 경로가 NOT NULL을 위반하는지(C-5).
- `counseling.py` 두 엔드포인트의 소유 범위 필터, prod에서 상담 관계가 생성되는 경로.
- 신규 테이블 FK별 참조 대상(잠금 영향).
- #116 실시간 프로토콜·네이티브 백그라운드 측정의 실동작(Brian 실측 전), 앱 × prod 호환(B-12).
- 6월 4커밋 각각의 줄 단위 대조(트리 동일성으로 갈음).
