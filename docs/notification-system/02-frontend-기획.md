# 알림 시스템 재설계 — 프론트 UX와 클릭 후속 행위

작성일: 2026-09-27 · 워커 B · Phase 1 기획 · 구현 전 검토용

## 1. 목적과 판독 기준

알림 센터와 토스트에서 동일한 알림을 열면, 수신자의 역할에 맞는 실제 화면에서 관련 내용을 확인할 수 있게 한다. 채팅은 방과 메시지 위치, 리포트는 리포트 ID, 세션·클래스는 최신 상태를 보여 주는 상세 화면을 기준으로 한다. 현재 알림 센터는 읽음 처리만 수행하고 토스트는 방 ID만 보존하므로, 공통 클릭 계약과 대상 화면의 수신 동작을 함께 정의한다. **[현재 근거]** `frontend/src/pages/notifications/NotificationCenterPage.tsx:133-147`, `frontend/src/stores/notificationStore.ts:6-12`.

- **현재**는 정적 소스에서 확인한 사실이다. 파일 경로는 저장소 루트 기준이며, 줄 번호는 작성 시점 소스 기준이다. 실행 환경에서의 성공 여부를 검증한 결과는 아니다.
- **제안**은 후속 SDD에 전달할 제품 결정이다. 각 제안의 근거는 개선 대상인 현재 코드이며, 제안한 동작이 이미 구현됐다는 의미가 아니다.
- **확인 필요**는 백엔드 합의·권한 정책·추가 UX 설계가 필요한 사항이다. 기존 라우트와 새 쿼리 계약을 구분하며, 미확인 경로를 동작 가능한 경로로 취급하지 않는다.
- 범위는 이 문서뿐이다. 구현, 코드 변경, 배포, Linear 게시 및 별도 산출물 작성은 포함하지 않는다.

## 2. 현재 구조 정정(브리프 대비)

| 항목 | 확인 결과와 정정 | 현재 코드 근거 |
|---|---|---|
| 클릭 이동이 전부 없음 | 알림 센터에는 이동이 없지만 두 셸의 토스트에는 채팅 이동 코드가 있다. 다만 `/chat?room=…`, `/app/chat?room=…`를 만들고, 채팅 페이지는 경로의 방 ID만 읽으므로 대상 방 선택 계약이 불일치한다. | `frontend/src/pages/notifications/NotificationCenterPage.tsx:133-147`; `frontend/src/components/layout/AppShell.tsx:52-57`; `frontend/src/components/client/ClientShell.tsx:56-61`; `frontend/src/pages/chat/ChatPage.tsx:43-44,90-98`; `frontend/src/pages/client/ClientChatPage.tsx:56-60` |
| 내담자 알림 센터 | `/app/notifications` 메뉴와 분기는 있지만 실제 콘텐츠는 `ClientHomePage`이다. 상담사 알림 센터와 동등한 기능이 구현됐다고 볼 수 없다. 상담사 미연결 내담자는 그 분기 전에 코드 입력 화면으로 이동한다. | `frontend/src/components/layout/SidebarNav.tsx:110-116`; `frontend/src/pages/client/ClientAppPage.tsx:257-262,310-312` |
| 보고 있는 방의 배지 제외 | WS 수신 시 알림 벨의 서버 미읽음 수는 무조건 조회한다. 제외되는 것은 토스트와 채팅방 unread 증가다. 활성 방 일치만 검사하며 탭 가시성·메시지 노출 여부는 검사하지 않는다. | `frontend/src/hooks/useNotificationSocket.ts:54-85` |
| 채팅 읽음과 알림 읽음 | 방 진입은 방 전체 읽음을 요청하고 서버는 `extra.room_id`가 같은 채팅 알림도 읽는다. 반면 메시지별 읽음 API에는 Notification 갱신이 없다. 따라서 방을 계속 보고 있을 때 도착한 알림의 벨 감소까지 보장하지 않는다. | `frontend/src/components/chat/ChatRoom.tsx:102-108,186-192`; `backend/app/services/chat_service.py:1006-1014,1031-1101` |
| 채팅 payload로 딥링크 가능 | `room_id`, `sender_id`는 방 이동에 쓸 수 있지만 `message_id`가 없어 특정 메시지는 식별할 수 없다. 최근 50개 조회와 하단 스크롤만으로 오래된 메시지 도달을 보장할 수 없다. | `backend/app/services/chat_service.py:959-965`; `frontend/src/lib/api/chat.ts:116-117`; `frontend/src/components/chat/ChatRoom.tsx:116-122`; `backend/app/services/chat_service.py:864-877` |
| 실제 발화 “5곳” | 애플리케이션 발화 파일은 5개이나 호출 위치는 6개다. 채팅·리포트 각 1, 상담사 정보 변경 2, 기관 계정 상태 변경 1, 소속 해제 1이다. 공통 서비스 내부 호출은 별도다. | `backend/app/services/chat_service.py:959`; `backend/app/services/report_service.py:518`; `backend/app/services/counselor_info_service.py:282,346`; `backend/app/services/org_service.py:394`; `backend/app/services/personal_office_service.py:118`; `backend/app/services/notification_service.py:112` |
| 기관·개인 상담소 알림 | 기관 서비스는 계정 활성/비활성 `system` 알림에 `actor_kind`, `action`을 전달한다. 소속 해제는 별도 `org_removed` 타입과 `org_name`, `office_name`을 전달한다. 후자는 현재 센터 타입 사전에 없고 별도 확인 팝업이 존재한다. | `backend/app/services/org_service.py:390-395`; `backend/app/services/personal_office_service.py:112-125`; `frontend/src/pages/notifications/NotificationCenterPage.tsx:15-29`; `frontend/src/components/org/OrgRemovedNoticeDialog.tsx:21-23,38-44` |
| 사이드바·모바일 토스트 | `notificationBadge` prop은 전달되지만 SidebarNav의 배지 렌더는 채팅만 처리한다. 플랫폼 관리자 메뉴에는 알림 항목이 없다. 두 셸의 토스트는 `hidden md:flex`인 데스크톱 헤더 내부에 있다. | `frontend/src/components/layout/SidebarNav.tsx:119-125,127-169`; `frontend/src/components/layout/AppShell.tsx:108-170`; `frontend/src/components/client/ClientShell.tsx:112-174` |
| 센터 미읽음·갱신 | 센터 숫자는 첫 50개 로컬 목록의 미읽음 합계이고 전체 서버 unread를 사용하지 않는다. 읽음 처리 후 전역 벨을 갱신하지 않으며 WS 수신도 센터 목록을 갱신하지 않는다. | `frontend/src/pages/notifications/NotificationCenterPage.tsx:105-114,133-175`; `frontend/src/hooks/useNotificationSocket.ts:54-85` |
| 전체 읽음 응답 | 서버는 `{marked: count}`, 프론트 선언은 `{count: number}`다. 현재 센터는 반환 숫자를 사용하지 않지만 계약 정합화가 필요하다. | `backend/app/api/v1/notifications.py:62-68`; `frontend/src/lib/api/notifications.ts:51-52`; `frontend/src/pages/notifications/NotificationCenterPage.tsx:149-152` |
| 크림 브랜드 값 | 브리프는 `#F7F4F0`을 요구하지만 로드되는 기존 `--mb-cream`은 `#EBE6E2`다. 요청 색은 이번 알림 화면의 제안값으로 명시하고 기존 토큰의 현재 값으로 오인하지 않는다. | `frontend/src/main.tsx:4-5`; `frontend/src/mb-tokens.css:29-34`; 알림 카드의 현재 흰 배경은 `frontend/src/pages/notifications/NotificationCenterPage.tsx:64` |

## 3. 권장 접근과 우선순위

**제안: 역할을 고려하는 공통 대상 해석 규칙을 센터·토스트에 적용한다.** 화면별 분기 추가는 빠르지만 현재 두 셸의 잘못된 쿼리 계약을 반복하기 쉽다. 서버가 완성 URL을 보내는 방식은 역할별 웹 경로와 이벤트 생산자를 결합한다. `target_type + target_id + params`를 받아 프론트의 허용 경로로 변환하는 방식을 권장한다. 현재 `extra`는 자유 형식이고 프론트가 받은 값을 보존할 수 있으므로, 기존 DTO를 기반으로 점진적 전환을 기획할 수 있다. **[근거]** `frontend/src/lib/api/notifications.ts:5-12`, `backend/app/schemas/notification.py:9-16`, `frontend/src/components/layout/AppShell.tsx:52-57`, `frontend/src/components/client/ClientShell.tsx:56-61`.

1. **P0 — 도달 가능한 알림:** 내담자 센터 실체화, 역할별 방/리포트/세션 이동, 읽음·벨 정합화, 모바일 토스트, 오류/권한/레거시 대체 경로. **[근거]** `frontend/src/pages/client/ClientAppPage.tsx:310-312`, `frontend/src/pages/notifications/NotificationCenterPage.tsx:133-175`, `frontend/src/components/layout/AppShell.tsx:108-170`.
2. **P0 — 메시지 딥링크 선행 계약:** `message_id`, 메시지 주변 조회, 메시지별 알림 읽음 연동. 이 조건까지 충족해야 “해당 메시지로 이동”을 완료로 인정한다. 방만 여는 중간 결과는 별도로 표시한다. **[근거]** `backend/app/services/chat_service.py:959-965,1031-1101`, `backend/app/api/v1/chat.py:151-159`.
3. **P1 — 탐색·설정 확장:** 서버 기반 유형/읽음 필터, 날짜 그룹, 더 보기, 신규 이벤트 설정. **[근거]** `backend/app/api/v1/notifications.py:49-59`, `backend/app/schemas/notification.py:29-44`, `frontend/src/pages/notifications/NotificationCenterPage.tsx:105-114,207-264`.

## 4. 딥링크 payload와 백엔드 인계 계약

### 4.1 백엔드 문서 대조 상태

최종 검토 시점에도 `docs/notification-system/01-backend-기획.md`가 없어 문서 간 일치 여부는 **확인 필요**다. 아래는 프론트가 제안하는 계약이며 백엔드 확정안으로 간주하지 않는다. 현재 코드와의 차이는 명시했다. 백엔드 문서가 생성되면 필드명·대상 enum·역할별 수신자·메시지 ID·레거시 키 유지·읽음 연동을 대조해야 한다.

### 4.2 표준 extra 제안

현재 REST는 `extra` 전체와 `created_at/is_read`를 반환하고, WS는 `id/type/title/body/extra`를 전달한다. 토스트 상태는 `extra`를 버리고 `roomId`만 남긴다. **제안:** REST·WS·토스트가 아래 동일한 대상 정보를 보존하고, WS에도 서버 `created_at/is_read`를 포함한다. 누락된 시간은 수신 시각으로 날조하지 않고 목록 재조회로 보완한다. **[근거]** `backend/app/services/notification_service.py:118-126,157-170`, `frontend/src/hooks/useNotificationSocket.ts:54-68`, `frontend/src/stores/notificationStore.ts:6-12`.

| 필드 | 제안 계약 | 현재와의 차이·근거 |
|---|---|---|
| `extra.schema_version` | 신규 알림은 정수 `1`. 버전 미지원은 상세 이동을 차단하고 알림 내용만 표시. | 현재 버전 없음: `backend/app/services/chat_service.py:965`; `backend/app/services/report_service.py:524` |
| `extra.event_type` | `chat_message`, `report_ready` 등 세부 이벤트. 그룹핑·문구 구분용이며 권한 근거로 쓰지 않음. 신규 이벤트 키는 워커 A와 합의 필요. | 현재 라우터 입력에는 있지만 알림 응답 독립 필드에는 없음: `backend/app/services/notification_service.py:92-108,157-165` |
| `extra.target_type` | `chat_room`, `report`, `session`, `credentials`, `self_profile`, `organization`, `notice` 허용값 제안. 그 외는 정보 안내만. | 현재 `extra`는 자유 dict: `backend/app/schemas/notification.py:15` |
| `extra.target_id` | 방·리포트·세션·기관은 해당 UUID 필수. `credentials`, `self_profile`, `notice`는 null 허용하며 현재 로그인 사용자의 화면/알림 내용만 연다. | 현재 서로 다른 ID 전달: `backend/app/services/chat_service.py:965`; `backend/app/services/report_service.py:524`; 설정은 로그인 사용자 기준: `frontend/src/pages/SettingsPage.tsx:47-57` |
| `extra.params` | 객체. 채팅 메시지는 `message_id` 필수, 방 초대/생성은 생략 가능. 리포트의 `session_id`는 맥락용이며 `report_id` 대체 금지. 세션 상태는 힌트만 사용하고 도착 시 재조회. | 현재 메시지 ID 누락: `backend/app/services/chat_service.py:965`; 두 ID 구분: `backend/app/services/report_service.py:524`; 세션 재조회: `frontend/src/pages/client/ClientSessionDetailPage.tsx:68-84` |
| 기존 루트 extra 키 | 전환 중 `room_id/sender_id/report_id/session_id/changed_fields/actor_kind/org_name/office_name` 보존. 신규 필드와 기존 ID가 다르면 상세 이동 차단·재조회. | 서버 방 전체 읽음은 루트 `room_id`에 의존: `backend/app/services/chat_service.py:1006-1013`; 해제 팝업은 이름 키에 의존: `frontend/src/components/org/OrgRemovedNoticeDialog.tsx:35-36` |

**제안 payload 예시(설명용 데이터이며 구현 코드가 아님):**

- 채팅 메시지: `schema_version=1`, `event_type=chat_message`, `target_type=chat_room`, `target_id=<room UUID>`, `params.message_id=<message UUID>`; 기존 `room_id=<같은 room UUID>`, `sender_id=<sender UUID>` 병행. **[기존 근거]** `backend/app/services/chat_service.py:935-944,959-965`.
- 리포트 발행: `schema_version=1`, `event_type=report_ready`, `target_type=report`, `target_id=<report UUID>`, `params.session_id=<session UUID>`; 기존 `report_id/session_id` 병행. **[기존 근거]** `backend/app/services/report_service.py:518-524`.
- 소속 해제: `schema_version=1`, `target_type=notice`, `target_id=null`, `params={}` 및 기존 `org_name/office_name` 유지. 기관 ID는 현재 payload에 없으므로 이름으로 기관 경로를 만들지 않는다. 신규 `event_type`와 type 재분류는 **확인 필요**. **[기존 근거]** `backend/app/services/personal_office_service.py:118-125`.

### 4.3 레거시·API 호환 요구

**제안:** 버전이 없는 데이터만 레거시 규칙을 적용한다. `chat + room_id`는 방만 열고 “이전 알림은 메시지 위치를 제공하지 않습니다”를 안내한다. `report + report_id`는 역할별 리포트 상세로 이동한다. `system`은 제목 문자열로 이벤트를 추론하지 않고 내용 펼치기, `org_removed`는 기존 이름 기반 안내를 유지한다. `session_id`가 없는 세션 알림은 목록으로 이동하되 “세션을 특정할 수 없습니다”를 표시한다. 알려지지 않은 타입은 “기타”로 표시하고 외부 URL이나 임의 경로를 실행하지 않는다. **[근거]** `frontend/src/pages/notifications/NotificationCenterPage.tsx:60,85-86`, `backend/app/services/counselor_info_service.py:282-287`, `backend/app/services/personal_office_service.py:118-125`, `backend/app/services/chat_service.py:965`, `backend/app/services/report_service.py:524`.

**백엔드 합의 필요:** (1) 모든 생산자의 표준 extra 적용 및 REST/WS 동일성, (2) 메시지 주변 조회와 접근/삭제 오류 구분, (3) 메시지별 읽음→연결된 알림 읽음 처리, (4) 전체 읽음 응답 `marked` 정합화, (5) 알림 유형 필터·동률 정렬·페이지 중복 방지, (6) 환경설정 스키마 확장. 현재 각각 자유 extra, limit 단독 메시지 조회, 알림 갱신 없는 메시지별 읽음, 프론트 응답 타입 불일치, only_unread/offset 조회, 고정 5개 설정이라는 제약이 있다. **[근거]** `backend/app/schemas/notification.py:15,29-44`, `backend/app/api/v1/chat.py:151-159`, `backend/app/services/chat_service.py:1031-1101`, `backend/app/api/v1/notifications.py:49-68`, `frontend/src/lib/api/notifications.ts:51-52`, `backend/app/services/notification_service.py:146-150`.

## 5. 알림 타입 × 대상 라우트 × 파라미터

아래 **경로 자체는 현재 코드에 존재**하며, `?message=`만 신규 제안이다. 현재 `type`은 화면 분류이고 실제 대상 선택은 표준 `target_type`과 로그인 역할로 결정한다. 권한은 대상 API에서 다시 확인한다. 신규 이벤트 수신자와 type 확장은 **확인 필요**이며 존재하지 않는 `/classes/:id`, `/verification/:id`를 사용하지 않는다. **[근거]** `frontend/src/App.tsx:130,159-172,180-182,231-232`, `backend/app/services/notification_service.py:17-24`, `backend/app/services/report_service.py:380-387`.

| 알림 유형 / 이벤트 | 대상 사용자·화면 | 경로 계약 | 필요 파라미터·도착 동작 | 현재 코드 근거 |
|---|---|---|---|---|
| `chat` / 메시지 | 상담사·기관 관리자 중 방 접근 가능한 사용자 | `/chat/{room_id}?message={message_id}` | target ID=room UUID; message 쿼리 수신·스크롤은 신규. | `frontend/src/App.tsx:171-172`; `frontend/src/pages/chat/ChatPage.tsx:90-108`; `frontend/src/components/chat/ChatRoom.tsx:116-122` |
| `chat` / 메시지 | 내담자 | `/app/chat/{room_id}?message={message_id}` | 같은 대상 정보, 내담자 경로 사용. 상담사 연결 게이트 처리 선행. | `frontend/src/pages/client/ClientAppPage.tsx:257-266`; `frontend/src/pages/client/ClientChatPage.tsx:56-60` |
| 채팅방 초대·생성 / type 합의 필요 | 방 접근 가능한 상담사·기관 관리자·내담자 | `/chat/{room_id}` 또는 `/app/chat/{room_id}` | `room_id` 필수; 메시지 위치 없음. 실제 초대 수신 알림의 발화 계약은 확인 필요. | 방 경로: `frontend/src/App.tsx:171-172`; 참여자 정보: `backend/app/services/chat_service.py:844-860` |
| `report` / `report_ready` | 내담자 리포트 상세 | `/app/reports/{report_id}` | target ID=report UUID. session UUID로 대체하지 않음. 승인·발행된 결과 확인. | `frontend/src/pages/client/ClientAppPage.tsx:275-278`; `frontend/src/pages/client/ClientReportDetailPage.tsx:29-40`; `backend/app/services/report_service.py:515-524` |
| `report` / 검토 요청 등 신규 이벤트 | 담당 상담사·접근 가능한 기관 관리자 | `/reports/{report_id}` | target ID=report UUID. 클릭 자체로 승인·발송하지 않음. 신규 이벤트 수신자 확정 필요. | `frontend/src/App.tsx:180-182`; `backend/app/services/report_service.py:443-451,494-505` |
| `session` / 예약·변경·취소 | 상담사·기관 관리자 / 내담자 | `/sessions/{session_id}` / `/app/sessions/{session_id}` | 세션 ID 필수. 최신 일시·취소 상태 표시; 취소 알림을 입장으로 연결하지 않음. | `frontend/src/App.tsx:164-166`; `frontend/src/pages/client/ClientSessionDetailPage.tsx:56-84,142-146` |
| 세션·클래스 ready/open/in_progress/paused/completed / type 합의 필요 | 호스트·접근 가능한 운영자 / 참여 내담자 | 위와 동일한 세션 상세 | 알림 상태를 믿고 자동 시작하지 않음. open/in_progress/paused는 상세의 입장 CTA, ready/scheduled는 대기 안내, completed는 종료 정보. | `frontend/src/pages/client/ClientSessionDetailPage.tsx:97-145`; 호스트 전용 화면 경로 `frontend/src/App.tsx:168-170` |
| 클래스 회원 초대 / type·이벤트 키 합의 필요 | 초대된 내담자 | `/app/sessions/{session_id}` | 세션 상세에서 참여 상태 확인 후 `/join?code={access_code}`. 코드는 최신 상세 응답에서 획득. 알림 클릭 자체로 초대 수락·동의 처리하지 않음. | 초대는 참여자 추가: `backend/app/services/session_service.py:491-522`; 상세 입장: `frontend/src/pages/client/ClientSessionDetailPage.tsx:103-109`; join 쿼리: `frontend/src/pages/class-join-page.tsx:107-110` |
| `verification` / 상담사 자격 검증 결과 | 당사자 자격·상태 화면 | `/credentials` | `target_type=credentials`; 본인 인증 등급과 증빙 목록. 개별 증빙 자동 선택은 별도 계약 확인 필요. | `frontend/src/App.tsx:163`; `frontend/src/pages/credentials/CredentialDashboardPage.tsx:116-140,241-243` |
| 검증 결과 중 기관 가입·소속 요청 | 신청 당사자 | `/org/requests` 후보 | 자격 검증과 구분할 이벤트/대상 계약 확인 필요. 식별 불가한 기존 verification은 센터에서 내용 확인; 일괄 credentials 이동 금지. | 현재 별도 라우트: `frontend/src/App.tsx:159,163`; 이벤트는 단일 키: `backend/app/services/notification_service.py:23` |
| `system` / 본인 정보 수정 | 상담사·기관 관리자 / 내담자 | `/settings` / `/app/profile` | 신규 `self_profile` 대상에만 사용. changed_fields는 표시 정보이며 자동 스크롤 가능한 필드 ID는 현재 미정. | `frontend/src/pages/SettingsPage.tsx:54-61`; `frontend/src/pages/client/ClientAppPage.tsx:314-315`; 생산 payload `backend/app/services/counselor_info_service.py:282-287,346-351` |
| 기관 정보 변경 / type 합의 필요 | 접근 가능한 기관 관리자 | `/org/{org_id}` | `target_type=organization`, 기관 UUID 필수. 탈퇴·소속 해제로 권한 상실 시 내용 확인으로 대체. | `frontend/src/App.tsx:162`; `frontend/src/pages/org/OrgManagementPage.tsx:22-24,42-57` |
| `system` / 계정 활성·비활성 | 통지 당사자 | 역할별 알림 센터 내부 내용 펼침 | 별도 계정 상태 상세 경로 확인 필요. status action을 프론트에서 다시 실행하지 않음. 인증 불가 시 일반 로그인 안내. | `backend/app/services/org_service.py:390-395`; 읽음 소유권 검사 `backend/app/services/notification_service.py:183-192` |
| `org_removed` / 기관 소속 해제·개인 상담소 전환 | 상담사·기관 관리자 | 역할별 센터 내용 펼침, 보조 CTA `/settings` | 기존 안내 팝업과 같은 알림 ID의 읽음 공유. office_name을 org_id로 사용하지 않음. | `backend/app/services/personal_office_service.py:118-125`; `frontend/src/components/org/OrgRemovedNoticeDialog.tsx:35-44`; `frontend/src/App.tsx:232` |
| 알 수 없는 타입·깨진 payload | 모든 수신자 | 내담자 `/app/notifications`, 그 외 `/notifications` | 센터 내 내용 확인. 누락된 ID를 제목/본문에서 추출하지 않음. | `frontend/src/App.tsx:231`; `frontend/src/pages/client/ClientAppPage.tsx:310-312`(내담자 센터 구현 필요) |

**플랫폼 관리자:** `/notifications` 경로는 존재하나 전용 메뉴는 없다. 알림 진입점 추가를 제안하되 상담사·내담자 화면에 무조건 보내지 않는다. 향후 검토 업무 알림은 기존 `/admin/reviews/{targetType}/{id}`가 후보이며 허용 `targetType`과 수신자 계약을 확정한 후 연결한다. 현 단계에서는 이 경로를 일반 `verification_result`의 기본값으로 채택하지 않는다. **[근거]** `frontend/src/App.tsx:94-108,191-197,231`, `frontend/src/components/layout/SidebarNav.tsx:119-125`.

**리포트 ID 주의:** 내담자 세션 상세의 현재 “리포트 보기”는 `/app/reports/${session.id}`로 이동하지만 리포트 상세는 받은 ID로 `getReport`를 호출하고 서버도 Report.id로 조회한다. 이 기존 동작을 알림 계약에 복제하지 않는다. 리포트 알림은 반드시 payload의 report_id를 사용하고, 세션 완료 알림에서 report_id를 확보하지 못하면 세션 상세에 머문다. **[근거]** `frontend/src/pages/client/ClientSessionDetailPage.tsx:128-136`, `frontend/src/pages/client/ClientReportDetailPage.tsx:31-40`, `backend/app/services/report_service.py:380-383`.

## 6. 클릭부터 도착까지의 UX

### 6.1 공통 흐름과 읽음 의미

**제안 순서:** 알림 선택 → 중복 클릭 잠금 → 인증·payload 형식과 역할 경로 확인 → 알림 읽음 요청 및 대상 화면 이동 → 대상 API 접근 결과 표시 → 서버 미읽음 수와 센터 목록 재동기화. 알림을 열었다는 사실과 대상 데이터 열람 성공을 구분한다. 알림 읽음이 네트워크 문제로 실패해도 대상 이동은 허용하고 “읽음 상태를 저장하지 못했습니다”와 재시도를 제공한다. 403/404인 알림 읽음 응답은 해당 알림을 재검증하고 상세 이동을 중단한다. 이미 읽은 알림도 동일하게 이동하며 읽음 API만 생략한다. **[근거]** 현재 클릭은 읽음 성공 뒤 로컬 배열만 갱신: `frontend/src/pages/notifications/NotificationCenterPage.tsx:133-147`; 서버는 소유권과 존재 확인: `backend/app/services/notification_service.py:183-192`.

**제안:** 대상이 삭제되거나 접근 권한이 없어도 사용자가 확인한 알림은 읽음으로 유지한다. 실패 화면은 “현재 이 내용을 열 수 없습니다”와 `다시 시도`(일시 오류), `알림으로 돌아가기`, `관련 목록`(권한이 허용되는 경우)을 제공한다. 서버 오류의 원문을 그대로 이용자에게 노출하지 않는다. 목록으로 돌아오면 필터·날짜 그룹·스크롤·선택 카드 위치를 복원한다. **[근거]** 현재 리포트 조회는 403/404를 반환하고 내담자 화면은 error.message와 목록 버튼을 표시: `backend/app/services/report_service.py:380-387`, `frontend/src/pages/client/ClientReportDetailPage.tsx:70-80`.

**제안:** 로그인 만료 시 안전하게 검증한 내부 목적지를 보존하고 로그인·필수 온보딩 이후 재시도한다. 현재 일반 역할은 `next`를 복원하지 않으므로 이를 기존 기능으로 전제하지 않는다. 새 사용자로 계정이 바뀌면 이전 알림 의도·토스트·목록을 폐기한다. 상담사 연결이 없는 내담자도 자신의 알림은 읽을 수 있도록 알림 센터를 연결 게이트와 분리하는 방안을 권장하며, 실제 세션·채팅 접근은 서버 판단을 따른다. **[근거]** `frontend/src/lib/auth-routing.ts:3-14`, `frontend/src/pages/LoginPage.tsx:29,72`, `frontend/src/pages/client/ClientAppPage.tsx:257-262`; 사용자별 목록 제한 `backend/app/services/notification_service.py:145-146`.

### 6.2 채팅 메시지 위치 이동

1. **제안:** 역할별 방 경로를 열고 방 접근 확인 후 `message` 쿼리를 읽는다. 현재 경로의 room ID 선택은 재사용 가능하나 message 쿼리 처리와 대상 전달은 새 작업이다. **[근거]** `frontend/src/pages/chat/ChatPage.tsx:43,90-98`, `frontend/src/pages/client/ClientChatPage.tsx:56-60`, `frontend/src/components/chat/ChatRoom.tsx:59-63`.
2. **제안:** 로드된 목록에 대상 메시지가 있으면 렌더링 후 가운데에 위치시키고 약 3초간 연보라 배경과 “알림의 메시지” 표식을 표시한다. 키보드 사용 시 메시지 컨테이너에 포커스를 옮기되 입력창으로 강제 이동하지 않는다. reduced-motion 사용자는 애니메이션 없이 표시한다. **[근거]** 기존 메시지 DOM 식별자와 ref: `frontend/src/components/chat/ChatRoom.tsx:181,297-306`.
3. **제안·백엔드 선행:** 없으면 방 ID+메시지 ID로 메시지 주변 구간을 한 번에 조회한다. 대상 존재 여부, 앞뒤 메시지, 이전/다음 페이지 커서를 반환하는 계약이 필요하다. 현재 API의 limit를 끝없이 늘리는 방식으로 성공을 가장하지 않는다. endpoint 이름·페이지 크기는 **확인 필요**. **[근거]** `frontend/src/lib/api/chat.ts:116-117`, `backend/app/api/v1/chat.py:151-159`, `backend/app/services/chat_service.py:864-877`.
4. **제안:** 조회 성공 전에는 “메시지 위치를 찾고 있습니다”. 메시지 삭제는 “해당 메시지를 찾을 수 없습니다”와 `최근 대화 보기`; 권한 없음은 센터/허용 목록 복귀; 일시 실패는 `다시 시도`로 구분한다. 삭제 여부는 현재 주변 조회 계약이 없으므로 서버 판별 방식 **확인 필요**. **[근거]** 현재 방 조회의 404·멤버 검사와 메시지 목록 반환: `backend/app/services/chat_service.py:864-877`.
5. **제안:** 딥링크 탐색 중에는 자동 최하단 스크롤을 멈춘다. 새 메시지가 와도 대상 위치를 유지하고 `새 메시지 N개`/`최근 대화로` 버튼을 제공한다. 같은 방에서 다른 알림을 누르면 URL의 message 변경만으로 다시 탐색하고, 뒤로가기는 이전 알림 위치로 복원한다. **[근거]** 현재 msgList 길이가 바뀔 때마다 하단 스크롤: `frontend/src/components/chat/ChatRoom.tsx:116-122`.
6. **제안:** 깊은 과거 메시지를 열었다고 방 전체를 읽음 처리하지 않는다. 해당 알림 읽음은 클릭 규칙을 따르고, 채팅 메시지 읽음은 실제 노출 메시지만 반영한다. 기존 입장 시 `markRoomRead`와 노출 기반 `markMessagesRead`의 혼용을 먼저 정리해야 한다. **[근거]** `frontend/src/components/chat/ChatRoom.tsx:102-108,186-221`, `backend/app/services/chat_service.py:989-1014,1031-1101`.

### 6.3 세션·클래스 및 검증의 후속 행위

**제안:** 세션 알림 클릭은 조회만 수행한다. 상세에 도착해 최신 상태를 확인한 사용자가 입장·재생·승인 등 별도 CTA를 누르게 한다. 클래스 입장은 `/join?code=…`의 현재 코드 입력/상세/대기 흐름을 사용하며, 알림에 참여 토큰이나 개인정보를 넣지 않는다. ready 알림을 open 알림처럼 자동 입장시키거나 completed 알림을 리포트 발행으로 해석하지 않는다. **[근거]** `frontend/src/pages/class-join-page.tsx:20,31-43,48-51,107-118`, `frontend/src/pages/client/ClientSessionDetailPage.tsx:97-145`.

**제안:** 검증 결과는 결과 조회→필요 시 본인 서류/정보 수정의 순서다. 승인·반려 자체를 클릭으로 실행하지 않는다. 소속 해제는 같은 ID의 팝업·센터 중 하나를 확인하면 나머지 표면도 읽음 상태를 공유한다. 기존 팝업의 이름 키를 유지하고 반복 안내를 방지한다. **[근거]** `frontend/src/pages/credentials/CredentialDashboardPage.tsx:131-150`, `frontend/src/components/org/OrgRemovedNoticeDialog.tsx:21-23,35-44`.

## 7. 알림 센터 UX

### 7.1 정보 구조와 카드

**제안:** 데스크톱은 현재 중앙 `max-w-2xl` 단일 열을 유지하고, 상단을 `알림 / 전체 미읽음 N / 모든 알림 읽음 / 알림 설정`으로 구성한다. 내담자 센터는 ClientShell 안에 같은 목록 기능을 두며 AppShell을 중첩하지 않는다. 플랫폼 관리자도 `/notifications`에 진입할 수 있는 알림 메뉴를 제공한다. **[근거]** `frontend/src/pages/notifications/NotificationCenterPage.tsx:178-205`, `frontend/src/pages/client/ClientAppPage.tsx:310-338`, `frontend/src/components/layout/SidebarNav.tsx:119-125`.

**제안 카드:** 유형 아이콘·한글 유형, 제목, 본문 2줄, 발생 시각, 읽음 상태, 도착 CTA 순서로 배치한다. 이동 가능한 카드는 `메시지 보기 →`, `리포트 보기 →`, `세션 확인 →`, `검증 결과 보기 →`처럼 목적지를 명시한다. 정보형은 `내용 확인`으로 펼치며 이동 화살표를 쓰지 않는다. 호버뿐 아니라 키보드 포커스에도 보라 외곽선, 모바일에서도 항상 CTA를 표시한다. 본문 전체는 펼쳐서 확인할 수 있게 한다. 별도 `읽음으로 표시`는 이동 없이 작동하도록 카드 주 동작과 분리한다. **[근거]** 현재 카드 전체가 단일 button이며 본문 2줄, 읽음 점, 유형 배지만 있음: `frontend/src/pages/notifications/NotificationCenterPage.tsx:53-95`.

**제안 읽음 표현:** 미읽음은 보라 좌측 선·점·굵은 제목에 접근성 이름 “읽지 않음”을 더한다. 읽음은 일반 제목과 중립 테두리로 표시하되 대비를 낮춰 내용을 숨기지 않는다. 알림 센터 진입/카드 화면 노출만으로 읽음 처리하지 않는다. `모든 알림 읽음`은 필터 결과나 현재 50개가 아닌 계정 전체에 적용됨을 안내하고, 성공 후 서버 값을 다시 받는다. **[근거]** 기존 시각 차이 `frontend/src/pages/notifications/NotificationCenterPage.tsx:64-91`; 서버 전체 범위 `backend/app/services/notification_service.py:195-207`.

### 7.2 그룹핑·필터·페이지

**제안 기본 그룹:** 최신순, 날짜별 `오늘 / 어제 / 이전 날짜(YYYY.MM.DD)`로 구분한다. 날짜 경계는 사용자 브라우저 시간대를 사용하고 상세 시각은 시간대와 절대 날짜를 함께 제공한다. 이미 `created_at`과 상대 시각 함수가 있으므로 이를 확장한다. 날짜가 잘못되었으면 “시간 정보 없음”으로 표시한다. **[근거]** `frontend/src/pages/notifications/NotificationCenterPage.tsx:40-50,77-78`, `frontend/src/lib/api/notifications.ts:12`.

**제안 필터:** 기본 `전체`, 보조 `읽지 않음`, 유형 `전체/채팅/세션·클래스/리포트/검증/계정·기관/기타`. 화면의 유형 그룹은 백엔드 type 재분류와 별도로 표시값을 매핑한다. 현재 서버에는 유형·읽음완료 전용 필터가 없으므로 우선 전체/미읽음만 기존 API로 제공하고, 유형 필터를 출시하려면 서버 조회·total 계약을 확장한다. 로드된 50개만 필터링한 결과를 전체 결과로 표시하지 않는다. **[근거]** `backend/app/api/v1/notifications.py:49-59`, `frontend/src/pages/notifications/NotificationCenterPage.tsx:105-108`, `frontend/src/lib/api/notifications.ts:15-19,32-42`.

**제안 이벤트 그룹:** 기본은 알림 1건당 카드 1개로 메시지 위치를 보존한다. 후속 확장에서는 같은 날짜·event_type·target_id별 접기만 제공하고, 그룹 선택은 내용을 펼치며 개별 메시지 CTA를 유지한다. 그룹 제목을 클릭했다고 묶인 모든 알림을 읽지 않는다. 현재 type만으로는 세부 이벤트 구분이 안 되므로 표준 event_type 도입 이후 활성화한다. **[근거]** 현재 목록의 1건별 카드 `frontend/src/pages/notifications/NotificationCenterPage.tsx:259-262`; 현재 응답에는 event_type 없음 `backend/app/services/notification_service.py:157-166`.

**제안 페이지:** 기존 limit/offset 기반 `더 보기`를 우선 사용하고 ID로 중복 제거한다. 읽음 필터에서 읽음 처리로 항목이 빠지거나 새 알림이 들어오면 첫 페이지부터 재검증하되 이미 보는 위치를 갑자기 이동시키지 않는다. 연속 이벤트에서는 “새 알림 N개” 버튼으로 갱신한다. 장기적으로 서버의 created_at+id 안정 정렬·커서 지원은 **확인 필요**. **[근거]** `backend/app/services/notification_service.py:146-150`, `frontend/src/pages/notifications/NotificationCenterPage.tsx:105-108,259-262`.

### 7.3 빈 상태·오류·설정

| 상황 | 제안 표시와 동작 | 개선 대상의 현재 근거 |
|---|---|---|
| 최초 로딩 | 카드 스켈레톤과 `불러오는 중`; 완료 전 “모든 알림을 읽었습니다” 숨김 | `frontend/src/pages/notifications/NotificationCenterPage.tsx:175-187,247-250` |
| 전체 없음 | `아직 받은 알림이 없습니다`와 세션·채팅·리포트 안내 | `frontend/src/pages/notifications/NotificationCenterPage.tsx:250-256` |
| 미읽음 없음 | `읽지 않은 알림이 없습니다` + 전체 보기 | 현재 목록 호출은 전체 고정: `frontend/src/pages/notifications/NotificationCenterPage.tsx:107` |
| 필터 결과 없음 | `조건에 맞는 알림이 없습니다` + 필터 초기화 | 유형 필터 미지원 API: `backend/app/api/v1/notifications.py:49-59` |
| 최초 조회 실패 | 오류 안내·재시도; 정상 빈 상태와 구별 | 현재 error 배너와 빈 목록이 동시에 가능: `frontend/src/pages/notifications/NotificationCenterPage.tsx:109-113,179-181,250-256` |
| 추가 조회/실시간 갱신 실패 | 기존 목록 유지, 목록 하단/상단에 재시도 | 현재 로컬 목록 단일 조회: `frontend/src/pages/notifications/NotificationCenterPage.tsx:99-114` |
| 읽음/전체읽음 실패 | 실패한 상태만 원복·재시도; 서버 벨 재조회 | 현재 개별 실패 무시·전체 실패 error 표시: `frontend/src/pages/notifications/NotificationCenterPage.tsx:133-155` |
| 설정 조회·저장 실패 | 기존 값 유지, 실패한 행과 재시도 표시, 저장 중 중복 입력 방지 | 현재 실패 무시: `frontend/src/pages/notifications/NotificationCenterPage.tsx:116-122,158-170` |

**제안 설정:** “메일 알림 설정”을 “알림 설정”으로 바꾸고 이메일·인앱 채널을 구분한다. 세션 변경은 현재 예약 설정을 공유하므로 초기 문구는 “세션 예약·변경”으로 정확히 표현하고, 독립 토글은 서버 확장 후 제공한다. 새 이벤트를 프론트에만 추가하지 않는다. 알림 센터와 `/settings`의 중복 설정 UI는 같은 라벨·저장 상태를 사용하고 토글에는 switch 역할과 상태·접근성 이름을 제공한다. **[근거]** `frontend/src/pages/notifications/NotificationCenterPage.tsx:210-239`, `frontend/src/pages/SettingsPage.tsx:20-42,63-67`, `backend/app/services/notification_service.py:34-35`, `backend/app/schemas/notification.py:29-44`.

## 8. 토스트·배지·실시간 정합성

### 8.1 토스트

**제안:** 토스트도 센터와 동일한 대상 해석·읽음 동작을 사용한다. 신규 알림마다 일반 문구 대신 제목·짧은 본문·목적지 CTA를 보여 주고, 민감한 상담 원문은 기본 미리보기에서 제외한다. 표시용 본문 정책은 백엔드 템플릿과 합의가 필요하다. 현재 채팅은 본문 앞 100자를 보내므로 기존 데이터에도 프론트 미리보기 제한을 적용할 수 있어야 한다. **[근거]** `backend/app/services/chat_service.py:963-965`, `frontend/src/components/layout/AppShell.tsx:150-155`, `frontend/src/stores/notificationStore.ts:6-12`.

**제안:** 모바일·데스크톱 공통 가시 영역에 한 번만 렌더하고, 제목/CTA와 닫기 버튼을 독립된 조작 요소로 둔다. 자동 닫힘은 기본 6초, 호버·포커스 중 정지, 닫기·시간 만료는 읽음으로 간주하지 않는다. 같은 notification ID의 중복 수신은 한 번만 표시하고 연속 수신은 최대 3개 순차 표시 후 “새 알림 N개 · 알림 보기”로 요약한다. ID 없는 실시간 데이터는 재조회 신호로 취급하고 가짜 ID로 읽음 요청하지 않는다. **[근거]** 현재 단일 toast와 4초 타이머 `frontend/src/stores/notificationStore.ts:15-16,40-45`; 시간 기반 대체 ID `frontend/src/hooks/useNotificationSocket.ts:63`; 현재 토스트 내부 닫기 `frontend/src/components/layout/AppShell.tsx:135-169`.

### 8.2 벨과 채팅 배지의 의미

**제안:** 알림 벨은 서버 Notification 미읽음 수, 채팅 배지는 아직 읽지 않은 채팅 메시지 수로 정의한다. 알림 카드를 읽는 것만으로 방 전체 메시지를 읽었다고 처리하지 않는다. 두 수가 항상 같아야 한다고 가정하지 않으며 같은 방의 실제 메시지를 읽었을 때만 연결 알림을 읽음으로 동기화한다. 벨·센터 상단·사이드바는 하나의 서버 unread 값을 사용한다. **[근거]** `backend/app/services/notification_service.py:174-179`, `frontend/src/components/layout/AppShell.tsx:34-38`, `frontend/src/hooks/useNotificationSocket.ts:82-84`, `backend/app/services/chat_service.py:1006-1014`.

**제안 숫자 표시:** 0은 배지 숨김, 1~99는 숫자, 100 이상은 `99+`; 접근성 이름에는 정확한 미읽음 수를 전달한다. 현재 `9+`와 사이드바 누락을 통일한다. 조회 실패 때 0으로 덮지 않고 마지막 값을 유지하며 동기화 지연 상태를 별도로 표시한다. **[근거]** `frontend/src/components/layout/AppShell.tsx:98-100,128-130`, `frontend/src/components/layout/SidebarNav.tsx:161-169`, `frontend/src/stores/notificationStore.ts:31-37`.

### 8.3 “보고 있는 방 제외”의 확정 제안

| 수신 당시 상태 | 토스트 | 채팅·알림 읽음 / 배지 | 현재 근거 |
|---|---|---|---|
| 같은 방 + 문서 visible + 창 focus + 해당 메시지 50% 이상 화면 노출 | 억제 | 메시지 읽음 성공 시 연결된 알림도 서버 읽음 처리 후 양쪽 수 재조회. 처리 중 일시적 카운트 차이는 최종 서버 값으로 해소 | 현재 활성 방 비교 `frontend/src/hooks/useNotificationSocket.ts:57-61`; 50% 노출 기준 `frontend/src/components/chat/ChatRoom.tsx:197-221`; 서버 연동 확장 필요 `backend/app/services/chat_service.py:1031-1101` |
| 같은 방이지만 과거 메시지 탐색 등으로 신규 메시지는 안 보임 | 팝업 대신 방 내부 `새 메시지 N개` | 읽음 처리하지 않음; 벨과 채팅 미읽음 유지 | 현재 자동 하단 이동과 활성 방 일괄 제외 개선: `frontend/src/components/chat/ChatRoom.tsx:116-122`; `frontend/src/hooks/useNotificationSocket.ts:82-84` |
| 같은 방이지만 탭 hidden 또는 창 blur | 백그라운드에서 강제 노출하지 않음 | 자동 읽음 금지. 복귀 시 실제 노출 및 서버 값 재검증 | 현재 활성 방은 mount/unmount만 반영: `frontend/src/components/chat/ChatRoom.tsx:107-112` |
| 다른 방 또는 채팅 밖 | 공통 토스트 | 수신된 알림 ID 중복 제거, 서버 unread 갱신, 채팅 unread 재검증 | 현재 수신마다 fetch·로컬 증가: `frontend/src/hooks/useNotificationSocket.ts:54-56,71-84` |

**중요:** “보고 있는 방이면 벨 숫자에서 임의로 빼기”는 채택하지 않는다. 실제 읽음 근거와 서버 상태가 일치해야 새로고침·다른 기기에서도 숫자가 복원되지 않는다. 위 정책은 기존 방 진입 시 전체 읽음을 메시지 노출 기반으로 정리하는 것과 함께 출시해야 한다. 구형 payload에 message_id가 없으면 자동 연결 읽음은 수행하지 않고 기존 알림 ID의 수동 읽음을 유지한다. **[근거]** 방 전체 읽음 `frontend/src/components/chat/ChatRoom.tsx:102-105`; 서버의 방 단위 알림 갱신 `backend/app/services/chat_service.py:1006-1014`; 현재 payload `backend/app/services/chat_service.py:965`.

### 8.4 WS와 폴링

**현재:** 최초 마운트·WS 연결·new_notification에서 unread를 fetch한다. Socket.IO의 `polling` transport는 연결 방식이며 알림 REST 주기 조회가 아니다. 이 훅에는 REST 주기 재조회가 없다. 알림 구독은 두 셸 내부라 셸 없는 내담자 상세에서는 같은 구독 지속을 전제할 수 없다. **[근거]** `frontend/src/hooks/useNotificationSocket.ts:27-42,54-56,88-99`, `frontend/src/components/layout/AppShell.tsx:41-42`, `frontend/src/components/client/ClientShell.tsx:45-46`, `frontend/src/pages/client/ClientAppPage.tsx:269-278`.

**제안:** 로그인 사용자 단위 단일 구독을 유지하고, 연결·재연결·탭 복귀·읽음 성공·전체읽음 성공에 unread와 필요한 목록을 재검증한다. WS 연결 중에도 visible 상태에서 60초 간격으로 unread를 보정해 직접 생성 알림과 다른 기기 읽음을 반영한다. WS 미연결 시 visible 상태에서 30초 REST fallback을 사용하고 hidden에서는 중단한다. 연속 이벤트 fetch는 짧게 합쳐 중복 요청을 줄이고 오래된 응답이 최신 숫자를 덮지 않게 한다. 간격은 이번 기획의 제안값이며 운영 부하 측정 후 조정한다. **[근거]** 직접 생성 함수는 DB flush만 수행 `backend/app/services/notification_service.py:51-68`; 연결 상태 필드 `frontend/src/stores/notificationStore.ts:14-23`; 현재 fetch는 응답 순서 보호 없음 `frontend/src/stores/notificationStore.ts:31-37`.

## 9. 브랜드·반응형·접근성 기획

| 요소 | 제안 디자인 | 현재 코드 근거·차이 |
|---|---|---|
| 보라 `#5F0080` | 주요 CTA, 미읽음 점·좌측 선, 선택 필터, 포커스 | 기존 브랜드 및 카드 강조 유지: `frontend/src/mb-tokens.css:17`; `frontend/src/pages/notifications/NotificationCenterPage.tsx:64-91` |
| 크림 `#F7F4F0` | 알림 센터 콘텐츠 바탕, 흰 카드와 낮은 대비의 면 구분 | 브리프 요구값을 신규 적용 제안. 기존 cream은 `#EBE6E2`: `frontend/src/mb-tokens.css:30`; 셸·카드는 현재 흰색 `frontend/src/components/layout/AppShell.tsx:192`; `frontend/src/pages/notifications/NotificationCenterPage.tsx:64` |
| 민트 `#01f0c8` | 완료·연결 회복 등의 작은 보조 강조, 어두운 글자와 사용 | 기존 토큰은 같은 색 대문자 표기: `frontend/src/mb-tokens.css:34,102`. 미읽음과 경고의 의미를 민트 하나로 통합하지 않음 |
| Pretendard | 제목 15~16px/700, 본문 14px/400, 메타·CTA 최소 12px; 전체 확대에서도 줄바꿈 | 기존 로드와 fontSans: `frontend/src/mb-tokens.css:12,108-111`; `design-system/build/outputs/tailwind/preset.cjs:6-15`; 현재 카드 10~14px `frontend/src/pages/notifications/NotificationCenterPage.tsx:73-85` |
| 카드 형태 | 현재 16px 라운드·얇은 테두리·16px 안쪽 여백 계승. 액션 있는 카드만 화살표 | `frontend/src/pages/notifications/NotificationCenterPage.tsx:64-65` |
| 반응형 | 기존 모바일/데스크톱 셸 유지. 작은 폭에서 필터 가로 스크롤, CTA와 상태는 줄바꿈, 터치 영역 최소 44px | 기존 md 기준 셸: `frontend/src/components/layout/AppShell.tsx:64-76,108`; 현재 카드 CTA는 없음 `frontend/src/pages/notifications/NotificationCenterPage.tsx:53-95` |
| 보조기술 | 아이콘만으로 구분하지 않고 한글 유형·미읽음 이름 제공. 새 알림은 polite 알림 영역, 경로 이동 뒤 대상 제목 포커스. 닫기·이동 버튼 분리, reduced-motion 대응 | 현재 카드 emoji·색 구분과 토스트 내부 role button 개선: `frontend/src/pages/notifications/NotificationCenterPage.tsx:69-91`; `frontend/src/components/layout/AppShell.tsx:136-169` |

색 대비와 200% 확대·모바일 실제 렌더링은 **확인 필요**다. 이 문서는 소스 기반 기획이므로 접근성 통과나 시각 QA 완료를 주장하지 않는다. 특히 기존 10~11px 메타를 확대하고, 민트 위 흰 글자를 피하며 보라 포커스 표시를 색 외 형태로도 전달하는 안을 후속 디자인에서 검증한다. **[근거]** `frontend/src/pages/notifications/NotificationCenterPage.tsx:77,85`, `frontend/src/mb-tokens.css:34`.

## 10. 후속 SDD 입력과 수용 기준

아래는 **구현 전 사용할 제안 검증 시나리오**이며 이번 작업에서 실행한 테스트가 아니다. 브리프의 요구를 만족하려면 UI 이동뿐 아니라 대상 API·읽음 상태까지 함께 검증해야 한다. **[근거]** 현재 이동 누락 `frontend/src/pages/notifications/NotificationCenterPage.tsx:133-147`; 현재 방·알림 읽음 결합 `backend/app/services/chat_service.py:1006-1014`.

| 시나리오 | 수용 기준 | 관련 현재 코드 |
|---|---|---|
| 상담사/내담자 채팅 알림 | 각자 올바른 경로의 동일 방·동일 메시지로 이동; 이미 읽은 알림도 이동 | `frontend/src/pages/chat/ChatPage.tsx:43,90-108`; `frontend/src/pages/client/ClientChatPage.tsx:56-60` |
| 50개 밖 메시지·삭제 메시지 | 주변 조회로 정확히 찾거나 명확한 부재 안내; 무한 로딩·강제 최신 이동 없음 | `frontend/src/lib/api/chat.ts:116-117`; `frontend/src/components/chat/ChatRoom.tsx:116-122` |
| 같은 방의 다른 알림 연속 클릭 | 새 message 쿼리마다 재탐색, 중복 요청·하단 스크롤 충돌 없음 | `frontend/src/components/chat/ChatRoom.tsx:85-122` |
| 리포트 발행 | report_id로 상세 조회; session_id로 잘못 조회하지 않음; 클릭 시 승인/발송 안 함 | `backend/app/services/report_service.py:380-387,518-524` |
| 세션 open 후 취소·종료 | 클릭 당시 최신 상태 표시, 입장 불가 상태는 CTA 비활성/종료 안내 | `frontend/src/pages/client/ClientSessionDetailPage.tsx:68-84,97-145` |
| 소속 해제·정보형 알림 | 대상 ID 없는 정보형 내용 확인 가능; 확인 시 기존 팝업과 읽음 공유 | `frontend/src/components/org/OrgRemovedNoticeDialog.tsx:21-44` |
| 내담자 센터·연결 없는 계정 | 알림 메뉴에서 홈 콘텐츠가 나오지 않음; 알림 접근과 대상 권한 구분 | `frontend/src/pages/client/ClientAppPage.tsx:257-262,310-312` |
| visible/focus/메시지 노출 조합 | §8.3 표와 일치; 탭 hidden/과거 탐색을 방 전체 읽음으로 오판하지 않음 | `frontend/src/hooks/useNotificationSocket.ts:57-84`; `frontend/src/components/chat/ChatRoom.tsx:102-108,197-221` |
| 읽음/전체읽음·50개 초과 | 센터·벨·사이드바가 서버 unread와 일치, 필터·페이지와 무관한 전체읽음 범위 안내 | `frontend/src/pages/notifications/NotificationCenterPage.tsx:105-108,149-175`; `backend/app/services/notification_service.py:195-207` |
| WS 중복·단절·재접속·다른 기기 읽음 | 같은 ID 토스트 중복 없음; 서버 값으로 수렴; 알림 구독 중복 없음 | `frontend/src/hooks/useNotificationSocket.ts:27-56,91-99`; `frontend/src/stores/notificationStore.ts:31-45` |
| 잘못된 ID·다른 계정·로그인 만료 | 서버 권한 오류에 맞는 안내, 외부 URL 이동 없음, 허용된 목적지만 복원 | `backend/app/services/notification_service.py:183-192`; `frontend/src/lib/auth-routing.ts:3-14` |
| 모바일·키보드·확대 | 토스트 가시성, 이동/닫기 독립 조작, 포커스·미읽음 음성 안내, 잘림 없는 레이아웃 | `frontend/src/components/client/ClientShell.tsx:112-174`; `frontend/src/pages/notifications/NotificationCenterPage.tsx:53-95` |
| 설정 신규 이벤트·저장 실패 | 서버에 존재하는 설정만 조작 가능, 오류 시 기존 값과 재시도 표시 | `backend/app/schemas/notification.py:29-44`; `frontend/src/pages/notifications/NotificationCenterPage.tsx:158-170` |

### 최종 확인 필요 목록

1. 워커 A의 `schema_version/event_type/target_type/target_id/params` 채택 여부와 새 이벤트·유형·역할별 수신자 계약. 현재 자유 extra와 6개 이벤트 매핑만 확인했다. **[근거]** `backend/app/services/notification_service.py:17-24,108`, `backend/app/schemas/notification.py:15`.
2. 메시지 주변 조회 API 및 메시지별 읽음과 Notification 읽음을 함께 확정할 방식. 현재 최근 목록 조회와 메시지 읽음만으로는 요구를 충족하지 않는다. **[근거]** `backend/app/api/v1/chat.py:151-159`, `backend/app/services/chat_service.py:1031-1101`.
3. 클래스 초대 수신자의 기존 상담사 연결 여부와 미연결 상태의 접근 정책, 기관 검증 결과 목적지, 플랫폼 관리자 알림 범위. 관련 화면과 게이트가 서로 다르므로 새 이벤트 하나로 묶지 않는다. **[근거]** `frontend/src/pages/client/ClientAppPage.tsx:257-262`; `frontend/src/App.tsx:159,163,191-197`; `backend/app/services/session_service.py:491-522`.
4. 계정 비활성 상태에서 알림 열람을 허용할지에 대한 제품·인증 정책. 상태 변경 알림의 생성만으로 통지 당사자가 나중에 열람할 수 있다고 단정하지 않는다. **[근거]** `backend/app/services/org_service.py:390-395`.
5. 크림 신규 값과 전역 브랜드 토큰의 관계, 민감한 본문 미리보기 문구, 30/60초 보정 주기의 운영 비용. 기존 토큰·본문 전송·이벤트 fetch를 근거로 제안했으며 합의 및 실제 UX 검증이 남아 있다. **[근거]** `frontend/src/mb-tokens.css:30`, `backend/app/services/chat_service.py:964`, `frontend/src/hooks/useNotificationSocket.ts:54-56`.

후속 단계에서는 이 문서를 워커 A 산출물과 합쳐 계약을 확정한 뒤 구현 전 Verify를 작성한다. 이번 산출물은 기획서이며 구현 완료·테스트 통과·상호 계약 합의 완료를 의미하지 않는다.
