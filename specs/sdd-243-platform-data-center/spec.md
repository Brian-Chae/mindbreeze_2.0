# SDD-243 — 플랫폼 관리자 데이터 센터

- 상태: **Stage ① Spec + HTML 디자인 시안 · Brian 결정 대기**. 제품 구현·SDD 완료 아님.
- 브랜치: `sdd/243-platform-data-center`
- 작성일 / 코드 조사 기준: 2026-10-24, 이 워크트리의 로컬 소스. 운영 DB·서버·.env·실데이터 조회 없음.
- 요청: “전체 사용자들의 데이터를 관리할 수 있는 데이터 센터 프론트가 플랫폼 관리자 화면에 필요하다.”
- 이번 산출물: 이 Spec, `designs/platform-data-center/index.html`, 합성 데이터 캡처·검증 기록. 제품 코드는 수정하지 않는다.

## 1. 배경과 권장안

현재 플랫폼 관리자는 기관·상담사·회원 계정을 관리할 수 있지만, 한 사용자의 데이터가 어디에 얼마나 쌓였고 연구 동의·보관 정리가 어느 단계인지 함께 확인하기 어렵다. 원본·파생 지표·동의·삭제 이력이 각 업무 화면과 백엔드에 흩어져 있다.

**권장: 플랫폼 관리자 전용의 조회 중심 데이터 센터를 추가한다.** 6개 탭, 테이블·검색·필터·그룹핑, 행 선택 시 우측 상세를 공통 패턴으로 사용한다. 데이터의 존재·처리·보관 상태를 관리하며 민감한 본문을 읽는 도구로 확장하지 않는다. 이름·이메일은 기존 정책대로 노출하고 연락처·생년월일은 기본 마스킹한다. 개별 개인정보 열람만 별도 인가를 거친다.

| 대안 | 장점 | 비용·위험 | 판정 |
|---|---|---|---|
| A. 통합 조회 센터 | 사용자 단위 추적과 전역 운영 확인이 한곳에 모임; 기존 도메인과 권한 유지 | 관리자용 집계·마스킹 API 필요 | **권장** |
| B. 기존 관리자 화면마다 데이터 열 추가 | 초기 변경이 작음 | 연구·보관·측정의 전역 현황이 계속 분산, 중복 조회 | 계정 관리 보조로만 유지 |
| C. 데이터 탐색·다운로드·삭제를 모두 포함 | 운영자가 한곳에서 실행 | 대량 유출·오삭제·재식별 위험, 승인·감사·복구 설계 필요 | 1차 제외 |

성공의 기준은 “찾는 사용자의 보유 데이터와 보관/연구 처리 상태를 확인할 수 있음”이다. 웰니스 점수·종합점수·순위를 만들거나 개인정보·상담내용의 접근 범위를 넓히는 것이 아니다.

## 2. 현재 플랫폼 관리자 화면·라우트·API

경로는 저장소 루트 기준이며 `파일:행`은 이 조사 시점 기준이다. UI 존재와 관리자 전역 UI 존재를 구분한다.

| 현재 화면 / 라우트 | 실제 데이터·기능 | 프론트 근거 | 백엔드 근거 |
|---|---|---|---|
| 기본 `/admin` → `/admin/orgs` | 기관 관리로 이동 | `frontend/src/App.tsx:269` | — |
| 기관 `/admin/orgs` | 기관명·유형·코드·연락처·서류 인증·상태·소속 상담사·초대, 생성/수정/비활성 | `frontend/src/App.tsx:309`, `frontend/src/pages/admin/OrgManagementPage.tsx:376`, `frontend/src/lib/api/admin.ts:169` | `backend/app/api/v1/admin.py:452` 목록, `:480` 상세, `:495` 상담사, `:539` 이후 상태/프로필 변경 |
| 가입 신청 `/admin/applications` | 기관·개인 상담사 신청, 승인·반려·초대 재발송 | `frontend/src/App.tsx:317`, `frontend/src/lib/api/admin.ts:233` | `backend/app/api/v1/signup_applications.py:91`, `backend/app/services/signup_application_service.py:363` |
| 사용자 `/admin/users` | 이름과 달리 **role=counselor 고정**. 상담사 이름·이메일·상태·인증·가입일, 정지·해제·삭제 | `frontend/src/pages/admin/UserManagementPage.tsx:66`, `:207` | `backend/app/api/v1/admin.py:212`, `backend/app/services/admin_service.py:432` |
| 회원 `/admin/clients` | **role=client 고정**, 대표 담당 상담사·계정 정보·수동 추가·정지·삭제 | `frontend/src/pages/admin/ClientManagementPage.tsx:215`, `:251` | `backend/app/services/admin_service.py:460`, `:608` |
| 검토 `/admin/reviews`, `/admin/reviews/:targetType/:id` | 상담사 자격증·기관 서류 검토, 위험도·유형 필터, 검토 액션 | `frontend/src/App.tsx:277`, `:285`, `frontend/src/pages/admin/AdminReviewDetailPage.tsx:93` | `backend/app/api/v1/admin.py:149`, `:161`, `:174`, `:187`, `backend/app/services/admin_service.py:79` |

- 플랫폼 사이드바는 기관·가입 신청·사용자·회원 4개(`frontend/src/components/layout/SidebarNav.tsx:137`). 검토 라우트는 있으나 이 4개 메뉴에 포함되지 않는다. 데이터 센터는 새 메뉴 `/admin/data-center` 제안이며 **현재 라우트 없음**.
- `GET /api/v1/admin/pipeline/backlog`: 본문 없는 파이프라인 적체 집계가 이미 있음(`backend/app/api/v1/admin.py:132`).
- `GET /api/v1/admin/sessions/{session_id}/research-consents`: 세션별 연구 동의 조회가 있음(`backend/app/api/v1/admin.py:333`). 전역 목록·필터 API와 다름.
- 연구 철회·원본 삭제 API는 이미 있음(`backend/app/api/v1/admin.py:319`, `:349`). **존재가 데이터 센터 쓰기 기능 승인 또는 상담본문 열람 권한을 의미하지 않는다.**
- 연구 배치 `GET /research-export/batches`와 ack는 서비스 토큰용(`backend/app/api/v1/research_export.py:22`, `:32`). 브라우저에 서비스 토큰을 전달하거나 그대로 연결하지 않는다.
- 표준 데이터는 Playground의 기존 관리 UI와 API가 있음(`frontend/src/pages/playground/PlaygroundPage.tsx:16`, `:156`, `backend/app/api/v1/normalization.py:54`, `:109`, `:185`). 모델 조회는 재사용 가능하나 baseline 응답의 개인정보는 축소해야 한다.

## 3. 시스템 데이터 종류 전수표

범위: 현재 `backend/app/models/*.py`, 수집/저장 서비스, 프론트 업무 UI에서 확인한 데이터 범주. PG는 PostgreSQL 모델, S3는 코드상 객체 저장소를 뜻한다. **기간 미확인 = 개별 TTL/정리 계약을 확인하지 못함이며 영구 보관을 뜻하지 않는다.** 운영 데이터의 존재·수량·설정·스토리지 용량은 확인하지 않았다.

| 데이터 종류 | 실제 테이블·저장소 | 보관 정책·제약 | 현재 UI / 데이터 센터 판정 | 코드 근거 |
|---|---|---|---|---|
| 사용자·프로필·기관 소속 | PG `users`, `client_profiles`, `counselor_profiles`, `user_org_memberships`, `client_counselor_links` | 계정 삭제 절차 별도; 링크 메모는 비공개 | 사용자·회원 관리 있음 / 보유 데이터 통합 없음 | `backend/app/models/user.py:112`, `client_profile.py:14`, `counselor_profile.py:14`, `user_org_membership.py:18`, `client_counselor_link.py:14` |
| 기관·서류·소속 요청 | PG `organizations`, `org_documents`, `org_join_requests`; 문서 S3 key | 개별 TTL 미확인 | 기관 관리·서류 심사 있음 / 메타데이터만 | `backend/app/models/organization.py:14`, `org_document.py:14`, `org_join_request.py:14` |
| 상담사 자격·경력·검토 | PG `credentials`, `qualifications`, `careers`, `verification_audits`; 파일 S3 key | 개별 TTL 미확인 | 검토 화면 있음 / 파일 원문 제외 | `backend/app/models/credential.py:14`, `:33`, `qualification.py:14`, `career.py:14` |
| 세션·클래스·진행자 | PG `sessions`, `classes`, `class_instructors`, `session_host_history`, `session_host_requests`, `session_host_notes` | 숨김·종료와 영구삭제 구분, 메모 비공개 | 상담·클래스 업무 화면 있음 / 전역 보유 목록 없음 | `backend/app/models/session.py:15`, `class_program.py:20`, `:79`, `session_parent.py:17`, `class_scheduling.py:102`, `:136` |
| 상담관계·비회원 | PG `counseling_relationships`, `counseling_guests`, `counseling_relationship_counselors/events`, `guest_claim_events` | 클래스 비회원 90일 규칙을 그대로 적용한다고 가정 금지 | 상담 업무 UI / 계정 없는 대상은 별도 범위 식별 | `backend/app/models/counseling.py:19`, `:61`, `:133`, `:152`, `:168` |
| 참여자·클래스 멤버·출석 | PG `session_participants`, `class_members`, `class_member_events`, `class_attendance_events`, `class_makeup_assignments`, `session_presence_leases` | 비회원 PII는 아래 §3.1 수명 구분 | 회차/출석 업무 UI / 회원·비회원 별도 표시 | `backend/app/models/session.py:145`, `class_program.py:99`, `:157`, `class_membership.py:18`, `:38`, `:145` |
| 비회원 인증·병합·작업 이력 | PG `class_guest_credentials/recoveries/merges/join_operations`, `class_member_operations` | credential·복구 비밀은 절대 노출 금지; canonical 병합 경계 유지 | 입장·복구 UI / 건수·상태만 | `backend/app/models/class_membership.py:63`, `:81`, `:94`, `:108`, `:119` |
| EEG 원본 | PG `eeg_raw_chunks` 업로드 원장, S3 **`.bin` 바이너리** | 통합 정책 90일·연구 ack 전 보류; 운영 활성 미확인 | 세션 측정 UI / 전역 원본 재고 없음 | `backend/app/models/record.py:118`, `:126`, `:156`, `:166`, `backend/app/services/eeg_raw_service.py:68` |
| EEG 지표·윈도우·분석 요약 | PG `eeg_records`, `eeg_feature_windows`, JSON 분석 | 원본 스위프의 지표 요약 삭제 대상 아님, 별도 기간 미확인 | 업무 그래프·리포트 있음 / 수집 완전성·보유만 | `backend/app/models/record.py:85`, `:112`, `backend/app/models/eeg_feature.py:21`, `:72`, `:98`, `backend/app/services/retention_sweep_service.py:17` |
| PPG·ACC | 클라이언트 처리·버퍼; PG `eeg_feature_windows` HRV/심박/호흡/움직임 파생 컬럼 | **독립 PPG·ACC raw 서버 저장 경로 확인 안 됨**. 파생 지표 기간 미확인 | 측정 UI 있음 / 원본 보유로 표시 금지 | `frontend/src/lib/eeg/StreamProcessor.ts:342`, `frontend/src/hooks/useBand.ts:451`, `backend/app/models/eeg_feature.py:101` |
| 음성 | PG `audio_chunks.file_path`; 실제 청크는 로컬 영속 디스크; `session_records.audio_s3_key` 필드 별도 | 대상 원본 90일. 저장 필드 이름만 보고 전부 S3라 판단 금지 | 녹음·전사 업무 UI / 재생 제외 | `backend/app/models/record.py:26`, `:49`, `backend/app/services/audio_service.py:22`, `:124` |
| 영상 | PG `video_chunks`, `session_records.video_s3_key`; S3/로컬 참조 | 호스트 카메라 녹화 계약; 대상 원본 90일 | 업무 영상 UI / 재생·URL 제외 | `backend/app/models/record.py:29`, `:63`, `:70` |
| 전사·AI 요약·상담 메모 | PG `session_records` transcript/ai_summary/counselor_notes/수정이력 | transcript·segments 원본 정리, 요약·리포트 유지; 메모 비공개 | 상담 기록 UI / 본문 일괄 비노출 | `backend/app/models/record.py:14`, `:24`, `:38`, `backend/app/services/retention_sweep_service.py:150` |
| 리포트·생성 작업·서사 캐시 | PG `reports`, `class_report_jobs/items`, `narrative_cache`; PDF URL 필드 | 원본 스위프 대상 아님, 개별 기간 미확인 | 담당자/본인 리포트 있음 / 생성 상태만 | `backend/app/models/record.py:176`, `:205`, `class_report_job.py:39`, `:75`, `narrative_cache.py:14` |
| 채팅·참여·읽음·신고·차단 | PG `chat_rooms/messages/room_participants/message_reads/reports/blocks` | 개별 TTL 미확인 | 업무 채팅 UI / 본문·신고 사유 제외 | `backend/app/models/chat.py:14`, `:33`, `:56`, `:68`, `:83`, `:113` |
| 일반·민감·EEG·녹음·리포트 동의 | PG `consents`, `session_participants` 동의 필드, `report_choice_events`, `class_member_consent_events` | 동의 유형·고지버전·철회/선택 범위를 분리, 개별 TTL 미확인 | 가입·설정·회차 동의 UI / 전역 조회 없음 | `backend/app/models/consent.py:14`, `:17`, `session.py:181`, `:230`, `:287`, `class_membership.py:130` |
| 연구 동의·철회 | PG `research_consents`, `research_consent_events`, `research_withdrawal_requests` | 미철회 유효 동의·버전·회차 범위, append-only 이력; FK cascade 없음 | 세션별 관리자 API / 전역 관리 UI 없음 | `backend/app/models/research.py:1`, `:22`, `:52`, `:80`, `backend/app/api/v1/admin.py:333` |
| 연구 내보내기 배치(SDD-241) | PG `research_export_batches/items`, S3 staging Parquet+manifest; 연구 저장소 별도 | 비식별 연구 사본 무기한 정책; 실 보관 검증 별도. 진행자 실명 포함 가능 | 서비스용 목록/ack만 / 관리자 목록 신규 | `backend/app/models/research_export.py:25`, `:47`, `backend/app/services/research_export_service.py:75`, `:586`, `backend/app/api/v1/research_export.py:22` |
| 보관 정리·원본 삭제 감사(SDD-238) | PG `retention_sweep_runs.report`, `original_deletion_audits` | 실행 이력은 대상이 사라져도 유지; 개별 TTL 미확인 | 실행 CLI/서비스·삭제 API 있음 / 목록 UI·조회 API 없음 | `backend/app/models/retention_sweep_run.py:1`, `:18`, `original_deletion_audit.py:18`, `backend/app/services/retention_sweep_service.py:300` |
| 표준 데이터(SDD-036) | PG `normalization_baselines` 눈감음/뜸 JSON·장비·성별·생일; `normalization_models` 버전/표본/분포/활성 | 개별 TTL 미확인; baseline 개인정보 제외 필요 | Playground UI/API 있음 / 안전한 baseline 투영 신규 | `backend/app/models/normalization_baseline.py:12`, `:24`, `normalization_model.py:12`, `:24`, `backend/app/api/v1/normalization.py:109`, `:185` |
| 계정 삭제 접수·원장·객체 | PG `account_deletion_requests`, `account_deletion_ledger`, `account_deletion_objects` | 공개 이메일 접수 ≠ 본인확인된 탈퇴. 원장 유예 기본30일, 스위프 기본 비활성 | 공개 접수·본인 탈퇴 UI / 전역 관리목록 없음 | `backend/app/models/account_deletion.py:63`, `:84`, `:102`, `backend/app/config.py:56` |
| 알림·푸시·리마인더 | PG `notifications`, `notification_outbox`, `device_tokens`, `session_reminder_logs` | 토큰/키 비노출; revoke 이후 행 유지, 개별 TTL 미확인 | 본인 알림 UI / 전역 운영상태 목록 없음 | `backend/app/models/notification.py:14`, `notification_outbox.py:14`, `device_token.py:1`, `:19`, `session.py:256` |
| AI 에이전트 | PG `agent_conversations/messages/relay_events/delivery_logs/counselor_settings/briefing_logs/checkin_enablements/checkin_prefs/checkins/profile_items/risk_signals/memory_items` | 대화·추론·위험신호는 민감, 개별 TTL 미확인 | AI 업무 UI / 건수·처리상태만 | `backend/app/models/agent.py:36`, `:58`, `:98`, `:136`, `:166`, `:204`, `:239`, `:270`, `:293`, `:327`, `:364`, `:402` |
| 개인 자료 내보내기 | PG `data_export_jobs/audits`, expires_at·다운로드 참조 | 만료시각 있음; 연구 내보내기와 다른 목적 | 기존 개인 반출 기능 / 다운로드·재실행 제외 | `backend/app/models/data_export.py:13`, `:36`, `:47` |
| 가입·초대·온보딩·운영 큐 | PG `signup_applications`, `client_invites`, `class_email_invites`, `session_email_invites`, `onboarding_progress`, `class_operations/effects`, `pipeline_outbox` | 초대 PII 스크럽 일부 적용; 운영 응답/본문 자유노출 금지 | 가입/초대 업무 UI, backlog API / 건수·상태만 | `backend/app/models/signup_application.py:19`, `client_invite.py:14`, `class_scheduling.py:25`, `:49`, `:72`, `session_email_invite.py:22`, `onboarding_progress.py:14`, `pipeline_outbox.py:19` |
| 인증·소셜 연결·해지 | PG `password_history`, `refresh_tokens`, `social_identities`, `social_revoke_outbox`; 임시 캐시·큐는 Redis | 만료·해지 계약별 관리. 비밀번호 해시·토큰·암호문·subject는 노출 금지 | 로그인/계정 설정 / 센터는 범주별 건수만 | `backend/app/models/password_history.py:14`, `refresh_token.py:14`, `account_deletion.py:20`, `:35`, `:46` |

### 3.1 보관 상태를 잘못 해석하지 않기 위한 규칙

1. **서비스 EEG raw는 `.bin`, 연구 export는 Parquet**. 문서의 포괄적 “EEG Raw → S3 Parquet” 설명보다 현재 저장 코드 근거를 따른다.
2. 통합 스위프 기본은 `enabled=False`, raw 90일, guest PII 90일, hold 경고14일(`backend/app/config.py:158`). 실행 하한이 없으면 기본 dry-run; 명시적 소급 예외가 있음(`retention_sweep_service.py:300`). UI에서 설정·실제 실행 상태를 추측하지 않는다.
3. 원본 후보는 종료·취소 세션, 템플릿 제외, 종료일 없으면 생성일 폴백, 숨긴 세션 포함(`retention_sweep_service.py:68`). 주석의 “클래스”라는 명칭과 달리 쿼리는 `sessions` 상태/템플릿을 기준으로 하므로 클래스만이라고 축소하지 않는다.
4. 미철회 연구 동의의 EEG는 ack 전 원본 삭제 보류(`retention_sweep_service.py:88`). **연구 사본 무기한, 서비스 EEG 원본은 ack 후 90일 규칙**이라는 SDD-238 A안 유지(`specs/sdd-238-eeg-raw-retention-90d/spec.md:20`). 음성·영상·전사에는 이 EEG 보류를 확대 적용하지 않는다(`retention_sweep_service.py:144`). 보류 제외 상태는 `acked`, `withdrawn`, `blocked_withdrawn`, `not_applicable`이며 이를 보존한다(`:43`). ack는 영구 보관·재식별 불가능성의 증명이 아니다.
5. 레거시 비회원 스크럽은 `user_id IS NULL AND member_id IS NULL` 참여자와 초대 주소(`retention_sweep_service.py:256`). canonical 클래스 비회원은 별도로 **종료/탈퇴/제외 시각과 마지막 출석 종료 중 늦은 시각+90일**, 활성 alias·시각 결측 시 보류(`class_member_consent_service.py:183`, 호출 `retention_sweep_service.py:338`). 상담 비회원 전체에 이 규칙이 적용된다고 추정하지 않는다.
6. 구 EEG 스위프 기본은 0(무기한), 구 미디어 청크는 생성일90일(`backend/app/config.py:170`, `backend/app/services/media_cleanup_service.py:125`). 통합 활성 시 구 작업을 건너뜀(`backend/app/tasks/eeg_raw_task.py:21`, `media_cleanup_task.py:22`). 운영의 실제 상태는 이번에 확인하지 않았다.
7. `run_retention_sweep(dry_run=True)`도 이력을 **쓰기** 때문에 GET 조회에서 호출하면 안 된다(`retention_sweep_service.py:324`). 후보 조회는 쓰기 없는 정책 평가를 분리해야 한다. 파일 삭제는 DB 커밋 이후 best-effort(`:343`); DB 처리완료만으로 물리 삭제 완료를 보장하지 않는다.
8. 계정 삭제는 공개 `received` 접수와 실제 탈퇴 원장 `requested → purging → purged/failed`를 별도로 표시한다(`backend/app/models/account_deletion.py:74`, `:103`). 이메일 일치만으로 접수와 계정을 자동 연결하거나 삭제예정일을 만들지 않는다.

## 4. 화면 구성과 정보 계약

### 공통

- 제안 경로 `/admin/data-center`; 플랫폼 관리자 사이드바에 추가. 데스크톱1440 중심, 좌측 내비 + 메인 테이블/필터 + 우측 상세. 390 모바일은 표 가로 스크롤·선택한 행 상세를 아래 표시하는 조회 수준.
- 검색은 식별번호·이름·이메일 등 허용 필드만, 연락처/생일 전체검색과 본문검색은 제외. 기간(KST 표시, UTC 쿼리 경계), 기관, 역할/회원유형, 데이터 종류·상태 필터. 기관/유형 그룹. 실제 UI는 서버 페이지네이션과 안정 정렬, 필터 변경 시 페이지 초기화.
- 정확히 “없음 / 미수집 / 미사용 / 미집계 / 권한상 비노출 / 처리 실패”를 구분한다. 0은 확인된 0만 표시. 알 수 없는 기관 귀속은 “귀속 확인 필요” 그룹으로 유지한다.
- 목록·상세에 `as_of`, 집계 범위·단위·미집계 사유. 원본 바이트를 합산한 값은 “메타데이터 기준 부분 집계”로 명시하고 DB 크기나 실제 버킷 총량으로 부르지 않는다.
- 개인정보 열람은 선택한 대상 1건, 행·탭·페이지·필터 변경 및 닫기/이탈 시 폐기. HTML은 합성값만 내장하고 동작을 시연한다. 실제 제품에서는 원문을 미리 내려받지 않는다.

| 탭 | 메인 테이블·필터 | 우측 상세 | 기존 근거 / 신규 필요 |
|---|---|---|---|
| 개요 | 사용자·기관·세션·측정·용량·동의·7일 임박 집계, 데이터 종류별 보유 지도 | 저장 범주, 보관 기준, 집계 범위·결측 사유 | 원천 모델 존재, 전역 집계 **신규 API 필요** |
| 사용자 데이터 | 모든 역할의 계정 + 계정 없는 참여자를 유형 구분, 기관·역할·회원/비회원 필터 | 기본 프로필, 보유 건수, 시간순 메타데이터 타임라인, 개인정보 열람 | 기존 계정 API 일부, 안전한 통합 목록·타임라인·플랫폼 열람 **신규** |
| 측정 데이터 | 세션·참여자 단위 EEG 업로드·윈도우·파생 신호 보유, 수집 품질 | 채널·샘플레이트·청크·윈도우 수, 결측/저품질 건수·시간근거 | 원장/feature 존재, 관리자 통합 조회 **신규** |
| 동의·연구 | 일반 동의 / 연구 동의 / 내보내기 배치, 버전·상태·기간 필터 | 동의 범위·철회·보류 사유 또는 배치 상태·시각·파일수/바이트 | 세션 동의 GET 부분 재사용, 전역 목록·안전한 배치 조회 **신규** |
| 보관·삭제 | 실행 기록 / 삭제 후보 / 계정 삭제 접수·원장, 모드·상태 필터 | 실행시각·cutoff·후보/처리/보류·미확인; 공개 접수와 원장 구별 | 저장 모델/서비스 존재, 읽기 API **신규** |
| 표준 데이터 | 모델 이력 / 기준 측정, 버전·상태 필터 | 표본수·활성 상태·수집구간·파이프라인 메타 | 모델 GET 재사용, baseline 개인정보 축소·페이지네이션 **신규 어댑터** |

### 집계 단위와 가정

- 사용자 수: `users` 고유계정, 계정 없는 참여자는 별도 수. 기관 수는 필터된 organizations. 세션 수는 `sessions`의 템플릿 제외 회차. 숨김·탈퇴 데이터의 잔존 현황은 별도 상태로 포함하며 업무의 활성 수와 구분.
- 측정 보유 1건: 세션+참여자 조합에서 raw 업로드 완료 또는 feature가 있는 경우. 둘 다 있으면 중복하지 않는다. 참여자 연결 없는 레거시는 별도 미연결 그룹. 밴드 미사용은 실패 아님.
- 동의 비율: **유효 연구동의 건수 / 연구동의 평가 대상 참여자-회차 수**. 동의 이벤트 행 수를 분모로 쓰지 않는다. 철회·구버전·확장동의 범위를 분리하고 0분모는 해당 없음. 화면의 310/500, 62%는 합성 예시.
- 저장량: 업로드 완료 EEG `size_bytes`, 연구 배치 `total_bytes`는 각각의 영역으로만 집계. 로컬 음성·영상/DB/실제 연구 저장소는 미집계 사유를 표시. 서비스 원본과 연구 사본을 합쳐 유일 데이터 용량으로 부르지 않는다.
- 품질은 `quality`, `signal_quality`, 업로드 상태, 윈도우/청크/결측 건수 등 기술적 수집 품질. 생체지표 수치·건강 판정·종합점수·순위는 1차에서 모두 제외. 측정 시각 근거 없으면 null+사유, 입장/업로드시각으로 대신하지 않는다.
- 계정과 비회원은 `subject_type + subject_id + scope`로 식별. 기존 canonical/claim 관계만 이용하고 이름·이메일로 추정 병합하지 않는다. 다중기관 사용자는 기관별 합계에서 중복 가능함을 표시. 기존 회원 개요의 non_member는 “담당 상담사 미연결 회원” 의미도 있으므로 계정 없는 guest와 동일시하지 않는다.

## 5. 권한·개인정보 경계

### 확인된 정책과 구현 차이

- 플랫폼 권한은 FE `PlatformAdminRoute`와 BE `require_platform_admin`의 DB role 검사(`frontend/src/App.tsx:145`, `backend/app/api/v1/admin.py:56`). 데이터 센터 API도 모든 호출에서 인증·역할·활성 상태를 재검사하도록 설계한다. 기관관리자·상담사·회원·게스트는 접근 불가.
- **이메일 원문 유지, 개인정보 열람 감사 DB는 출시 이후**가 후속 확정 결정(`specs/sdd-230-member-overview/spec.md:137`). 초기 같은 문서의 이메일 마스킹 제안보다 후속 결정을 우선한다.
- 기존 회원 API는 이름·이메일을 반환하고 전화/생일 원문 제거 + 마스킹(`backend/app/services/client_service.py:155`, `client_overview_service.py:588`). `ClientProfilePage.tsx:243`에 개별 열람 버튼이 있다. 이름까지 마스킹한다는 정책으로 확대하지 않는다.
- 기존 열람은 매번 권한 검사, 열람자/대상/시각/필드명만 logger 기록(`backend/app/services/client_overview_service.py:617`). **영속 DB 감사라고 부르지 않는다.** 플랫폼 역할은 기존 `/clients/{id}/contact-reveal` 허용 대상이 아니므로 전용 endpoint 필요(`backend/app/api/v1/client.py:62`).
- 반면 현재 `/admin/users` 응답은 전화번호 원문을 포함한다(`backend/app/services/admin_service.py:489`). 이 응답을 그대로 받고 CSS로 가리는 방식은 금지. 기존 API 변경은 이번 Spec 범위가 아니며 제품 구현 때 전용 DTO로 방지한다.
- 기관관리자의 활동 범위 확대에도 상담 세션·상담사용 리포트·타 상담사 비공개 메모 제외(`specs/sdd-230-member-overview/spec.md:149`, `:151`, `:156`). `session_authz.py:128`의 민감자료 인가를 우회하지 않는다. 플랫폼 관리자라는 이유만으로 본문을 보여주지 않는다.

| 정보 | 1차 화면·API 계약 |
|---|---|
| 사용자 ID·이름·이메일·역할·상태·기관 | 기본 노출. 스크럽된 비회원은 이름/이메일 복원하지 않음 |
| 연락처·생년월일 | 기본은 마스킹/원문 없음. 개별 열람 재인가 시 존재하는 필드만 일시 반환 |
| 동의 유형·고지 버전·철회·시간·처리 상태 | 조회 허용. 사유 자유문/본문은 제외 |
| EEG·PPG·ACC·음성·영상·전사·리포트·채팅·AI | 존재·건수·시각·상태만. 본문·원시값·재생·다운로드·미리보기 없음 |
| 상담 기록·비공개 메모·상담사용 리포트·AI 위험신호 | 본문과 내용 기반 추론 모두 비노출. 개인정보 열람으로 해제되지 않음 |
| S3 key/prefix, 파일 경로, presigned URL, manifest 원문, 토큰·인증정보 | 응답 DTO에서 제외. 오류는 허용된 코드·설명으로만 표시 |
| 연구 가명 ID·HMAC·진행자 실명 메타데이터 | 연구 배치 상세에서 개인 프로필로 역연결하지 않음. 번들·진행자 명단·원본 ID 교차표 미노출 |
| 표준 baseline 생년월일·장비 ID·개별 feature | 목록/상세에서 제외. 기준 측정 ID·구간·파이프라인·생성시각만 |

연구 사본은 참여자 HMAC 가명화이지만 SDD-241 확장에는 진행자 실명·실제 계정 ID가 포함된다(`research_export_service.py:75`, `:586`). 새 r5-2 고지 확인 이후 회차만 확장, 구버전은 구범위, 자동 재반출 금지. 진행자 이용/외부 제공 근거·운영 승인은 별도 미확인 위험으로 남아 있다(`specs/sdd-241-research-export-metadata/spec.md:36`). 데이터 센터에서 이를 해결된 법적 적합성으로 표시하지 않는다. 이는 기존 코드·결정 확인이며 새로운 법률 검토가 아니다.

## 6. 필요한 신규 API — 제안 15개

모두 `/api/v1/admin/data-center` 아래. **14개 GET + 개별 개인정보 열람 POST 1개**. 15개는 라우트 제안 수이며 실제 구현 분리는 Plan에서 확정한다. 공개/기관 API를 우회 호출하지 않는다. 아래의 집계·투영은 기존 모델에서 계산하되, 없는 운영·용량 정보는 `null + unavailable_reason`을 반환한다.

| # | 메서드·제안 경로 | 목적·핵심 응답 | 신규인 이유 |
|---|---|---|---|
| 1 | GET `/summary` | 전역 KPI, 단위·분모·as_of·부분집계 | 통합 집계 없음 |
| 2 | GET `/inventory` | 데이터 종류별 건수·저장 범주·정책·미집계 | 관리용 인벤토리 없음 |
| 3 | GET `/subjects` | 전체 역할 계정/비회원, 기관 필터, 마스킹 프로필·보유 요약 | 현 admin/users는 역할 분산·PII 원문 |
| 4 | GET `/subjects/{subject_type}/{subject_id}/holdings` | 범위가 있는 메타데이터 타임라인·종류별 보유 상태 | 사용자 데이터 통합 없음 |
| 5 | POST `/subjects/{subject_type}/{subject_id}/contact-reveal` | 재인가 후 연락처·생년월일만, Cache-Control no-store | 현 열람 API는 counselor/org_admin 전용 |
| 6 | GET `/measurements` | 세션·참여자 측정 보유/기술 품질·기간 필터 | 전역 측정 조회 없음 |
| 7 | GET `/measurements/{session_id}/{participant_id}` | raw/feature 수·시각 근거·결측 사유 | 관리자용 최소 메타 투영 없음 |
| 8 | GET `/consents` | 일반/연구 scope, 고지·선택·철회·export 상태, 페이지네이션 | 기존은 세션 단위 연구 동의만 |
| 9 | GET `/research-batches` | 배치 상태·시각·바이트·파일수·재시도 | 기존은 서비스 토큰 API |
| 10 | GET `/research-batches/{batch_id}` | 안전한 상세·이력·정제 오류, 가명키/개인 조인 제외 | manifest/S3 키 없는 관리자 DTO 필요 |
| 11 | GET `/retention-runs` | dry_run/execute·상태·시각·요약 수치 | 이력 저장 모델만 있음 |
| 12 | GET `/retention-runs/{run_id}` | 저장된 report의 allowlist 투영·cutoff·보류·실패 | 자유 JSON·오류 원문 노출 방지 |
| 13 | GET `/retention-candidates` | 기준시각의 삭제 후보/기한임박/연구보류, 평가 사유 | **쓰기 없는 평가 서비스 신규 필요**, 실행 함수 호출 금지 |
| 14 | GET `/account-deletions` | `source=request/ledger`, 접수/원장 상태·유예·보존사유, 객체 처리 건수 | 접수와 탈퇴 원장 분리된 관리자 목록 없음 |
| 15 | GET `/baselines` | 개인정보 없는 baseline 목록·최소 메타·필터/페이지 | 기존 baseline API 존재하나 PII 포함; 안전한 어댑터 |

재사용 후보(신규 15개에 미포함): `GET /api/v1/normalization/models`, 보조 상태 `GET /api/v1/admin/pipeline/backlog`, 단일 세션 동의 `GET /api/v1/admin/sessions/{session_id}/research-consents`. 연구 서비스 token·ack·실행 CLI는 재사용 UI에서 제외한다.

공통 계약: 역할/활성 상태 검사, cursor+limit(기본25·최대100 제안), 안정 정렬(시간+ID), KST 입력을 UTC로 변환, 허용 검색/정렬/그룹 필드, 선택한 페이지의 전체 건수 의미 명시. PII 원문·원시 feature·자유 JSON을 bulk 반환하지 않는다. 개인정보 POST는 사용자 데이터 변경은 없으나 민감 접근 로그를 남기는 예외임을 명시한다. 로그는 원문 없이 actor/target/시간/필드/허용결과, DB 감사 추가는 출시 이후. 원문 클라이언트 캐시·URL·localStorage·분석 로그 저장 금지.

## 7. 단계별 범위·위험

| 단계 | 포함 | 제외·위험 |
|---|---|---|
| 이번 작업 | 코드 근거 Spec, 합성 HTML 시안·캡처·검토, 요청한 docs 커밋/작업 브랜치 push | 제품 코드·Plan/Verify 사후 작성·SDD 완료 선언 없음; 서버/DB/.env/실데이터/메일/삭제/배포 없음 |
| 1차 구현 제안 | 6탭 조회, 안전한 API15개, 모델 조회 재사용, 개별 인적사항 열람, 조회 상태/결측/권한 UX | CSV·파일 다운로드·재생·삭제·수정·연구 철회/재실행/ack·모델 재계산/활성화 제외 |
| 후속 선택 | 집계 전용 CSV, 상세 저장량 수집, 운영 알림 조회 고도화 | 내보내기는 식별정보 결합·대량유출 위험; 별도 동의/권한/만료/감사 요구 결정 후 설계 |
| 별도 승인 과제 | 삭제/정리 실행, 동의변경, 연구재반출, 표준모델 변경 | 비가역 삭제·연구 보류 해제·리포트 변화. 대상 미리보기·승인·감사·실패/복구 계약 필요. 이번에 버튼조차 연결하지 않음 |

제품 구현 승인 뒤 Plan → **구현 전 Verify** → Implement/Test/Summary 순서. 이번 Spec/시안 승인과 제품 구현 완료·배포 승인을 혼동하지 않는다.

## 8. 완료 조건

### 이번 Spec·시안 인계

- 현재 관리자 화면·API와 데이터 범주별 테이블/저장소/보관/UI를 파일:행으로 확인.
- 기존 개인정보 정책과 admin API 원문 반환 차이, 상담 비공개·연구 재식별·보관 미확인 경계를 문서화.
- 자체완결 `index.html`: 외부 요청 없음, 합성 사용자·기관·수치·이메일(example.invalid), 보라 #5B1A8A·크림·흰 패널, 6탭과 각 하위 화면, 마스킹/열람/빈 상태/390 모바일.
- Playwright로 1440/390 캡처, 가로 페이지 넘침·구성요소 겹침·텍스트 잘림 검사, 검색·필터·그룹·열람 후 재마스킹·모바일 상세 확인. PNG를 직접 열어 시각 점검.
- 변경 경로가 `specs/sdd-243-platform-data-center/`, `designs/platform-data-center/`뿐임을 확인하고 docs 커밋·해당 브랜치 push. PR 머지/배포 없음.

### 후속 제품 구현의 인수 기준(아직 실행하지 않음)

- [ ] 기관관리자/상담사/회원/게스트/비활성 계정의 새 API 접근 차단, ID 변경·행/탭 전환 재인가 검증.
- [ ] 기본 응답과 캐시에 전화·생일 원문, 상담본문·토큰·저장소 경로가 없고 열람 응답만 제한된 필드 반환.
- [ ] 회원/비회원·canonical/claim·다중기관·귀속미상·탈퇴 데이터가 중복/오병합 없이 집계.
- [ ] 개요·목록·상세가 같은 기준시각/필터에서 일치, 0과 미집계·원본 없음·밴드 미사용 구분.
- [ ] EEG 바이너리와 연구 Parquet, PPG/ACC 파생·raw 미확인, baseline 개인정보 축소 검증.
- [ ] 연구 구고지/r5-2/철회·ack 이전 보류·기한임박 구분, 가명-사용자 역연결 및 확장 자동반출 없음.
- [ ] retention GET이 DB/파일/알림을 변경하지 않음; stored dry-run 결과와 실제 실행 구분; 공개 삭제접수와 탈퇴원장 구별.
- [ ] 실 브라우저1440/390와 실제 권한별 API 응답 확인. 데이터 정합성은 합성 DB fixture로 별도 검증 후 승인된 환경에서 운영 검증.

## 9. Brian 결정 질문 — 3개

1. **1차를 조회 + 개별 인적사항 열람으로 확정할까요?** 권장: CSV·원본 다운로드·수정·삭제·연구 실행 제외. 대안: 집계 CSV부터 포함하되 반출 계약/감사 범위 추가.
2. **조회 대상에 계정 없는 참여자까지 포함할까요?** 권장: 모든 역할의 사용자 + 비회원 포함, 유형·범위 구분 및 기존 canonical/claim 관계만 연결. 대안: 1차는 로그인 계정만; 비회원 연구·보관 사각지대가 남음.
3. **개인정보 범위는 기존 회원 정책을 유지할까요?** 권장: 이름·이메일 노출, 전화·생일 개별 열람, 상담/채팅/AI/미디어 본문은 계속 비노출, DB 열람 감사는 출시 이후. 대안: 전화·생일 원문 열람도 1차 제외.

질문은 향후 제품 범위 확정을 위한 것이다. 지금 요청받은 Spec·합성 시안·커밋·push 수행을 막는 승인이 아니다.

## 10. 시안·검증 근거

- 진입: `designs/platform-data-center/index.html` (파일 직접 열기, `?tab=users` 등 지원).
- 재현: `node designs/platform-data-center/capture.mjs` (로컬 Playwright 또는 기존 메인 체크아웃의 설치본, Chrome headless 사용). 서비스 서버를 띄우지 않음.
- 캡처: `designs/platform-data-center/captures/`; 자동 점검 결과 `capture-results.json`, 사용법·확인 범위 `README.md`.
- 외부 폰트/이미지 호출 없이 로고와 한국어 폰트 subset을 HTML 내장. Pretendard 설치 시 우선, 미설치 환경은 저장소 Noto Sans KR 폰트 사용. 디자인 시스템의 보라/크림·한국어 UI 원칙을 적용하되 요청한 자체완결 HTML을 우선.
- 표/집계의 값은 **전부 합성 예시**. 시안 상호작용·레이아웃 검증은 실제 API·보관 실행·개인정보 보호의 제품 검증이 아니다.
