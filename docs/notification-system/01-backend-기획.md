# 알림 시스템 재설계 — 백엔드 알림 체계와 데이터 설계

작성일: 2026-09-27 · 워커 A 담당 범위 · Phase 1 기획 · 구현 전 검토안

## 1. 목적과 근거의 범위

이벤트 발생부터 수신자 결정, 사용자 설정, 알림 저장, 실시간·이메일 전달, 클릭 대상까지 하나의 계약으로 정의한다. 현재 공통 라우터와 직접 저장 경로가 혼재하고 `extra`가 자유 형식이다. 이 문서는 구현 완료 명세가 아니라 다음 SDD의 입력이다. **현재 근거:** `backend/app/services/notification_service.py:51-68,92-135`, `backend/app/schemas/notification.py:9-16`.

**표기 원칙:** ‘현재’는 저장소 정적 소스에서 확인한 사실, ‘제안’은 해당 소스를 개선하기 위한 신규 정책이다. 제안 옆의 근거는 기존 구현의 근거이지 제안이 구현되어 있다는 뜻이 아니다. 실행 환경·배포 DB·실제 메일 전달은 검증하지 않았다. 불명확한 사항은 ‘확인 필요’로 남긴다. 파일:라인은 저장소 루트 기준이다. 조사 대상은 `backend/app`의 알림 호출, 상태 변경 서비스, 이메일 경로와 연결된 프론트 소스다.

`00-research-brief.md`를 먼저 읽었으며, 기존 `02-frontend-기획.md` 전체를 대조했다. 공통 `extra`는 프론트 §4의 필드명과 허용 대상에 맞춘다. 이 문서만 작성하며 코드·프론트 기획서·SDD 문서·외부 시스템은 변경하지 않는다.

## 2. 현재 구조 정정(브리프 대비)

1. **발화는 5개 파일, 6개 애플리케이션 호출 지점이다.** 채팅·리포트 각 1개, 상담사 정보 수정 2개, 기관 계정 상태 변경 1개, 개인 상담소 복귀 안내 1개다. 공통 서비스 내부 호출은 별도다. **근거:** `backend/app/services/chat_service.py:959`, `backend/app/services/report_service.py:518`, `backend/app/services/counselor_info_service.py:282,346`, `backend/app/services/org_service.py:394`, `backend/app/services/personal_office_service.py:118`, `backend/app/services/notification_service.py:112`.
2. **기관 서비스의 기존 알림은 기관 정보 수정이 아니라 상담사 계정 정지·복구다.** `system` 타입, `extra.actor_kind/action`을 전달한다. 상담사 정보 수정은 관리자 대리 수정 때 대상자에게 생성하며 본인 수정은 제외한다. **근거:** `backend/app/services/org_service.py:336-395`, `backend/app/services/counselor_info_service.py:265-287,346-351`.
3. **개인 상담소 경로는 `org_removed`라는 별도 타입을 이미 사용한다.** payload는 `org_name/office_name`이며 일반 소속 해제 전체가 아니라 남은 활성 기관이 없어 개인 상담소로 복귀할 때 생성한다. 별도 이메일 큐도 있다. **근거:** `backend/app/services/personal_office_service.py:94-140`, `backend/app/services/org_service.py:524-536`, `backend/app/services/org_management_service.py:203-226`.
4. **`notify_event`는 저장·전달뿐 아니라 전달받은 DB 세션을 커밋한다.** 반면 `create_notification`은 flush만 한다. 같은 트랜잭션에 감사 로그와 알림을 저장하는 기존 경로를 단순 치환하면 커밋 경계가 바뀐다. **근거:** `backend/app/services/notification_service.py:66-67,110-133`, `backend/app/services/counselor_info_service.py:265-290`.
5. **채팅 payload로 가능한 것은 방 식별까지다.** `message_id`가 없으므로 특정 메시지 도달은 현재 불가능하다. **근거:** `backend/app/services/chat_service.py:935-965`; 최근 목록만 제공하는 `backend/app/services/chat_service.py:864-877`.
6. **세션에는 실시간 상태 이벤트가 이미 있으나 Notification은 아니다.** `session_state_changed/participant_changed`와 영속 사용자 알림은 구분해야 한다. 상태에는 `paused`, 재개, 별도 `run_id`도 있고 구형 `join_session`이 직접 `in_progress`로 바꾸는 경로도 있다. **근거:** `backend/app/services/session_service.py:24-35,369-400,409-462,626-633`.
7. **5개 설정 중 예약 설정이 변경 이벤트까지 제어한다.** `session_updated`를 `session_booked`로 치환한다. 미등록 이벤트는 인앱 True/이메일 False 기본값으로 처리한다. 요청 스키마의 채널 공통 기본 True와 모델의 `email.chat_message=False`도 다르다. **근거:** `backend/app/services/notification_service.py:34-47,110-133`, `backend/app/models/user.py:11-25`, `backend/app/schemas/notification.py:29-44`.
8. **승인 알림 이메일과 리포트 원문 전달 이메일은 서로 다른 경로다.** 승인 말미 주석은 ‘메일 예약 안 함’이지만 승인 중 `notify_event(report_ready)`는 설정에 따라 일반 알림 이메일을 보낸다. 요청 기반 리포트 링크 메일은 별도 서비스다. **근거:** `backend/app/services/report_service.py:515-534`, `backend/app/services/notification_service.py:132-133`, `backend/app/services/report_email_service.py:48-112,115-155`.
9. **알림 센터 이동은 없지만 토스트에는 채팅 이동 시도가 있다.** 토스트의 `?room=`과 채팅 페이지의 경로 ID 소비가 불일치한다. API 전체읽음 응답도 서버 `marked`와 프론트 `count`가 다르다. **근거:** `frontend/src/pages/notifications/NotificationCenterPage.tsx:133-147`, `frontend/src/components/layout/AppShell.tsx:52-57`, `frontend/src/components/client/ClientShell.tsx:56-61`, `frontend/src/pages/chat/ChatPage.tsx:90-98`, `backend/app/api/v1/notifications.py:62-68`, `frontend/src/lib/api/notifications.ts:51-52`.
10. **‘시스템 전체 알림이 5곳뿐’으로 확대 해석하면 안 된다.** 초대 이메일, 신청 접수 메일, 비밀번호 재설정 메일은 Notification 외부에 있다. `send_system_message`는 채팅 시스템 메시지 저장 함수이고 `backend/app` 검색에서 정의 외 호출은 발견하지 못했다. **근거:** `backend/app/services/org_invite_service.py:116-173,243-260`, `backend/app/services/signup_application_service.py:211,234`, `backend/app/services/password_reset_service.py:50`, `backend/app/services/admin_password_reset_service.py:137,246`, `backend/app/services/system_message_service.py:11-23`.

## 3. 설계 선택과 적용 순서

**제안: 공통 이벤트 라우터 + 트랜잭셔널 outbox를 권장한다.** 직접 호출만 `notify_event`로 치환하는 안은 작지만 중간 커밋·동기 이메일·WS 실패 후 복구 부재가 남는다. 독립 이벤트 플랫폼을 신설하는 안은 범위가 크다. 도메인 변경과 알림 전달 의도를 같은 DB 트랜잭션에 저장하고, 커밋 이후 전달하는 안을 권장한다. 기존 함수 이름은 유지하되 호출자가 커밋 책임을 갖도록 재설계한다. **개선 근거:** `backend/app/services/notification_service.py:110-133`, `backend/app/services/chat_service.py:943-969`, `backend/app/services/personal_office_service.py:128-140`.

**제안 우선순위:** P0는 기존 6개 호출의 표준 payload·전달 일원화, 세션 예약/변경/취소·입장 가능/시작·회원 초대, 채팅 메시지 위치 조회, 리포트 수신자 권한, 읽음 정합성이다. P1은 추가 운영 이벤트·검증/기관 알림·설정 UI 확장이다. P0/P1 모두 아래 카탈로그를 계약으로 사용하고, 모든 카탈로그 행이 첫 배포에 포함된다고 해석하지 않는다. **근거:** 누락된 세션 호출 경계 `backend/app/services/session_service.py:148-222,280-402,491-522`; 메시지 계약 `backend/app/services/chat_service.py:864-877,959-965`.

## 4. 이벤트 카탈로그

다음 항목의 **이벤트 키·문구·수신자·채널은 제안**이다. ‘기존’은 현재 Notification 생성, ‘추가’는 상태 변경 코드만 존재, ‘예약’은 실제 발화 경계 확인 전 생성 금지를 뜻한다. 제목 / 본문 순서로 템플릿을 표기한다. `인앱`은 영속 Notification이며 WS는 그 전달 수단이다. 모든 이벤트는 해당 수신자의 채널 설정을 적용한다. 이메일 기본값은 §8에서 정한다. **현재 근거:** `backend/app/services/notification_service.py:92-135`.

### 4.1 세션·클래스

클래스도 Session을 대상으로 한다. `participant_mode=group`이면 표시 타입 `class`, 나머지는 `session`을 제안한다. `type=meditation`만으로 그룹을 판정하지 않는다. 호스트가 행위자이면 자기 알림을 제외하며 회원 참여자만 대상으로 한다. 대기자에게는 예약/변경/취소/초대는 알리되 입장 가능·시작 알림은 보내지 않는다. **근거:** `backend/app/services/session_service.py:184-212,350-357,508-518`, `backend/app/services/session_service.py:704-705`.

- **S01 `session_booked` — 추가:** 예약 세션 생성 호스트 → 최초 등록 회원 참여자. “세션이 예약되었습니다” / “예정된 세션의 일시와 참여 정보를 확인해주세요.” 대상 `session(session_id)`. 생성 시 즉석 ready와 중복 발화하지 않는다. **발화 경계:** `backend/app/services/session_service.py:157-158,184-222`.
- **S02 `session_updated` — 추가:** 호스트 → 등록 회원·대기자. “세션 정보가 변경되었습니다” / “변경된 일정과 참여 정보를 확인해주세요.” 대상 `session`. 제목·일시·시간·장소·참여 방식 등 이용자에게 보이는 값이 실제 변경된 경우만 1건; 내부 notes만 바뀌면 알리지 않는다. **근거:** `backend/app/services/session_service.py:280-333`.
- **S03 `session_cancelled` — 추가:** 호스트의 cancel → 등록 회원·대기자. “세션이 취소되었습니다” / “세션이 취소되었습니다. 최신 안내를 확인해주세요.” 대상 `session`; 아직 삭제되지 않은 취소 상태 상세를 연다. **근거:** `backend/app/services/session_service.py:29-35,342-372`.
- **S04 `session_ready` — 추가:** 즉석 세션 생성 호스트 → 최초 등록 회원. “클래스가 준비되었습니다” / “아직 입장 전입니다. 오픈 안내를 기다려주세요.” 대상 `session`; 참여자 없는 생성은 0건. **근거:** `backend/app/services/session_service.py:157-158,211-222`.
- **S05 `session_opened` — 추가:** open 호스트 → 대기자가 아닌 회원 참여자. “클래스 입장이 가능합니다” / “세션 상세에서 참여 상태를 확인해주세요.” 대상 `session`; 알림 자체에 참여 코드·토큰을 넣지 않는다. **근거:** `backend/app/services/session_service.py:30,360-370,710-718`.
- **S06 `session_started` — 추가:** start 호스트 또는 구형 온라인 입장 전이 → 대기자가 아닌 회원 참여자. “세션이 시작되었습니다” / “진행 중인 세션을 확인해주세요.” 대상 `session`; `ready/scheduled/open → in_progress`만 해당. **근거:** `backend/app/services/session_service.py:31,342-372,626-633`.
- **S07 `session_paused` — 추가:** pause 호스트 → 대기자가 아닌 회원 참여자. “세션이 일시정지되었습니다” / “재개 안내를 기다려주세요.” 대상 `session`. **근거:** `backend/app/services/session_service.py:32,342-372`.
- **S08 `session_resumed` — 추가:** resume 호스트 → 대기자가 아닌 회원 참여자. “세션이 재개되었습니다” / “세션 진행 상태를 확인해주세요.” 대상 `session`; 시작과 구별하고 같은 run을 유지한다. **근거:** `backend/app/services/session_service.py:33,409-416`.
- **S09 `session_completed` — 추가:** end 호스트 → 대기자가 아닌 회원 참여자. “세션이 종료되었습니다” / “세션이 종료되었습니다. 리포트 준비 여부는 별도로 안내합니다.” 대상 `session`; 생성/승인 전 리포트 도착을 약속하지 않는다. **근거:** `backend/app/services/session_service.py:34,374-397`.
- **S10 `session_invited` — 추가:** 호스트 → 새로 추가된 회원 1명. “세션에 초대되었습니다” / “참여 상태와 일정을 확인해주세요.” 대기자이면 본문 “현재 대기 상태입니다. 참여 가능 여부를 확인해주세요.” 대상 `session`; params의 `is_waitlisted`는 표시 힌트다. **근거:** `backend/app/services/session_service.py:491-522`.
- **S11 `session_waitlist_promoted` — 추가:** 제거에 따른 시스템 승격 → 승격된 회원. “세션 참여가 가능해졌습니다” / “대기 상태가 해제되었습니다. 최신 입장 가능 상태를 확인해주세요.” 대상 `session`. **근거:** `backend/app/services/session_service.py:472-488,539-554`.
- **S12 `session_participant_removed` — 추가:** 호스트 → 제거된 회원. “세션 참여가 해제되었습니다” / “이 세션의 참여 대상에서 제외되었습니다.” 대상 `notice(null)`; 제거 뒤 상세 권한을 전제하지 않는다. **근거:** `backend/app/services/session_service.py:242-257,525-554`.
- **S13 `session_deleted` — 추가:** 호스트 → 삭제 직전 회원·대기자. “세션이 삭제되었습니다” / “세션 정보를 더 이상 확인할 수 없습니다.” 대상 `notice(null)`; 취소와 물리 삭제를 구별하고 삭제 전 수신자 스냅샷을 확보한다. **근거:** `backend/app/services/session_service.py:336-339`.

**제안 비발화:** `start_new_run`의 run ID 교체만으로 별도 사용자 알림을 만들지 않고 이후 상태 전이에 포함한다. 참가자 입장·EEG 기기 변화·실시간 지표는 라이브 이벤트로 유지한다. 새로운 예약 리마인더 시간·스케줄러는 **확인 필요**이며 이번 카탈로그에서 실행 이벤트로 가정하지 않는다. **근거:** `backend/app/services/session_service.py:409-462,743-758,1336-1351`.

### 4.2 채팅

- **C01 `chat_message` — 기존:** 메시지 작성자 → 같은 방 수신자에서 작성자를 제외한 고유 회원 집합. “새 메시지가 도착했습니다” / “채팅방에서 메시지를 확인해주세요.” `chat`, `chat_room(room_id)`, `params.message_id` 필수. 기존 발신자명·본문 앞 100자 대신 기본 알림 문구는 원문을 포함하지 않는 안을 제안한다. **근거:** `backend/app/services/chat_service.py:880-965`.
- **C02 `chat_room_created` — 추가:** 명시적 방 생성자 → 실제 생성된 방의 상대 회원·참여자, 생성자 제외. “새 채팅방이 만들어졌습니다” / “참여 중인 채팅방을 확인해주세요.” `chat`, `chat_room`. 기존 방 반환은 발화하지 않는다. 세션 생성에 따른 자동 방은 세션 알림과 중복하지 않도록 이 이벤트를 억제한다. **근거:** `backend/app/services/chat_service.py:192-224,227-309`, `backend/app/services/session_service.py:217-220`.
- **C03 `chat_room_invited` — 추가:** 방 호스트/초대 가능한 기관 관리자 → 실제 신규 추가 회원. “채팅방에 초대되었습니다” / “새로 참여한 채팅방을 확인해주세요.” `chat`, `chat_room`; 이미 참여한 ID는 발화하지 않는다. **근거:** `backend/app/services/chat_service.py:681-703`.
- **C04 분기 방 생성 — C02/C03으로 분류:** `fork_group_room`의 승계 회원에게 C02, 새 회원에게 C03을 보내되 동일 방·수신자에는 하나만 보낸다. 별도 fork 이벤트 키는 만들지 않는다. **근거:** `backend/app/services/chat_service.py:706-763`.
- **C05 `chat_room_removed` — 추가:** 방 호스트 → 제거된 회원. “채팅방 참여가 해제되었습니다” / “이 채팅방을 더 이상 열 수 없습니다.” `chat`, `notice(null)`. **근거:** `backend/app/services/chat_service.py:822-839,163-175`.

**제안:** 방 이름 변경·읽음 갱신·프로필 동기화는 Notification을 만들지 않는다. 채팅 시스템 메시지와 Notification을 연결하더라도 같은 도메인 사건의 중복 알림은 억제한다. **근거:** `backend/app/services/chat_service.py:576-600,982-1101`, `backend/app/ws/chat_namespace.py:96-109`, `backend/app/services/system_message_service.py:11-23`.

### 4.3 리포트

- **R01 `report_review_requested` — 추가:** 생성 태스크의 pending_review 확정 → 세션 호스트. “검토할 리포트가 준비되었습니다” / “내용을 확인하고 승인해주세요.” `report`, `report(report_id)`, `params.session_id`. 자동 승인될 건은 최종 승인 판단 뒤 검토 요청을 생략한다. **근거:** `backend/app/tasks/report_task.py:274-289`, `backend/app/services/report_service.py:208-217,243-275`.
- **R02 `report_ready` — 기존:** 호스트의 최초 승인 또는 자동 승인 → 해당 리포트 `user_id`. “리포트가 도착했습니다” / “승인된 세션 리포트를 확인해주세요.” `report`, `report(report_id)`. 게스트는 Notification 없음. **근거:** `backend/app/services/report_service.py:494-534`.
- **R03 `report_generation_failed` — 추가:** 생성 태스크의 error 확정 → 세션 호스트. “리포트 생성에 실패했습니다” / “리포트 상태를 확인하고 다시 시도해주세요.” `report`, `report(report_id)`. 내부 예외·상담 원문을 본문에 복사하지 않는다. **근거:** `backend/app/tasks/report_task.py:290-306`.
- **R04 `report_email_failed` — 추가:** 요청 기반 이메일의 큐 적재/전달 실패 → 회원 요청자. “리포트 이메일을 보내지 못했습니다” / “리포트에서 발송 상태를 확인해주세요.” `report`, `report(report_id)`; 게스트는 요청 화면의 실패 상태로 안내하고 임의 회원 계정을 만들지 않는다. **근거:** `backend/app/services/report_email_service.py:59-65,100-111,115-155`.

**제안:** 현재 승인과 발행을 독립 사건으로 두 번 알리지 않는다. `pending_review → completed`가 R02이며 이메일 발송 성공은 ‘발행’과 다르다. `sent_at`도 승인 시 기록되므로 이메일 delivered 증거로 쓰지 않는다. **근거:** `backend/app/services/report_service.py:503-513`, `backend/app/services/report_email_service.py:153-155`.

### 4.4 검증·기관·계정·개인 상담소

- **V01 `verification_result` — 추가:** 플랫폼 관리자 증빙 승인/반려 → 증빙 소유 상담사. “자격 검증 결과가 도착했습니다” / “자격 화면에서 결과와 보완 사항을 확인해주세요.” `verification`, `credentials(null)`, `params.credential_id/result`. 두 검토 경로를 모두 다루고 최종 결정 변경당 1건으로 한다. **근거:** `backend/app/services/credential_service.py:197-221`, `backend/app/services/admin_service.py:200-238`.
- **V02 `organization_verification_result` — 추가:** 플랫폼 관리자 기관 문서 검토 → 해당 기관 관리자. “기관 검증 결과가 도착했습니다” / “기관 검증 상태를 확인해주세요.” `verification`, `organization(org_id)`; 문서 ID·결과는 params. 문서와 기관의 실제 소유 연결 및 알림 수신 관리자 선택은 **확인 필요**, 확정 전 발송 금지. **근거:** `backend/app/services/admin_service.py:240-258`; 목적지 `frontend/src/App.tsx:162`.
- **O01 `organization_join_requested` — 추가:** 소속 신청 상담사 → 해당 기관 활성 관리자. “새 소속 신청이 있습니다” / “기관에서 소속 신청을 확인해주세요.” `organization`, `organization(org_id)`. **근거:** `backend/app/services/org_service.py:144-182,207-232`.
- **O02 `organization_join_result` — 추가:** 기관 관리자 승인/반려 → 신청 상담사. “소속 신청 결과가 도착했습니다” / “신청 결과를 확인해주세요.” `organization`, 우선 `notice(null)`. `/org/requests` 전용 target은 프론트와 별도 합의 전 추가하지 않는다. **근거:** `backend/app/services/org_service.py:234-292`, `frontend/src/App.tsx:159`.
- **O03 `organization_updated` — 추가:** 플랫폼 관리자의 기관 정보 실변경 → 해당 기관 활성 관리자, 행위자 제외. “기관 정보가 변경되었습니다” / “기관의 최신 정보를 확인해주세요.” `organization`, `organization(org_id)`. 인증 상태만 변경되면 V02 계열과 중복시키지 않을 분류 규칙이 필요하다. **근거:** `backend/app/services/org_management_service.py:62-82`.
- **O04 `organization_deactivated` / `organization_reactivated` — 추가:** 플랫폼 관리자 → 영향을 받는 해당 기관 활성 소속 상담사·관리자. “기관 이용이 중지되었습니다” / “소속 기관의 이용 상태를 확인해주세요.” 또는 “기관 이용이 재개되었습니다” / “소속 기관의 이용 상태를 확인해주세요.” `organization`, `notice(null)`; 비활성 기관 상세 접근을 전제하지 않는다. **근거:** `backend/app/services/org_management_service.py:127-155`, `backend/app/models/user_org_membership.py:27-37`.
- **O05 `organization_role_changed` — 추가:** 기관/플랫폼 관리자 → 역할 변경 당사자. “기관 내 권한이 변경되었습니다” / “현재 권한과 이용 가능한 기능을 확인해주세요.” `organization`, `self_profile(null)`. **근거:** `backend/app/services/org_service.py:467-500`, `backend/app/services/org_management_service.py:199-224`.
- **O06 `organization_removed` — 기존 일부/확장:** 기관/플랫폼 관리자 → 소속 해제 당사자. “기관 소속이 해제되었습니다” / “소속 정보와 현재 이용 상태를 확인해주세요.” 개인 상담소 복귀라면 기존 기관·상담소 이름 안내를 유지한다. 일반 경우 `organization`, 복귀 호환 기간에는 `org_removed`; 모두 `notice(null)`. 남은 다른 기관이 있어도 신규 정책에서는 1건 생성한다. **근거:** `backend/app/services/org_service.py:524-536`, `backend/app/services/org_management_service.py:203-226`, `backend/app/services/personal_office_service.py:94-125`.
- **A01 `counselor_profile_updated` — 기존 직접 저장:** 기관/플랫폼 관리자 → 수정 대상 상담사. “내 정보가 수정되었습니다” / “관리자가 회원님의 정보를 수정했습니다. 변경 항목을 확인해주세요.” `system`, `self_profile(null)`; `changed_fields/actor_kind` 유지. **근거:** `backend/app/services/counselor_info_service.py:265-287`.
- **A02 `primary_admin_profile_updated` — 기존 직접 저장:** 플랫폼 관리자 → 수정 대상 기관 대표 관리자. “내 정보가 수정되었습니다” / “플랫폼 관리자가 회원님의 정보를 수정했습니다.” `system`, `self_profile(null)`. **근거:** `backend/app/services/counselor_info_service.py:335-353`.
- **A03 `account_suspended` / `account_reactivated` — 기존 일부/확장:** 기관 또는 플랫폼 관리자 → 해당 계정 당사자. “계정이 비활성화되었습니다” / “계정 이용 상태가 변경되었습니다.” 또는 “계정이 다시 활성화되었습니다” / “계정 이용 상태를 확인해주세요.” `system`, `notice(null)`; 상세 사유는 권한이 확인된 화면에서 제공하는 안이다. **근거:** `backend/app/services/org_service.py:336-398`, `backend/app/services/admin_service.py:493-528`.
- **P01 `personal_office_opened` — 추가:** 개인 가입 승인 또는 상담소 최초 생성의 시스템 처리 → 소유 상담사. “개인 상담소가 준비되었습니다” / “개인 상담소 이용 정보를 확인해주세요.” `organization`, `self_profile(null)`; 이미 있는 상담소 재사용은 발화하지 않는다. 소속 해제로 최초 생성된 경우 O06만 보낸다. **근거:** `backend/app/services/signup_application_service.py:350-375`, `backend/app/services/personal_office_service.py:64-91,94-109`.
- **P02 `personal_office_closed` — 예약:** 개인 상담소 자체 폐쇄의 독립 업무 흐름·수신자·권한은 **확인 필요**다. 가정한 발화 주체로 이벤트를 생산하지 않는다. 후속 확인 시 “개인 상담소 이용이 종료되었습니다” / “현재 이용 상태를 확인해주세요.”, `organization`, `notice(null)` 후보. 기관 소속 해제 O06과 구별한다. **확인 범위 근거:** 현재 개인 상담소 서비스는 보장·복귀·해제 안내 함수로 구성됨 `backend/app/services/personal_office_service.py:64-160`; 일반 기관 중지는 `backend/app/services/org_management_service.py:127-155`.

### 4.5 Notification 외 채널의 전수 조사 결과와 경계

다음은 기존 서비스 메일이므로 누락하지 않되 일반 벨 알림과 무조건 통합하지 않는다. **제안:** 인증·계정 활성화 동작 메일은 별도 트랜잭션 메일 정책으로 유지하고, 로그인된 회원에게 부가 인앱 알림이 필요할 때만 명시적 이벤트를 추가한다. 이미 발송하는 서비스를 동시에 일반 라우터 이메일로 호출하지 않는다.

- 기관 관리자·상담사·소속·내담자 초대: 발화 주체는 초대 서비스, 수신자는 초대 대상 이메일. 부가 인앱 이벤트 후보 `organization_invited`는 기존 회원만 대상으로 “기관 초대가 도착했습니다” / “초대 이메일에서 가입 절차를 확인해주세요.”, `organization`, `notice(null)`. 토큰은 extra에 금지. **근거:** `backend/app/services/org_invite_service.py:116-173,243-260`; 별도 내담자 초대 `backend/app/services/client_service.py:219`.
- 가입 상담 신청 접수: 기존 운영 수신 이메일은 설정값이며 특정 platform_admin 계정 집합으로 단정하지 않는다. `signup_review_requested` 후보는 검토 담당자 계정 매핑 **확인 필요**, “새 가입 신청이 있습니다” / “가입 신청 검토 목록을 확인해주세요.”, `system`, `notice(null)`. **근거:** `backend/app/services/signup_application_service.py:211,234`, `backend/app/tasks/email.py:559-610`.
- 가입 신청 결과: `signup_application_result` 후보, 플랫폼 관리자 → 신청자(회원 ID가 확인된 경우만 인앱). “가입 신청 결과가 도착했습니다” / “가입 신청 결과와 다음 절차를 확인해주세요.”, `system`, `notice(null)`. 개인 승인 후 초대 메일은 이미 존재하고 기관 승인/반려 결과 이메일의 운영 정책은 **확인 필요**다. **근거:** `backend/app/services/signup_application_service.py:329-397`.
- OTP·비밀번호 재설정·관리자 재설정·재설정 완료: 기존 요청자/대상자 메일 유지, 일반 알림 설정과 분리. 인증 코드·재설정 URL을 벨 payload에 복제하지 않는다. **근거:** `backend/app/tasks/email.py:68-95,643-752`, `backend/app/services/admin_password_reset_service.py:137,246`.
- 리포트 링크 요청/재발송: 회원·게스트의 검증된 수신 주소에 기존 전용 메일 유지. Notification의 R02와 문구·전달 목적을 구분한다. **근거:** `backend/app/services/report_email_service.py:48-112,115-155,159-189`.

## 5. 알림 type과 표준 extra

### 5.1 type 정의

**제안:** `session`, `class`, `chat`, `report`, `verification`, `organization`, `system`을 화면 분류값으로 사용한다. 모두 현행 String(30) 범위 안이다. `extra.event_type`은 세부 사건이며 type과 구별한다. 미등록 신규 이벤트를 자동 system으로 떨어뜨리는 현재 동작 대신 등록된 카탈로그·스키마를 검증한다. **근거:** `backend/app/models/notification.py:18`, `backend/app/services/notification_service.py:17-24,87`.

**호환 예외:** `org_removed`는 기존 팝업이 type으로 찾으므로 전환 기간 유지한다. O06 일반 소속 해제는 organization, 개인 상담소 복귀는 org_removed로 발행한다. 이후 프론트가 `event_type=organization_removed`와 전환 여부로 처리하도록 이관한 다음에만 타입을 합친다. 현재 알림을 일괄 재분류하지 않는다. **근거:** `frontend/src/components/org/OrgRemovedNoticeDialog.tsx:21-44`, `backend/app/services/personal_office_service.py:118-125`.

### 5.2 필드 계약 — 프론트 §4.2와 동일한 이름

**제안:** `extra`는 다음 구조를 사용한다. 현재는 JSONB와 자유 dict이므로 아래 필수성은 신규 계약이다. **근거:** `backend/app/models/notification.py:22`, `backend/app/schemas/notification.py:15`.

- `schema_version`: 정수 1, 신규 알림 필수. 버전 없는 기존 행에 임의로 1을 붙이지 않는다.
- `event_type`: §4에 등록한 문자열, 신규 필수. 인증·권한 판단에 사용하지 않는다.
- `target_type`: `chat_room`, `report`, `session`, `credentials`, `self_profile`, `organization`, `notice`만 허용한다.
- `target_id`: `chat_room/report/session/organization`이면 해당 리소스 UUID 문자열 필수; `credentials/self_profile/notice`는 null. 본인 화면에 타인 user_id를 전달하지 않는다.
- `params`: 객체, 미사용 시 빈 객체. 채팅 메시지에는 `message_id` UUID 필수; 방 생성·초대에는 생략. 리포트는 맥락용 `session_id`. 세션은 `status/state_version/run_id/is_waitlisted`를 필요한 사건에만 전달한다. 검증은 `credential_id/result` 또는 `document_id/result`로 구분한다. 기관 변경에는 `changed_fields`, 소속 해제에는 `personal_office_fallback` bool을 제안한다.
- 기존 루트 키 `room_id/sender_id/report_id/session_id/changed_fields/actor_kind/org_name/office_name/action`은 호환 기간 유지한다. 신규 target ID와 루트 ID는 동일해야 한다. params의 식별자와 DB 관계를 서버가 검증한다.

**제안 예시:** C01은 `schema_version=1; event_type=chat_message; target_type=chat_room; target_id=<방 UUID>; params.message_id=<메시지 UUID>; room_id=<같은 방 UUID>; sender_id=<발신자 UUID>`다. R02는 `target_type=report; target_id=<리포트 UUID>; params.session_id=<세션 UUID>` 및 기존 `report_id/session_id`를 병행한다. O06 복귀는 `target_type=notice; target_id=null; params.personal_office_fallback=true` 및 기존 이름 키다. **개선 근거:** `backend/app/services/chat_service.py:965`, `backend/app/services/report_service.py:524`, `backend/app/services/personal_office_service.py:124`.

**제안 금지 정보:** 임의 URL/라우트, 참여 access_code, 인증·리포트 조회 토큰, 상담·채팅 원문, EEG 값, 주민번호·연락처·관리자 사유 원문을 신규 extra에 넣지 않는다. 기존 body가 민감한 텍스트를 포함할 수 있으므로 레거시 토스트도 안전 문구를 사용해야 한다. **근거:** 현재 채팅 원문 `backend/app/services/chat_service.py:964`, 수정 사유 `backend/app/services/counselor_info_service.py:285,349`, 토큰 링크 `backend/app/services/report_email_service.py:129-132`.

### 5.3 대상과 프론트 경로 매핑

다음은 §4의 모든 이벤트가 사용하는 대상 공통 규칙이다. 경로는 프론트 담당이며 서버는 완성 경로를 저장하지 않는다. **근거:** 현재 경로 정의 `frontend/src/App.tsx:159-182,231-232`.

- `chat_room`: 상담사·접근 가능한 기관 관리자 `/chat/{target_id}`, 내담자 `/app/chat/{target_id}`. C01에만 `?message={params.message_id}` 추가 제안. 메시지 쿼리 처리와 주변 조회는 신규다. **근거:** `frontend/src/App.tsx:171-172`, `frontend/src/pages/client/ClientChatPage.tsx:56-60`, `backend/app/services/chat_service.py:864-877`.
- `report`: 호스트·접근 가능한 운영자 `/reports/{target_id}`, 해당 내담자 `/app/reports/{target_id}`. session ID 대입 금지. **근거:** `frontend/src/App.tsx:180-182`, `frontend/src/pages/client/ClientAppPage.tsx:275-278`, `backend/app/services/report_service.py:380-387`.
- `session`: 호스트 또는 실제 참여자에게 `/sessions/{target_id}` 또는 `/app/sessions/{target_id}`. 알림만으로 입장/동의/시작하지 않는다. **근거:** `frontend/src/App.tsx:166`, `frontend/src/pages/client/ClientSessionDetailPage.tsx:56-84,97-145`, `backend/app/services/session_service.py:242-257`.
- `credentials`: `/credentials`; 본인 자격 결과만. 기관 가입 결과를 여기로 보내지 않는다. **근거:** `frontend/src/App.tsx:159,163`, `backend/app/services/credential_service.py:197-221`.
- `self_profile`: 상담사·기관 관리자 `/settings`, 내담자 `/app/profile`. **근거:** `frontend/src/App.tsx:232`, `frontend/src/pages/client/ClientAppPage.tsx:314-315`.
- `organization`: 접근 가능한 기관 관리자 `/org/{target_id}`. 플랫폼 관리자와 일반 상담사의 기관 경로 자동 전환은 확인 전 `notice`로 안내한다. **근거:** `frontend/src/App.tsx:162,179`, `backend/app/services/org_service.py:249-254`.
- `notice`: 알림 센터 내 내용 확인, 내담자 `/app/notifications`, 나머지 `/notifications`. 내담자 센터는 현재 홈 콘텐츠로 연결되므로 후속 구현이 선행되어야 한다. **근거:** `frontend/src/App.tsx:231`, `frontend/src/pages/client/ClientAppPage.tsx:310-312`.

## 6. 발화 일원화와 데이터 저장 설계

### 6.1 공통 처리 순서

**제안 흐름:** 도메인 권한/변경 검증 → 실제 변경 확정 → 이벤트 ID와 수신자 고유 집합 결정 → 설정/본문/extra 검증 → Notification 및 전달 outbox 저장 → 도메인과 한 번 커밋 → 전달 작업자가 WS·이메일 처리. `create_notification`은 라우터 내부의 저장 함수로만 남기고 도메인 직접 호출을 제거한다. **개선 근거:** 직접 저장·flush `backend/app/services/notification_service.py:51-68`; 현재 라우터 커밋과 태스크 생성 `backend/app/services/notification_service.py:110-130`.

추가 호출 위치는 §4 각 행의 함수이며 기존 대체 위치는 채팅 `post_message`, 리포트 `approve_report`, 상담사 `update_profile/update_primary_admin_profile`, 기관 `set_counselor_suspension`, 개인 상담소 `create_org_removed_notification`이다. 세션 `create_session/update_session/transition_status/join_session/invite_participant/remove_participant/delete_session`을 함께 다뤄 우회 경로를 빠뜨리지 않는다. 생성·분기 채팅방은 참여자 저장 완료 후 사건을 확정한다. **근거:** `backend/app/services/chat_service.py:751-763,927-968`, `backend/app/services/session_service.py:148,280,336,342,491,525,614`.

**제안:** 직접 생성 알림의 감사 로그 원자성을 보존하고, 도메인 커밋 뒤 outbox 전달 실패는 업무 성공을 되돌리지 않는다. DB 트랜잭션 자체가 실패하면 업무와 알림 의도는 함께 롤백한다. 별도 이메일 큐와 신규 outbox 중 어느 쪽이 해당 메일의 유일한 소유자인지 이벤트별로 정하고 이중 전송을 막는다. **근거:** `backend/app/services/counselor_info_service.py:265-290`, `backend/app/services/personal_office_service.py:128-140`, `backend/app/services/report_email_service.py:100-111`.

### 6.2 논리 데이터 모델 제안

현재 Notification의 `id/user_id/type/title/body/is_read/extra/created_at`는 유지한다. 다음 확장은 **신규 논리 설계**이며 실제 테이블·인덱스 마이그레이션은 후속 Plan에서 검증한다. 현재 모델에는 이벤트 고유키·채널 전달 상태가 없다. **근거:** `backend/app/models/notification.py:13-25`.

- 사건 레코드: `event_id` UUID, `event_type`, 도메인 종류/ID, `occurrence_key`, `actor_id` nullable, `occurred_at`, payload version, 최소한의 수신자/표시 스냅샷. 사건 고유키는 ‘대상 ID + 실제 변경 식별자’로 유일하게 한다.
- Notification 확장: `event_id` FK 및 `(event_id,user_id)` 유일성; `read_at` nullable를 추가하고 `is_read`와 같은 작업에서 갱신. API에는 기존 필드를 유지한다. 이메일만 켜진 사용자에게는 Notification 없이 사건·이메일 전달 레코드를 보유한다.
- 전달 레코드(outbox): `delivery_id`, `event_id`, `user_id`, `channel`, nullable `notification_id`, `status(pending/processing/sent/failed/suppressed)`, `attempt_count`, `next_attempt_at`, `last_error_code`, `provider_message_id`, `created_at/sent_at`. `(event_id,user_id,channel)` 유일성. `sent`는 WS emit 또는 공급자 요청 수락이며 사용자가 보았다는 뜻이 아니다.
- 조회 인덱스 후보: Notification `(user_id,created_at,id)`, 미읽음 부분 인덱스 `(user_id,created_at,id) WHERE is_read=false`, 전달 재시도용 `(status,next_attempt_at)`. 실제 DB 인덱스 존재·실행 계획·보관 기간은 **확인 필요**다. 모델 정의와 목록 정렬만으로 운영 DB 상태를 단정하지 않는다. **근거:** `backend/app/models/notification.py:13-25`, `backend/app/services/notification_service.py:146-154`.

**제안 멱등 키:** 채팅은 message ID, 세션 상태는 session ID+run ID+state_version+전이, 초대는 참여자 추가 사건 ID, 리포트 발행은 report ID+최초 승인 사건, 정보 변경은 감사 사건 ID를 사용한다. 일정 수정·구형 join에는 현재 version 증가가 없으므로 도메인 사건 UUID를 같은 트랜잭션에서 새로 부여해야 한다. 재시도는 같은 사건 ID를 재사용하며 정상 재가입/재초대는 새 사건 ID다. **근거:** `backend/app/services/chat_service.py:935-944`, `backend/app/services/session_service.py:331-333,369-371,626-633`, `backend/app/services/report_service.py:508-516`, `backend/app/services/counselor_info_service.py:270-279`.

**제안 이행:** 기존 행을 제목에서 역추론해 event_type/message_id를 채우지 않는다. 버전 없는 알림은 레거시 해석만 지원하고, 새 생산자부터 v1을 적용한다. 채팅 루트 room_id와 org_removed 이름 키는 소비자 이관 완료 전 제거하지 않는다. 삭제된 대상은 알림 이력을 남기되 읽음·목록이 실패하지 않게 도메인 FK 강제 연결을 피한다. 삭제/탈퇴 시 보존·파기 기간은 **확인 필요**다. **근거:** `backend/app/services/chat_service.py:1006-1014`, `frontend/src/components/org/OrgRemovedNoticeDialog.tsx:21-44`, `backend/app/services/admin_service.py:531-562`.

## 7. 권한과 수신자 규칙

**제안 공통:** 수신자는 요청자가 보낸 user ID 목록을 그대로 신뢰하지 않고 도메인 관계로 계산한다. 중복 제거·행위자 제외를 기본으로 하되 관리자 대리 변경 대상자는 반드시 포함한다. 일반 운영 이벤트는 active 계정 대상으로 하고, 정지 통지 자체는 정지된 당사자도 포함한다. 게스트는 User FK가 없으므로 Notification 대상에서 제외한다. **근거:** `backend/app/models/notification.py:17`, `backend/app/models/user.py:38-45`, `backend/app/services/chat_service.py:880-924`, `backend/app/services/report_service.py:515-516`.

- **counselor:** 자신이 호스트인 리포트 검토/실패, 자신이 포함된 채팅, 본인 자격·정보·소속·상담소 알림. 기관 동료라는 이유만으로 다른 세션이나 대화 알림을 받지 않는다. **근거:** `backend/app/services/session_service.py:242-257`, `backend/app/services/chat_service.py:147-188`, `backend/app/services/report_service.py:494-501`.
- **client:** 자신이 참여한 세션·초대·대기 승격, 자신이 수신자인 채팅, 본인에게 발행된 client 리포트. 다른 참여자 리포트/호스트 검토 대기 알림 제외. **근거:** `backend/app/services/session_service.py:250-257,491-522`, `backend/app/services/report_service.py:515-524`.
- **org_admin:** 자신의 채팅 관계/호스트 업무와 해당 기관 신청·정보·운영 사건. 관리자라는 이유로 모든 세션 알림을 일괄 구독하지 않는다. 다중 소속은 active membership 기준으로 수신자를 결정하되 실제 상세 API 권한과 맞는지 검사한다. **근거:** `backend/app/models/user_org_membership.py:3-4,27-37`, `backend/app/services/org_service.py:249-254`; 현행 리포트의 주 소속 비교 `backend/app/services/report_service.py:448-451`.
- **platform_admin:** 본인 대상 계정 알림과 명시적으로 배정된 검토 업무만. 전체 상담·리포트 내용 알림의 자동 수신자는 아니다. 운영 검토 담당자 배정/이메일과 계정 매핑은 **확인 필요**다. **근거:** `backend/app/services/admin_service.py:77,200-258`, `backend/app/tasks/email.py:610`, `backend/app/services/report_service.py:443-464`.

**현재 권한 갭 / 제안 선행 검증:** 리포트 `_can_access_report`는 참여 여부를 검사하지만 report의 사용자·타입·completed 조건까지 검사하지 않는다. ‘본인에게 발행된 client 리포트만’은 현행 보장으로 쓰면 안 된다. 알림 수신자 제한과 별도로 대상 조회 API의 report 단위 정책을 후속 SDD에서 검증·정합화해야 한다. 세션 상세는 호스트/참여자만 통과하므로 기관 관리자 전원에게 세션 딥링크를 보내지 않는다. **근거:** `backend/app/services/report_service.py:380-403,443-464`, `backend/app/services/session_service.py:242-257`.

**현재 WS 갭 / 제안:** JWT로 개인 room에 들어가는 경로 외에 `_enter_room`은 전달된 room_id를 검증 없이 사용한다. 단순히 ‘개인 room이므로 안전’이라고 할 수 없다. 일반 join으로 `user:*` room 가입 차단, JWT 용도·사용자 상태 확인, 도메인 방 멤버 검증을 알림 실시간 확장의 선행 조건으로 둔다. **근거:** `backend/app/ws/chat_namespace.py:17-35,49-64,112-115`.

**확인 필요:** 현재 알림 API의 `get_current_user`는 DB 존재/role을 읽지만 status 차단은 이 함수에 없다. 정지 계정이 절대 알림을 못 읽는다고 단정하지 않는다. 로그인·토큰 갱신·기발급 토큰·WS 전체에 대한 정지 정책을 확정하고, 정지 안내는 이메일로도 전달할 수 있게 기획한다. **근거:** `backend/app/api/deps.py:30-42`, `backend/app/api/v1/notifications.py:19-24,49-58`, `backend/app/services/org_service.py:390-395`.

## 8. 환경설정과 채널 정책

### 8.1 설정 확장

**제안:** email/in_app 두 채널은 유지하고, §4에서 활성화하는 각 event_type을 설정 키로 등록한다. 예약 키 공유를 제거해 session_updated를 독립시킨다. 기존 저장값은 보존하며 session_updated 미저장 시 기존 session_booked 값을 승계한다. 검증·기관·클래스를 화면에서는 그룹화해도 서버는 event_type별 bool을 보관한다. 예약 P02와 담당자 불명인 후보는 UI에서 토글을 노출하지 않는다. **근거:** `backend/app/models/user.py:11-25,45`, `backend/app/services/notification_service.py:34-47`, `backend/app/schemas/notification.py:29-44`.

**제안 기본값:** 모든 신규 활성 이벤트는 인앱 True. 이메일은 `session_booked/session_updated/session_cancelled/session_invited`, `verification_result/organization_verification_result`, `organization_join_result/organization_removed`, `account_suspended/account_reactivated`에 True, 나머지는 False. 기존 `report_ready=True` 등 이미 저장된 사용자 선택은 유지한다. 신규 사용자 report_ready는 기존 모델과 맞춰 True로 두되 원문 없는 안내 이메일만 보낸다. 채팅 메시지·방 초대·클래스 ready/open/start/pause/resume/end는 이메일 False로 과다 발송을 피한다. 이는 현재 5개 기본값을 확장하는 제품 제안이다. **근거:** `backend/app/models/user.py:11-25`, `backend/app/services/notification_service.py:132-133`.

**제안 저장 계약:** 기존 PUT의 두 채널 전체 전달 형식은 유지하되 미제출 event key는 기존값을 보존하고 명시적 bool만 갱신하는 호환 규칙을 도입한다. 신규 이벤트 목록·채널 지원·기본값을 알려주는 메타데이터 응답을 추가할 것을 제안한다. 고정 Pydantic 5개 필드와 UI를 함께 확장해야 한다. 채널별로 다른 기본값을 같은 True 스키마로 처리하지 않는다. **근거:** `backend/app/api/v1/notifications.py:27-38`, `backend/app/services/notification_service.py:228-234`, `backend/app/schemas/notification.py:29-44`.

### 8.2 채널 전달

**제안 인앱/WS:** 인앱 OFF면 Notification·WS·벨 증가 없음. ON이면 DB가 진실 원천이며 온라인 상태와 무관하게 저장한다. WS는 커밋된 동일 Notification을 보내고 REST와 같은 `id/type/title/body/is_read/extra/created_at` 필드를 갖는다. 보고 있는 채팅방이라는 이유로 서버 저장을 생략하지 않는다. **근거:** 현재 인앱 분기 `backend/app/services/notification_service.py:110-127`; REST 필드 `backend/app/services/notification_service.py:157-170`.

**제안 이메일:** email ON은 인앱 설정과 독립이다. 일반 메일 제목은 `[MIND BREEZE] {title}`, 본문은 최소 안내와 로그인 후 확인 경로만 사용한다. 리포트 원문 링크 메일은 기존 본인 요청·주소 검증·게스트 토큰 계약을 유지한다. 이미 요청 기반 원문 메일 발송이 예정된 같은 리포트에는 일반 안내 메일을 합칠지 **확인 필요**이며 승인 메일과 원문 메일을 같은 delivered로 취급하지 않는다. **근거:** `backend/app/services/notification_service.py:83-89,132-133`, `backend/app/services/report_email_service.py:48-112,129-155`.

**제안 재시도:** 현행 동기 3회 대신 작업자에서 최대 3회, 실패 간격 1분·5분을 초기 제안값으로 둔다. 영구 주소 오류는 재시도하지 않고 일시 오류만 재시도한다. WS 재시도는 동일 notification ID를 사용하고 클라이언트가 중복 제거한다. 공급자 요청 수락 뒤 응답 유실에서는 중복 이메일 가능성이 있으므로 ‘정확히 한 번 수신’을 보장하지 않는다. 공급자 멱등 지원은 **확인 필요**다. **근거:** 현재 재시도 `backend/app/services/notification_service.py:71-80`, 동기 HTTP `backend/app/tasks/email.py:47-62`.

**제안 기존 별도 메일:** OTP/초대/재설정은 인증 절차의 일부로 유지한다. 소속 해제 기존 큐는 신규 라우터로 옮길 때 사용자 설정 적용 여부를 명시적으로 바꿔야 한다. 이 기획은 일반 O06 메일을 사용자 설정 대상으로 제안하며, 정책상 필수 통지가 필요하다면 별도 고지·설정 예외를 승인받아 정의해야 한다. 현재 큐 전달에는 notification_preferences 조회가 없다. **근거:** `backend/app/services/personal_office_service.py:128-160`, `backend/app/services/org_invite_service.py:116-173`.

## 9. API·읽음·프론트 계약 대조

**대조 결과:** 프론트 문서의 `schema_version/event_type/target_type/target_id/params`, 7개 target enum, 메시지 ID 필수, 레거시 키 보존, REST·WS 동일 필드 제안을 채택했다. 필드명 충돌은 없다. 프론트 §4.1의 ‘백엔드 문서 없음’은 작성 시점 차이이며 이 문서에서 대조 결과를 기록한다. 양 문서 작성이 제품 승인이나 구현 완료를 뜻하지 않는다.

**추가 합의/차이를 명시한다.**

1. 프론트가 미정으로 둔 신규 이벤트 키·`class/organization` type은 §4~5에서 제안했다. 프론트의 새 타입 표시 사전 반영은 아직 필요하다. `org_removed`는 팝업 호환 때문에 즉시 제거하지 않는다. **근거:** `frontend/src/pages/notifications/NotificationCenterPage.tsx:15-29`, `frontend/src/components/org/OrgRemovedNoticeDialog.tsx:21-23`.
2. 기관 가입 결과의 `/org/requests`는 프론트에서 후보이고 target enum에 없다. 이번 백엔드는 `notice`로 고정 제안하며 credentials로 오분류하지 않는다. 전용 대상 도입은 공동 후속 결정이다. **근거:** `frontend/src/App.tsx:159,163`.
3. 프론트의 ‘접근 가능한 기관 관리자’는 실제 서버 권한 충족 시에만 적용한다. 세션 상세에 기관 관리자 일반 예외가 없고 리포트에는 오히려 report별 제약이 부족하므로 역할만 보고 동일하게 라우팅/발송하지 않는다. **근거:** `backend/app/services/session_service.py:242-257`, `backend/app/services/report_service.py:443-464`.
4. 소속 해제 `params.personal_office_fallback`, 검증 `credential_id/result`, 세션 `state_version/run_id`는 백엔드의 추가 선택 필드다. 프론트 예시의 빈 params와 기본 대상은 호환되며 프론트는 미지원 선택 키를 무시한다. 새 target enum은 추가하지 않는다. **근거:** 정보의 원천 `backend/app/services/personal_office_service.py:94-109`, `backend/app/services/credential_service.py:209-213`, `backend/app/services/session_service.py:369-370,425`.
5. 채팅 기본 본문을 안전 문구로 바꾸는 제안은 프론트 §8.1의 원문 제외 제안과 일치한다. 서버가 현재 보내는 앞 100자와는 다르므로 기존 동작으로 표현하지 않는다. **근거:** `backend/app/services/chat_service.py:963-965`.

### 9.1 필요한 API 확장 제안

- **메시지 주변 조회:** 방 ID와 메시지 ID를 받아 접근 검증 후 대상 메시지·이전/다음 구간·커서를 반환한다. 대상 메시지와 방의 관계를 검증하고 권한 거부는 존재 정보 노출 전에 처리한다. 기존 최근 목록은 유지한다. 엔드포인트 이름·구간 크기·삭제 판별은 **확인 필요**이며 SDD 계약에서 정한다. **근거:** `backend/app/services/chat_service.py:864-877`, `backend/app/api/v1/chat.py:151-159`.
- **메시지 읽음 연동:** `mark_messages_read` 성공 시 같은 사용자·방·message_id의 알림만 읽는다. 알림 클릭으로 방 전체 메시지를 읽지 않는다. 기존 방 전체 읽음에서 루트 room_id 기준 일괄 갱신하는 경로는 프론트 입장 시 일괄 읽음 제거와 함께 이행한다. message_id 없는 레거시는 임의로 개별 메시지에 매핑하지 않는다. **근거:** `backend/app/services/chat_service.py:1006-1014,1031-1101`, `frontend/src/components/chat/ChatRoom.tsx:102-108`.
- **목록·전체읽음:** 기존 `only_unread/limit/offset`, `notifications/total/unread`를 유지한다. 신규 type/event 필터는 서버에 적용하고 total은 필터 결과, unread는 계정 전체로 정의한다. 정렬에 created_at+id를 사용하며 안정 커서는 후속 확장한다. 전체읽음 응답은 현행 `{marked}`를 정본으로 맞춘다. **근거:** `backend/app/api/v1/notifications.py:49-68`, `backend/app/services/notification_service.py:146-170`, `frontend/src/lib/api/notifications.ts:51-52`.
- **동기화:** 읽음/전체읽음은 멱등이며 권한은 수신자 본인 기준이다. 다중 기기에서는 성공 후 unread 재조회, WS 재연결·탭 복귀 시 목록 재검증을 한다. 프론트의 30/60초 보정 제안은 서버와 충돌하지 않지만 실제 부하는 **확인 필요**다. WS 전달 성공을 읽음으로 간주하지 않는다. **근거:** `backend/app/services/notification_service.py:183-207`, `frontend/src/hooks/useNotificationSocket.ts:27-42,54-85`.

## 10. 후속 SDD의 확인 과제와 수용 기준

아래는 **미실행 검증 시나리오 제안**이다. 이 문서는 구현 전 Verify를 대체하거나 사후 테스트 통과를 주장하지 않는다.

1. 기존 6개 호출이 모두 동일 payload/채널 정책을 거치고 업무·감사·알림 의도가 원자적으로 저장되는지 확인한다. 강제 롤백·커밋 뒤 작업자 장애·재시도에서도 이벤트/수신자당 중복 Notification이 없어야 한다. **근거:** `backend/app/services/notification_service.py:110-130`, `backend/app/services/counselor_info_service.py:265-290`.
2. 세션 예약·즉석·open·start·구형 join·pause/resume·cancel·end에서 각각 올바른 사건만 생기는지, 대기자 제외·회원/게스트 구별·삭제 후 notice를 검증한다. **근거:** `backend/app/services/session_service.py:29-35,148-222,342-400,491-554,626-633,704-705`.
3. 명시적 방 생성/기존 방 반환/자동 방/분기/기존 회원 재초대가 중복되지 않고 메시지 50개 밖 딥링크와 실제 노출 읽음이 맞는지 검증한다. **근거:** `backend/app/services/chat_service.py:192-224,681-763,864-877,1006-1101`.
4. 다른 참여자·초안·상담사용 리포트를 내담자가 알림 ID나 report ID 변경으로 열 수 없는지 검증한다. 자동 승인은 검토 요청을 중복시키지 않고 동일 승인 재시도는 R02를 재생성하지 않아야 한다. **근거:** `backend/app/services/report_service.py:208-217,380-403,443-464,508-516`.
5. active 다중 소속, 기관 해제 후 다른 기관 잔존/개인 상담소 복귀, org_removed 팝업, 정지 계정, WS 개인 room 임의 가입을 검증한다. **근거:** `backend/app/models/user_org_membership.py:27-37`, `backend/app/services/org_service.py:524-536`, `backend/app/ws/chat_namespace.py:49-64`.
6. 설정 4조합(인앱/이메일 ON/OFF), 기존 session_booked 값 승계, 누락 키 보존, report_ready 일반 메일과 원문 메일 중복 정책을 검증한다. **근거:** `backend/app/services/notification_service.py:34-47,110-133,228-234`, `backend/app/services/report_email_service.py:115-155`.
7. 알림 50개 초과·동일 시각 정렬·전체읽음 응답·REST/WS 필드 동일성·알 수 없는 버전·누락된 ID·삭제된 대상에서 프론트 대체 행동을 검증한다. **근거:** `backend/app/services/notification_service.py:118-126,146-170`, `backend/app/api/v1/notifications.py:62-68`.

**출시 전 확인 필요:** 개인 상담소 자체 폐쇄 업무, 기관 문서→기관/수신 관리자 연결, platform_admin 검토 담당자 배정, 정지 계정 전체 인증 정책, 데이터 보관·파기 기간, 공급자 이메일 멱등성과 재시도 운영값, 가입 신청 결과 통지 경로, 추가 API 엔드포인트 명세. 해당 항목은 현재 코드만으로 확정할 수 없으므로 자동 발송·임의 라우트를 만들지 않는다. 관련 근거는 각각 §4.4~4.5, §6~9에 제시했다.
