# [SDD-093] 노티피케이션(알림) 시스템 재설계 — 구현 결과

> 7-Stage SDD ④~⑥. 기획서는 `docs/notification-system/01-backend-기획.md`·`02-frontend-기획.md`.

## 구현 결과

### 백엔드 (FastAPI)
**표준 딥링크 계약** — `notification_service.py`
- `EVENT_CATALOG` 35종(세션 13·채팅 4·리포트 4·검증 2·기관 7·계정 4·개인상담소 1) → 화면 분류 `type` + 딥링크 `target_type` 1:1 매핑
- `build_standard_extra()` — `schema_version/event_type/target_type/target_id/params` 표준 payload (+ 레거시 루트 키 호환)
- `notify_event()` 표준 extra 정규화 — 레거시 발화 지점도 자동 보완

**환경설정 확장** — `models/user.py`·`schemas/notification.py`
- `DEFAULT_NOTIFICATION_PREFERENCES` 35종 (이메일 기본: 일정·검증·소속·계정만 ON, 인앱 전부 ON)
- `email/in_app` → `dict[str, bool]`, `update_preferences` 미제출 키 보존

**이벤트 발화 일원화** (`notify_event` + `build_standard_extra`)
- 세션 S01~S13: `session_service._notify_participants_event` — 예약/변경/취소/오픈/시작/일시정지/재개/종료/초대/대기승격/제거/삭제 (호스트 제외·대기열 규칙 적용)
- 채팅 C01: `message_id` 포함 · 리포트 R02: 표준 extra
- 기관 O01~O06·검증 V01~V02·계정 A01~A03·개인상담소 P01: `org_service`·`org_management_service`·`credential_service`·`admin_service`·`personal_office_service`·`counselor_info_service`

**API 확장**
- `GET /chat/rooms/{id}/messages-around?message_id=` + `GET /chat/rooms/{id}/messages/{mid}/context` — 접근 검증(멤버·방 일치·1:1 격리) 후 앞뒤 구간·커서 반환
- 메시지 읽음 ↔ 알림 읽음 연동 (`event_type=chat_message` + `params.message_id` 일치만)
- 알림 목록 `type`/`event` 필터

### 프론트엔드 (React 18 + TS)
- `resolveNotificationTarget(extra, role)` — target_type 화이트리스트 → 라우트 경로 (상담사/내담자 분기, 레거시 루트 키 폴백, 알 수 없는 타입 이동 금지)
- 알림 센터 클릭 → 딥링크 이동 (`NotificationCenterPage`)
- 실시간 토스트 클릭 → 딥링크 이동 (`AppShell`/`ClientShell`)
- 내담자 알림 센터 (`ClientNotificationPage`) + 공용 `NotificationCard` 추출
- 채팅 메시지 스크롤 딥링크 (`?message={id}` → 주변 조회·스크롤·3초 강조·최근 대화 폴백)

## 검증

| 항목 | 결과 |
|---|---|
| 백엔드 `pytest -q` | **770 passed, 12 skipped, 0 실패** (기존 746 + 신규 24) |
| 프론트 `tsc -b --noEmit` | exit 0 |
| 프론트 `npm run build` | ✓ built (1.39s) |

신규 테스트: `backend/tests/test_sdd093_{account_events,org_events,chat}.py`, `frontend/tests/chat-message-{api,deeplink}.test.ts`, `client-notification.test.ts`

## 디버깅
- **Orca 워커 TUI 블로킹**: Orca가 claude/codex를 TUI 모드로 띄워 CLI 옵션이 프롬프트로 전달 → timeout. headless CLI(`codex exec`) 직접 병렬 실행으로 우회.
- **claude hang**: `claude -p --model fable` 2회 연속 0바이트 hang → 백엔드도 Codex로 대체.
- **워커 첫 실행 실패 3건**: 테스트 fixture `SessionLocal`을 테스트 DB로 연결, 계정 정지 테스트는 동시각 알림 구분 위해 `system` 타입 필터 추가 → 해결.
- **PYTHONPATH 간섭**: Hermes 3.14 site-packages가 venv(3.11)를 오염 → `unset PYTHONPATH`로 해소.

## 남은 경계 (Out-of-scope, spec.md §Out-of-scope와 동일)
- 트랜잭셔널 outbox·사건 레코드의 **물리 DB 테이블 신설** (논리 설계만, 동기 경로로 구현)
- P02 개인상담소 "예약" 발화 (경계 미확정)
- 플랫폼 관리자 검토 담당자 자동 배정
- 알림 데이터 보관·파기 정책
- 실서비스 이메일/WS 전달·배포·커밋 (미수행)
