# [SDD-093] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 승인받고 구현 시작할 것. (Brian "전부 처리" → 연속 진행)

**Goal:** 이벤트 카탈로그 33종 발화 일원화 + 표준 딥링크 payload + 알림 클릭 후속 행위 구현

**Architecture:**
```
도메인 서비스(session/chat/report/org/credential/personal_office)
  └─ notify_event(event_type, user_id, data{title,body,extra}, db)   ← 단일 라우터
       ├─ 표준 extra 검증(schema_version/event_type/target_type/target_id/params)
       ├─ 인앱 Notification 생성 (type 재정의값)
       ├─ broadcast_notification(WS new_notification, REST 동일 필드)
       └─ (설정 시) 이메일 발송
프론트: new_notification/목록 조회 → extra.target_type·target_id → 라우트 이동(딥링크)
```

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic v2 · React 18 + TypeScript + Zustand · Socket.IO

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/services/notification_service.py` | 표준 extra 검증·적용, type 매핑 확장, 이벤트 카탈로그 등록 |
| Modify | `backend/app/models/user.py` | DEFAULT_NOTIFICATION_PREFERENCES 이벤트 확장 |
| Modify | `backend/app/schemas/notification.py` | 채널별 이벤트 bool 스키마 확장 |
| Modify | `backend/app/services/session_service.py` | S01~S13 세션 이벤트 발화 |
| Modify | `backend/app/services/chat_service.py` | C01 message_id, C02~C05 방 이벤트 발화 |
| Modify | `backend/app/services/report_service.py` | R01/R03/R04 이벤트 발화 |
| Modify | `backend/app/services/org_service.py` | O01/O02/O05/O06, A03 이벤트 발화 |
| Modify | `backend/app/services/org_management_service.py` | O03/O04 이벤트 발화 |
| Modify | `backend/app/services/credential_service.py` | V01 이벤트 발화 |
| Modify | `backend/app/services/personal_office_service.py` | P01 이벤트 발화, O06 확장 |
| Modify | `backend/app/api/v1/chat.py` + `chat_service.py` | 메시지 주변 조회 API, 읽음 연동 |
| Modify | `backend/app/api/v1/notifications.py` | type/event 필터, `{marked}` 정합 |
| Modify | `frontend/src/pages/notifications/NotificationCenterPage.tsx` | 딥링크 클릭 이동, UX 개선 |
| Modify | `frontend/src/hooks/useNotificationSocket.ts` | created_at/is_read 수신, 딥링크 토스트 |
| Modify | `frontend/src/stores/notificationStore.ts` | 딥링크 필드 보존 |
| Modify | `frontend/src/components/layout/AppShell.tsx` + `ClientShell.tsx` | 토스트 클릭 딥링크 |
| Create | `frontend/src/pages/client/ClientNotificationPage.tsx` | 내담자 알림 센터 |
| Modify | `frontend/src/pages/client/ClientAppPage.tsx` | `/app/notifications` 분기 |
| Modify | `frontend/src/lib/api/notifications.ts` | 딥링크 타입, 필터 파라미터 |

## Tasks

### Phase 1 — 백엔드 표준 계약 (핵심 선행)
- **Task 1:** `notification_service.py`에 `STANDARD_TARGET_TYPES`, `EVENT_CATALOG`(33종 이벤트→type/수신자 메타), `build_standard_extra()` 도입. `notify_event`가 표준 extra를 검증·병합하고 REST/WS 동일 필드 반환. **Files:** `notification_service.py`, `schemas/notification.py` **Estimate:** 15min
- **Task 2:** `user.py` `DEFAULT_NOTIFICATION_PREFERENCES`를 이벤트 카탈로그에 맞게 확장(이메일 기본값: 세션 예약/변경/취소/초대·검증·기관 결과·계정 정지/복구 True, 나머지 False). **Files:** `models/user.py` **Estimate:** 10min
- **Task 3:** `schemas/notification.py` 채널 스키마를 이벤트별 bool로 확장(호환: 미제출 키 보존). **Files:** `schemas/notification.py` **Estimate:** 10min

### Phase 2 — 이벤트 발화 일원화
- **Task 4:** 세션 S01~S13 발화. 상태 전이 함수(create/update/cancel/transition_status/join_session/invite/remove/delete)에서 `notify_event` 호출, 대기자 제외·행위자 제외·회원만 대상. **Files:** `session_service.py` **Estimate:** 20min
- **Task 5:** 채팅 C01(message_id 포함)·C02~C05 발화. **Files:** `chat_service.py` **Estimate:** 15min
- **Task 6:** 리포트 R01/R03/R04 + 기존 R02 표준 extra 적용. **Files:** `report_service.py`, `tasks/report_task.py` **Estimate:** 10min
- **Task 7:** 기관·검증·계정·개인상담소 O01~O06/A03/V01/P01 발화. **Files:** `org_service.py`, `org_management_service.py`, `credential_service.py`, `personal_office_service.py` **Estimate:** 20min

### Phase 3 — API 확장
- **Task 8:** 메시지 주변 조회 API(방 ID+메시지 ID → 접근 검증 → 대상 메시지·앞뒤 구간·커서). **Files:** `api/v1/chat.py`, `chat_service.py` **Estimate:** 15min
- **Task 9:** 메시지 읽음 ↔ 알림 읽음 연동(같은 user·room·message_id 알림만 읽음). **Files:** `chat_service.py` **Estimate:** 10min
- **Task 10:** 알림 목록 type/event 필터 + 전체읽음 `{marked}` 정합. **Files:** `api/v1/notifications.py`, `notification_service.py` **Estimate:** 10min

### Phase 4 — 프론트 딥링크 + 센터
- **Task 11:** 딥링크 유틸(`resolveNotificationTarget(extra)` → 라우트 경로+파라미터) + `NotificationCenterPage` 클릭 이동. **Files:** `lib/api/notifications.ts`, `pages/notifications/NotificationCenterPage.tsx` **Estimate:** 15min
- **Task 12:** `useNotificationSocket` created_at/is_read 수신 + 토스트 클릭 딥링크 + 배지 정합. **Files:** `hooks/useNotificationSocket.ts`, `stores/notificationStore.ts`, `AppShell.tsx`, `ClientShell.tsx` **Estimate:** 15min
- **Task 13:** 내담자 알림 센터(`ClientNotificationPage`) + `/app/notifications` 분기. **Files:** `pages/client/ClientNotificationPage.tsx`, `pages/client/ClientAppPage.tsx` **Estimate:** 15min
- **Task 14:** 채팅 메시지 딥링크(`?message={id}` 스크롤·하이라이트·주변 조회 폴백). **Files:** `pages/chat/ChatPage.tsx`, `pages/client/ClientChatPage.tsx`, `components/chat/ChatRoom.tsx` **Estimate:** 20min

## Testing Strategy
- `cd backend && pytest` — 신규 이벤트 발화·표준 extra·읽음 연동 테스트
- `cd frontend && npm run build` + `npx tsc -b --noEmit` — 타입·빌드 검증
- verify.md 시나리오 실제 실행(딥링크 이동·읽음 정합·레거시 폴백)
