# 11. R4·R5 코드 조사 (B0) — 2026-10-17, develop `4b2e6809`

> Stage ② Plan Task **B0**의 산출. 코드를 직접 열어 확인한 사실만 적는다(파일:줄, 줄 번호는 이 커밋 기준). 코드 수정 없음. dev 서버는 **읽기 전용 집계/설정 조회만** 했다(개인정보·토큰·비밀번호·코드 값 출력 없음). 확인하지 못한 것은 `미확인`.
> 조사 중 확인한 서버 사실의 근거는 `baseline.md §4` 에 있다.

## 0. 결론 요약 (plan 가정과 달랐던 것 우선)

| # | 결론 | 영향 |
|---|---|---|
| S1 | **기존 보관 스위프가 dev 에서 이미 매일 돌고 있다.** `sweep_stale_media_cron.py`(04:45 UTC)·`sweep_stale_eeg_raw_cron.py`(04:30 UTC)가 `deploy-dev.yml:275-276` 으로 crontab 등록(2026-10-06 `24f52f25`). 음성·영상 청크는 `created_at` 90일 경과분이 **지금도 삭제되는 중**. EEG raw 는 `eeg_raw_retention_days=0`(무기한)이라 고아(pending/failed)만 정리. | plan 의 "스위프는 `RETENTION_SWEEP_ENABLED=false` 로 배포 → 배포 직후 원본 변동 0" 이 **현행 90일 음성·영상 삭제를 멈추는 정책 변경**이 된다. 기존 cron 을 새 스위프로 대체할 때 "현행 동작 유지(90일)"와 "비활성(변동 0)" 중 무엇인지 정해야 한다(§2-3) |
| S2 | **외래키(`ondelete`) 변경은 필요 없고 효과도 없다.** 원본/세션 삭제는 FK 자동 CASCADE 가 아니라 **앱 코드 5곳**(ORM `cascade="all, delete-orphan"` + 명시 SQL DELETE)이 만든다. FK 를 바꿔도 `db.delete(s)`·`DELETE FROM …` 은 그대로 행을 지운다. | MG-4 "FK 변경" 폐기, 하드 삭제 코드 경로 교체로 충족(§1·§5) |
| S3 | **`NarrativeCache` 는 개인·세션 데이터가 없는 전역 패턴 캐시**(PK=6자 지표 방향 시그니처). 제외 참가자 때문에 무효화할 대상이 아니다. 무효화/필터 대상은 **`Report.content`(JSONB 스냅샷)**·이를 읽는 경로다. | BE-3 "캐시 키에 선택 버전 포함/일괄 무효화" 중 narrative_cache 는 해당 없음(§3) |
| S4 | 리포트는 **DB 에 저장된 스냅샷**(`reports.content`)이고 PDF 는 저장하지 않는다(`pdf_url` 쓰는 코드 없음, 프로세스 메모리 LRU 32건, 키=내용 해시). 이메일 링크(`report_view` JWT, 7일)와 공개 `GET /reports/view` 는 **선택 상태를 보지 않는다**. | 선택 변경 시 `Report.content` 재생성/삭제, 열람 경로 게이트 필요(§3) |
| S5 | **상담사 리포트 EEG 는 "첫 참가자 1명" 기준으로만 집계된다**(`generate_report` 가 `participant_id=first_participant` 로 저장 → `_build_eeg_content(participant_id, session_wide=False)`). 그룹 클래스에서도 마찬가지(`report_service.py:293-306`, `report_task.py:503-510`). | "그룹 집계에서 제외 참가자 기여분 제거"의 현행 대상은 사실상 **첫 참가자의 데이터가 상담사 리포트에 대표로 들어가는 문제**. 첫 참가자가 제외면 상담사 리포트의 EEG 가 비어야 하는지·다른 참가자로 대체하는지 정의 필요(§3) |
| S6 | **PPG·ACC 원본은 서버에 저장되지 않는다.** raw 청크는 EEG 2채널(fp1,fp2 float32)뿐(`raw-encoder.ts:15-31`). PPG/ACC 는 파생 지표(`heart_rate`·`rmssd`·`motion` 등)로만 `eeg_feature_windows` 에 남는다. | R5-C4 "EEG raw·PPG·ACC 적재" 중 PPG/ACC **raw 는 적재 불가**(§7-2) |
| S7 | **비회원 소유 증명의 기반이 이미 있다**: `report_participant` JWT(`report_email_service.py:29-31`, HS256, 7일 고정 만료, `sub=participant.id`). 그러나 ① 상태 조회(`GET /by-code/{code}/state`)·WS join·EEG 업로드·무음 신호는 **`participant_id` 만으로 통과**(토큰 검증 없음) ② 토큰에 폐기 버전·세션 종료 연동 없음 ③ 게스트 채팅은 아예 미지원(채팅 WS/REST 는 로그인 JWT 필수). | BE-5 의 "재사용 + 교체 범위"가 확정됨(§4) |
| S8 | 비회원 이메일 초대는 **기존 알림 아웃박스를 못 쓴다**(`NotificationOutbox.user_id` NOT NULL FK). 신규 `session_email_invites` 필요(plan 일치). 메일 "전달 확인"은 **불가능에 가깝다**: `_send_email` 은 Resend 2xx 를 성공으로 보고 id 를 로그에만 남긴다. 웹훅 수신 코드 없음. | 응답 문구는 "발송 요청 접수"까지만 약속(§7-3) |
| S9 | **`remove_participant`(호스트가 참여자 제거)가 EEG 원본 행을 CASCADE 로 영구 삭제**하고 S3 `eeg-raw/` 객체는 고아로 남는다(F30 에 없던 경로, `session_service.py:1325-1341`). `admin_service.delete_user` 는 참가자 자격으로 남은 타 클래스 데이터도 지운다. | BE-1 삭제 경로 표에 추가(§2) |
| S10 | `session_records.audio_s3_key` 는 **어디서도 쓰지 않는다**(읽기만). 음성은 병합본이 없고 **청크 파일만** 서버 로컬 디스크에 둔다. dev 에서 음성 청크 경로의 98%(1383/1405행)가 `/tmp/mindbreeze_audio/`, 영상 청크 982행(약 778MB)은 `/tmp/mindbreeze_video/` 를 가리키는데 영상 쪽 디렉터리는 현재 **0개 파일**. | DB 행 수·바이트만으로 "보유 원본"을 말할 수 없다. 스냅샷은 DB 와 실제 파일 둘 다 기록(`baseline.md §4`) |

## 1. ① 모델·unique/FK 현황

| 테이블 (모델) | 기존 unique / 인덱스 | FK 와 `ondelete` | 근거 |
|---|---|---|---|
| `sessions` (`Session`) | `access_code`: **`unique=True, index=True`, `String(6)`** → DB 객체는 단일 **unique 인덱스 `ix_sessions_access_code`**(제약 아님). `ix_sessions_host_is_template` | `host_id → users.id` (ondelete 없음), `organization_id → organizations.id` | `models/session.py:45`, 마이그레이션 `881a08fbe584…:43`(`create_index(..., unique=True)`) |
| `session_participants` | `uq_session_participant_user (session_id, user_id)` — **PG 는 NULL 을 서로 다르게 보므로 비회원 중복 허용**. 이메일·이름 unique 없음 | `session_id → sessions.id CASCADE`, `user_id → users.id`(ondelete 없음) | `models/session.py:97-99,102-103` |
| `session_participants` 컬럼 | 비회원 개인정보 컬럼 **전부 존재**: `guest_name`·`gender`·`birth_date(Date)`·`report_email`·`report_email_status`·`report_email_sent_at`·`consent_audio/eeg`·`is_waitlisted`·`waitlist_position`·`raise_hand`·`speaking` | — | `models/session.py:105-125` |
| `session_records` | `session_id` unique | `session_id → sessions.id`(**ondelete 없음**, ORM `Session.record` 가 `delete-orphan`) | `models/record.py:17`, `models/session.py:86` |
| `audio_chunks` / `video_chunks` | `uq_*_chunk_session_idx (session_id, chunk_index)` | `session_id → sessions.id CASCADE` | `record.py:52,56,73,77` |
| `eeg_records` | `uq_eeg_record_session_participant` | `session_id → sessions.id`(ondelete 없음, ORM cascade), `participant_id → session_participants.id CASCADE` | `record.py:92-94,98,102-104` |
| `eeg_raw_chunks` | `(session, participant, stream, chunk)` 계열 unique + 범위 스캔 인덱스 | `session_id`·`participant_id` 모두 CASCADE | `record.py:126-148` |
| `eeg_feature_windows` | 세션·참가자 인덱스, unique 포함 | `session_id`·`participant_id` CASCADE | `models/eeg_feature.py:58,66` |
| `reports` | **부분 unique 2개**: `uq_report_session_participant_type`(participant NOT NULL), `uq_report_session_type`(participant NULL) | `session_id → sessions.id`(ondelete 없음, ORM cascade), `participant_id → session_participants.id CASCADE` | `record.py:175-203,206,212-214` |
| `narrative_cache` | PK `signature` String(6) | FK 없음 | `models/narrative_cache.py:13-24` |
| `chat_rooms` | `session_id` unique | `sessions.id CASCADE` | `models/chat.py:18` |
| `notification_outbox` | — | `user_id → users.id` **NOT NULL** | `models/notification_outbox.py:31` |

- ORM 관계 `Session.participants/record/eeg_records/reports` 가 모두 `cascade="all, delete-orphan"`(`models/session.py:85-88`) — **`db.delete(session)` 는 DB FK 설정과 무관하게 이 4종 행을 지운다.** 나머지(청크·지표·채팅방·리마인더 로그)는 DB CASCADE.
- 마이그레이션 FK 실물은 모델과 일치함을 확인(`b3d9e1f04277…:73-74`, `e036a0000012…:33`, `b2d8f1a4c093…:42` 등 `ondelete='CASCADE'`).

## 2. ② 원본 삭제·정리 경로 전수 (F30)

### 2-1. 삭제를 일으키는 코드 (행 + 스토리지)

| # | 경로 | 파일:줄 | 무엇이 지워지나 | 비고 |
|---|---|---|---|---|
| D1 | **보관 스위프(미디어)** `sweep_stale_media` | `media_cleanup_service.py:26,120-152` | 음성·영상 **청크** 행+파일(`created_at` < 90일) + 부모 없는 고아. `MEDIA_RETENTION_DAYS=90` 코드 상수 | cron 04:45 UTC **활성**. 병합 영상(`video_s3_key`)·STT 텍스트는 대상 아님 |
| D2 | **보관 스위프(EEG raw)** `sweep_stale_eeg_raw` | `eeg_raw_service.py:352-410`, `config.py:79`(`eeg_raw_retention_days: int = 0`) | `pending`>24h·`failed`>24h 고아 행(+객체 best-effort), `uploaded` 는 retention>0 일 때만. 삭제 후 `EEGRecord.file_count` 재계산 | cron 04:30 UTC **활성**, dev `.env.dev` 에 `EEG_RAW_RETENTION_DAYS`/`RETENTION*` 설정 **없음**(=무기한). 상수 `EEG_RAW_RETENTION_DAYS=90`(`:327`)은 호출되지 않는 참고값 |
| D3 | 클래스 삭제 `delete_session` | `session_service.py:817-831` → `media_cleanup_service.delete_session_media`(`:73-86`) 후 `db.delete(s)` | 청크 파일·raw 객체·병합 영상 키 파일 + ORM/DB CASCADE 로 참가자·기록(STT 텍스트 포함)·EEG 레코드·리포트·지표·청크 행 전부 | **호스트 API `DELETE /sessions/{id}` 로 상태 가드 없이 가능**(진행/완료도). `EEGRecord.s3_key` 객체는 수집 대상에서 빠짐 |
| D4 | 참여자 제거 `remove_participant` | `session_service.py:1325-1341` (`db.delete(participant)`) | `participant_id` FK CASCADE 로 해당 참가자의 **EEG raw 행·지표 행·EEGRecord·리포트 행 삭제**. S3 `eeg-raw/{sid}/{participant}/…` 객체는 **정리 코드 없음 → 고아** | **F30 에 없던 경로.** 호스트 권한, 대기열 승격과 같은 함수 |
| D5 | 관리자 계정 삭제 `admin_service.delete_user` | `admin_service.py:711-797` | 먼저 `delete_user_media`(`media_cleanup_service.py:89-107`, 호스트 세션 + 본인 `EEGRawChunk.user_id` 객체) → 호스트 세션 자식 9개 테이블 `DELETE`(`:743-760`) → `eeg_records/reports/session_participants … WHERE user_id` 삭제(`:765-790`) → `db.delete(user)` | 라우트 `DELETE /admin/users/{id}` 는 `require_platform_admin`(`api/v1/admin.py:274-285`). **회원 자진 탈퇴 기능은 코드에 없다**(`탈퇴` 검색 결과 0, 계정 삭제 경로는 이것 하나) |
| D6 | 개발 계정 초기화 | `dev_user_service.py:230` | dev 고정 계정 | 운영 경로 아님 |
| D7 | 가입 신청 정리 | `signup_application_service.py:92-106` | 신청자 사용자·기관 | 세션 데이터 없음 |
| D8 | 영상 병합 후 원본 청크 정리 | `video_service.py:82-102,341,355` (`_cleanup_source_chunks`) | 병합 성공 시 **영상 청크 행+파일 즉시 삭제**(병합본 `video/{sid}/merged.webm` 만 남음) | 이는 "재생성 가능한 임시파일" 정리가 이미 구현된 사례. 병합 실패 시 청크가 남아 D1 의 90일 대상이 됨 |
| D9 | 업로드 경합 미채택 파일 정리 | `audio_service.py:101-107`, `video_service.py:33-43` | 미채택 요청이 쓴 파일 | 원본 아님 |
| D10 | 알림 아웃박스 삭제 | `tasks/outbox.py:108-121` | 알림 | 원본 아님 |

### 2-2. 원본/파생 데이터가 실제로 어디에 저장되나 (R5 "저장 위치")

| 데이터 | 저장소 | 모델·키 | 만료/삭제 경로 |
|---|---|---|---|
| EEG raw (fp1,fp2 float32 LE, 250Hz) | **S3** `eeg-raw/{session}/{participant}/{play_group}/…` | `EEGRawChunk.object_key`(`record.py:168`) | D2(기본 무기한), D3, D5(호스트·본인 user_id), **D4 는 객체 누락** |
| PPG·ACC raw | **저장 없음** | — | — (S6) |
| EEG/PPG/ACC **파생 지표**(집중·이완·스트레스·밴드파워·HRV·심박·호흡·움직임 등) | **DB** `eeg_feature_windows` 컬럼(`eeg_feature.py` 61-90행) | 윈도우 단위 | 별도 만료 경로 없음. D3/D4/D5 로만 삭제 |
| 음성 | **EC2 로컬 디스크**(`AUDIO_CHUNK_DIR` 기본 `/var/lib/mindbreeze/audio`, dev 는 대부분 `/tmp/mindbreeze_audio`), 병합본 없음(`audio_s3_key` 미사용) | `AudioChunk.file_path`(`audio_service.py:20,131`) | D1(90일), D3, D5 |
| 영상 | **S3** `video/{session}/…` 청크(실패 시 로컬 `/var/lib/mindbreeze/video` 또는 `/tmp/mindbreeze_video`) → 병합 `video/{session}/merged.webm` | `VideoChunk.file_path`, `SessionRecord.video_s3_key`(`video_service.py:43`, `video_task.py:66-67`) | 청크: D1/D8. **병합본: D3/D5 만(기간 만료 없음)** |
| **STT 원문** | **DB** `session_records.transcript`(Text) + `ai_summary.segments`(JSONB, 화자 분리) + `transcript_confidence` | `tasks/stt_task.py:564-577` | 기간 만료 없음. D3/D5. **행 삭제는 리포트 생성을 깨므로 스위프는 컬럼 비움(NULL) 방식이 필요** |
| AI 요약·마커·상담사 메모·주관 상태 | **DB** `session_records.ai_summary`·`markers`·`counselor_notes`·`subjective_state` | `summary_task.py:312-323`, `record_service.py` | 위와 동일 |
| 리포트 | **DB** `reports.content`(JSONB: 지표·시계열·서사·코멘트·`transcript_segments`·영상 가용 여부) | `report_task.py:350-377,460-588` | 기간 만료 없음. PDF 는 저장하지 않음 |

### 2-3. 스위프 재사용·설정값화에 필요한 정정 (plan BE-1·BE-R2 영향)

1. **기준일**: D1 은 청크 `created_at`, D2 는 `coalesce(uploaded_at, created_at)` — 둘 다 "세션 종료일" 이 아니다. 세션 종료일 기준 통일은 청크→세션 조인(`sessions.ended_at`, 미종료는 `created_at` 폴백 필요)으로 바뀐다. 이미 `older_90d` 가 0건이라(스냅샷 Q3~Q5) 현 데이터에는 영향 없음.
2. **병합 영상·STT 원문·전사 요약은 어떤 스위프에도 없다.** R5 가 "원본(EEG raw·음성·영상·STT 원문) 기간 삭제" 를 요구하므로 `video_s3_key` 객체 삭제(+키 비움, `video_status` 유지 여부 결정)와 `transcript`/`ai_summary.segments` 비움 로직을 **신규로** 만들어야 한다. 현행 스위프 재사용만으로는 병합 영상(스냅샷 38건, S3 `video/` 총 2.18GB)이 영구 보존된다.
3. **현행 활성 스위프의 처리 결정이 필요**(S1): (a) 새 `retention_sweep` 로 대체하되 `RETENTION_SWEEP_ENABLED=false` 로 두면 현행 90일 음성 삭제가 **중단**된다 (b) 현행 동작을 유지하며 점진 이행 (c) 새 스위프도 기본 활성화하되 N-5(배포일 이후 종료 클래스부터) 적용. → 기술 결정이 아니라 **데이터 삭제 동작의 변경이므로** Brian 확인 항목 후보. 배포 시점의 dry-run 결과는 `baseline.md §4` 숫자가 기준선이다.
4. `delete_session_media`(D3)는 병합 영상은 지우지만 `EEGRecord.s3_key`·리포트 PDF(없음)는 수집하지 않는다. D4 는 객체 수집 자체가 없다.
5. 청크 파일 삭제는 모두 best-effort(`media_cleanup_service.py:42-60`): S3 삭제 실패해도 DB 행은 지워진다 → **행은 없는데 객체는 남는 고아**가 생길 수 있다. 스위프 dry-run 에는 "행 기준 후보"와 "객체 목록 기준 고아" 를 따로 세야 한다(S3 목록은 총량 확인용으로 `baseline.md` 에 기록).

## 3. ③ 리포트 생성·조회·발송·캐시 경로 전수 (F31)

선택 정보(`report_included`)가 걸려야 하는 지점과 현재 상태:

| # | 경로 | 파일:줄 | 현재 동작 | 필요 조치(BE-3) |
|---|---|---|---|---|
| R1 | 종료 파이프라인 → 참가자별 client 리포트 | `report_service.py:337-417`(`generate_client_reports_for_session`), 호출은 `tasks/pipeline_outbox_task.py` | 활성(비대기) 참가자마다 Report 생성 | 제외 참가자는 리포트 행을 만들지 않거나(권장) 빈 제외 리포트로 생성 |
| R2 | 리포트 본문 생성 | `report_task.py:460-588`(`generate_report_inline`), `_build_eeg_content :181-347`, `_client_content :380-391`, `_counselor_content :350-377` | `Report.content` 에 **스냅샷 저장**(지표·시계열·서사·`ai_record`). client 리포트는 그룹이면 공통 녹음 제외(`:513`), 상담사 리포트는 **`transcript_segments` 전체(전 참가자 발화)·영상 가용 여부 포함** | 생성 시점에 선택 상태 반영. 상담사 리포트의 `transcript_segments`/`video` 는 "제외 참가자 있음" 이면 제거(공통 녹음 분리 불가) |
| R3 | 상담사 리포트 단일화 | `report_service.py:293-306`, `report_task.py:503-510` | 상담사 리포트 `participant_id=첫 참가자(joined_at 순)`. **EEG 는 그 1명만 집계**(S5) | 첫 참가자가 제외일 때 대체 규칙 정의(다음 포함 참가자? 비움?) — 정책 결정 |
| R4 | 재생성/승인 | `report_service.py:247-335`, `approve_report :873-943` | 승인 시 코멘트·메일 예약. 이미 승인(`completed`)된 리포트는 재생성해도 `completed` 유지(`report_task.py:464-476`) | **선택 변경 시 `completed` 보존 규칙이 제외를 되돌리지 못한다** → 제외 전환은 예외로 내용 교체+승인 상태 유지 규칙 필요 |
| R5 | 목록·상세 조회 | `report_service.py:504-692`(`list_reports`), `get_report :695-738`, `_serialize :130-185` | DB 의 `content` 를 그대로 직렬화. 상담사 상세에 `client_comments` 파생 주입(`:732`) | 응답 직전 필터(저장본이 구버전이어도 제외가 보장되도록 **조회 시 방어 필터** 병행) |
| R6 | 내보내기 사본 | `export_service.py:78`(게이트), `export_package.py:79-125` | 상담사/플랫폼 관리자 데이터 다운로드. 게이트는 `participant.consent_eeg`(EEG 데이터가 있을 때) | 리포트 선택과 **독립**(요구사항대로 혼용 금지). 단 최신 client 리포트 본문을 번들에 포함(`:113-116`)하므로 제외 시 번들 정책 필요 |
| R7 | 화면 PDF | `api/v1/reports.py:105-115`, `report_pdf_service.py:159-192` | 승인 리포트를 즉석 렌더. `pdf_url` 컬럼은 **어디서도 쓰지 않음**. 프로세스 LRU 32건(키=내용 해시 `:24-34`) | 저장물 없음 → 별도 무효화 불필요. 내용 해시 키라 내용이 바뀌면 자동 갱신. (메모리 캐시 잔존은 재시작으로 소멸) |
| R8 | 이메일 링크 열람 | `report_email_service.py:282-314`(`get_report_view_content`), `:317-`(`view_report_email`), 공개 라우트 `reports.py:28-41`, `session.py:513` | `report_view` JWT(7일, `email` 클레임)와 `participant.report_email` 일치만 확인 | **선택 상태 확인 없음** → 제외 전환 후에도 이미 발송된 링크가 7일간 유효. 열람 시 `report_included`·재동의 확인 + 사본 회수 불가 고지 |
| R9 | 메일 발송 | `report_email_service.py:171-216`(`deliver_report_email`), `report_task.py:424-457`, `report_service.py:839-870`, 태스크 `report_email_task.py:18-27` | `participant.report_email` 이 있고 리포트 `completed`(상담사 승인)일 때 자동 예약. 발송 후 `report_email_sent_at` 기록(재발송 방지) | 제외 참가자는 대상 아님. **R5 의 "입력 이메일 자동 발송" 은 이미 구현돼 있고(승인 게이트 포함), 비회원은 `report_email` 을 입장 시 채우기만 하면 된다** |
| R10 | AI 입력(코멘트 초안) | `report_comment_service.py:108-175`(`_draft_context`) | 그룹이면 공통 녹음 제외, 1:1 은 `ai_summary`·`counselor_notes`·EEG 서사 사용 | 제외 참가자의 리포트에서는 AI 초안 입력에서 `ai_summary`·`eeg_narrative` 제거(자동 승인 경로 `ensure_auto_comment` 포함) |
| R11 | AI 비서(루시) | `agent_policy.py:170-190`(본인 완료 client 리포트 본문), `agent_report_chat.py`(완료 트리거) | 승인된 본인 리포트만 사용 | 제외 리포트가 `completed` 로 남아 있지 않게 R4 규칙 필요 |
| R12 | 대시보드·기관 통계 | `dashboard_service.py:51,83`, `org_service.py:488`, `api/v1/client_portal.py:258` | 리포트 목록/존재 여부 | 제외 리포트 노출 방식 결정(숨김 vs "제외됨" 표시) |
| R13 | 서사 캐시 | `summary_task.py:100-135`, `report_narrative.py:59-70`, `models/narrative_cache.py` | 키=6자 방향 시그니처(`↑↓→?`), 값=일반 문장. **세션/참가자/텍스트 정보 없음** | **무효화 불필요**(S3). 제외 참가자의 지표로 만들어진 문장은 이미 어느 개인에도 귀속되지 않는 패턴 문장 |
| R14 | 그룹 집계 | `group_aggregate.py`(`compute_group_aggregate/average`)는 **WS 실시간에서만 호출**(`session_live_namespace.py:547,691,1118-1221`) | 리포트에는 쓰이지 않음 | 실시간 집계에서의 제외 처리 필요 여부는 정책 질문(실시간 화면은 리포트가 아님) — 기본은 변경 없음 |
| R15 | 영상 재생 | `api/v1/video.py:64-95`, `video_service.py:392-` | 호스트/플랫폼 관리자가 세션 단위 병합 영상 재생 URL 발급 | 영상은 세션 단위 1개 → 참가자별 제외 불가. "제외 참가자 있으면 영상 재생/리포트 영상 비노출" 규칙 필요 |
| R16 | 읽기 전용 기록 API | `record_service.py:148-171,213-219` | 호스트에게만 `transcript`/`ai_summary` 전체, 비호스트는 마스킹 | 변경 없음(호스트 원본 열람 ≠ 리포트). 정책상 "상담사용 리포트" 범위만 필터 |

**그룹 공통 녹음**: 현행 코드가 이미 같은 방향의 방어를 갖고 있다 — client 리포트와 AI 초안은 `participant_mode == "group"` 이면 공통 녹음 요약을 제외(`report_task.py:511-513`, `report_comment_service.py:143-146`). R4 는 이 규칙을 "그룹 + 제외 참가자 1명 이상 → **상담사 리포트의 `transcript_segments`·영상까지**" 로 확장하면 된다(상담사 리포트는 현재 전 참가자 발화를 담는다).
**1:1 + 유일 참가자 제외**: 상담사 리포트의 STT/영상/EEG 가 모두 제거돼 리포트가 사실상 비게 된다. 정책 의도(상담 기록 자체의 제외)인지 확인이 필요하다(§8 가정 A3).

## 4. ④ 비회원 자격 재사용 범위·WS 연결 (F32)

### 4-1. 현행 비회원 소유 증명

| 항목 | 현행 | 근거 |
|---|---|---|
| 발급 | `join_session_by_code` 게스트 분기가 `participant_token`(JWT `type=report_participant`, `sub=참가자 id`, `session_id`, `exp=7일`) 반환 | `session_service.py:1678-1682`, `report_email_service.py:23-31` |
| 서명 | 로그인 JWT 와 **같은 비밀키·알고리즘**(`settings.jwt_secret_key`, HS256) — `type` 클레임으로만 구분 | `report_email_service.py:23-26`, `config.py:40-42` |
| 만료 | 7일 고정(세션 종료·상태와 무관). **폐기용 버전/jti 없음** | 같음 |
| 재접속 | 토큰으로 기존 행 재사용(이름·성별·생일 덮어씀). **토큰 없이 같은 이름으로 재입장하면 행이 새로 생김**(유령 참가자) | `session_service.py:1633-1676` |
| 입장 시 동의 | 게스트 행은 `consent_eeg=True` 로 생성 | `session_service.py:1657,1669` |

### 4-2. 엔드포인트별 소유 검증 현황

| 기능 | 검증 | 근거 |
|---|---|---|
| LiveKit 토큰 `POST /by-code/{code}/livekit-token` | 게스트: **토큰 필수**(`sub` 일치). 회원: 로그인 일치 | `session_service.py:1690-1747` |
| 손들기 `raise_hand` | 토큰/로그인 필수(`_authorize_participant_access`) | `session_service.py:1794-1815,1818-1852` |
| 주관 상태 체크인 | 토큰/로그인 필수 | `record_service.py:278-298`, `schemas/record.py:113-122` |
| 리포트 메일 신청 | 게스트: 토큰 + 이메일 OTP | `report_email_service.py:55-134` |
| **상태 조회 `GET /by-code/{code}/state`** | **인증 없음** — `participant_id` 만으로 **본인 최신 EEG 지표·밴드 상태 반환**(소유 검증 없음) | `api/v1/session.py:112-118`, `session_service.py:2179-2248`(plan F2 의 줄 번호 `1818-1840` 은 오기, 정정) |
| **WS `/session-live` join** | 연결 시 토큰 없으면 게스트로 허용. `join` 의 게스트는 **`participant_id`(UUID)만** 확인(+`user_id IS NULL` 행) | `session_live_namespace.py:388-433`, `session_service.py:2292-2362` |
| **WS feature 업로드·EEG 배치 업로드** | `resolve_upload_participant`: 게스트는 `participant_id` + `user_id IS NULL` 만. 그 뒤 `_assert_upload_eligible` | `session_service.py:2507-2572`, `session_live_namespace.py:958-990` |
| **무음 신호** `resolve_signal_sender` | 위와 동일(participant_id 만) | `session_service.py:1934-1990` |
| 채팅 | **게스트 미지원**: REST 는 로그인 필수, 채팅 WS 는 access JWT 필수(`chat_namespace.py:47-79`), `ChatMessage.sender_id` → users. 게스트 join 응답의 `chat_room_id` 는 노출되지만 메시지 송수신 수단이 없음 | `ws/chat_namespace.py`, `models/chat.py:40` |
| 녹화 WS `/record` | JWT 사용자 기준 | `ws/record_namespace.py:53-81` |

`participant_id` 는 UUID4 라 추측은 어렵지만 **참가자 목록/WS 브로드캐스트에 노출되는 값**이다(`participant_changed`·`live-metrics`). 소유 증명으로 쓸 수 없다.

### 4-3. 재사용 판단 (BE-5 확정 입력)

- **재사용 가능**: 서명 JWT 방식·`sub=participant.id` 검증 헬퍼(`_authorize_participant_access`, `resolve_*`)·게스트 행 모델. 새 자격은 "같은 방식 + 아래 보강" 이 가장 작은 변경이다.
- **교체 필요(plan 의 "무토큰/약한 검증" 구체화)**: ① by-code state(IDOR) ② WS join·feature·quiet-signal ③ REST/WS EEG 업로드(게스트 분기) — 모두 `participant_id` 단독 신뢰. ④ 로그인 회원도 `resolve_*` 가 `user_id` 로만 확인하므로 새 자격 도입 시 "회원은 로그인 토큰, 비회원은 입장 자격" 이중 경로를 유지하는 쪽이 안전.
- **보강 필요**: 별도 `type`(예: `class_entry`), 짧은 만료(클래스 종료 또는 N시간) + 세션 종료 시 서버가 거부, **폐기 버전 필드**(MG-2 `자격 폐기용 버전` 이 참가자 행에 있어야 JWT 의 `ver` 와 대조 가능), 키는 기존 `jwt_secret_key` 재사용 vs 분리(`decode_token` 호출부 6곳 전수 확인: `deps.py:23-25`·`session_live_namespace.py:404-419`·`record_namespace.py:82-90` 은 `type=="access"` 만 허용, `chat_namespace.py:54-62` 는 `type` 이 없거나 `access` 만 허용, `auth.py:660` 은 로그아웃 best-effort 라 권한 부여 없음 → 현재 `report_participant` 토큰이 로그인 토큰으로 오용될 수 없음. 새 자격도 별도 `type` 을 쓰면 같은 키 재사용이 안전하며, **`type` 없는 토큰을 허용하는 `chat_namespace` 분기만 새 자격 토큰에 `type` 을 반드시 넣어야 한다**).
- **WS 연결 방식**: 연결 시 `auth.token` 은 로그인 JWT 만 받는다(`connect :388-433`). 비회원은 `join` 이벤트 페이로드에 자격을 싣고 검증하는 방식이 가장 변경이 적다(연결 단계는 무토큰 허용 유지).
- **채팅 비회원 지원은 신규 범위**: 현행 채팅 인프라 전체가 users 기반이라 "소유권 검증 통일(채팅 포함)" 은 검증 통일이 아니라 **기능 신설**이다. plan 5b 범위에서 채팅은 "비회원 채팅 미지원 유지, 회원만" 으로 낮추거나 별도 Task 로 분리하는 것을 제안(미결정).

## 5. ⑤ 마이그레이션 수·FK 변경 필요성

현재 head `e036a0000041`(DB `alembic_version` 도 동일, 단일 head 확인 — 서버 조회). `alembic/versions/` 파일 74개.

| 제안 | 내용 | FK 변경 | 비고 |
|---|---|---|---|
| **M-A (MG-1)** | `sessions.access_code` **unique 인덱스 `ix_sessions_access_code` 교체**: drop → 활성 상태 한정 **부분 unique 인덱스** 생성. 길이는 `String(6)` 유지(4자리 수용). `legacy_access_code`(nullable, String(6)) 추가 | 없음 | 모델에서 `unique=True` 를 빼고 `Index(..., postgresql_where=…)` 로. 사전 중복 검사 필수. 롤백은 코드만 |
| **M-B (MG-2)** | `session_participants` 에 `report_included`(NOT NULL, `server_default false`)·고지 시각/버전·`entered_at`·대기 취소 시각/상태·자격 폐기 `entry_ver`·`pii_scrubbed_at` | 없음 | 상수 기본값 메타데이터 전용 add column(PG 11+ 무락). 비회원 PII 컬럼은 **재사용** |
| **M-C (MG-3)** | `report_choice_events`(선택 이력), `original_deletion_audits`(관리자 삭제 감사) | 신규 FK 는 **`ondelete` 없음(SET NULL 이 아닌 NO ACTION)** 로, 세션/참가자 삭제 후에도 감사 행이 남도록 컬럼에 id 값만 보관(FK 없이 UUID 컬럼) 검토 | 감사·이력은 부모 CASCADE 에 휩쓸리면 안 됨 |
| **M-D (MG-5)** | `research_consents`·`research_consent_events` | **session/participant FK 에 CASCADE 금지**(plan 일치), 참조는 UUID 컬럼으로만 보관 가능 | 스크럽·숨김 후에도 가명 해시 철회 대조 |
| **M-E (MG-6)** | `sessions.hidden_at`(숨김/보존 전환), `retention_sweep_runs` | 없음 | 숨김 필터가 필요한 조회: `list_sessions`(`session_service.py:624`), `report_service.list_reports`, `dashboard_service`, `org_service.py:488`, `client_portal.py:258` |
| **M-F (MG-7)** | `research_export_batches/items`, `research_withdrawal_requests`, `session_email_invites` | 초대 테이블: `session_id → sessions.id`(스크럽 후 행 유지 필요 → CASCADE 여부는 숨김 정책과 함께 결정) | 알림 아웃박스 재사용 불가(S8) |

- **추정 마이그레이션 파일 수: 6개(M-A~M-F)**, 단일 head 체인. plan 이 가정한 "필요 최소" 보다 많지만 모두 추가형이며, 데이터 변경(코드 재발급)은 분리 스크립트(DS-1).
- **FK `ondelete` 변경 결론: 하지 않는다.** 근거 = S2 (삭제는 앱 코드 경로). 대신 필요한 변경은 코드: D3(`delete_session`)·D4(`remove_participant`)·D5(`delete_user`)가 원본/기록을 **숨김·비활성화**하도록 바꾸고, 실제 삭제는 스위프·관리자 서비스로만 도달하게 한다. 단 `Session.participants/record/eeg_records/reports` 의 `cascade="all, delete-orphan"` 는 그대로 두면 `db.delete(s)` 가 남아 있는 한 연쇄 삭제가 일어나므로, **`db.delete(Session)` 호출처를 관리자 서비스 한 곳으로 모으는 것이 핵심**이다.
- 회원 자진 탈퇴가 없으므로 "탈퇴 숨김" 은 `admin_service.delete_user` 의 변경(계정 비활성+개인정보 비식별화 vs 현행 영구삭제)이다. 사용자 행 삭제는 `sessions.host_id` FK 때문에 세션을 함께 지워야 하므로 **숨김 전환 시 users 행을 지울 수 없다**(`status` 비활성 처리로 대체) — 설계 선택지로 plan 에 반영 필요.

## 6. ⑥ 스토리지 lifecycle (읽기 전용 확인)

AWS CLI(프로파일 `looxid-las`, `ap-northeast-1`)로 **설정 조회만** 수행했다.

| 항목 | 결과 |
|---|---|
| 버킷 | `mindbreeze-dev` 단일(코드 기본값 `config.py:57`) |
| Lifecycle 규칙 | **없음** (`NoSuchLifecycleConfiguration`) → 만료는 앱 스위프만 |
| 버저닝 | 비활성(조회 결과 없음) → 객체 삭제는 복구 불가 |
| 암호화 | SSE-S3(AES256), SSE-C 차단 |
| 프리픽스 | `eeg-raw/` 1,550 객체 3,080,000 B / `video/` 1,316 객체 2,183,957,108 B / `research-export/` 0 (미존재) |
| prod 버킷 | 없음(메모리 기준: prod 버킷 없음) — 운영 lifecycle 은 `미확인`(존재하지 않음) |

- 버저닝이 꺼져 있어 S3 쪽 안전망이 없다 → 스위프 활성화 전 dry-run 승인 게이트의 중요도가 높다.
- 연구 내보내기용 스테이징 prefix(`research-export/`) IAM·정책은 **별도 승인 인프라 작업**(변경 없음).

## 7. R5 추가 확인사항

### 7-1. STT 원문·EEG 지표·리포트 저장 위치
§2-2 표 참고. 요약: **STT 원문 = DB(`session_records.transcript`, `ai_summary.segments`)**, **EEG 지표 = DB(`eeg_feature_windows`)**, **리포트 = DB(`reports.content`)**, EEG raw = S3, 영상 = S3, 음성 = 서버 로컬 디스크. N-2(a)(원본+비회원 개인정보만 삭제) 기준 "원본"에는 **STT 원문 컬럼 비움**을 넣어야 하며, 이때 `reports.content.transcript_segments` 에 **같은 내용이 스냅샷으로 복제돼 있다**(`report_task.py:352,364`)는 점에 주의 — 원문 삭제가 리포트 안의 화자 분리 기록을 지우지 못한다. (N-2 "리포트 본문은 삭제 대상 아님" 과 충돌하는 지점 → 정책 확인 필요)

### 7-2. 연구 번들 필드 허용표 초안 (BE-R3)

저장돼 있는 것만 후보로 삼았다. 판정: ✅ 허용 / ⛔ 금지 / ❓ 결정 필요.

| 구분 | 필드(원천) | 판정 | 비고 |
|---|---|---|---|
| 식별 | `research_subject_id`(HMAC) | ✅ | 키 버전 `key_version` 동반 |
| 식별 | 이름 원문·이메일·전화·`user_id`·`participant_id`·`session_id` 원본 UUID·호스트/기관 id | ⛔ | 세션/참가자 연결은 번들 내 **임의 일련 가명**(`session_pseudo`, `participant_pseudo`)으로만 |
| 인구통계 | `gender` | ✅ | |
| 인구통계 | `birth_date` → `birth_year_month`(YYYY-MM) | ✅ | N-4 확정. 일(日) 제거. 현재 컬럼은 `Date` 이므로 **연구 DB 로는 YYYY-MM 문자열만**(기본 DB 저장 형태 변경 여부는 N-4 별개 확인) |
| 세션 메타 | `type`, `participant_mode`, `location_type`, `linkband_mode`, `duration_min` | ✅ | |
| 세션 메타 | `scheduled_at/started_at/ended_at` 절대 시각 | ⛔ | 세션 시작 기준 **상대 시각(ms)**; 요일/시간대 일반화는 ❓ |
| 세션 메타 | `title`·`notes`·`custom_type_name` | ⛔ | 자유 텍스트 |
| EEG raw | `eeg_raw_chunks` 의 객체 본문(fp1,fp2 float32, 250Hz, 2ch) + `sample_rate/channel_count/unit/schema_version/start_ms/end_ms/stream_id` | ✅ | `object_key`·`checksum`·`id` 는 번들 내 재번호. **PPG/ACC raw 는 존재하지 않음**(S6) → 번들 계약에서 "PPG/ACC 는 파생 지표만" 으로 정정 |
| EEG 지표 | `eeg_feature_windows`: `focus_index, cognitive_load, relaxation_index, stress_index, emotional_stability, total_neural_activity, faa, hemispheric_balance, delta/theta/alpha/beta/gamma/total_power, meditation_level, attention_level, signal_quality, quality, window_index, device_timestamp_ms` | ✅ | `device_timestamp_ms` 는 장비 기준 시각 → **상대화 확인 필요**(장비 시계의 절대 의미 여부 `미확인`) |
| PPG/ACC 파생 | `sdnn, rmssd, lf_power, hf_power, lf_hf_ratio, heart_rate, respiratory_rate, motion` | ✅ | |
| 텍스트 | `transcript`·`ai_summary`·`counselor_notes`·`markers`·`subjective_state`·리포트 `content`(서사·코멘트) | ⛔ | 정책(녹취/STT 제외) + 자유 텍스트 재식별 위험. `subjective_state`(자기보고 수치)는 ❓ |
| 미디어 | 음성·영상 | ⛔ | 정책 |
| 리포트 | `data_credibility`, `eeg.coverage_ratio` 등 품질 메타 | ❓ | 연구 가치 있음(제외 시 품질 필터 불가). 수치만이라 비식별 |
| 상태 | `band_connected/battery/linkband_device_id` | ⛔(device id) / ❓ | 기기 식별자는 금지 |

**검증 규칙 제안**: 허용 목록에 없는 키가 번들에 하나라도 있으면 업로드 거부(화이트리스트 방식), manifest 에 필드 목록 해시 기록, 문자열 값 컬럼은 허용 목록의 열거형(`type` 등)만.

### 7-3. 초대 메일 전달 확인 수단

| 항목 | 확인 결과 | 근거 |
|---|---|---|
| 발송 방식 | Resend REST `POST /emails`, 2xx 이면 `True`. 응답 `id` 는 **로그에만** 남김(저장 안 함) | `tasks/email.py:27-72` |
| 전달/반송 확인 | **불가**: Resend 웹훅(Svix) 수신 코드 없음(`webhook|bounce|delivered` 검색 0건). `GET https://api.resend.com/emails/{id}` 로 `last_event`(delivered/bounced/…) 조회는 가능하나 현 코드는 id 를 저장하지 않아 사용 불가 | 같음, 전수 검색 |
| 개발 모드 | `settings.debug and not resend_api_key` 이면 **실제 발송 없이 True 반환**(로그만). dev 서버는 `DEBUG=false`, `RESEND_API_KEY` 설정됨(값 비출력), 발신 주소는 자체 도메인(`dev.mindbreeze.looxidlabs.com`) | `email.py:34-41`, 서버 `.env.dev` 존재/비존재만 확인 |
| 결론 | 초대 응답 상태는 **"발송 요청 접수(Resend 수락)"** 와 **"전달 확인됨"** 을 분리하되 후자는 (a) `session_email_invites` 에 Resend `id` 저장 + 상담사 화면에서 조회 버튼/주기 폴링(`GET /emails/{id}`), 또는 (b) 웹훅 엔드포인트 신설(서명 검증, 공개 URL 필요) 중 택일. 기본안은 (a) — 외부 노출 없이 가능. 문구는 "초대했어요/메일을 보냈어요" 까지만 |

### 7-4. `email_app` 워커 경로 (BE-R4)

- 앱: `app/tasks/report_email_task.py:1-17` — `Celery("report_email", broker=redis_url, set_as_current=False)`, **기본 큐 `email`**(`task_default_queue/exchange/routing_key`).
- 워커: systemd `mindbreeze-email-worker.service`: `celery -A app.tasks.report_email_task:email_app worker -Q email --concurrency=2`, `Restart=always` (`backend/deploy/mindbreeze-email-worker.service`). 배포 시 설치·재시작은 `deploy-dev.yml:209-212,225,140`. dev 에서 `mindbreeze-email-worker` / `mindbreeze-worker` / `mindbreeze-backend` 모두 **active** 확인.
- **새 초대 메일 태스크는 `report_email_task.py` 안에 `@email_app.task` 로 등록해야 한다**(워커가 이 모듈만 로드. 파일 내 주석 `:42-` "mindbreeze-email-worker 가 이 모듈을 로드하므로 같은 앱에 등록"). 다른 모듈에 정의하면 큐에서 `unregistered task` 로 버려진다(이미 겪은 장애, `report_email_task.py:5-15` 주석).
- 호출측은 `task.apply_async(args=[...], retry=False)` 패턴(`report_email_service.py:44-47`). **브로커 실패 시 예외가 요청 경로로 올라오므로** 등록 결과(DB 행)와 발송 요청 결과를 분리하는 plan BE-7/R4 설계와 맞는다.
- 메일 관련 cron(아웃박스)은 별개: `process_email_outbox_cron.py`(1분) 가 `NotificationOutbox` → `notification_email_task` 로 넘김(`report_email_task.py:55-`). 비회원 초대는 이 경로를 못 쓴다(S8).
- 워커 미기동 감지: 큐에 쌓이기만 하므로 요청 시점에 알 수 없다. 점검 수단 제안 = `session_email_invites.status` 를 `queued`→`sent/failed` 로 갱신하고 일정 시간 `queued` 인 건을 상담사 화면에 "아직 보내지 못했어요" 로 표시(워커 헬스 API 는 `미확인`/미구현).

## 8. plan 가정과 뒤집힐 수 있는 것 (요약)

| # | plan 가정 | 조사 결과 | 필요한 결정/수정 |
|---|---|---|---|
| A1 | 스위프를 `false` 로 배포하면 원본 변동 0 | 현행 음성·영상 90일 스위프가 이미 활성(S1) | 기존 cron 대체 방식 결정(§2-3-3) |
| A2 | 삭제 방지에 FK 변경이 필요할 수 있다 | FK 무관, 앱 코드 경로가 원인(S2) | MG-4 폐기, `delete_session`·`remove_participant`·`delete_user` 변경 |
| A3 | 제외 시 상담사 리포트에서도 제외 → 1:1 이면 상담 기록이 빈다 | 상담사 리포트는 STT 전체+영상+첫 참가자 EEG(S5) | 1:1 유일 참가자 제외 시 상담사 리포트 범위 확인(정책) |
| A4 | narrative_cache 무효화 필요 | 전역 패턴 캐시(S3) | BE-3 에서 제외 |
| A5 | PPG·ACC raw 를 연구 DB 로 | PPG/ACC raw 미저장(S6) | R5-C4·BE-R3 문구 정정(파생 지표만) |
| A6 | STT 원문 삭제 = 기본 DB 삭제 대상 | 리포트 스냅샷에 `transcript_segments` 복제(§7-1) | N-2 범위 재확인 |
| A7 | 비회원 채팅도 자격으로 통일 | 채팅은 게스트 미지원(§4-2) | 5b 범위에서 채팅 분리/제외 |
| A8 | 이메일 전달 성공을 표시할 수 있다 | 접수(2xx)만 알 수 있음(§7-3) | 문구·`id` 저장 필요 |
| A9 | F2 `session_service.py:1818-1840` 가 상태 조회 | 실제 `:2179-2248` | 줄 번호 정정 |

## 9. 확인하지 못한 것

- 장비 시계(`device_timestamp_ms`)가 절대 시각 의미를 갖는지.
- 운영(prod) 환경의 스위프·스토리지: 저장소에 운영 배포 파이프라인 없음(plan F17 과 동일).
- Resend 계정의 웹훅 설정·도메인 검증 상태(코드 밖).
- dev 에서 6월~7월 생성 청크가 이미 90일 스위프로 삭제됐는지: 가장 오래된 음성/영상 청크가 2026-09-18(스냅샷 Q3/Q4)이지만 클래스는 06-10 부터 있다 — 청크가 애초에 없었는지 삭제됐는지 구분 불가(스위프 로그 `/var/log/mindbreeze-media-sweep.log` 는 0바이트, 회전 직후로 추정).
