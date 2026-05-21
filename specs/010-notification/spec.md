# F10 — 알림 시스템 (이메일·인앱·설정)

## 현재 상태
- ✅ `Notification` 모델 존재: id·user_id·type·title·body·is_read·extra·created_at
- ✅ `EmailService` 존재: Resend API, `send_verification_email`, `send_welcome_email`
- ✅ F8 리포트 승인 시 Notification 생성됨 (인앱 알림)
- ❌ Notification API 없음 (목록·읽음처리)
- ❌ 이메일 발송 트리거 없음 (이벤트→이메일 매핑)
- ❌ 알림 설정 UI 없음
- ❌ User.notification_preferences 필드 없음

## 구현 범위

### 백엔드

#### 1. NotificationPreferences (User 모델 확장)
- `app/models/user.py`에 `notification_preferences` 컬럼 추가 (JSONB, nullable)
- 기본값: `{"email": {"session_booked": true, "session_cancelled": true, "chat_message": false, "report_ready": true, "verification_result": true}, "in_app": {"session_booked": true, "session_cancelled": true, "chat_message": true, "report_ready": true, "verification_result": true}}`
- Alembic 마이그레이션

#### 2. Notification API (`app/api/v1/notifications.py`)
- `GET /notifications` — 내 알림 목록 (읽음/안읽음 필터, 페이지네이션)
- `GET /notifications/unread-count` — 안 읽은 알림 개수 (배지용)
- `PUT /notifications/{id}/read` — 읽음 처리
- `PUT /notifications/read-all` — 전체 읽음 처리

#### 3. Notification 환경설정 API
- `GET /notifications/preferences` — 내 알림 설정 조회
- `PUT /notifications/preferences` — 알림 설정 변경 (전체 replace)

#### 4. Notification Service (`app/services/notification_service.py`)
- `create_notification(user_id, type, title, body, extra)` — 인앱 알림 생성
- `notify_event(event_type, user_id, data)` — 이벤트 라우터:
  - 인앱: Notification 생성
  - 이메일: 수신자 설정 확인 → Resend 발송 (템플릿)
- `send_email_notification(to_email, subject, body)` — 이메일 발송 위임
- 이벤트 타입: session_booked, session_updated, session_cancelled, chat_message, report_ready, verification_result

#### 5. NotificationSchemas (`app/schemas/notification.py`)
- NotificationResponse
- NotificationPreferencesRequest/Response

#### 6. pytest: 10+ 테스트
- 알림 생성 + 목록 조회 + 읽음 처리
- 전체 읽음 처리
- 안 읽은 개수 조회
- 환경설정 조회·변경
- 이메일 발송 (Mock Resend)
- 채널별 ON/OFF 확인

### 프론트엔드

#### 1. API 클라이언트 (`lib/api/notifications.ts`)
- listNotifications, getUnreadCount, markRead, markAllRead
- getPreferences, updatePreferences

#### 2. NotificationCenterPage (`pages/notifications/NotificationCenterPage.tsx`)
- AppShell 래퍼
- 알림 목록 (읽음/안읽음 시각적 구분)
- 읽지 않은 알림: 왼쪽 보라색 점 + bold 텍스트
- 읽은 알림: 일반 텍스트
- 우측 상단 "전체 읽음" 버튼
- 알림 카드: 아이콘(타입별) + 제목 + 본문 + 상대시간
- 타입별 아이콘: 세션📅·채팅💬·리포트📄·검증✅

#### 3. Notification Preferences 컴포넌트
- NotificationCenterPage 하단 또는 별도 설정 탭
- 채널별(이메일·인앱) + 이벤트별 토글 스위치
- UI Kit 보라색 토글

#### 4. AppShell 알림 배지
- 기존 알림 벨 버튼에 안 읽은 개수 배지 추가
- `useNotificationBadge` 훅: 주기적 폴링 (30초) 또는 WebSocket

#### 5. App.tsx 라우트
- `/notifications` → NotificationCenterPage

#### 6. AppShell 사이드바
- "알림" 메뉴 추가 (bell 아이콘)

### 기존 코드 통합
- F8 report_service.py: `notify_event("report_ready", ...)` 호출로 교체
- 추후 F5 세션·F6 채팅 등에서도 `notify_event` 호출 추가

## 주의
- 이메일 발송은 사용자 환경설정에서 `email.{event_type} = true`일 때만
- Resend API 실패 시 재시도 3회 + 로그
- §18 승인 게이트: 실제 이메일 발송 전 Brian 확인 (MVP1에서는 인앱 알림 우선)
- `cd frontend && npm run build` + `cd backend && pytest` 검증
