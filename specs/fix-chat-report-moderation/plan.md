# [MB261026][FIX] 채팅 신고 운영 처리·게시 필터(D4) — Plan (원인분석 + 설계)

- 기준: origin/develop `f13cc705` (브랜치 `fix/chat-report-moderation`)
- 승인 근거(원문 대조): `docs/reviews/store-review-prep-20261023/07-대표님결정.md` "대표님 결정 기록 (2026-10-24)" D4
  > 운영 전용 신고 수신 주소 + 플랫폼 관리자 페이지 신고 목록으로 연결. 처리 기한은 추천안(접수 2영업일·1차 판단 5영업일)
- 참고: 같은 폴더 `04-tech-fix-plan.md` §3, `drafts/07-신고·차단_운영정책_초안.md` §3 A안, `05-policy-law-verification.md:24`(Apple 1.2: 필터·신고 대응·차단·연락처)
- 이번 카드 단계: 원인분석 → plan → verify까지. **구현은 감독 승인 후.**

---

## 1. 원인분석

### 1-1. 현재 흐름 (파일:줄)

| 단계 | 위치 | 현재 동작 |
|---|---|---|
| 신고 생성 | `backend/app/api/v1/chat.py:253` `POST /chat/reports` → `chat_moderation_service.report_user` (`chat_moderation_service.py:205`) | 한 트랜잭션에 `ChatReport` + 상호 `ChatBlock` + `NotificationOutbox(channel=email)` 생성 |
| 운영 알림 수신자 | `chat_moderation_service.py:283` `recipient=settings.signup_notice_email` | 가입 신청 알림과 같은 키. 기본값이 **개인 주소**(`config.py:174`). `deploy/env-manifest.tsv`에 해당 키 행 없음 → 운영에서 바꿀 수 없음 |
| 알림 본문 | `chat_moderation_service.py:285-296` | ID·사유만, "chat_reports 테이블에서 내용을 확인해 주세요"(`:293`) → 사람이 DB를 직접 조회해야 함 |
| 메일 발송 | `backend/app/tasks/outbox.py:16` `process_email_outbox`(매 분) | outbox `pending` 행을 Resend로 발송 |
| 신고 철회 | `chat.py:272` → `chat_moderation_service.py:369` | `submitted`만 `withdrawn`으로. 잠금(`with_for_update`) 없음 |
| 차단 목록·해제 | `chat.py:284`, `:294` | 본인 차단만 조회·해제 |
| 신고 데이터 | `backend/app/models/chat.py:80-110` `ChatReport` | `status`(submitted/withdrawn)·`withdrawn_at`만. 처리자·처리 시각·처리 메모 없음 |
| 관리자 신고 목록·처리 | (없음) `api/v1/admin.py` 라우트 목록(`:132~:750`)에 신고 관련 없음. 프론트 `pages/admin/`에도 없음 | 운영자가 신고를 볼 화면·API 없음 |
| 메시지 게시 | `backend/app/services/chat_service.py:1545` `post_message` (유일한 사용자 메시지 생성 경로, 호출: `chat.py:211`) | 멤버·클래스 채팅 on·1:1 차단(`:1555`)·공백(`:1558`) 검사만. **유해 표현 필터 없음** |
| 사용자에게 보이는 신고 연락처 | `frontend/src/lib/api/chat.ts:207` `CHAT_REPORT_CONTACT_EMAIL` → `report-dialog.tsx:88`, `ChatRoom.tsx:467` | **개인 주소가 화면에 노출**. 승인된 문의 주소(`legal-copy.ts:4` `OPERATIONS_EMAIL`)와 불일치 |
| 공개 문구 | `frontend/src/pages/terms-page.tsx:7` | 금지행위·제재·이메일 이의제기만. 신고 처리 기한·필터 언급 없음(신고 기한을 약속하는 공개 문구는 현재 0건, grep 확인) |

### 1-2. D4 · Apple 1.2 항목별 충족 여부

| 기준 | 항목 | 현재 | 판정 |
|---|---|---|---|
| D4 | 운영 전용 신고 수신 주소 | 가입 알림 키 공유, 개인 주소 기본값, 운영 설정 불가 | ❌ 미충족 |
| D4 | 플랫폼 관리자 페이지 신고 목록으로 연결 | API·화면 없음, 메일 본문은 DB 조회 안내 | ❌ 미충족 |
| D4 | 접수 2영업일 · 1차 판단 5영업일 | 처리 상태·시각 필드 없음 → 기한 계산·추적 불가, 공개 안내 없음 | ❌ 미충족 |
| Apple 1.2 | 부적절 콘텐츠 게시 필터 방법 | 없음 | ❌ 미충족 |
| Apple 1.2 | 신고 + 적시 대응 | 신고 기능은 있음(SDD-220). 대응 추적·기한 없음 | △ 부분 |
| Apple 1.2 | 사용자 차단 | 신고 시 즉시 상호 차단 + 본인 해제(SDD-220) | ✅ 충족 |
| Apple 1.2 | 연락처 공개 | 공개 연락처는 있으나 채팅 화면은 개인 주소 노출 | △ 부분 |

> 범위 메모: "게시 필터"는 D4 원문이 아니라 **Apple 1.2 필수 항목**(감독 카드 범위)이다. D4 원문 범위(수신 주소·관리자 목록·기한)를 넓히지 않고, 필터는 1.2가 요구하는 "필터 방법 존재"를 만족하는 최소 장치로만 둔다.

---

## 2. 설계 (최소안)

### 2-1. 운영 전용 신고 수신 주소

- 신규 설정 `moderation_notice_email: str = ""` (`config.py`, `signup_notice_email` 옆). **코드에 실주소 없음.** 값은 OPS가 SSM `/mindbreeze/prod/MODERATION_NOTICE_EMAIL`(dev도 동일 방식)로 넣는다.
- `deploy/env-manifest.tsv`에 `MODERATION_NOTICE_EMAIL	ssm	0		채팅 신고 운영 알림 수신(운영 전용 주소)` 행 추가(선택 키 → 미설정이어도 배포는 진행).
- 미설정 시(안전한 동작):
  - 신고·상호 차단·관리자 목록 등록은 **정상 처리**(신고 접수가 메일 설정에 막히지 않음).
  - 이메일 outbox 행을 **만들지 않는다**. `signup_notice_email`(개인 주소)로 **폴백하지 않는다.**
  - `logger.warning`에 신고 ID만 남긴다(사유·내용·이름 없음).
  - 관리자 신고 화면 상단에 "운영 신고 수신 주소가 설정되지 않아 메일 알림이 가지 않습니다" 배너(API가 `notice_email_configured: bool`만 내려줌, 주소 값은 내리지 않음).
- 알림 본문 변경: DB 조회 안내 → 관리자 화면 링크 `{report_email_base_url}/admin/chat-reports?report={id}` + 접수 확인 기한·1차 판단 기한. **대화 내용·이름·이메일은 계속 싣지 않는다**(현 원칙 유지, 신고 내용 외부 전송 금지).
- 실제 발송은 기존 outbox 소비자가 한다. 이 카드의 테스트·검증에서는 발송 함수를 호출하지 않는다(verify V-07).

### 2-2. 처리 상태·기한 (DB)

`ChatReport` 상태 전이 (기존 `submitted`·`withdrawn` 유지, 3개 추가):

```
submitted(접수) ──→ reviewing(검토 중)  ──→ actioned(조치 완료) | dismissed(조치 없음 종결)
     │      └──────────────────────────────→ actioned | dismissed  (바로 판단 가능)
     └─(신고자 철회)→ withdrawn(철회)         ※ withdrawn·actioned·dismissed 는 종결, 재전이 없음(409)
```

- 추가 컬럼(단일 마이그레이션): `acknowledged_at`(처음 submitted를 벗어난 시각 = 접수 확인), `decided_at`(actioned/dismissed 시각 = 1차 판단), `handled_by`(FK users, `ON DELETE SET NULL`), `resolution_note`(Text, 1~1000자, 판단 시 필수). 인덱스 `(status, created_at)`.
- `actioned`는 "운영자가 **별도로** 조치했다"는 기록일 뿐이다. 이 API는 메시지 삭제·계정 정지·차단을 **자동으로 하지 않는다.** 정지가 필요하면 운영자가 기존 사용자 관리 화면(`/admin/users`, `admin.py:266` suspend)에서 사람이 직접 한다.
- 동시성: 관리자 전이와 신고자 철회 모두 `with_for_update`로 잠근다(현 `withdraw_report`에 잠금 추가). 철회는 기존대로 `submitted`일 때만 가능 → 관리자가 `reviewing`으로 옮긴 뒤 철회 시도는 기존 409 `REPORT_ALREADY_PROCESSED`.
- 같은 상태로의 재요청(예: reviewing→reviewing)은 200·무변경·감사 기록 없음(멱등).
- 기존 탈퇴 삭제(`account_deletion_sweep_service.py:59`)는 그대로: 신고자/대상이 탈퇴 확정되면 신고 행도 삭제된다(처리 중이어도). 동작 변경 없음.

### 2-3. 영업일 기한 계산

- 신규 `backend/app/services/business_days.py`: `due_end_of_business_day(received_at, n, holidays) -> datetime`.
- 규칙: 접수 시각을 **KST**로 바꾼 접수일 D 기준, D 다음 날부터 영업일(월~금, 휴일 제외)을 세어 n번째 영업일의 **23:59:59 KST**가 기한.
  - 금 15:00 접수 → 접수 확인 기한 화 23:59:59, 1차 판단 기한 다음 주 금 23:59:59.
  - 토·일 접수 → 월(1)·화(2) → 화 23:59:59.
- 휴일: 기본은 **주말만**(공휴일을 세지 않으면 기한이 더 짧아져 약속보다 엄격 = 안전 측). 선택 설정 `moderation_holidays: str = ""`(쉼표 구분 `YYYY-MM-DD`, OPS가 SSM `MODERATION_HOLIDAYS`로 관리, 매니페스트 선택 행). 잘못된 날짜는 무시 + 경고 로그.
- 기한은 **조회 시 계산**(저장 안 함) → 휴일 설정을 바꾸면 진행 중 신고 기한에 즉시 반영, 기존 행 백필 불필요.
- 기한 초과 판정: `ack_overdue = acknowledged_at 없음 AND now > ack_due`, `decision_overdue = decided_at 없음 AND now > decision_due`. `withdrawn`은 둘 다 false.
- 자동 경보 cron(04 문서 §3-3 3번)은 D4 원문 밖이므로 **이번 범위 제외**. 관리자 화면의 "기한 초과" 필터·배지로 대체.

### 2-4. 관리자 API (플랫폼 관리자 전용)

신규 라우터 `backend/app/api/v1/admin_chat_reports.py` (prefix `/admin`, 기존 `require_platform_admin`(`admin.py:56`) 재사용, `api/v1/__init__.py`에 등록). `admin.py`(776줄)는 건드리지 않는다.

| 메서드 · 경로 | 동작 | 응답 핵심 |
|---|---|---|
| `GET /admin/chat-reports?status=&overdue=&page=&size=` | 목록(최신순, 상태·기한 초과 필터) | `items[]`: id·status·reason·created_at·신고자/대상 {id, 표시 이름}·room_type·has_message·ack_due_at·decision_due_at·acknowledged_at·decided_at·ack_overdue·decision_overdue·handled_by_name / `counts`(상태별) / `notice_email_configured` — **메시지 발췌·이메일 없음** |
| `GET /admin/chat-reports/{id}` | 상세(최소 열람) | 목록 필드 + `message_excerpt`(신고된 메시지 1건의 기존 사본 ≤500자)·신고자/대상 이메일·room_id·message_id·resolution_note·처리 이력 |
| `POST /admin/chat-reports/{id}/transition` `{to, note}` | 상태 전이 | 갱신된 상세. 잘못된 전이 409 `INVALID_REPORT_TRANSITION`, 철회됨 409 `REPORT_WITHDRAWN`, 종결됨 409 `REPORT_CLOSED`, 판단 시 note 누락 422 |
| `GET /admin/chat-filter-terms` | 금칙어 목록 | `items[]`: id·term·created_at·created_by_name |
| `POST /admin/chat-filter-terms` `{term}` | 추가(정규화 후 중복 409) | 추가된 항목 |
| `DELETE /admin/chat-filter-terms/{id}` | 삭제(오탐 해소) | 204 |

- 비관리자(회원·상담사·기관관리자): 전부 403(기존 가드 문구). 미인증 401.
- 없는/잘못된 ID: 404.

### 2-5. 감사 로그 · 개인정보(data-privacy.md 정합)

- 기존 `verification_audits`(`models/credential.py:32`, `target_type/target_id/admin_id/action/reason/extra`) 재사용 — 새 감사 테이블을 만들지 않는다.

| action | 언제 | target | reason / extra |
|---|---|---|---|
| `chat_report_list` | 목록 조회 | target_id 없음 | extra: 필터·건수 |
| `chat_report_view` | 상세 조회(발췌 열람) | 신고 ID | – |
| `chat_report_transition` | 상태 전이 | 신고 ID | reason=운영자 메모, extra: {from, to} |
| `chat_filter_term_add` / `chat_filter_term_remove` | 금칙어 추가·삭제 | 금칙어 ID | extra: {term} |

- **최소 열람**: 목록에는 발췌·이메일을 내리지 않는다. 발췌는 상세에서만, 그리고 화면에서도 "신고된 메시지 보기" 버튼을 눌러야 상세를 불러온다(=열람 1회 = 감사 1행). 방의 앞뒤 대화·다른 메시지는 **보여 주지 않는다**(상담 내용 비밀 유지). 감사 행에는 발췌 내용을 복사하지 않는다.
- 금칙어 감사 `extra.term`은 운영 데이터(개인정보 아님)라 기록한다.
- 감사 보관은 기존 테이블 정책을 따른다(이 카드에서 보관 정책 변경 없음).

### 2-6. 게시 필터 (Apple 1.2 "필터 방법")

- 신규 테이블 `chat_filter_terms(id, term, normalized_term UNIQUE, created_by FK users SET NULL, created_at)` — 같은 마이그레이션.
- 신규 `backend/app/services/chat_content_filter.py`
  - 정규화: NFKC → 소문자 → 공백·흔한 구분 기호(`. - _ * ~ ! @ # $ % ^ & ( ) /` 등) 제거. 메시지와 금칙어를 같은 방식으로 정규화.
  - 판정: 정규화된 메시지에 정규화된 금칙어가 **부분 문자열로 포함**되면 차단.
  - 금칙어 제약: 정규화 후 2~50자, 최대 500개.
  - 매 게시마다 DB 조회(목록이 작음, 캐시 없음) → 관리자가 삭제하면 **즉시** 반영.
- `post_message`(`chat_service.py:1558` 공백 검사 직후) 한 줄 호출. 걸리면 저장·알림·푸시 없이 **422** `{"code":"CHAT_CONTENT_BLOCKED","message":"운영정책에 맞지 않는 표현이 있어 보낼 수 없어요. 내용을 고쳐 다시 보내 주세요."}`. 어떤 단어에 걸렸는지는 응답에 넣지 않는다.
  - 모든 방 유형(1:1·그룹·클래스)·모든 사용자(관리자 포함)에 적용. 시스템 메시지(`system_message_service.py:13`)는 대상 아님.
  - 로그: `user_id`·`term_id`만(메시지 내용 없음). 차단 시도는 DB에 저장하지 않는다.
- **금지 사항 준수**: 기존 메시지 소급 삭제 없음, 반복 차단에 따른 자동 정지·차단 없음, 경고 누적 없음.
- 오탐 경로: 사용자는 입력란에 원문이 그대로 남아 고쳐 보낼 수 있다 → 오탐이라 생각되면 화면 안내의 운영 이메일로 알림 → 관리자가 금칙어 삭제 → 즉시 전송 가능.
- 금칙어 목록이 비어 있으면 필터는 아무것도 막지 않는다(장치는 존재). 초기 목록은 **결정 필요 B1**.

### 2-7. 프론트

| 화면 | 변경 |
|---|---|
| 관리자 신고 화면(신규) `pages/admin/ChatReportsPage.tsx` · 라우트 `/admin/chat-reports`(`App.tsx`, 기존 `PlatformAdminRoute` 재사용) · 사이드바 `SidebarNav.tsx` `ADMIN_NAV_ITEMS` + `lib/terms.ts` 라벨 `'admin-chat-reports': '채팅 신고'` | 탭 `신고` / `금칙어`. 신고 탭: 상태 필터 칩(접수·검토 중·조치 완료·조치 없음·철회) + "기한 초과만" 토글 + 표(접수 일시, 상태, 사유, 신고자, 대상, 접수 확인 기한, 1차 판단 기한, 처리자). 기한 초과는 빨간 배지, 철회는 회색 "신고자 철회" 배지·처리 버튼 비활성. 행 선택 → 상세 패널: "신고된 메시지 보기"(눌러야 상세 조회), 처리 이력, 상태 버튼 + 메모(판단 시 필수). 미설정 배너. 기존 `SignupApplicationsPage.tsx` 배지·표 패턴 재사용 |
| 금칙어 탭 | 목록 + 추가 입력 + 삭제(확인 대화상자) |
| `lib/api/admin.ts` | 위 API 함수·타입 추가 |
| `components/chat/ChatRoom.tsx` `handleSend`(`:349`) | 422 `CHAT_CONTENT_BLOCKED`면 입력란에 원문 복원 + 안내 문구, 재전송 버튼 없음 |
| `lib/api/chat.ts:207` | `CHAT_REPORT_CONTACT_EMAIL` → `OPERATIONS_EMAIL`(`legal-copy.ts:4`)을 쓰도록 교체(개인 주소 노출 제거) + `isChatContentBlockedError` 추가 |
| `components/chat/report-dialog.tsx` 완료 화면(`:83~`) | "운영팀이 영업일 기준 2일 안에 접수를 확인하고, 5일 안에 1차 판단해요." 한 줄 추가 |
| `components/chat/blocked-users-list.tsx:58-62` | 신고 상태가 reviewing이면 "운영 검토 중", actioned/dismissed면 "처리 완료" 문구(철회 버튼은 기존대로 submitted만) |

### 2-8. 공개 문구 정합 (실제 동작과 일치)

| 문구 위치 | 바꿀 내용 | 실제 동작 근거 |
|---|---|---|
| `terms-page.tsx:7` 금지행위와 제재 | "채팅에서 신고하면 상대와 즉시 서로 차단되고, 운영팀이 영업일 기준 2일 안에 접수를 확인하고 5일 안에 1차 판단합니다. 운영정책에 맞지 않는 표현이 포함된 메시지는 보내지지 않을 수 있습니다." 추가 | 상호 차단(SDD-220), 처리 기한 표시·추적(2-2·2-3), 게시 필터(2-6) |
| `report-dialog.tsx` 완료 화면 | 위 2-7과 동일 문장 | 동일 |
| 지원 FAQ `lib/support-faq.ts` | "채팅에서 불쾌한 메시지를 받았어요" 1문항(신고 방법·즉시 차단·기한·운영 이메일) | **PR #119가 이 파일을 새로 만든다.** #119가 develop에 들어온 뒤 rebase해서 추가. 그 전에 구현이 끝나면 FAQ 문항은 후속 1줄 FIX로 분리 |
| 심사 메모(App Review Notes) | 신고 처리 절차·기한·필터 한 단락 | 문서 산출물은 스토어 준비 창구 담당. summary에 문안만 남긴다 |

- 쓰지 않을 표현: "24시간 내", "자동 삭제", "자동 정지"(구현과 불일치). "영업일 기준"을 반드시 붙인다.
- 공개 문구 금지어 검사(`legal-copy.ts` `findPublicCopyViolations`)에 걸리는 단어 없음.

---

## 3. 파일 목록 · 마이그레이션

### 3-1. 백엔드

| 파일 | 변경 | 비고 |
|---|---|---|
| `backend/app/config.py` | `moderation_notice_email`, `moderation_holidays` 2줄 | 공용 hot 파일 — 2줄만 |
| `deploy/env-manifest.tsv` | 선택 행 2개 | |
| `backend/app/models/chat.py` | `ChatReport` 컬럼 4개 + `ChatFilterTerm` 모델 | |
| `backend/app/models/__init__.py` | `ChatFilterTerm` export | |
| `backend/alembic/versions/<새 revision>_chat_report_moderation.py` | **단일 revision**, `down_revision="e246a0301001"`(현재 유일 헤드). 컬럼 4개·인덱스 1개·테이블 1개 추가, downgrade 대칭 | 머지 직전 `python3 scripts/check-alembic-heads.py`로 헤드 1개 확인(다른 PR이 먼저 마이그레이션을 넣으면 down_revision 재지정) |
| `backend/app/services/chat_moderation_service.py` | 수신자·본문(2-1), 철회 잠금 | |
| `backend/app/services/business_days.py` | 신규 | |
| `backend/app/services/chat_content_filter.py` | 신규 | |
| `backend/app/services/chat_report_admin_service.py` | 신규: 목록·상세·전이·금칙어 CRUD·감사 | |
| `backend/app/services/chat_service.py` | `post_message`에 필터 호출 1곳 | 공용 큰 파일 — 1곳만 |
| `backend/app/schemas/chat_report_admin.py` | 신규 Pydantic v2 | |
| `backend/app/api/v1/admin_chat_reports.py` | 신규 라우터 | |
| `backend/app/api/v1/__init__.py` | 라우터 등록 1줄 | |
| `backend/tests/test_chat_report_admin.py`, `test_chat_content_filter.py`, `test_business_days.py` | 신규 | `test_sdd220_chat_moderation.py`, `test_chat_unblock.py` 회귀 |

### 3-2. 프론트

| 파일 | 변경 |
|---|---|
| `frontend/src/pages/admin/ChatReportsPage.tsx` | 신규 |
| `frontend/src/App.tsx` | 라우트 1줄 (PR #119도 수정 — 다른 줄, rebase로 해결) |
| `frontend/src/components/layout/SidebarNav.tsx`, `frontend/src/lib/terms.ts` | 메뉴 1개·라벨 1개 |
| `frontend/src/lib/api/admin.ts`, `frontend/src/lib/api/chat.ts` | API·타입·에러 판별, 연락처 상수 교체 |
| `frontend/src/components/chat/ChatRoom.tsx`, `report-dialog.tsx`, `blocked-users-list.tsx` | 2-7 |
| `frontend/src/pages/terms-page.tsx` | 문장 추가 |
| `frontend/src/lib/support-faq.ts` | #119 머지 후에만 |
| `frontend/tests/fix-chat-report-moderation.test.tsx` | 신규 vitest |
| `frontend/e2e/chat-report-moderation.mjs` | 신규 Playwright(설치 Chrome `channel:"chrome"`) |

### 3-3. 건드리지 않는 것

- SDD-246 소유(실시간 v2·native, 3bf4c75e 변경 파일 대조): `backend/app/services/{session_live_*,live_ingest_service,live_redis/}`, `backend/app/schemas/session_live_*`, `backend/app/models/live_state.py`, `backend/app/ws/`, `frontend/src/lib/{session-live,measurement-web,native-measurement,biosignal}/`, `frontend/ios`, `frontend/android`, `contracts/session-live-v2/`. 겹치는 파일은 `backend/app/models/__init__.py`(export 1줄 추가만)뿐. 클래스 채팅 on/off 명령(`command-chat-set_enabled`)도 건드리지 않는다. 채팅 메시지 경로는 REST `post_message` 하나라 live 코드와 무관(grep: `ChatMessage(` 생성은 `chat_service.py:1560`, `system_message_service.py:13`뿐).
- `api/v1/admin.py` 본문, `signup_notice_email` 사용처(가입 신청·탈퇴 알림 `tasks/email.py:655`, `account_deletion_service.py:328`) — D4 범위 밖.
- 서비스 범위(상담·AI 비공개, 명상 중심), 탈퇴 삭제 정책, 감사 보관 정책.

### 3-4. 테스트 실행

- 로컬: `scripts/test-changed`(+ 위 신규 테스트 직접), 프론트 `npm test -- fix-chat-report-moderation`, `tsc`, `eslint`(변경 파일), `npm run build`.
- PG 마이그레이션: upgrade → downgrade → upgrade 왕복(로컬 PG 또는 CI PG 스모크).

---

## 4. 예상 규모

- 백엔드 코드 약 550줄(신규 서비스 3·라우터·스키마·마이그레이션) + 테스트 약 450줄.
- 프론트 코드 약 500줄(관리자 화면이 대부분) + vitest 약 200줄 + Playwright 스크립트 약 150줄.
- 작업량: 1인 1~1.5일(구현·테스트·실렌더 검증 포함).

## 5. 결정 필요 (사업 결정만)

| ID | 결정 | 추천 | 영향 |
|---|---|---|---|
| B1 | 초기 금칙어 목록을 누가 만드나 | **워커가 일반 욕설·성적 표현·혐오 표현 기본안(30개 안팎)을 문서로 제안 → Brian 확인 후 운영자가 관리 화면에서 등록**. 코드·마이그레이션에는 단어를 넣지 않음 | 비워 두면 심사 시 "필터는 있으나 비어 있음". 너무 넓으면 오탐(예: "시발점") 증가 |
| B2 | 운영 전용 신고 수신 주소 실값 | 공용 메일함(예: 기존 운영 메일 계정 하위 별칭)으로 지정 → OPS가 SSM 등록 | 미등록이면 메일 알림 없이 관리자 화면에서만 확인(안전 동작) |

> 기술 기본값(묻지 않고 진행, 바꾸려면 알려 주세요): 필터는 경고가 아니라 **전송 차단**, 걸린 단어는 사용자에게 알리지 않음, 공휴일은 OPS 설정 시에만 반영(기본 주말만), 관리자는 신고된 메시지 1건 발췌만 열람(앞뒤 대화 비공개), 자동 경보 cron은 이번 범위 제외.
