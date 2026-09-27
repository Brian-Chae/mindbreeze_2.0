# [SDD-093] 노티피케이션(알림) 시스템 재설계 — 이벤트 카탈로그 전수 + 딥링크 후속 행위

## Goal
시스템 전반의 알림 발생 이벤트를 체계화(이벤트 카탈로그 33종)하고, 표준 딥링크 payload(`extra`)를 도입해 알림 클릭 시 해당 화면(채팅방·리포트·세션 등)으로 이동하는 후속 행위를 정의·구현한다.

## Context
- 기획서(Phase 1) 완료: `docs/notification-system/01-backend-기획.md`(54KB) · `02-frontend-기획.md`(50KB) · `00-research-brief.md`
- Brian "전부 처리" 확정 → 이벤트 카탈로그 33종 전부 + 딥링크 계약을 구현 범위로 확정.
- 현재 갭: ① 알림 클릭 시 후속 행위(딥링크 이동) 없음(`NotificationCenterPage.tsx:133-147`이 읽음 처리만) ② `session_booked/cancelled` 등 세션 이벤트가 스키마에만 정의되고 실제 `notify_event` 호출부 없음 ③ `extra` payload가 이벤트마다 제각각 ④ 클래스 회원 초대(SDD-092) 알림 미연동.

## Scope
### ✅ In-scope
**백엔드**
- 표준 `extra` 계약: `schema_version`(1) / `event_type` / `target_type`(`chat_room`·`report`·`session`·`credentials`·`self_profile`·`organization`·`notice`) / `target_id` / `params` (기존 루트 키 `room_id`·`sender_id`·`report_id`·`session_id`·`changed_fields`·`actor_kind`·`org_name`·`office_name` 호환 유지)
- `type` 재정의: `session`·`class`·`chat`·`report`·`verification`·`organization`·`system` (`org_removed`는 호환 기간 유지)
- 이벤트 카탈로그 33종 발화 일원화 (`notify_event` 라우팅):
  - 세션 S01~S13 (booked/updated/cancelled/ready/opened/started/paused/resumed/completed/invited/waitlist_promoted/participant_removed/deleted)
  - 채팅 C01~C05 (message/room_created/room_invited/fork 분류/room_removed) + `params.message_id`
  - 리포트 R01~R04 (review_requested/ready/generation_failed/email_failed)
  - 검증·기관·계정·개인상담소 V01~V02/O01~O06/A01~A03/P01
- 환경설정 확장: 이벤트별 bool (email/in_app), `session_updated` 독립, 기존 `session_booked` 값 승계
- API 확장: 메시지 주변 조회(딥링크용), 메시지 읽음 ↔ 알림 읽음 연동, 목록 type/event 필터, 전체읽음 `{marked}` 정합
**프론트엔드**
- 알림 클릭 → 후속 행위(딥링크): 타입별 라우트 매핑 + `?message={message_id}` 스크롤 이동
- 내담자 알림 센터 실체화 (`/app/notifications`)
- 알림 센터 UX 개선(딥링크 안내·읽음/안읽음·그룹핑·필터·빈/오류 상태)
- 토스트 클릭 딥링크 + 배지 정합 + WS `created_at/is_read` 수신

### ❌ Out-of-scope
- 트랜잭셔널 outbox·사건 레코드·전달 레코드의 **물리 DB 테이블 신설**(기획서 §6.2는 논리 설계이며, 이번엔 기존 `notify_event` 동기 경로로 구현)
- 이메일 공급자 멱등·재시도 운영값 최적화
- 플랫폼 관리자 검토 담당자 자동 배정
- 개인 상담소 자체 폐쇄(P02, 기획서 "예약" 이벤트) — 발화 경계 미확정
- 알림 데이터 보관·파기 정책

## Acceptance Criteria
- [ ] 표준 `extra` 계약이 모든 발화 지점에 적용되고 REST·WS 응답에 동일 필드 포함
- [ ] 이벤트 카탈로그 33종(예약 P02 제외) 중 확정 이벤트가 해당 도메인 서비스에서 `notify_event`로 발화
- [ ] 알림 클릭 시 타입별 대상 화면으로 이동(채팅 메시지는 해당 방·메시지 위치)
- [ ] `cd backend && pytest` 0 실패 (신규 테스트 포함)
- [ ] `cd frontend && npm run build` 0 errors

## Dependencies
- 기획서 `docs/notification-system/01-backend-기획.md` · `02-frontend-기획.md`
- 기존 알림 인프라: `notification_service.py` · `Notification` 모델 · `chat_namespace.broadcast_notification`
- 채팅(SDD-092), 세션 라이프사이클(SDD-088), 리포트(SDD-086)

## Risks
- **계약 불일치**: 백엔드 `extra` 필드명 ↔ 프론트 라우트 파라미터 불일치 → 기획서 §9 상호 대조를 정본으로 고정하고 구현 후 교차 검증.
- **세션 상태 전이 다양성**: `paused/resumed/구형 join_session` 등 우회 경로에서 중복·누락 발화 → 발화 지점을 상태 전이 함수 단위로 통일.
- **딥링크 메시지 스크롤**: 50개 밖 메시지는 주변 조회 API 필요 → API 확장으로 해소, 실패 시 "최근 대화 보기" 폴백.
