# Mind Breeze 2.0 — 노티피케이션(알림) 시스템 재설계 리서치 브리프

> Supervisor(Hermes)가 현재 코드를 정적 분석해 작성한 확정 사실 기반 브리프.
> 이 문서를 읽고 **기획서(구현 금지)**를 작성하라. 추측 대신 아래 "현재 구조"를 파일:라인 근거로 검증하고, 틀린 전제가 있으면 "현재 구조 정정" 섹션에 명시하라.

---

## 1. 배경 & 목표

시스템이 커지면서(기관·상담사·내담자·채팅·클래스·리포트·세션 라이프사이클) 여러 기능에서 알림이 흩어져 발화되고 있다. 사용자 화면에는 "새 알림이 도착했습니다" 토스트와 알림 벨 배지가 뜨지만, **① 어떤 이벤트가 어떤 알림을 만드는지 체계가 없고 ② 알림을 클릭했을 때의 후속 행위(딥링크 이동)가 정의되지 않아** UX가 단절되어 있다.

**목표**: 시스템 전반의 알림 체계(이벤트→알림 매핑)를 수립하고, 알림 클릭 시 후속 행위(예: 채팅 메시지 알림 클릭 → 해당 채팅방의 해당 메시지로 이동)를 정의해 사용자 UX를 극대화한다.

**산출물은 기획서(Phase 1)다. 코드 구현 금지.** 기획서는 다음 구현(SDD 편성)의 입력이 된다.

---

## 2. 현재 알림 시스템 구조 (확정 사실 — 파일:라인 근거)

### 2-1. 백엔드 모델
- `backend/app/models/notification.py` — `Notification` 테이블: `id`, `user_id(FK users)`, `type(String 30)`, `title(String 200)`, `body(Text)`, `is_read(Boolean)`, `extra(JSONB)`, `created_at`
- `backend/app/models/user.py:11` — `DEFAULT_NOTIFICATION_PREFERENCES`: email/in_app 채널 × `session_booked/session_cancelled/chat_message/report_ready/verification_result` 5개 이벤트 bool. `User.notification_preferences` JSONB에 저장.

### 2-2. 알림 서비스
- `backend/app/services/notification_service.py`
  - `EVENT_TO_NOTIF_TYPE`(17행): `session_booked/session_updated/session_cancelled→session`, `chat_message→chat`, `report_ready→report`, `verification_result→verification`
  - `create_notification(user_id, notif_type, title, body, db, extra)`(51행): DB insert만
  - `notify_event(event_type, user_id, data, db)`(92행): 이벤트 라우터 — 인앱 알림 생성 + (설정 시) 이메일 발송 + 실시간 `broadcast_notification`
  - `send_email_notification`(71행): Resend 재시도 3회
  - 목록/읽음/전체읽음/설정 조회·변경 함수(138~234행)
- 실시간 브로드캐스트: `backend/app/ws/chat_namespace.py:112` `broadcast_notification(user_id, notif_data)` → `new_notification` 이벤트를 `room=f"user:{user_id}"`에 emit (Socket.IO `/chat` 네임스페이스)

### 2-3. 알림 API
- `backend/app/api/v1/notifications.py`
  - `GET /notifications` (only_unread/limit/offset), `GET /notifications/unread-count`, `PUT /notifications/{id}/read`, `PUT /notifications/read-all`, `GET/PUT /notifications/preferences`

### 2-4. 실제 발화 지점 (현재 5곳뿐)
| 위치 | 이벤트/타입 | extra(딥링크) payload | 상태 |
|---|---|---|---|
| `chat_service.py:959` | `chat_message` | `{room_id, sender_id}` | ✅ 딥링크 가능 |
| `report_service.py:518` | `report_ready` | `{report_id, session_id}` | ✅ 딥링크 가능 |
| `counselor_info_service.py:282,346` | `system`(정보수정) | `{changed_fields, actor_kind}` | ❌ 딥링크 없음 |
| `org_service.py:394` | (직접 create_notification) | — | ⚠️ 확인 필요 |
| `personal_office_service.py:118` | (직접 create_notification) | — | ⚠️ 확인 필요 |

### 2-5. 프론트엔드
- `frontend/src/pages/notifications/NotificationCenterPage.tsx`
  - 알림 목록 + 읽음/전체읽음 + 채널별(이메일/인앱) 토글 설정
  - **`handleClick`(133~147행): `markRead`만 호출 — 딥링크 이동 없음** ← 핵심 갭
  - `TYPE_ICONS/TYPE_LABELS/EVENT_LABELS`: session/chat/report/verification/system
- `frontend/src/stores/notificationStore.ts` — `unread`, `toast`, `wsConnected`
- `frontend/src/hooks/useNotificationSocket.ts` — `new_notification` 수신 → unread 갱신 + 토스트 + (chat이면) 채팅방 목록/미리보기 갱신
- `frontend/src/components/layout/AppShell.tsx` — 벨 아이콘 + `unread` 배지 + 토스트, 클릭 시 `/notifications` 이동
- `frontend/src/components/layout/SidebarNav.tsx` — `/notifications` 메뉴(역할별)
- `frontend/src/lib/api/notifications.ts` — API 클라이언트

---

## 3. 핵심 갭 (이번 기획이 해결해야 할 것)

1. **알림 클릭 후속 행위(딥링크) 부재**: extra에 `room_id`/`report_id`가 담겨도 클릭 시 해당 화면(채팅방/리포트/세션)으로 이동하지 않는다. 채팅 메시지 알림 클릭 → 해당 채팅방·메시지로, 리포트 알림 클릭 → 해당 리포트 상세로 이동하는 라우팅 정의가 필요.
2. **이벤트 커버리지 불완전**: `EVENT_TO_NOTIF_TYPE`에 `session_booked/session_updated/session_cancelled`가 정의돼 있으나 **실제 notify_event 호출부가 없다**(세션 예약·취소 시 알림 미발생). 클래스 회원 초대(SDD-092), 세션 라이프사이클(ready/open/in_progress/completed), 클래스 시작 등 신규 기능의 알림도 체계적으로 정의 안 됨.
3. **extra(딥링크 payload) 표준화 부재**: 이벤트마다 `room_id`/`report_id`/`changed_fields` 등 제각각. 딥링크 대상·라우트 매핑의 표준 스키마가 필요.
4. **발화 지점 일관성 부재**: `notify_event`(라우팅)와 `create_notification`(직접)이 혼용.

---

## 4. 역할 분할 (2워커 병렬)

### 워커 A — Claude(fable): 백엔드 알림 체계 + 데이터 설계
산출물: `docs/notification-system/01-backend-기획.md`

다룰 내용:
- **이벤트 카탈로그 전수 정의**: 현재 시스템의 모든 알림 발생 이벤트를 나열(세션 예약/변경/취소, 세션 라이프사이클 ready/open/in_progress/completed, 채팅 메시지/방 초대/방 생성, 리포트 승인·발행, 검증 결과, 기관/상담사 정보 변경, 개인상담소 개설·해제 등). 각 이벤트의 발화 주체·수신자(역할별)·타이틀/본문 템플릿.
- **딥링크 payload(extra) 표준 스키마**: `extra`에 담을 딥링크 필드 표준(예: `target_type` + `target_id` + `params`) 정의. 이벤트별 딥링크 대상 매핑표.
- **알림 유형(type) 재정의**: 현재 `String(30)`의 type 값들을 정리·확장(세션/채팅/리포트/검증/시스템/클래스/기관 등).
- **발화 일원화**: `notify_event`로 통일할지, 어느 지점에 `notify_event` 호출을 추가해야 하는지(세션 서비스·클래스 초대 서비스 등) 구체 위치(파일 기준) 제안.
- **권한·수신자 규칙**: 역할(counselor/client/org_admin/platform_admin)별 누가 어떤 알림을 받는지.
- **환경설정 확장**: 현재 5개 이벤트 → 새 이벤트 카탈로그에 맞게 확장.
- **실시간/이메일 채널 정책**: 인앱(WS) vs 이메일 발송 기준.

### 워커 B — Codex(gpt-6-astra): 프론트 UX + 알림 클릭 후속 행위(딥링크)
산출물: `docs/notification-system/02-frontend-기획.md`

다룰 내용:
- **알림 클릭 → 후속 행위(딥링크) UX 정의**: 알림 타입별 클릭 시 이동할 화면·라우트·대상(채팅 메시지 → 해당 채팅방의 해당 메시지 위치 스크롤, 리포트 → 해당 리포트 상세, 세션 → 해당 세션/클래스 화면, 검증 → 프로필/상태 화면 등). 현재 라우트 구조를 기준으로 실제 이동 경로 명세.
- **알림 센터 UX 개선**: 알림 카드에 딥링크 안내(화살표/호버), 읽음/안읽음 시각 구분 강화, 그룹핑(이벤트별/날짜별), 필터(타입별/읽음), 빈 상태·오류 상태.
- **토스트/배지 UX**: 토스트 클릭 시에도 딥링크 이동, 배지 갱신 정책(폴링 vs WS), "보고 있는 방이면 토스트/배지 제외" 규칙 정합.
- **라우트 매핑 테이블**: 알림 타입 × 대상 라우트 × 필요 파라미터(room_id/report_id/session_id 등) 표.
- **브랜드·디자인**: Mind Breeze 보라(#5F0080)·크림(#F7F4F0)·민트(#01f0c8), Pretendard. 기존 알림 센터 컴포넌트를 기준으로 개선안.

---

## 5. 공통 지침 (양쪽 워커 모두)

- **한국어**로 작성.
- **구현 금지, 기획 문서만.** 코드는 일절 수정하지 않는다.
- 각 주장은 **현재 코드 근거(파일:라인)**를 달아라. 모르는 것은 "확인 필요"로 명시하고 추측 금지.
- 브리프의 "현재 구조" 전제가 소스와 다르면 **"현재 구조 정정(브리프 대비)" 섹션**에 근거와 함께 기록하라.
- 두 워커가 서로의 산출물 파일을 읽어 **API/라우트/딥링크 계약이 일치**하도록 하라(백엔드가 정의한 `extra` 딥링크 필드 ↔ 프론트가 사용하는 라우트 파라미터).
- 산출물 파일명·경로를 정확히 지킬 것.

---

## 6. 참고 문서

- `specs/010-notification/spec.md` — 기존 F10 알림 시스템 SDD 스펙(구현 이전 기획)
- `docs/채팅-기능-적용-기획안.md` — 채팅 재적용 기획(알림 연동 언급)
- `docs/MIND_BREEZE_2.0_종합_기획.md`, `docs/MIND_BREEZE_2.0_기능명세서.md`
