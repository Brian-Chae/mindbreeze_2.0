# dev 보관 정리 활성화 결과

- Brian 2026-10-24 승인: 릴리즈 전 dev 실제 삭제 활성, 기존 자료 소급 적용, 표준 데이터 보존. 연구 영구 보존은 A안(비식별 사본만), 연구 미ack EEG 보류 유지.
- 현행 빈 `RETENTION_APPLY_FROM`은 실행을 차단하므로 단순 --dry-run 제거만으로는 활성화되지 않는다. dev 크론에 `RETENTION_SWEEP_ENABLED=true`와 `--retroactive`를 명시했다. **빈 하한 + 명시적 소급 옵션**일 때만 전체 과거 종료·취소 세션에 기간 규칙을 적용한다. 옵션 없는 운영 호출의 하한 미설정 차단·잘못된 날짜 차단·비활성·명시 dry-run은 유지한다.
- `RETENTION_APPLY_FROM`은 설정하지 않았다. jobs.tsv·install-release·config(False 포함)·다른 크론·서버 .env.dev 변경 없음. 실제 스케줄러 반영은 배포 이후다.

## 표준 데이터 보호 판정

**삭제 경로에 걸리지 않는다. 제외 필터 추가 불필요.**

- `normalization_baselines`는 closed/open JSON을 직접 저장한다. user_id도 FK 없는 문자열이며 session/participant/raw chunk/S3 참조가 없다(`backend/app/models/normalization_baseline.py:23`, `backend/alembic/versions/e036a0000001_sdd_036_normalization_baselines.py:18`). API도 요청 측정값을 복사할 뿐 raw 참조를 저장하지 않는다(`backend/app/api/v1/normalization.py:168`). 따라서 세션의 청크를 지워도 기준 측정값 재사용에 영향 없다.
- `normalization_models`는 params JSON·버전·표본 수만 저장하고 FK/relationship이 없다(`backend/app/models/normalization_model.py:23`, `backend/alembic/versions/e036a0000002_sdd_036_normalization_models.py:18`). 분포 계산은 baseline.closed/open만 사용한다(`backend/app/services/normalization_distribution.py:24`).
- `normalization_constants.json`은 서비스 디렉터리 고정 경로에서 읽는 상수다(`backend/app/services/eeg_metrics.py:33`, `:73`). 삭제는 DB에 저장된 미디어 참조만 사용하며 이 파일을 참조하지 않는다.
- sweep은 sessions·참여자 행을 삭제하지 않는다. 청크 FK의 CASCADE는 부모 삭제→자식 방향이며 청크 삭제가 부모로 전파되지 않는다(`backend/app/models/record.py:56`, `:77`, `:143`). 표준 두 테이블에는 FK 자체가 없어서 연결 cascade도 없다.
- 회귀: 1,000일 전 종료 세션과 활성 baseline/model을 넣고 execute 후 raw 4개 삭제, baseline/model의 모든 컬럼·행 수·상수 파일 바이트·세션 보존을 확인한다(`backend/tests/test_sdd209_b12_retention_sweep.py:427`).

## 단계별 전수 대상과 객체 참조

- raw (`retention_sweep_service.py:143`): `eeg_raw_chunks`, `audio_chunks`, `video_chunks` 행 삭제. `session_records`의 audio_s3_key/video_s3_key/transcript 및 ai_summary.segments 비움. `eeg_records.file_count` 재계산. 지우는 객체/파일은 **EEGRawChunk.object_key, AudioChunk.file_path, VideoChunk.file_path, SessionRecord.audio_s3_key, SessionRecord.video_s3_key** 전부다. 상대 참조는 S3, 절대 참조는 로컬 파일(`media_cleanup_service.py:33`). EEG 키는 `eeg-raw/{session}/{participant}/{play_group 또는 default}/{stream}/{index:08d}.bin`(`eeg_raw_service.py:45`, `:68`), 영상은 `video/{session}/{index}_{uuid}.webm`·`video/{session}/merged.webm`(`video_service.py:167`, `:329`), 음성 청크는 `CHUNK_STORAGE_DIR/{session}_{index}_{uuid}.bin`(`audio_service.py:124`). 연구 저장소 번들·표준 데이터 객체를 열거하거나 삭제하지 않는다.
- hold (`retention_sweep_service.py:211`): `research_consents`, `eeg_raw_chunks`, 관리자 `users` 읽기. 미철회 동의·미ack EEG 보류. 기한 초과 시 research_consents.hold_alerted_at 수정 및 `notifications`·`notification_outbox` 생성 가능(`notification_service.py:297`). WS 및 사용자 설정에 따른 메일 등 기존 알림 경로다. 음성·영상·전사는 보류 예외가 아니다.
- pii (`retention_sweep_service.py:255`): `session_participants`의 비회원 이름·성별·생일·리포트 이메일·스크럽 시각 수정, `session_email_invites`의 이메일·정규화 이메일·시각 수정(`session_email_invite_service.py:261`). canonical guest 경로는 `classes`·`sessions`를 읽고 `class_members` 및 참여자·초대 개인정보/발송 상태를 수정하며 `class_operations.result`·`class_member_operations.result`의 명시 멤버 ID에 대응하는 개인정보 사본도 비운다(`class_member_consent_service.py:181`, `:243`). S3 접근 없음.
- media/임시·고아 (`retention_sweep_service.py:346`): `eeg_raw_chunks` pending/failed TTL 경과 행과 object_key 삭제. retention_days=0이므로 이 하위 호출에서는 uploaded 기간 삭제 없음(`eeg_raw_service.py:355`). `audio_chunks/video_chunks`의 36,500일 경과분과 부모 없는 고아 행 및 file_path 삭제(`media_cleanup_service.py:122`). 엄밀히는 고아뿐 아니라 약 100년 경과 청크도 대상이다. file_count 갱신 외 다른 표준 테이블 접근 없음.
- 공통: `sessions`는 대상 종료일/상태 조회만, `retention_sweep_runs` 실행 이력 INSERT/UPDATE(`retention_sweep_service.py:324`, `:373`).
- 구 `sweep_stale_eeg_raw_cron`→`eeg_raw_task.py:21`, `sweep_stale_media_cron`→`media_cleanup_task.py:22`: 통합 설정 활성 시 skip, 비활성 시 각각 위 EEG 청크·미디어 청크만 정리. 표준 테이블/상수 참조 없음. dev 한 줄의 export는 별도 cron에 상속되지 않으므로 구 cron은 기존 환경 설정대로 동작한다. 표준 데이터 보호에 필요한 변경이 없어 그대로 유지했다.

## 활성 후 첫 실행 예상 영향

- 매일 UTC 03:00(KST 12:00), 빈 하한이면 오래된 자료도 소급 평가. 종료·취소·비템플릿(숨김 포함)의 종료일, 없으면 created_at 기준 **90일 초과** EEG raw·음성 청크/녹음·영상 청크/병합본·전사 원문/segments 삭제. 리포트 본문·요약·EEG 지표·회원 계정·세션 행은 유지한다.
- 기본 90일 지난 비회원 개인정보 및 초대 이메일 스크럽. canonical guest는 종료와 마지막 출석 종료 중 늦은 시각 기준 90일이며 작업 응답 사본도 스크럽한다.
- 미철회 연구 동의자의 미ack EEG는 보류, ack 후 서비스 원본 삭제. 거부·미동의·철회에는 게이트 없음. 연구 비식별 사본과 표준 데이터는 보존. 기존 보류 초과 관리자 알림/아웃박스 생성 가능.
- 임시 pending/failed 및 고아 미디어 정리. raw 객체 삭제는 DB 커밋 후, 임시/고아 경로는 flush 후 객체 삭제·커밋 순서이며 모두 best-effort라 실패 시 스토리지 잔존 가능.
- 서버/DB를 조회하지 않았으므로 실제 대상 수·용량·첫 실행 결과·외부 연구 보존은 미확인. 이번 작업에서 크론/실데이터 삭제/메일/알림/배포는 실행하지 않았다.

## 검증

- RED: 신규 소급 옵션 미구현/크론 정책 불일치로 4 failed, 25 passed.
- 표준 보호 선행 GREEN: retention 27 passed 후 dev 크론 변경.
- 최종 집중: retention B12·research export B13·normalization·normalization_score·dev_deploy **100 passed**, 의존성 경고 3건. cron 옵션 전달/dry-run 우선 사례도 포함. 독립 리뷰에서 테스트 DB·시각 고정 및 close 이후 ID 접근 문제를 보강한 뒤 재실행 통과.
- 파일 crontab 스텁: 17개 유지, retention 한 줄 외 동일, 빈/기존 크론 반복 등록 멱등 통과. 시스템 crontab 접근 없음. `bash -n` 통과.
- deploy-dev.yml SSH script: 10,086자/UTF-8 12,255바이트, 18,000 상한 통과. workflow 파일 변경 없음.

## 변경 파일

- `backend/app/services/retention_sweep_service.py`, `backend/retention_sweep_cron.py`: 명시 소급 옵션 및 보고·CLI 전달.
- `deploy/dev/register-crons.sh`: retention 한 줄의 승인 주석·실삭제·소급 옵션.
- `backend/tests/test_sdd209_b12_retention_sweep.py`, `backend/tests/test_dev_deploy_script_length.py`: 표준 보존·소급/차단·cron 전달·dev 정책 회귀.
- `fix-notes/dev-deploy-script-length/verify-crons.py`: 승인된 한 줄 변경만 비교 허용, 파일 스텁 멱등성 유지.
- `fix-notes/dev-retention-enable/plan.md`, `verify.md`, `summary.md`: 구현 전 계획/체크리스트와 보호 판정·실행 영향·검증 결과.
- `specs/sdd-238-eeg-raw-retention-90d/summary.md`: 후속 활성화 결정 연결.

## 최종 전체 회귀 및 독립 검토

- 격리된 SQLite·fakeredis fixture, 실제 설정 파일을 사용하지 않는 pytest launcher에서 `DATABASE_URL=sqlite:// RETENTION_SWEEP_ENABLED=false PG_SMOKE=0 ... pytest -q` 실행: **3939 passed, 463 skipped, 75 warnings**, 실패 0, 363.77초. 최초 전체 실행은 새 cron 테스트 격리 보강으로 중단했고 최신 코드로 전체 재실행한 최종 수치다.
- skipped에는 PostgreSQL/외부 의존 시나리오가 포함되며 실제 서버·DB·스토리지 검증을 뜻하지 않는다. 경고는 의존성 deprecation 및 기존 경고다.
- 읽기 전용 독립 검증자와 감독의 diff 재검토 통과. 표준 데이터 삭제 경로 없음, 운영 기본 차단 유지, retention 외 cron 변경 없음. `git diff --check` 및 금지 경로 diff 없음 확인.
