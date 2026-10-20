# SDD-220 Plan — 앱 스토어 심사 대비와 출시 막바지 준비

- 상태: Stage ② Plan — 구현 전 계획
- 정본: `specs/sdd-220-store-review-readiness/spec.md:1` (승인된 D1~D15·E1~E5·F1~F3·§9 적용)
- 기준 커밋: `27c2013c`; 브랜치: `sdd/220-store-review-readiness`; 조사일: 2026-10-20.
- 작성 범위: plan·verify만. 구현·실제 DB 조회·시드 실행·메일 발송·배포를 수행하지 않았다.
- 기존 219의 아키텍처 → 변경 지점 → 순서/위험 → 검증 형식을 확장했다. 여기서 새로 정한 API 오류코드·파일명은 **구현 제안 계약**이며 Brian의 추가 결정/승인 기록이 아니다.

근거 감사: `docs/reviews/prelaunch-audit/01-store-policy.md:1`(스토어/네이티브), `docs/reviews/prelaunch-audit/02-legal-privacy.md:1`(동의/보관), `docs/reviews/prelaunch-audit/03-security-backend.md:1`(API/인증), `docs/reviews/prelaunch-audit/04-app-runtime.md:1`(번들/실기기), `docs/reviews/prelaunch-audit/05-ugc-account-ops.md:1`(UGC/운영). 감사의 당시 운영 상태는 현재 확인 결과로 간주하지 않는다.

## 1. 아키텍처

### 1.1 공통 원칙

6개 트랙은 파일 단위로 독점 소유한다. Task 0 감독자가 공유 설정·라우트·메뉴 계약을 먼저 커밋한 뒤 트랙을 시작한다. 아직 없는 컴포넌트는 기반 커밋에 컴파일 가능한 최소 인터페이스를 함께 두거나, 최종 연결을 감독자가 순차 커밋한다. 다른 트랙은 공유 파일을 직접 수정하지 않고 요청 목록을 전달한다. 마이그레이션은 저장소 규칙에 따라 **ⓒ 한 워커만 두 개 모두 작성**한다.

AI 플래그는 FE `isAiEnabled()`와 BE `AI_FEATURES_ENABLED=false`를 기본값으로 한다. 상담 플래그와 독립이며 AI=true가 상담 비공개를 해제하지 않는다. E1에 따라 녹음·영상·업로드·원본 저장·영상 병합·EEG 계산·리포트 생성/승인/발송은 유지한다. STT·요약 작업만 큐에서 빼고, 서사·코멘트는 기존 규칙 출처로 생성한다. SDK의 EEG 수치 계산은 외부 LLM 호출과 구분한다.

인증은 Apple 공급자 sub를 별도로 저장하고 이메일만 같다는 이유로 기존 계정에 자동 연결하지 않는다. 신규 가입의 생년월일·필수 동의 검증을 이메일/Google/Apple 및 기존 가입 신청/초대 완료 경로에서 공통화한다. 기존 소셜 사용자의 재로그인에는 생년월일을 다시 요구하지 않는다. 계정 삭제는 즉시 접근 차단과 탈퇴 시각+30일 영구 삭제를 분리한다.

### 1.2 단일 AI 정책 가드와 호출 전수표

단일 정책 위치: 신규 `backend/app/core/ai_features.py:1` (추정)의 `is_ai_enabled() -> bool`, `require_ai_enabled() -> None`, `AiFeaturesDisabled`. 설정은 호출 시 읽고 import 시 값 캐싱 금지. HTTP 의존성은 이를 403 `AI_FEATURES_DISABLED`로 매핑한다. 네트워크 직전 모든 transport도 같은 가드를 호출해 API 우회·이미 큐에 든 작업·inline 실행을 막는다. 가드 예외는 공급자 장애 재시도로 취급하지 않는다. API 라우터는 유지하고 각 AI 라우터에 dependency를 적용한다(재공개 시 재등록 차이 방지).

검색 범위: `backend/app/services`, `backend/app/tasks`, `backend/app/api` 전체 `.py`. 검색식 `generateContent|generate_content|chat.completions|responses.create|requests.post|httpx.post|httpx.stream|audio/transcriptions|agent_llm\.`. transport 6개와 호출자 목록을 대조했다. 푸시·Resend·OAuth의 HTTP 호출은 LLM이 아니므로 제외한다. 아래는 현재 코드 기준이며 신규 호출 추가 시 이 표와 호출 0건 테스트를 함께 갱신한다.

| 영역 | 실제 근거 파일:줄 | off 처리 / 소유 |
|---|---|---|
| Gemini 스트리밍 | `backend/app/services/agent_llm.py:185` | 네트워크 직전 공통 가드; ⓑ |
| Gemini 멀티턴 | `backend/app/services/agent_llm.py:234` | `_call_gemini_chat` 가드; ⓑ |
| Gemini 코멘트/단일턴 공유 | `backend/app/services/report_comment_service.py:255` | `_call_gemini` 가드, `_generate_draft`는 `(draft, "rule")`; ⓑ |
| Gemini STT | `backend/app/tasks/stt_task.py:58` | `_gemini_request_once` 가드, retry/Whisper 폴백 0건; ⓑ |
| OpenAI Whisper | `backend/app/tasks/stt_task.py:142` | `_call_whisper` 가드; ⓑ |
| Gemini 요약/서사 | `backend/app/tasks/summary_task.py:53` | `_call_gemini_text` 가드; ⓑ |
| 루시 API·대화 | `backend/app/api/v1/agent.py:99`, `backend/app/services/agent_service.py:701` | 403, 대화/스트림/도구 실행 차단; ⓑ |
| 상담사 API·대화 | `backend/app/api/v1/agent_counselor.py:1`, `backend/app/services/agent_counselor_service.py:286` | 403, 브리핑/위험 조회 진입도 닫음; ⓑ |
| 기억/프로필 추출 | `backend/app/services/agent_memory.py:69`, `backend/app/services/agent_profile.py:147` | 추출 작업 skip, 외부 호출·신규 추출 행 0; ⓑ |
| 체크인/브리핑 예약 | `backend/app/services/agent_checkin.py:589`, `backend/app/services/agent_checkin.py:724`, `backend/app/services/agent_checkin.py:804`, `backend/app/services/agent_briefing.py:311` | sweep/close_stale/응답/요약 모두 skip, 자동 AI 메시지·알림 0; ⓑ |
| 리포트 대화 자동 발행 | `backend/app/services/agent_report_chat.py:35`, `backend/app/services/agent_report_chat.py:139` | 승인 후 루시 대화 생성 skip; 일반 리포트 알림 유지; ⓑ |
| 오디오 파이프라인 | `backend/app/services/audio_service.py:206` | STT·summary signature 0, video merge와 report signature 유지; ⓑ |
| STT/요약 inline·Celery | `backend/app/tasks/stt_task.py:490`, `backend/app/tasks/summary_task.py:257` | 이미 적재된 작업도 skipped, retry 0; ⓑ |
| 서사 캐시·업그레이드·리포트 | `backend/app/tasks/summary_task.py:95`, `backend/app/tasks/upgrade_narrative_cache.py:14`, `backend/app/tasks/report_task.py:357` | off에서 LLM 캐시도 읽지 않고 `fallback_narrative` 적용; upgrade 0건; ⓑ |
| 규칙 폴백 | `backend/app/services/report_narrative.py:129`, `backend/app/services/report_comment_service.py:278` | 의료 오인 문구 정리, source=rule 유지; ⓑ |

off의 오디오 상태는 저장 완료를 나타내는 `completed`로 마감하고 transcript/ai_summary를 새로 만들지 않는다. 기존 저장 전사를 일괄 삭제하지 않는다. `manual`은 마이크 미사용 의미를 보존한다. 서사 캐시 source=llm이 있어도 새 리포트 생성은 rule; 이미 발행된 과거 리포트를 무단 재작성하지 않는다.

프론트 검색식: `AI|루시|Lucy|agent|AISummary|RecordView|ENABLE_STT_AI_RECORD` (`frontend/src`, design/테스트/주석 제외, 실제 렌더 문자열·effect·라우트 확인).

| 진입점·문구 묶음 | 실제 근거 | off 처리·독점 소유 |
|---|---|---|
| 라우트·사이드바 | `frontend/src/App.tsx:191`, `frontend/src/components/layout/SidebarNav.tsx:1` | `/agent`, AI 딥링크는 역할 홈/채팅 목록 replace; 미읽음/체크인 조회 0; Task 0 |
| 회원 shell·하단 탭 | `frontend/src/components/client/ClientShell.tsx:51`, `frontend/src/components/client/BottomTabBar.tsx:39` | unread 조회·배지 0; ⓑ |
| 채팅 루시 채널 | `frontend/src/pages/chat/ChatPage.tsx:45`, `frontend/src/pages/client/ClientChatPage.tsx:47` | 루시 행·embedded agent 제거, 일반 채팅 유지; ⓓ가 ⓑ 계약 소비 |
| 대시보드·회원 홈·구 경로·회원 상세 | `frontend/src/pages/DashboardPage.tsx:308`, `frontend/src/pages/client/ClientHomePage.tsx:494`, `frontend/src/pages/client/ClientAppPage.tsx:253`, `frontend/src/pages/clients/ClientProfilePage.tsx:1` | AI CTA/체크인 패널·조회 0; 상담 플래그도 적용; ⓑ |
| AI 화면 subtree | `frontend/src/pages/client/ai-agent-page.tsx:1`, `frontend/src/pages/agent/counselor-agent-page.tsx:86`, `frontend/src/pages/agent/risk-signals.tsx:1` | 부모 gate로 mount 0 (파일 자체 수정 불필요); ⓑ 검증 |
| 기록·리포트 | `frontend/src/pages/records/SessionRecordPage.tsx:301`, `frontend/src/components/reports/ClientReportViewer.tsx:89`, `frontend/src/components/reports/ReportDetailView.tsx:227`, `frontend/src/components/reports/CounselorCommentCard.tsx:58` | AI 탭/전사 진입 숨김, 수동 메모·영상 유지, “초안” 표기; ⓑ |
| 진행·완료·목록 | `frontend/src/components/session/ReportProgressStepper.tsx:78`, `frontend/src/components/reports/ReportStatusBadge.tsx:70`, `frontend/src/pages/reports/ReportListPage.tsx:521`, `frontend/src/pages/reports/ReportDetailPage.tsx:31`, `frontend/src/components/class/flow/member/EndView.tsx:68` | AI 대기 문구 제거, 규칙 리포트 상태 표시; ⓑ |
| 호스트 녹음·동의 | `frontend/src/components/class/flow/host/wizard-steps.tsx:161`, `frontend/src/components/session/ConsentModal.tsx:30` | 녹음 기능 유지, AI 문구만 분기; wizard ⓑ / ConsentModal ⓒ |
| 회원 입장 고지 R1/F1 | `frontend/src/components/class/flow/member/NoticeStepView.tsx:86` | “녹음”, “이 클래스는 녹음·녹화될 수 있어요” 필수 체크; ⓒ |
| 랜딩/소개 | `frontend/src/pages/LandingPage.tsx:61`, `frontend/src/components/landing/Nav.tsx:4`, `frontend/src/components/landing/Hero.tsx:36`, `frontend/src/components/landing/ProcessSection.tsx:6`, `frontend/src/components/landing/PeopleSection.tsx:5`, `frontend/src/components/landing/CTASection.tsx:5` | AI 기능 제공 약속 제거/분기 + 결제 문구 정리; ⓔ |
| 레거시 플래그 | `frontend/src/lib/features.ts:1`, `frontend/src/components/reports/SessionReplayPanel.tsx:17` | 기존 STT 비공개 조건과 isAiEnabled AND; replay 영상은 유지; ⓑ |

추가 예약 경계: `backend/app/services/agent_reminder.py:300`, `backend/app/tasks/agent_task.py:17`은 직접 LLM transport는 없지만 루시 메시지를 생성하므로 off에서 skip한다. 일반 클래스 리마인더는 유지한다.

### 1.3 인증·F1·선택 동의 계약

Apple은 기존 의존성 `@capgo/capacitor-social-login`의 Apple 공급자를 사용한다. `frontend/src/lib/native/google.ts:16`의 initialize를 공통화해 Google/Apple 설정이 서로 덮어쓰지 않게 한다. 웹도 공급자의 웹 플로우를 사용하되 설치된 버전의 nonce·authorizationCode 반환 타입을 구현 전 확인한다(현재 worktree node_modules 없음, 이 부분은 추정). nonce 전달이 지원되지 않으면 서버 시작 challenge + Apple 웹 redirect 방식으로 대체하고 클라이언트 임의 nonce를 신뢰하지 않는다.

`POST /api/v1/auth/apple`: Apple JWKS RS256 allowlist·iss·확정 bundle/service aud·exp·일회용 nonce 검증. 서버 발급 challenge를 브라우저/앱 로그인 세션에 묶고 성공 후 소비. authorization code 교환으로 revoke용 refresh token을 얻어 암호화 저장(토큰/키 로그 금지). sub 고유성, private relay 주소, 최초 이름 저장을 보장한다. 신규 약관/생년월일 누락은 422, 신규 생성만 검사하며 재로그인은 200. 위조/만료/nonce 재사용은 401 `APPLE_TOKEN_INVALID`; 공급자 장애는 503 `APPLE_UNAVAILABLE`. 동일 이메일 기존 계정은 재인증 연결을 요구하고 자동 병합하지 않는다.

생년월일은 User 공통 Date 컬럼에 추가하되 기존 ClientProfile.birth_date와 이중 진실이 되지 않게 가입·프로필 변경을 공통 서비스로 동기화한다. 기존 사용자에게 임의 생일을 채우지 않는다. 서버 기준일은 Asia/Seoul 달력 날짜, 생일 당일 만14세 허용; 미래/잘못된 날짜 422 `INVALID_BIRTH_DATE`, 미입력 422 `BIRTH_DATE_REQUIRED`, 미달 422 `AGE_RESTRICTED`. 기관/진행자 신청·초대 완료를 통한 신규 계정 생성도 우회하지 못하게 검증한다.

동의: tos/privacy/클래스 기록 sensitive는 필수, eeg/research는 독립 선택. 기존 `consents.version` 컬럼은 재사용하고 게시 버전 상수와 일치시킨다(신규 컬럼 재생성 금지). 생년월일·탈퇴 시각·Apple 주체/암호화 토큰·철회/삭제 원장·회차 녹음/녹화 notice_version/동의 시각의 추가 스키마만 0059에 넣는다. 재동의 게이트는 범위 밖.

F1은 리포트 반영/연구 선택과 분리한다. 회원·게스트 모두 회차별 `recording_consented=true`, `recording_notice_version` 저장 성공 이후에만 입장/LiveKit 토큰 발급을 허용한다. 누락·거부·저장 실패 시 403 `RECORDING_CONSENT_REQUIRED`, 다음 단계/토큰/미디어 업로드 0. 초대 직입장·재접속·구 enter/join API도 같은 검증을 통과해야 한다. 기존 consent_audio만으로 영상 동의까지 추정하지 않는다. 연구 미동의·report excluded는 F1 충족 시 입장을 막지 않는다. 뇌파 미동의면 밴드 연결 사전 선택 UI와 서버 EEG 업로드 권한에서 차단한다. 기존 `backend/app/services/session_service.py:3213`의 consent_eeg는 리포트/내보내기 의미가 섞여 있으므로 수집 동의로 재해석하지 않는다. 신규 `eeg_collection_consented`·버전/시각을 회차 참여자에 구분 저장하고 계정 선택 철회와 동기화한다. `resolve_upload_participant` 공통 가드로 REST raw/feature 및 WS 경계를 막되 리포트 제외만으로 수집을 차단하지 않는다.

### 1.4 탈퇴와 사용자 단위 영구 삭제

`DELETE /api/v1/users/me`는 auth prefix 밖 account router로 제공한다(기존 `auth.py:947`의 `/auth/users/me`와 혼동 금지). 비밀번호 또는 5분 이내 소셜 재인증 proof 필요. 성공 204 + refresh cookie 만료, 로컬 토큰/스토어/푸시 등록 제거. User 행 lock 후 단독 기관 관리자(409 `SOLE_ORG_ADMIN`)·미래 scheduled 회차 진행자(409 `SCHEDULED_SESSIONS_EXIST`)를 검사하고 다른 관리자 지정/회차 정리 안내를 반환한다. 기관 계정도 관리자 승인 없이 본인 실행 가능.

재사용: `backend/app/services/admin_service.py:730`의 deleted 상태, `_ACCOUNT_ACCESS_TABLES` 접근권한 정리와 세션 숨김 일부를 트랜잭션 내부 helper로 추출한다. 기존 함수의 내부 commit, 모든 기관 참조를 한꺼번에 NULL로 만드는 UPDATE, `mark_needs_reassign`을 본인 탈퇴에서 무조건 호출하지 않는다. 관리자 삭제 API의 기존 의미는 별도 회귀로 유지한다. `_purge_user_hard`(:774)는 호스트 세션과 타 참여자 데이터를 삭제하므로 **직접 호출 금지**. `media_cleanup_service.delete_user_media`(:94)도 호스트 전체 미디어 삭제/best-effort이므로 사용자 스위프에서 그대로 호출 금지.

즉시 `status=deleted`, `deleted_at=UTC now`, `purge_after=deleted_at+30일` 기록. 로그인·refresh·기존 access token·이미 연결된 WS·미디어 읽기/쓰기 재검사, push token/web push 해지. 30일 동안 명단과 채팅 sender를 “탈퇴한 사용자”로 표시, 프로필 식별정보 외부 노출 금지. Apple revoke/Google 연결 해제는 재시도 가능한 outbox로 기록하고 실패해도 로컬 접근 차단을 되돌리지 않는다. 성공 건은 재호출하지 않으며 미완료를 운영에서 추적한다. 연구 철회 원장을 먼저 만들어 Spark 확인 전 근거를 잃지 않게 한다.

스위프는 기존 `backend/app/services/retention_sweep_service.py:300`(세션 종료일/90일)과 별도 `account_deletion_sweep_service.run_account_deletion_sweep(now, execute=False)`로 구현한다. due 기준은 UTC `now >= purge_after`. S3/외부 revoke/연구철회가 DB 트랜잭션과 원자적이지 않으므로 사용자·객체별 삭제 원장→재시도→확인→DB 정리 순서. 미디어 실패 시 키/행을 잃거나 purge 완료로 표시하지 않는다. dry-run은 모든 변경/외부 호출 0. 기존 90일 보관 정책을 30일 정책으로 덮어쓰지 않는다.

F2: deleted 계정 이메일은 정규화 후 전체 가입 경로에서 409 `ACCOUNT_DELETION_PENDING`, “탈퇴 처리 중인 이메일” 안내. 날짜만 30일 넘었으나 purge 미완료면 계속 차단한다. 영구 삭제 완료 후에만 새 UUID 신규 가입; 구 토큰/Apple sub 자동 복구 금지. 재생성 시드도 이 제한을 우회하지 않는다.

`/account-deletion` 공개 페이지는 이메일 접수 API(202 `{accepted:true}`)와 운영 메일 outbox를 사용한다. 계정 존재 여부에 관계없이 동일 응답, IP/이메일 rate-limit 429, 메일 장애 시 요청을 보존하고 재시도한다. 공개 폼만으로 계정을 삭제하지 않으며 별도 본인 확인 후 처리한다.

#### 삭제 대상 테이블 전수 대조

아래는 모델의 FK뿐 아니라 FK 없는 UUID·JSON을 포함한 대조 목록이다. “보존”은 다른 사람/기관 데이터 또는 비식별 집계만 의미한다. 법정 보관이라는 이유로 임의 무기한 보관하지 않으며 법무가 항목·근거·만료일을 확정하지 않은 부분은 제출 차단 항목으로 둔다. 구현 시 SQLAlchemy metadata의 모든 users/participants/session FK 목록과 이 표를 비교하는 누락 테스트를 둔다.

| 대상 테이블/열 | 코드 근거 | 즉시 / 30일 처리 |
|---|---|---|
| users; refresh_tokens, device_tokens, password_history, onboarding_progress | `backend/app/models/user.py:107`, `backend/app/models/refresh_token.py:14`, `backend/app/models/device_token.py:19`, `backend/app/models/password_history.py:14`, `backend/app/models/onboarding_progress.py:14` | 접근 자격 즉시 폐기; 프로필·비밀번호 30일 삭제, FK 정리 후 User 제거 |
| client_profiles, counselor_profiles, qualifications, careers, credentials, consents | `backend/app/models/client_profile.py:14`, `backend/app/models/counselor_profile.py:14`, `backend/app/models/qualification.py:14`, `backend/app/models/career.py:14`, `backend/app/models/credential.py:14`, `backend/app/models/consent.py:14` | 프로필·자격·동의 삭제; 법정 보관 확정분만 분리·만료 처리 |
| user_org_memberships, client_counselor_links, client_invites, org_join_requests, signup_applications | `backend/app/models/user_org_membership.py:18`, `backend/app/models/client_counselor_link.py:14`, `backend/app/models/client_invite.py:14`, `backend/app/models/org_join_request.py:14`, `backend/app/models/signup_application.py:19` | 접근 즉시 제거, 신청/초대 JSON·이메일 포함 PII 삭제 |
| organizations, org_documents | `backend/app/models/organization.py:14`, `backend/app/models/org_document.py:14` | 기관 자체/공용 문서 보존; 해당 사용자 FK만 안전하게 해제, 다른 관리자 FK를 함께 NULL로 만들지 않음 |
| sessions, session_host_history, class_instructors, classes, counseling_relationships, counseling_relationship_counselors | `backend/app/models/session.py:15`, `backend/app/models/session_parent.py:17`, `backend/app/models/class_program.py:20`, `backend/app/models/counseling.py:61` | 기관·타 참여자 회차 보존; host/created_by 등 필수 FK는 0059에서 nullable/삭제 후 표시 허용으로 조정, 개인 상담 본문/식별정보 삭제 |
| session_participants, class_members, counseling_guests, guest_claim_events | `backend/app/models/session.py:137`, `backend/app/models/class_program.py:99`, `backend/app/models/counseling.py:19` | user_id 외 participant/member/claimed_user 연결 추적, 이름·생일·이메일·토큰/credential 삭제/익명화 |
| eeg_records, eeg_raw_chunks, eeg_feature_windows, reports, narrative_cache | `backend/app/models/record.py:85`, `backend/app/models/record.py:126`, `backend/app/models/eeg_feature.py:21`, `backend/app/models/record.py:176`, `backend/app/models/narrative_cache.py:14` | user_id OR participant_id로 개인 데이터·PDF 삭제; 공유 리포트 content에서 개인 행/인용 제거. 이미 생성된 비식별 그룹 집계와 지표 시그니처 전용 규칙 캐시만 보존 |
| session_records, audio_chunks, video_chunks | `backend/app/models/record.py:14`, `backend/app/models/record.py:49`, `backend/app/models/record.py:70` | 해당 개인 녹음·영상·transcript·ai_summary·메모·edit_history·subjective_state 식별 항목 삭제. 혼합 원본을 개인별 분리할 수 없으면 원본 삭제 범위는 정합 메모 M2를 먼저 해결 |
| chat_messages, chat_message_reads, chat_room_participants, chat_rooms; 신규 chat_reports/chat_blocks | `backend/app/models/chat.py:14` | 유예 중 탈퇴 표시; 30일 메시지 본문·첨부/읽음 제거, 공유 방 보존·host FK 해제; 신고 증거도 보관근거 없는 본문 사본 삭제 |
| agent_conversations/messages/relay_events/delivery_logs/counselor_settings/briefing_logs/checkin_enablements/checkin_prefs/checkins/profile_items/risk_signals/memory_items | `backend/app/models/agent.py:36` | AI off여도 기존 사용자·상담사·수신자·대화 FK/본문/JSON 모두 삭제 또는 타인 데이터에서 식별정보 제거 |
| notifications, notification_outbox, session_reminder_logs | `backend/app/models/notification.py:14`, `backend/app/models/notification_outbox.py:14`, `backend/app/models/session.py:238` | 발송 즉시 취소; 메시지 payload에 복제된 이름/본문/주소 삭제 |
| data_export_jobs/audits, research_consents/events/withdrawal_requests, research_export_batches/items | `backend/app/models/data_export.py:13`, `backend/app/models/research.py:22`, `backend/app/models/research_export.py:25` | export 취소·객체 삭제; 연구 철회/Spark ack 추적, append-only 이력은 법무 확정 분리보관/만료 전용 경로 필요(일반 ORM delete 금지) |
| class_attendance_events/makeup_assignments/guest_credentials/guest_recoveries/guest_merges/member_operations/guest_join_operations/member_consent_events/session_presence_leases; class_member_events/report_choice_events | `backend/app/models/class_membership.py:18`, `backend/app/models/class_program.py:157`, `backend/app/models/session.py:269` | credential 즉시 무효화, operation 응답 JSON·guest 복제 PII 삭제, 타인 출석/집계 보존 |
| class_operations/effects/email_invites, session_email_invites/host_requests/host_notes; counseling_relationship_events | `backend/app/models/class_scheduling.py:25`, `backend/app/models/session_email_invite.py:22`, `backend/app/models/counseling.py:152` | 대기 발송·작업 취소; requester/actor/recipient/email·본문 scrub, 타인 예약 보존 |
| class_report_jobs/items, pipeline_outbox | `backend/app/models/class_report_job.py:39`, `backend/app/models/pipeline_outbox.py:19` | 삭제 대상 개인 작업 취소; stale retry로 개인 리포트 재생성 금지; 다른 대상 작업 유지 |
| verification_audits, original_deletion_audits, retention_sweep_runs | `backend/app/models/credential.py:33`, `backend/app/models/original_deletion_audit.py:18`, `backend/app/models/retention_sweep_run.py:18` | 업무 감사 최소값만 분리, user UUID/사유 PII 제거·법정 만료 적용 |
| normalization_models, normalization_baselines | `backend/app/models/normalization_model.py:12`, `backend/app/models/normalization_baseline.py:12` | 공용 분포 모델은 보존. baselines는 FK 없는 문자열 user_id·device_id·birth_date와 개인 측정치를 가지므로 사용자 매핑 후 개인 행 삭제; 공용 기준이라고 일괄 보존하지 않음 |

#### S3·로컬 키 전수표

| 참조/패턴 근거 | 삭제 단위·확인 |
|---|---|
| `backend/app/models/record.py:26` audio_s3_key, :31 video_s3_key | 병합 음성/영상. session 소유만으로 타인 원본까지 삭제하지 않음 |
| `backend/app/models/record.py:58` AudioChunk.file_path, :79 VideoChunk.file_path | S3 키 또는 로컬 절대경로. 로컬 허용 저장 루트 안에서만 삭제 |
| `backend/app/models/record.py:107` EEGRecord.s3_key, :168 EEGRawChunk.object_key | user_id와 participant_id 양쪽; 미ack pending 키도 수집 |
| `backend/app/models/record.py:233` Report.pdf_url | 허용 S3 버킷/서비스 소유 URL만 키로 역변환; 외부 URL 임의 DELETE 금지 |
| `backend/app/models/credential.py:21` credentials.s3_key | 로컬 자격 증빙 포함. 기존 cleanup에서 누락된 대상 추가 |
| `backend/app/models/chat.py:44` chat_messages.file_url | 서비스 소유 첨부 키·로컬 파일만 삭제, 외부 링크는 DB 본문만 삭제 |
| `backend/app/models/data_export.py:37`, `backend/app/services/export_service.py:206` data-exports/{job.id}/data.zip | 요청자뿐 아니라 대상 participant의 export도 삭제; 미완료 업로드 예약 차단 |
| `backend/app/models/research_export.py:34` prefix | research-export 배치의 manifest/Parquet 혼합물: 철회 사용자 제외 재작성·이전 버전 삭제/Spark 철회 확인; 타 참여자 묶음 무차별 삭제 금지 |
| `backend/app/models/org_document.py:19` org_documents.s3_key | 기관 공용 소유는 보존(사용자 삭제와 연쇄하지 않음) |
| `backend/app/models/user.py:115` User.profile_image, `backend/app/models/client_profile.py:22` profile_image_url | 서비스 소유 프로필 이미지 키/이전 버전 삭제, 외부 제공자 이미지 URL은 요청하지 않음 |
| JSON/URL 간접 참조 | reports.content·agent/chat 본문·profile JSON 내 서비스 소유 객체와 업로드 실패 잔여물 확인; 객체 원장에 귀속 불명확하면 완료 처리하지 않음 |

S3 versioning 버킷은 DeleteMarker만 만들면 영구 삭제가 아니다. 소유 객체의 모든 version/업로드 중 multipart 잔여물을 삭제하는 운영 권한·수명주기 검증이 필요하다. 코드 테스트는 버전별 키 mock으로 확인하고 prod 삭제 실행은 별도 승인이다.

### 1.5 마이그레이션 직선 체인

DB 접속 없는 실행: 저장소 루트에서 메인 레포의 `backend/venv/bin/python -m alembic -c backend/alembic.ini heads` → `e036a0000058 (head)`. 메인 체크아웃 파일/브랜치는 변경하지 않았다.

| 작성 소유자 | revision | down_revision | 내용 |
|---|---|---|---|
| ⓒ | `e036a0000059` | `e036a0000058` | 생년월일·탈퇴 시각·Apple identity/token·동의/F1·삭제원장, 공유 기록 사용자 FK 삭제 정책 |
| ⓒ (ⓓ 스키마 계약 수신) | `e036a0000060` | `e036a0000059` | chat_reports, chat_blocks·동일 pair unique·인덱스 |

0059 → 0060 순으로 적용, 빈/기존 fixture 양쪽 upgrade 및 테스트 DB downgrade/upgrade, heads=0060 한 개. 구현 시작 전 다른 커밋이 같은 ID를 사용했으면 자동 분기/merge revision을 만들지 말고 감독자가 예약을 재조정한다. ⓓ는 migration 파일을 만들지 않는다.

## 2. Files to Change / 트랙별 소유 파일 목록

각 행은 독점 소유 파일이다. 기존 파일은 내용을 읽고 선언/설정 위치의 `파일:줄`을 기록했다. 신규는 아직 코드가 없으므로 `:1 (신규·추정)`이며 제안 경로다. 테스트 파일도 소유 수에 포함한다. 다른 트랙 문단의 참조는 소유권 추가를 뜻하지 않는다. 기존 테스트 수정이 필요하면 담당 트랙이 경로를 감독자에게 먼저 등록한다.

### Task 0 — 감독자 공유 기반 — 9개 파일

| Action | File | Description |
|---|---|---|
| Modify | `frontend/src/App.tsx:1` | 공유 계약·라우트·메뉴·설정 기반 |
| Modify | `frontend/src/components/layout/SidebarNav.tsx:23` | 공유 계약·라우트·메뉴·설정 기반 |
| Modify | `frontend/src/components/layout/BottomTabBar.tsx:53` | 공유 계약·라우트·메뉴·설정 기반 |
| Modify | `frontend/src/lib/feature-flags.ts:4` | 공유 계약·라우트·메뉴·설정 기반 |
| Modify | `backend/app/config.py:8` | 공유 계약·라우트·메뉴·설정 기반 |
| Modify | `backend/app/api/v1/__init__.py:16` | 공유 계약·라우트·메뉴·설정 기반 |
| Modify | `backend/app/models/__init__.py:1` | 공유 계약·라우트·메뉴·설정 기반 |
| Create | `frontend/.env.example:1` | 공유 계약·라우트·메뉴·설정 기반 (신규·추정) |
| Create | `backend/.env.example:1` | 공유 계약·라우트·메뉴·설정 기반 (신규·추정) |

### ⓐ 네이티브·의존성·빌드 — 23개 파일

| Action | File | Description |
|---|---|---|
| Modify | `frontend/package.json:6` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `frontend/package-lock.json:1` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `frontend/capacitor.config.ts:1` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `frontend/vite.config.ts:1` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `frontend/ios/App/App/Info.plist:59` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `frontend/ios/App/App.xcodeproj/project.pbxproj:324` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `frontend/android/app/build.gradle:4` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `frontend/android/app/src/main/AndroidManifest.xml:1` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `backend/app/main.py:27` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `frontend/src/lib/native/push.ts:8` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `frontend/src/lib/native/use-push-registration.ts:8` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `frontend/src/components/settings/WebPushCard.tsx:17` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `frontend/src/components/layout/AppShell.tsx:29` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `frontend/src/components/class/flow/member/BandStepView.tsx:53` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `frontend/src/components/class/player/member/MemberSheets.tsx:334` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Modify | `frontend/src/components/class/player/host/sheets/MybandSheet.tsx:14` | 네이티브 빌드·권한·운영 노출·레이아웃 |
| Create | `frontend/ios/App/App/PrivacyInfo.xcprivacy:1` | 릴리스 검증·권한 안내 (신규·추정) |
| Create | `frontend/ios/App/App/en.lproj/InfoPlist.strings:1` | 릴리스 검증·권한 안내 (신규·추정) |
| Create | `frontend/scripts/check-release-bundle.mjs:1` | 릴리스 검증·권한 안내 (신규·추정) |
| Create | `frontend/src/components/native/permission-guide.tsx:1` | 릴리스 검증·권한 안내 (신규·추정) |
| Create | `frontend/tests/sdd220-native-release.test.ts:1` | 릴리스 검증·권한 안내 (신규·추정) |
| Create | `backend/tests/test_sdd220_production_docs.py:1` | 릴리스 검증·권한 안내 (신규·추정) |
| Modify | `frontend/ios/App/App/App.entitlements:1` | 네이티브 빌드·권한·운영 노출·레이아웃 |

### ⓑ AI 플래그 BE·FE — 43개 파일

| Action | File | Description |
|---|---|---|
| Modify | `backend/app/services/agent_llm.py:57` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/services/agent_service.py:82` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/services/agent_counselor_service.py:45` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/services/agent_memory.py:46` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/services/agent_profile.py:72` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/services/agent_checkin.py:136` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/services/agent_briefing.py:55` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/services/agent_report_chat.py:35` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/services/audio_service.py:32` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/services/report_comment_service.py:28` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/services/report_narrative.py:59` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/tasks/stt_task.py:49` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/tasks/summary_task.py:36` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/tasks/upgrade_narrative_cache.py:13` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/tasks/report_task.py:35` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/api/v1/agent.py:31` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `backend/app/api/v1/agent_counselor.py:41` | AI 가드·규칙 폴백·작업 중단 |
| Modify | `frontend/src/lib/features.ts:16` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/components/client/ClientShell.tsx:35` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/components/client/BottomTabBar.tsx:31` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/pages/DashboardPage.tsx:148` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/pages/client/ClientHomePage.tsx:120` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/pages/client/ClientAppPage.tsx:206` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/pages/clients/ClientProfilePage.tsx:9` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/components/records/RecordView.tsx:18` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/components/records/AISummaryTab.tsx:14` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/pages/records/SessionRecordPage.tsx:194` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/components/reports/ClientReportViewer.tsx:29` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/components/reports/ReportDetailView.tsx:114` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/components/reports/CounselorCommentCard.tsx:29` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/components/reports/ReportStatusBadge.tsx:88` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/components/session/ReportProgressStepper.tsx:99` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/pages/reports/ReportDetailPage.tsx:12` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/pages/reports/ReportListPage.tsx:166` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/components/class/flow/member/EndView.tsx:54` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Modify | `frontend/src/components/class/flow/host/wizard-steps.tsx:31` | AI 진입·호출·문구 차단 및 해당 파일 의료 표현 정리 |
| Create | `backend/app/core/ai_features.py:1` | 단일 가드 및 off/on 회귀 (신규·추정) |
| Create | `frontend/src/components/routing/ai-gate.tsx:1` | 단일 가드 및 off/on 회귀 (신규·추정) |
| Create | `backend/tests/test_sdd220_ai_features.py:1` | 단일 가드 및 off/on 회귀 (신규·추정) |
| Create | `frontend/tests/sdd220-ai-features.test.tsx:1` | 단일 가드 및 off/on 회귀 (신규·추정) |
| Modify | `frontend/src/components/reports/SessionReplayPanel.tsx:9` | AI 전사 진입 분기·영상 유지 |
| Modify | `backend/app/services/agent_reminder.py:52` | AI 예약 메시지 생성 중단(일반 알림 유지) |
| Modify | `backend/app/tasks/agent_task.py:17` | AI 예약 메시지 생성 중단(일반 알림 유지) |

### ⓒ 인증·탈퇴·동의 — 70개 파일

| Action | File | Description |
|---|---|---|
| Modify | `backend/app/api/v1/auth.py:66` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/schemas/auth.py:11` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/models/user.py:106` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/models/consent.py:13` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/models/session.py:14` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/models/class_program.py:19` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/models/research.py:21` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/services/admin_service.py:29` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/services/media_cleanup_service.py:29` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/services/research_consent_service.py:52` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/services/class_member_consent_service.py:12` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/services/session_service.py:54` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/services/class_guest_service.py:23` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/services/class_membership_service.py:11` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/api/v1/session.py:72` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/api/v1/class_membership.py:15` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/schemas/session.py:19` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/schemas/class_consents.py:6` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/api/deps.py:14` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/services/signup_application_service.py:41` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/schemas/signup_application.py:6` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `backend/app/core/celery_app.py:7` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `deploy/jobs.tsv:1` | 인증·개인정보·동의·입장·삭제 스위프 |
| Modify | `frontend/src/pages/LoginPage.tsx:27` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Modify | `frontend/src/pages/register/RegisterClientPage.tsx:73` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Modify | `frontend/src/pages/register/RegisterCounselorPage.tsx:31` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Modify | `frontend/src/components/auth/ConsentCheckList.tsx:27` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Modify | `frontend/src/lib/native/google.ts:1` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Modify | `frontend/src/lib/api/auth.ts:54` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Modify | `frontend/src/stores/authStore.ts:101` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Modify | `frontend/src/pages/SettingsPage.tsx:46` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Modify | `frontend/src/pages/settings/ClientSettingsPage.tsx:16` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Modify | `frontend/src/pages/class/EntryPage.tsx:44` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Modify | `frontend/src/components/class/flow/member/NoticeStepView.tsx:46` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Modify | `frontend/src/lib/class/flow/member-prep.ts:8` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Modify | `frontend/src/lib/api/class-flow.ts:11` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Modify | `frontend/src/components/class/flow/member/BandStepContainer.tsx:23` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Modify | `frontend/src/components/session/ConsentModal.tsx:13` | 가입·탈퇴·F1·선택 동의 UI; AI 문구/정적 링크도 이 소유자가 연결 |
| Create | `backend/app/services/apple_auth_service.py:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `backend/app/services/account_deletion_service.py:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `backend/app/services/account_deletion_sweep_service.py:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `backend/app/models/account_deletion.py:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `backend/app/api/v1/account.py:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `backend/app/tasks/account_deletion_task.py:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `frontend/src/lib/native/apple.ts:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `frontend/src/components/auth/AppleLoginButton.tsx:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `frontend/src/components/settings/account-deletion.tsx:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `frontend/src/pages/account-deletion-page.tsx:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `frontend/src/components/settings/privacy-consents.tsx:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `backend/alembic/versions/e036a0000059_sdd220_account_privacy.py:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `backend/alembic/versions/e036a0000060_sdd220_chat_moderation.py:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `backend/tests/test_sdd220_apple_auth.py:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `backend/tests/test_sdd220_age_consents.py:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `backend/tests/test_sdd220_account_deletion.py:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `backend/tests/test_sdd220_deletion_sweep.py:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `backend/tests/test_sdd220_recording_consent.py:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Create | `frontend/tests/sdd220-auth-consents.test.tsx:1` | 신규 인증·삭제·마이그레이션·검증 (신규·추정) |
| Modify | `backend/app/models/record.py:13` | 공유 FK·삭제/동의 우회 방지·권한 안내 연결 |
| Modify | `backend/app/models/counseling.py:18` | 공유 FK·삭제/동의 우회 방지·권한 안내 연결 |
| Modify | `backend/app/models/class_report_job.py:36` | 공유 FK·삭제/동의 우회 방지·권한 안내 연결 |
| Modify | `backend/app/models/class_scheduling.py:24` | 공유 FK·삭제/동의 우회 방지·권한 안내 연결 |
| Modify | `backend/app/models/session_parent.py:16` | 공유 FK·삭제/동의 우회 방지·권한 안내 연결 |
| Modify | `backend/app/services/export_service.py:27` | 공유 FK·삭제/동의 우회 방지·권한 안내 연결 |
| Modify | `backend/app/services/research_export_service.py:94` | 공유 FK·삭제/동의 우회 방지·권한 안내 연결 |
| Modify | `frontend/src/pages/sessions/ClassPlayerPage.tsx:278` | 공유 FK·삭제/동의 우회 방지·권한 안내 연결 |
| Create | `backend/account_deletion_sweep_cron.py:1` | 사용자 스위프·수집 동의·개인 기준 데이터/객체 삭제 (신규·추정) |
| Modify | `backend/app/services/eeg_raw_service.py:26` | 사용자 스위프·수집 동의·개인 기준 데이터/객체 삭제 |
| Modify | `backend/app/models/normalization_baseline.py:11` | 사용자 스위프·수집 동의·개인 기준 데이터/객체 삭제 |
| Modify | `backend/app/models/client_profile.py:13` | 사용자 스위프·수집 동의·개인 기준 데이터/객체 삭제 |
| Modify | `backend/app/services/storage_service.py:31` | 사용자 스위프·수집 동의·개인 기준 데이터/객체 삭제 |

### ⓓ 채팅 신고·차단 — 17개 파일

| Action | File | Description |
|---|---|---|
| Modify | `backend/app/models/chat.py:13` | 신고·상호 차단·탈퇴 표시; 두 채팅 페이지의 루시 숨김 포함 |
| Modify | `backend/app/schemas/chat.py:12` | 신고·상호 차단·탈퇴 표시; 두 채팅 페이지의 루시 숨김 포함 |
| Modify | `backend/app/api/v1/chat.py:28` | 신고·상호 차단·탈퇴 표시; 두 채팅 페이지의 루시 숨김 포함 |
| Modify | `backend/app/services/chat_service.py:22` | 신고·상호 차단·탈퇴 표시; 두 채팅 페이지의 루시 숨김 포함 |
| Modify | `backend/app/ws/chat_namespace.py:24` | 신고·상호 차단·탈퇴 표시; 두 채팅 페이지의 루시 숨김 포함 |
| Modify | `frontend/src/lib/api/chat.ts:77` | 신고·상호 차단·탈퇴 표시; 두 채팅 페이지의 루시 숨김 포함 |
| Modify | `frontend/src/stores/chatStore.ts:27` | 신고·상호 차단·탈퇴 표시; 두 채팅 페이지의 루시 숨김 포함 |
| Modify | `frontend/src/components/chat/MessageBubble.tsx:40` | 신고·상호 차단·탈퇴 표시; 두 채팅 페이지의 루시 숨김 포함 |
| Modify | `frontend/src/components/chat/RoomSettingsModal.tsx:51` | 신고·상호 차단·탈퇴 표시; 두 채팅 페이지의 루시 숨김 포함 |
| Modify | `frontend/src/components/chat/ChatRoom.tsx:67` | 신고·상호 차단·탈퇴 표시; 두 채팅 페이지의 루시 숨김 포함 |
| Modify | `frontend/src/components/chat/InviteMemberModal.tsx:17` | 신고·상호 차단·탈퇴 표시; 두 채팅 페이지의 루시 숨김 포함 |
| Modify | `frontend/src/pages/chat/ChatPage.tsx:48` | 신고·상호 차단·탈퇴 표시; 두 채팅 페이지의 루시 숨김 포함 |
| Modify | `frontend/src/pages/client/ClientChatPage.tsx:48` | 신고·상호 차단·탈퇴 표시; 두 채팅 페이지의 루시 숨김 포함 |
| Create | `backend/app/services/chat_moderation_service.py:1` | 신고 트랜잭션·차단 경계 검증 (신규·추정) |
| Create | `backend/tests/test_sdd220_chat_moderation.py:1` | 신고 트랜잭션·차단 경계 검증 (신규·추정) |
| Create | `frontend/src/components/chat/report-dialog.tsx:1` | 신고 트랜잭션·차단 경계 검증 (신규·추정) |
| Create | `frontend/tests/sdd220-chat-moderation.test.tsx:1` | 신고 트랜잭션·차단 경계 검증 (신규·추정) |

### ⓔ 문구·정적 화면 — 33개 파일

| Action | File | Description |
|---|---|---|
| Modify | `frontend/src/lib/privacy-policy.ts:4` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `frontend/src/pages/register/RegisterOrganizationPage.tsx:16` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `frontend/src/pages/RegisterPage.tsx:33` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `frontend/src/pages/onboarding/ClientOnboardingPage.tsx:86` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `frontend/src/pages/onboarding/CounselorOnboardingPage.tsx:57` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `frontend/src/components/settings/ClientProfileSection.tsx:43` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `frontend/src/components/settings/ProfileSection.tsx:37` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `frontend/src/pages/reports/ReportViewPage.tsx:32` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `frontend/src/components/reports/EegTimeline.tsx:27` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `frontend/src/components/reports/NarrativeSections.tsx:223` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `frontend/src/pages/OrgDashboardPage.tsx:599` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `frontend/src/components/session/SessionCard.tsx:47` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `frontend/src/lib/class/class-labels.ts:5` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `backend/app/services/report_pdf_service.py:24` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `backend/app/services/notification_service.py:89` | 약관·처리방침·노출 문구·지표 고지 |
| Modify | `frontend/src/pages/LandingPage.tsx:87` | 랜딩 AI 분기·결제/의료 표현 정리 |
| Modify | `frontend/src/components/landing/Hero.tsx:1` | 랜딩 AI 분기·결제/의료 표현 정리 |
| Modify | `frontend/src/components/landing/Nav.tsx:1` | 랜딩 AI 분기·결제/의료 표현 정리 |
| Modify | `frontend/src/components/landing/CTASection.tsx:12` | 랜딩 AI 분기·결제/의료 표현 정리 |
| Modify | `frontend/src/components/landing/ProcessSection.tsx:9` | 랜딩 AI 분기·결제/의료 표현 정리 |
| Modify | `frontend/src/components/landing/ReportPreviewSection.tsx:6` | 랜딩 AI 분기·결제/의료 표현 정리 |
| Modify | `frontend/src/components/landing/PeopleSection.tsx:9` | 랜딩 AI 분기·결제/의료 표현 정리 |
| Modify | `frontend/src/components/landing/FeatureCards.tsx:9` | 랜딩 AI 분기·결제/의료 표현 정리 |
| Create | `frontend/src/pages/terms-page.tsx:1` | 정적 화면·공통 고지·금지 표현 검사 (신규·추정) |
| Create | `frontend/src/pages/crisis-help-page.tsx:1` | 정적 화면·공통 고지·금지 표현 검사 (신규·추정) |
| Create | `frontend/src/pages/measurement-guide-page.tsx:1` | 정적 화면·공통 고지·금지 표현 검사 (신규·추정) |
| Create | `frontend/src/lib/legal-copy.ts:1` | 정적 화면·공통 고지·금지 표현 검사 (신규·추정) |
| Create | `frontend/src/components/legal/wellness-notice.tsx:1` | 정적 화면·공통 고지·금지 표현 검사 (신규·추정) |
| Create | `frontend/src/components/routing/native-organization-gate.tsx:1` | 정적 화면·공통 고지·금지 표현 검사 (신규·추정) |
| Create | `frontend/tests/sdd220-public-copy.test.tsx:1` | 정적 화면·공통 고지·금지 표현 검사 (신규·추정) |
| Create | `backend/tests/test_sdd220_public_copy.py:1` | 정적 화면·공통 고지·금지 표현 검사 (신규·추정) |
| Modify | `backend/app/tasks/email.py:18` | 메일 본문 금지 표현 정리·검사 |
| Modify | `backend/app/services/report_email_service.py:23` | 메일 본문 금지 표현 정리·검사 |

### ⓕ 체험·데모 시드·메타데이터 — 8개 파일

| Action | File | Description |
|---|---|---|
| Modify | `frontend/src/pages/playground/PlaygroundPage.tsx:33` | 회원 체험 모드·개발자 패널 제거·추정 지표 고지 |
| Modify | `frontend/src/components/playground/ConnectionPanel.tsx:34` | 회원 체험 모드·개발자 패널 제거·추정 지표 고지 |
| Modify | `frontend/src/components/playground/PlaygroundMeditationPanel.tsx:133` | 회원 체험 모드·개발자 패널 제거·추정 지표 고지 |
| Modify | `frontend/src/hooks/useBand.ts:326` | 회원 체험 모드·개발자 패널 제거·추정 지표 고지 |
| Create | `backend/scripts/seed_store_review.py:1` | 데모 시드 스크립트·메타데이터·검증 (신규·추정) |
| Create | `specs/sdd-220-store-review-readiness/appstore-metadata.md:1` | 데모 시드 스크립트·메타데이터·검증 (신규·추정) |
| Create | `frontend/tests/sdd220-demo-mode.test.tsx:1` | 데모 시드 스크립트·메타데이터·검증 (신규·추정) |
| Create | `backend/tests/test_sdd220_review_seed.py:1` | 데모 시드 스크립트·메타데이터·검증 (신규·추정) |

### 2.1 겹침 해소 (동시 수정 금지)

| 충돌 요구 | 최종 소유 | 소비/전달 방식 |
|---|---|---|
| App.tsx: AI gate, /terms·도움·삭제, 기관 가입 gate, design 제외, 체험 경로 | Task 0 | ⓐ~ⓕ가 라우트 계약 전달, 감독자만 변경 |
| SidebarNav·layout BottomTabBar: AI unread, 회원 체험, iPad 메뉴 | Task 0 | 공통 flag/링크 적용; 레이아웃 AppShell은 ⓐ |
| config.py·환경변수 예제: AI·Apple·삭제 스위프·production | Task 0 | 필드 선등록, 값은 별도 운영 승인 |
| api/v1/__init__.py·models/__init__.py | Task 0 | 신규 account/chat 모델·라우트 등록만 감독자 |
| auth.py·LoginPage·가입·설정 | ⓒ | ⓔ의 소개/기관 도입 문의·약관/위기 링크와 ⓐ native UI 분기를 ⓒ가 반영 |
| feature-flags.ts | Task 0 | ⓑ는 isAiEnabled 소비, 상담 함수 기존 의미 보존 |
| privacy-policy.ts | ⓔ | ⓒ의 30일·F2·동의·F3, ⓑ의 AI 제외, ⓐ의 수집 항목 전달 후 한 번에 개정 |
| NoticeStepView·ConsentModal | ⓒ | F1 + AI off 녹음 문구 + 권한 고지 함께 구현 |
| ChatPage·ClientChatPage·chat_service·WS | ⓓ | AI 채널 숨김과 탈퇴 표시/현재 연결 토큰 차단까지 함께 반영 |
| 리포트 컴포넌트·규칙 서사/코멘트 | ⓑ | ⓔ 금지어 사전/면책 문구 사용; 별도 편집 금지 |
| 랜딩 AI 소개·의료·결제 | ⓔ | isAiEnabled 소비해 문구 분기 |
| PlaygroundMeditationPanel·useBand | ⓕ | 체험·효과 표현·의료 고지 묶음; 뇌파 동의는 ⓒ BandStepContainer와 계약 연동 |
| 마이그레이션 두 개 | ⓒ | ⓓ 모델 설계 후 0060만 ⓒ에게 작성 요청 |

## 3. Task 목록·의존성

Estimate는 구현+집중 테스트 예상 작업일(추정), 실기기 대기/법무/계정 복구 시간 제외. 각 Task의 Files는 §2 해당 트랙 목록의 명시된 부분집합이며 파일별 줄은 §2를 사용한다. 모든 Task는 실패하는 verify 시나리오를 먼저 작성 → 최소 구현 → 해당 테스트/타입검사 → 독립 리뷰 순서다. 이 문서는 구현 실행 승인이 아니다.

### Task 0 — 공유 기반 계약

- **Objective:** 공유 소유 파일 전부. 6트랙 라우트/설정/API·오류코드·법무 문구 인터페이스 선등록, E3 계정 읽기 점검은 수동 표로 분리.
- **Files:** §2 Task 0 전부.
- **Estimate:** 0.5~1일 (추정).
- **선행 의존:** Stage ③ 승인.
- [ ] RED: TS3~TS5, TS42의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task a1 — 네이티브 산출물

- **Objective:** Capacitor core/ios/android/cli 8.5.3 이상 같은 호환 버전·lockfile·cap sync, 1.0.0/증가 빌드번호·manifest 4곳 등록·서명 누락 release 실패.
- **Files:** ⓐ package/lock·iOS·Android·capacitor 설정.
- **Estimate:** 1~2일 (추정).
- **선행 의존:** 0.
- [ ] RED: TS1, TS2, TS28, TS29의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task a2 — 운영 번들과 문서 비공개

- **Objective:** prod cap 기본 스크립트·dev-api 게이트, bgm/mb-design 제외 또는 원격화 후 실제 BGM 재생 확인; API docs/redoc/openapi 404.
- **Files:** ⓐ vite·check-release-bundle·main.py 및 해당 테스트.
- **Estimate:** 0.5~1일 (추정).
- **선행 의존:** a1, 0의 design route 제외.
- [ ] RED: TS30, TS31의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task a3 — 권한·iPad 회귀

- **Objective:** 기능 첫 사용 사전 안내, 시작 시 0회; native WebPush/브라우저 안내 제거; iPad 4화면/방향과 실제 BLE/푸시/소셜 회귀.
- **Files:** ⓐ native push·권한 안내·WebPushCard·AppShell·BandStepView·MemberSheets·MybandSheet.
- **Estimate:** 1~2일 (추정).
- **선행 의존:** a1, c1, c3, f1.
- [ ] RED: TS2, TS25~TS27, TS40의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task b1 — 서버 AI 차단

- **Objective:** 정책 단일 가드 + transport·API·inline·예약작업·리포트 대화 차단, 이미 적재된 작업에도 호출 0.
- **Files:** ⓑ core/ai_features·agent API/services·stt/summary/upgrade tasks.
- **Estimate:** 1~1.5일 (추정).
- **선행 의존:** 0.
- [ ] RED: TS3~TS5, TS8의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task b2 — 녹음 보존·규칙 리포트

- **Objective:** 체인에서 STT/요약만 제거, source=rule 및 캐시 우회, 기존 미디어/리포트 상태 의미 유지.
- **Files:** ⓑ audio_service·report_task·report_comment_service·report_narrative·summary_task.
- **Estimate:** 1일 (추정).
- **선행 의존:** b1.
- [ ] RED: TS6, TS7의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task b3 — 프론트 AI 비공개

- **Objective:** 미읽음/CTA/effect/AI 탭·문구 전수 적용, on 회귀; 공유/채팅/회원 고지/랜딩 변경 요청을 소유자에게 전달.
- **Files:** ⓑ 프론트 파일·테스트 전부.
- **Estimate:** 1~1.5일 (추정).
- **선행 의존:** 0, b1, e1의 공통 문구 계약.
- [ ] RED: TS3~TS5, TS7의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task c1 — Apple·연령·가입

- **Objective:** Apple nonce/JWKS/code exchange·재로그인·신규 연령/약관·F2 이메일 차단. 0059 작성, 0060 작성은 d1 계약 수신 후.
- **Files:** ⓒ auth·schemas/auth·user/consent·Apple 서비스/버튼/native·Login/가입·0059·0060·가입신청.
- **Estimate:** 2~3일 (추정).
- **선행 의존:** 0; 0060은 d1 스키마 계약.
- [ ] RED: TS9~TS13, TS19, TS42의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task c2 — 즉시 탈퇴·공개 접수

- **Objective:** 재인증/예외 검사/즉시 토큰 차단·소셜 revoke outbox·웹 202 접수, 설정 2탭 내 진입.
- **Files:** ⓒ account API/model/service·admin_service·api/deps·authStore·설정/삭제 화면.
- **Estimate:** 1.5~2일 (추정).
- **선행 의존:** c1.
- [ ] RED: TS16~TS20, TS23의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task c3 — F1·선택 동의

- **Objective:** 회차별 필수 녹음/녹화 동의 + 서버 입장 gate, eeg/research 선택·철회·게시 버전 저장·UI 안내.
- **Files:** ⓒ session/class 서비스·스키마·모델·API·Notice/Entry/BandStepContainer/ConsentModal·privacy-consents.
- **Estimate:** 1.5~2일 (추정).
- **선행 의존:** c1, b1, e1.
- [ ] RED: TS14, TS15, TS24의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task c4 — 30일 사용자 스위프

- **Objective:** 객체 원장·재시도·삭제 대상 전수 테스트·공유 집계 보존·연구 철회·F2 재가입, 기존 90일 별도 유지.
- **Files:** ⓒ account_deletion_sweep_service·task·media_cleanup_service·research·celery/jobs·삭제 테스트.
- **Estimate:** 2~3일 (추정).
- **선행 의존:** c2, c3, d1; M2/M3 해결.
- [ ] RED: TS21, TS22, TS41, TS43의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task d1 — 신고·상호 차단 서버

- **Objective:** 정규화 pair unique·신고/차단 같은 트랜잭션·운영 알림 outbox, REST/WS/초대/미읽음/preview 전체 차단 및 탈퇴 사용자 표시.
- **Files:** ⓓ backend 전부 (마이그레이션 파일은 ⓒ).
- **Estimate:** 1.5~2일 (추정).
- **선행 의존:** 0; 적용 테스트는 c1의 0060 후.
- [ ] RED: TS32~TS35의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task d2 — 신고 UI·AI 채널 정리

- **Objective:** 메시지 메뉴/상대 프로필 신고·선택 사유, 기존 캐시 제거·상호 blocked 상태 표시·루시 비노출.
- **Files:** ⓓ frontend 전부.
- **Estimate:** 1일 (추정).
- **선행 의존:** d1, b1.
- [ ] RED: TS3, TS32~TS35의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task e1 — 정적 정책·도움·고지

- **Objective:** terms/privacy/위기/측정 안내·F3·30일·위탁표·광고 미사용·선택 동의, 의료 면책 상수. 공공번호는 게시 전 도구/공식 근거 확인, 법무 검토 구분.
- **Files:** ⓔ 정적 신규 화면·legal-copy·privacy-policy·wellness-notice.
- **Estimate:** 1~1.5일 (추정).
- **선행 의존:** 0, c1/c2 계약.
- [ ] RED: TS36, TS37, TS39의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task e2 — 공개 문구·기관 앱 가입 차단

- **Objective:** 의료·결제 사전 검사, 랜딩 AI off 분기, 네이티브 두 기관 URL 안내·메일 문의, 웹 가입 유지. 타 소유 파일은 수정 요청만.
- **Files:** ⓔ 나머지 기존 화면·native-organization-gate·문구 테스트.
- **Estimate:** 1~1.5일 (추정).
- **선행 의존:** e1, 0, b1.
- [ ] RED: TS36~TS39의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task f1 — 회원 체험 모드

- **Objective:** 명시적 예시 모드·상시 띠·파형/스펙트럼/지표/명상 작동·prod 개발 패널 제거, 실제 데이터 저장·업로드와 분리.
- **Files:** ⓕ Playground/ConnectionPanel/MeditationPanel/useBand·프론트 테스트.
- **Estimate:** 1일 (추정).
- **선행 의존:** 0, e1.
- [ ] RED: TS40의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.

### Task f2 — 데모 시드·스토어 자료

- **Objective:** 진행자/회원·합성 클래스/EEG/리포트 시드 및 멱등 재생성 코드·dry-run; prod 실행/계정/시연 영상/스토어 제출은 별도 승인 체크리스트.
- **Files:** ⓕ seed_store_review·시드 테스트·appstore-metadata.
- **Estimate:** 1~1.5일 (추정).
- **선행 의존:** f1, c4, b2.
- [ ] RED: TS44~TS46의 구체적 Expected를 집중 테스트로 먼저 고정한다.
- [ ] GREEN: Objective 범위만 구현하고 소유 파일 밖 변경 요청은 감독자에게 전달한다.
- [ ] 검증: 해당 pytest/vitest 실행, FE 변경은 tsc·eslint, DB 변경은 임시 테스트 DB에서 단일 head/FK 회귀 확인.
- [ ] 리뷰: 실패/미실행 증거를 구분해 보고하고 트랙별 커밋을 준비한다.


### 3.1 작업량 요약

| 소유 | Task 수 | 소유 파일 수(신규 테스트 포함) |
|---|---|---|
| 감독자 Task 0 | 1 | 9 |
| ⓐ | 3 | 23 |
| ⓑ | 3 | 43 |
| ⓒ | 4 | 70 |
| ⓓ | 2 | 17 |
| ⓔ | 2 | 33 |
| ⓕ | 2 | 8 |
| 합계 | 17 | 203 |

### 3.2 순서·통합

Task 0 → ⓐ a1/a2, ⓑ b1/b2, ⓒ c1, ⓓ d1 스키마 설계, ⓔ e1을 독립 진행한다. c1은 d1 계약 수신 후 0060을 작성한다. ⓒ 내부는 c1→c2→c3→c4 순차, ⓓ d1→d2, ⓔ e1→e2, ⓕ f1→f2 순차. 공유 문구·API 계약은 먼저 고정하되 완성되지 않은 의존 기능을 통과로 기록하지 않는다. a3/f2는 통합 후 실제 장치·콘솔 검증이 남는다. 작업자는 별도 워크트리를 사용하며 현재 문서 작업은 브랜치 전환/새 워크트리 생성 없이 수행한다.

## 4. Testing Strategy

- verify TS1~TS46과 §5 완료 기준 대응표를 최종 인수 기준으로 사용한다. 모든 상태는 미실행으로 시작한다.
- BE: transport를 spy/금지 mock으로 바꾸고 AI off에서 HTTP·queue enqueue·AI side effect 0을 증명한다. on은 공급자 fixture로 기존 결과 계약을 검증하며 실제 유료 API 호출하지 않는다.
- 탈퇴·차단·동의는 단위 테스트 외 테스트용 PostgreSQL로 FK·동시 실행·트랜잭션 경합을 검증한다. 테스트 DB 외 prod/dev 공유 DB 실행은 별도 승인.
- FE: vitest에서 `VITE_AI_ENABLED`와 `VITE_COUNSELING_ENABLED` 4조합, native/web 양쪽, 역할별 mount/API 호출 횟수·링크 문구 확인. DOM 테스트를 실기기 증거로 대신하지 않는다.
- 통합: 전체 pytest, vitest, `npx tsc -b`, `npx eslint src/`, prod 빌드 및 `npm audit --omit=dev` critical=0. 기존 실패는 기준선 기록 후 해결 여부 분리하되 §5 전체 통과 기준을 자동 완화하지 않는다.
- 정적: Files to Change 중복 소유 0, 기존 경로/줄 실재, migration 단일 head, 결제/의료 화면 문자열/백엔드 규칙·메일 사전 검사. 면책 허용은 정확한 문장 단위만.
- 수동: iPhone/iPad simulator build와 iOS/Android 실기기 BLE·push·Google·Apple·권한 거절/재허용, iPad 4화면 × 2방향 캡처. 스토어/법무/계정 검증은 코드 테스트와 별도 증거.

## 5. 코드 외 수동/승인 항목

| 항목 | 담당·전제 | 완료 증거 / 실행 경계 |
|---|---|---|
| Apple 법인 팀 복구(E3)·bundle ID 확정 | Brian/계정 소유자 | 복구 후 읽기 점검; 현재 개인 팀 bundle을 자동 변경하지 않음 |
| Apple capability·Services ID·Return URL·p8 | 계정 소유자 | 실제 웹/iOS aud allowlist·nonce/revoke 실기기 결과; 키는 보관 위치만 기록 |
| Play 조직 인증·App Signing·업로드 키 | 계정 소유자 | 조직 인증·서명 AAB 검사, 키 값 출력 금지 |
| Google OAuth·FCM·APNs 운영 연결 | 계정 소유자 | prod 패키지/bundle 일치·로그인/푸시 실기기 성공 |
| prod AI 환경변수 | 운영 승인 | AI_FEATURES_ENABLED=false, GEMINI_API_KEY·OPENAI_API_KEY 비우기; 복구 보관 위치만 기록, 값은 문서화하지 않음 |
| prod 90일 retention | D7 정책 승인과 실제 설정 변경 구분 | RETENTION_SWEEP_ENABLED·RETENTION_APPLY_FROM·timer 확인, 시행일 전 dry-run 결과 검토 후 별도 운영 실행 |
| prod 사용자 30일 sweep | 운영 승인 | 삭제 원장 dry-run·법정 예외·S3 version 권한 확인 후 스케줄 활성화; 기존 retention 설정에 묵시 종속시키지 않음 |
| 데모 prod 시드 | 별도 명시 승인 | 이번 범위는 스크립트 작성/테스트뿐; 실제 DB 실행·계정 생성·메일 발송 금지 |
| 데모 동결·재생성 | 운영자 | 심사 기간 비밀번호/데이터 유지; 탈퇴 계정은 F2 30일 우회 금지, 대체 데모 계정으로 심사 접근 유지 |
| 약관·방침 법무 | 법무/책임자 | 실제 위탁사·국가·항목·목적·보유기간·시행일, 법정 보존 항목/만료와 연구 이력 처리 확정 |
| 공공 긴급 연락처 | 게시 담당 | 게시 직전 한국 관할 헬프라인 도구/공식 최신 정보 확인; 이 문서에서는 미검증 번호를 재게시하지 않음 |
| 영상·스크린샷·콘솔 신고 | Brian 승인 후 별도 | 1~2분 실제 밴드 영상, 4화면 iPad 캡처, App Privacy/Data safety/건강 앱 신고 대응표; 개인 실데이터 금지 |
| 스토어 업로드·제출 | Brian 별도 승인 | 메타데이터 입력·AAB/IPA 업로드·제출은 코드 완료와 별개 |

## 6. 위험·롤백

AI off 기본값과 prod 키 제거는 독립 방어다. 키 제거만으로 차단 테스트를 통과시키지 않는다. AI 재공개는 on 회귀와 개인정보 고지 재검토 후 재배포한다. Capacitor 상향은 단독 커밋으로 분리해 회귀 원인을 좁힌다. 삭제 데이터는 롤백 불가이므로 dry-run·객체 원장 확인 없이 sweep를 활성화하지 않는다. 삭제 스위프 중단은 신규 삭제만 멈추며 deleted 사용자의 로그인은 복구하지 않는다. 차단/탈퇴 작업 실패 시 클라이언트 캐시가 타인의 본문을 계속 보여주지 않게 이벤트와 재조회 경계를 테스트한다.

## 스펙 정합 메모

- M1: §3.13의 “보관기간 스위프로 30일 삭제”는 §9 R2에 의해 사용자 별도 스위프로 해석했다. 기존 세션 90일 스위프를 대체하지 않는다.
- M2: §3.13 전체 개인 녹음·녹화 삭제와 R4 그룹 집계/타인 자료 보존 사이에 **공유 음성·영상 원본** 처리 규칙이 부족하다. 현재 `SessionRecord`/청크는 session 단위이고 `VideoChunk` 주석은 호스트 영상만 저장한다고 명시한다. 실제 녹음 범위를 확인하고 혼합 원본에서 개인을 분리할 수 없을 때 객체 전체 삭제/편집 중 어느 범위인지 구현 전 확정해야 한다. 타인 기관 데이터 연쇄 삭제로 임의 해결하지 않는다.
- M3: 법정 보관분의 항목·근거·만료일 및 append-only 연구 이력 삭제 방식은 spec에 없다. `research_consent_events`는 ORM 삭제를 거부하고 Spark 철회 확인이 별도이므로 영구 삭제 완료 기준에 법무/운영 확인을 추가했다. 무기한 보관을 새로 승인한 것으로 쓰지 않는다.
- M4: D10 재생성 스크립트와 F2 30일 동일 이메일 재가입 불가가 충돌할 수 있다. F2 우선: 삭제되지 않은 시드의 멱등 복구만 허용, 탈퇴된 계정은 새 이메일 대체 데모 준비; 같은 이메일 즉시 부활 금지.
- M5: §3.3의 기존 “약관 3종”은 §9.2 승인에 따라 필수 기록 동의와 선택 EEG/연구를 분리한다. `consents.version`은 이미 존재하여 추가가 아니라 게시 버전 저장 연결이 필요하다. 재동의 gate는 후속.
- M6: §6 “220 병합=제출 가능”은 코드 밖 법무·E3·실기기·데모/영상·콘솔 신고 완료까지 조건부로 해석한다. 병합만으로 실제 제출 승인이나 계정 복구 완료를 주장하지 않는다.
- M7: 현재 `frontend/src/lib/terms.ts`는 약관이 아닌 내비게이션 용어 사전이다. 약관은 신규 legal-copy/terms-page에 두고 기존 파일 의미를 바꾸지 않는다. React 등 실제 package.json은 AGENTS 기술스택 표와 다르지만 이번 SDD에서 프레임워크 버전 정합 작업을 확대하지 않는다.
- M8: API 상태/오류코드·삭제 원장/FK nullable 설계·실기기 4화면 선택은 plan의 구현 제안이다. 사용자 결정으로 인용하지 않으며 Stage ③ 승인 전 구현하지 않는다.

- M9: 기존 consent_eeg는 리포트 선택/내보내기 계약과 결합되어 있다. §9.2의 신규 수집 동의를 별도 필드로 분리하며 리포트 반영 거부와 혼용하지 않는다. 개인 normalization_baselines는 FK가 없어 기존 하드 삭제 목록에서 빠지므로 삭제 대상에 추가했다.
