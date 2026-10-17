# I2 리포트 신청 OTP 제거 — 코드 조사

> 기준: develop `32fa5533`, 조사일 2026-10-17. 경로는 프론트 `frontend/src/`, 백엔드 `backend/app/` 기준(테스트는 `frontend/tests/`, `backend/tests/`). 코드·시안 수정 없음.
> 근거 시안: `designs/class-flow-redesign/member-b.html` FM09 (`on-group-member`, `-report`, `-reportsent`, `-checkin`, `-checkinempty`, `-checked`), 구현은 `member-b.html:520-543`(`FM09()`).

## 0. 한 줄 결론

- **백엔드는 이미 "로그인 회원이 계정 이메일로 신청하면 OTP 생략"을 지원한다**(`services/report_email_service.py:75-85`). 프론트 `ReportEmailRequestPanel` 에도 그 경로가 있다(`useAccountEmail`, `:44`, `:72`). 즉 1탭 신청은 **프론트만으로 가능**하고 백엔드 변경은 필수가 아니다.
- 남는 일은 (a) 패널에서 게스트·OTP 분기 제거와 1탭 UI 로 재작성, (b) 시트 2종을 시안 언어로 정리(현행은 라이트 카드 + 중복 제목 + 완료 후 빈 시트), (c) 백엔드 권장 3건(계정 이메일 강제, participant 자동 해석, 중복 생성 가드).
- `POST /auth/email/request-otp`·`verify-otp` 는 **회원가입 등 다른 사용처가 있어 제거 불가**. 게스트 용도 코드(`GuestCompletePanel.tsx`, 패널의 OTP 분기)만 정리한다.
- 기존 테스트에 **로그인 회원이 OTP 없이 신청하는 백엔드 테스트가 없다**(전부 게스트 참가자). 1탭을 정식 경로로 삼는다면 추가해야 한다.

## 1. 현재 코드 상태

| 항목 | 판정 | 근거 |
|---|---|---|
| 회원 경로(OTP 생략) 프론트 | 있음 | `components/class/ReportEmailRequestPanel.tsx:44` `useAccountEmail`, `:72` `skipOtp`, `:81` `token = skipOtp ? null : ...`, `:143` 폼 제출이 `useAccountEmail ? handleVerifyAndSubmit : handleRequestOtp` |
| 게스트 경로(OTP) 프론트 | 있음 | 같은 파일 `:46-63` `requestOtp`, `:65-101` `verifyOtp`→`requestReportEmail`, `:103-113` 재발송 쿨다운, `:167-207` 코드 입력 폼 |
| 회원 OTP 생략 백엔드 | 있음 | `services/report_email_service.py:75-80` 참가자 `user_id == 로그인 user_id` 이고 body 이메일이 계정 이메일과 `casefold` 일치하면 `email_verified = True` |
| 서버가 body 이메일을 받는가 | 있음(강제 아님) | `schemas/session.py:484-488` `ReportEmailRequest.email: EmailStr` 필수. 계정 이메일이 아니어도 `email_verify_token` 이 맞으면 통과(`report_email_service.py:81-85`) |
| 회원 소유 검증 | 있음 | `report_email_service.py:66-68` `participant.user_id` 가 있으면 `str(participant.user_id) != user_id` 일 때 403. `get_current_user_optional`(`api/deps.py:56-70`)은 토큰 무효 시 `None` → 회원 참가자는 403 |
| 신청 중복·멱등 | 일부 | 같은 이메일 재신청은 허용(`:86-89`), 다른 이메일은 409(`:86-88`, 대소문자 구분 `!=`). 리포트는 `(session, participant, type=client)` 로 재사용(`:90-96`). **생성 중 재신청 시 매번 생성 태스크 재발행**(`:101-103`) |
| 상담사 승인 후 발송 | 있음 | 신청 시 `pending_review` 면 `{"status":"pending_review","message":"상담사 승인 후 이메일로 발송됩니다"}`(`:118-119`), 승인 시 `services/report_service.py:873-929` `approve_report` → `_enqueue_client_email_on_approval`(`:929`) |
| 신청 상태 조회 API | 없음 | `participant.report_email*` 는 `_serialize`·참가자 DTO에 없다(`services/session_service.py:121-142` 참가자 필드 목록에 없음). 호스트 리포트 목록에만 노출(`report_service.py:726`) |
| 1탭 UI(계정 이메일 표시·신청 1버튼·완료) | 일부 | 계정 이메일을 읽기 전용 입력으로 보여 주고 `리포트 신청` 버튼 1개(`ReportEmailRequestPanel.tsx:147-162`). 마스킹·`확인` 버튼·시안 문구는 없음 |
| 이메일 마스킹 유틸 | 없음 | `maskEmail`/`마스킹` grep 0건(`frontend/src`) |
| 종료 화면 시트 2종 시안 정합 | 일부 | 아래 §2-6 |
| OTP 엔드포인트 다른 사용처 | 있음(제거 불가) | 아래 §2-4 |
| 게스트 전용 OTP 레코드 모델 | 없음 | OTP 는 Redis(`services/otp_service.py:15-25` `otp:{email}` 등), 검증 토큰은 JWT(`email_verify_service.py:14-19`). `EmailVerification` 류 DB 모델·테이블 없음 → 정리할 레코드 없음 |
| `GuestCompletePanel.tsx` | 죽은 코드 | import 하는 곳 없음. `grep GuestCompletePanel frontend/src` 결과는 자기 파일(`:15`, `:44`, `:54`)과 주석 2곳(`ReportEmailRequestPanel.tsx:1`, `MemberEndScene.tsx:2`)뿐 |

## 2. 상세 조사

### 2-1. `ReportEmailRequestPanel.tsx` 구조 (209줄)
- props: `sessionId`, `participantId`, `participantToken`, `accountEmail`, `isLoggedIn`(`:10-17`).
- 단계 상태 `FormPhase = 'email' | 'otp' | 'success'`(`:8`). 신청 가능 조건 `canRequest = sessionId && participantId && (isLoggedIn || participantToken)`(`:43`), 아니면 `참가 정보가 없어 리포트를 신청할 수 없습니다.`(`:121-123`).
- **회원 경로**: `useAccountEmail`(로그인 + 계정 이메일 있음)이면 입력은 `readOnly`(`:153`), 제출이 곧바로 `handleVerifyAndSubmit`(`:143`) → `skipOtp` 로 `verifyOtp` 생략 → `requestReportEmail(sessionId, {participant_id, email, email_verify_token: null, participant_token: null}, {skipAuth: false})`(`:81-91`). 단위 테스트가 이 호출 인자를 못 박고 있다(`tests/report-email-request-panel.test.tsx:44-58`).
- **게스트 경로**: 이메일 입력 → `requestOtp`(`:56`) → 6자리 입력 → `verifyOtp`(`:81`) → `requestReportEmail(..., participant_token, {skipAuth: true})`(`:82-91`). 재발송 30초 쿨다운(`:107`, `:115-119`).
- 호출 API 함수: `lib/api/auth.ts:54-58` `requestOtp`(`POST /auth/email/request-otp`), `verifyOtp`(`POST /auth/email/verify-otp`), `lib/api/session.ts:498-505` `requestReportEmail`(`POST /sessions/{id}/report-email`, `skipAuth` 옵션).
- 성공 문구: `reportRes.status === 'pending_review'` 면 `상담사 승인 후 메일로 발송됩니다` 고정(`:93`), 그 외 서버 `message` 사용(`:94`: `generating`/`queued`/`sent` 문구가 그대로 노출). 완료 화면은 `리포트 신청이 완료되었어요.` + 서버 문구 + 안내 문단(`:125-135`).
- 영업일 문구: `영업일 기준 1 ~ 2일 이내`는 **프론트 하드코딩**(`:145`). 서버는 영업일을 언급하지 않는다.

### 2-2. 오류 문구 매핑 (`reportEmailErrorMessage`, `:19-32`)
| status | 프론트 문구 | 서버가 실제로 이 status 를 내는 경우 |
|---|---|---|
| 401 | 이메일 인증이 필요합니다. 인증 코드를 다시 받아 주세요. | 계정 이메일이 아닌 주소 + `email_verify_token` 없음(`report_email_service.py:82-83`), 게스트 소유 토큰 불량(`:41`). **1탭에서는 인증 코드 안내가 의미 없음** |
| 403 | 참가자 확인에 실패했거나 인증 이메일이 일치하지 않습니다. | 참가자 아님(`:65`), 남의 리포트(`:68`), 토큰 sub 불일치(`:72`), 인증 이메일 불일치(`:85`)를 **한 문구로 뭉갬** |
| 409 | 메시지에 `변경` 포함 → 변경 불가 / 아니면 완료된 세션만 | 미완료 세션(`:74`), 이메일 변경(`:88`) |
| 422 | 이메일 형식을 확인해 주세요 | Pydantic `EmailStr` |
| 그 외(예: 503) | **서버 `error.message` 원문**(`:29`) | `리포트 생성 예약에 실패했습니다...`(`:110`), `리포트 생성에 실패했습니다...`(`:117`), `메일 발송 예약에...`(`:133`) |
- 시안/결정 7(해요체)과의 차이: 현행 문구는 합쇼체(`~합니다`). 서버 원문 노출은 시안의 "서버 메시지 원문 숨김" 방향(`FM10 error`)과 어긋난다 — 1탭 패널에서는 status→문구 매핑표로 교체 필요.

### 2-3. 백엔드 구현 (읽은 파일)
- 라우터: `api/v1/session.py:501-509` `POST /sessions/{session_id}/report-email`(202, `get_current_user_optional`). 열람용 `GET .../report-email/view`(`:512-517`).
- 서비스: `services/report_email_service.py:55-134` `request_report_email`.
  1. 세션 행 잠금 조회(`:56`), 404.
  2. `participant_id` 로 `is_waitlisted == False` 참가자 조회, 없으면 403(`:59-65`).
  3. 회원 참가자(`user_id` 있음) → 로그인 user 일치 필수(`:66-68`). 게스트 → `report_participant` JWT 의 `sub`/`session_id` 일치(`:69-72`, 토큰 발급 `:29-31`, 7일 유효 `:25`).
  4. `session.status != "completed"` 면 409(`:73-74`).
  5. **OTP 생략 분기**: 회원 본인 + body 이메일 == 계정 이메일 → 인증 통과(`:75-80`). 아니면 `email_verify_token` 필수·이메일 일치(`:81-85`).
  6. 기존 `participant.report_email` 과 다르면 409(`:86-88`), 같으면 덮어씀(`:89`).
  7. client 리포트 조회/생성 `pending_analysis`(`:90-96`), 커밋.
  8. 상태 분기: `pending_analysis|error` → 생성 태스크 발행(`:101-110`), 아직이면 `generating`(`:113-115`); `error` → 503(`:116-117`); `completed` 아님 → `pending_review`(`:118-119`); 이미 발송 → `sent`(`:120-121`); 그 외 메일 발송 큐 → `queued`(`:122-134`).
- 승인 흐름: `services/report_service.py:873-` `approve_report`는 `pending_review|completed` 만 승인(`:884-885`), `completed` 전이 + 회원이면 `report_ready` 알림(`:895-910`), 처음 승인이면 신청된 메일 발송 예약(`:929`). 상담사 `auto_approve_report` 가 켜져 있으면 생성 직후 자동 승인(`:363`, `:406-411`) — 이 경우 신청 직후 `queued`/`sent` 가 나올 수 있어 **시안의 "상담사가 확인하면"** 문구와 어긋난다.
- 세션 종료 시 리포트는 신청 여부와 무관하게 자동 생성된다(`tests/test_sdd086_auto_report.py:195-225`: 종료 후 client 리포트 존재, 신청 시 재사용). 즉 "신청"은 **수신 이메일 등록 + 발송 트리거**다.
- 신청 가능 대상: 종료(`completed`)된 세션의 비대기열 참가자만. 호스트는 참가자 행이 아니므로 호출 시 403(참가자 조회 실패).

### 2-4. OTP 엔드포인트의 다른 사용처 (제거 불가)
| 사용처 | 근거 |
|---|---|
| 회원(내담자) 가입 | FE `pages/register/RegisterClientPage.tsx:113`(`requestOtp`), `:134`(`verifyOtp`); BE `api/v1/auth.py:316-338` `_create_user_with_role` 가 `email_verify_token` 필수 검증, `:420-` `/register/client`, `:180-` 레거시 `/register`(`:198-199` 토큰 필수) |
| 상담사 가입 신청(개인) | FE `pages/register/RegisterCounselorPage.tsx:55`, `:72`; BE `api/v1/signup_applications.py:74`, `services/signup_application_service.py:180-194` |
| 상담사 코드 확인 | `api/v1/auth.py:534-544` `/counselor-code/check` 가 `email_verify_token` 요구 |
| 리포트 신청(게스트) | 위 패널, `GuestCompletePanel.tsx`(죽은 코드) |
| 비밀번호 재설정·이메일 변경 | **사용 안 함**: `backend/app` 전체 grep(`otp|email_verify|EmailVerification`)에서 해당 경로 없음 |
- 엔드포인트 정의 `api/v1/auth.py:272-296`(`request-otp` 60초 쿨다운 `otp_service.py:28-34`, `verify-otp` 시도 5회 `OTP_MAX_ATTEMPTS`, `otp_service.py:12`·`:44-66`). 테스트: `backend/tests/test_mb2_high_severity_fixes_5.py:385-414`, E2E `frontend/e2e/full-journey.mjs:78-114`(가입용).
- 결론: 엔드포인트·서비스·`email_verify_token` 은 **유지**. 정리 대상은 리포트 신청의 게스트 분기뿐.

### 2-5. 로그인 회원이 OTP 없이 호출했을 때
- 허용된다. 조건은 (a) 로그인 토큰 유효, (b) `participant_id` 가 본인 소유·비대기열, (c) body `email` 이 계정 이메일과 대소문자 무시 일치(`report_email_service.py:77-80`), (d) 세션 `completed`. `email_verify_token` 은 `null` 이어도 된다.
- **이메일 출처 강제 여부**: 강제하지 않는다. 회원이 다른 주소를 보내면 OTP 토큰이 있어야 통과(`:81-85`). 따라서 "계정 이메일 고정"은 현재 **프론트가 readOnly 로 막고 있을 뿐** 서버는 다른 인증된 주소도 받는다. 결정 1(계정 이메일 1탭) 을 서버에서도 보장하려면 권장 변경 B1.
- 사소한 비대칭: `participant.report_email != str(payload.email)` 는 대소문자 구분(`:86`)인데 OTP 생략 비교는 `casefold`(`:79`). 계정 이메일 대소문자가 바뀌면 이미 신청한 회원이 409 를 받을 수 있다(저장 이메일은 가입 시 소문자화 `auth.py:339-340` 이므로 현실 가능성 낮음).
- `participant_id` 를 프론트가 직접 넘긴다(`ReportEmailRequest.participant_id`, `schemas/session.py:485`). 현행은 코드 입장 응답에서 받는다(`pages/class-join-page.tsx:346`·`:413` `joinSessionByCode` → `joined.participant_id`). **초대 입장(결정 1)에서는 `joinSession`(`lib/api/session.ts:387-388`, `POST /sessions/{id}/join`)이 `participant_id` 를 주지 않는다**(`services/session_service.py:1445-1470` 응답은 세션 DTO + `livekit_token`). 프론트는 `session.participants` 에서 `user_id === 내 id` 인 행의 `participant_id` 를 찾아야 한다(참가자 목록은 비호스트에게도 내려간다: `session_service.py:121-142`, `:695`). → 다른 조사(입장 경로)와 맞물리는 지점.

### 2-6. 종료 화면(FM09) 현행 vs 시안
- 구성: `class-join-page.tsx:515-529` `complete` 단계 → `components/player/MemberEndScene.tsx` → `components/class/player/member/MemberFullView.tsx:113-153` `MemberEndView`. 시트 본문(`panel`)은 시트가 열린 동안만 마운트(`:124`, `:130-132`) → 닫았다 열면 패널 상태 초기화(신청 완료 후 재오픈하면 다시 폼).
- 시트 2종이 **라이트 카드로 감싸져 어두운 시트 위에 떠 있음**: `MemberEndScene.tsx:29-31` `LegacyPanelCard`(`mp-legacy-panel`, `member-player.css:347`). 시안은 "소프트 시트(라이트 카드 제거)"(`기획.md` FM09 행).
| 항목 | 시안 | 현행 |
|---|---|---|
| 리포트 시트 본문 | `받는 이메일`(마스킹 `se***@example.com`, 읽기 전용) + 안내 `리포트는 상담사가 확인한 뒤 계정 이메일로 보내 드려요. 영업일 기준 1~2일 걸릴 수 있어요.` + 버튼 `리포트 신청하기`(메일 아이콘) (`member-b.html:531`) | 이메일 입력(마스킹 없음, `ReportEmailRequestPanel.tsx:147-157`) + 안내 합쇼체(`:145`) + 버튼 `리포트 신청`(`:161`) |
| 신청 완료 | `신청했어요` + `상담사가 확인하면 이메일로 보내 드려요.` + `확인` 버튼(`member-b.html:529`) | `리포트 신청이 완료되었어요.` + 서버 문구 + 안내 문단, `확인` 버튼 없음(시트 X 로만 닫음)(`:125-135`) |
| 상태 시트 | 제목 `오늘 상태 남기기`, 안내 `뇌파를 측정하지 않아도 이 기록은 리포트에 남아요.`, 3축, `한 줄 소감 (선택)`, 버튼 `남기기`(3축 미선택 시 비활성 `checkinempty`)·`건너뛰기`(`member-b.html:523-526`) | 시트 제목은 `오늘 상태 남기기`(`MemberFullView.tsx:130`)인데 **본문에 다시 제목 `오늘 수업 이후 어떠신가요?`**(`SelfCheckinPanel.tsx:209`), 버튼 `설문 남기기`(`:248`)·`건너뛰기`(`:256`), 오류 `수업 후 느낌을...`(`:180`)·`ariaPrefix="수업 후 "`(`:218`) 등 `수업` 용어 |
| 완료/건너뜀 후 | 시트 닫힘, 메인 카드 버튼이 `오늘 상태를 남겼어요`(완료 비활성)로 바뀜(`checked`, `member-b.html:537`) | `phase === 'done' | 'skipped'` 면 `return null`(`SelfCheckinPanel.tsx:202`) → **시트는 열린 채 본문이 빈 상태**. `onSubmitted`(`:27`, `:188`)를 `MemberEndScene` 이 넘기지 않음(`MemberEndScene.tsx:64`) → 메인 카드는 완료를 모름 |
| 메인 카드 행 라벨 | `클래스` | `수업`(`MemberFullView.tsx:141`) — 결정 7 용어 위반(대기열 카드 `:95` 도 동일) |
| 메인 하단 버튼 | `홈으로`(고스트) | 로그인 회원 `대시보드로 이동`(`MemberEndScene.tsx:50`), 주(primary) 스타일(`MemberFullView.tsx:149`) |
- 사후 체크인 API: `lib/api/checkin.ts` `submitCheckin` → `POST /sessions/{id}/checkin`(`api/v1/records.py:49`), 서버는 `SessionRecord.subjective_state` 에 phase 별 저장(`services/record_service.py:320-331`, 취소 세션만 409). 게스트 소유 증명(`participant_token`) 인자가 있다(`SelfCheckinPanel.tsx:53-55`).
- 현행 테스트: `tests/member-end-scene.test.tsx`(패널 모킹, 시트 진입), `tests/report-email-request-panel.test.tsx`(회원 생략·게스트 OTP·6자리 검증·정보 없음·토큰 없음), `tests/self-checkin.test.ts`, `tests/class-player-member-fullview.test.tsx`, E2E `e2e/class-player/live.mjs:285-302`(종료 카드에서 `리포트 받기` 클릭 → 시트 열림만 확인).

## 3. 변경 목록

### 프론트
| 파일 | 변경 | 규모 |
|---|---|---|
| `components/class/ReportEmailRequestPanel.tsx` | 게스트·OTP 분기 전부 제거. props 를 `{sessionId, participantId, accountEmail, onDone}` 로 축소. 상태 `idle/submitting/done`. 계정 이메일 **마스킹** 읽기 전용 표시 + 버튼 `리포트 신청하기` 1개. 완료 뷰(`신청했어요` + `확인`). 오류는 status→해요체 문구 매핑(서버 원문 비노출): 403=`내 클래스의 리포트만 신청할 수 있어요`, 409 미완료=`클래스가 끝난 뒤에 신청할 수 있어요`, 409 이메일=`이미 다른 이메일로 신청했어요`, 503/기타=`지금은 신청하지 못했어요. 잠시 후 다시 시도해 주세요`. 완료 문구는 응답 `status` 로 분기(`pending_review/generating`=시안 문구, `queued`=`곧 메일로 보내 드려요`, `sent`=`이미 메일로 보냈어요`). 중복 탭 방지(제출 중 비활성, 완료 후 재제출 불가) | M |
| 신규 `lib/` 이메일 마스킹 유틸(예: `lib/class/mask-email.ts`) + 단위 테스트 | `se***@example.com` 규칙(로컬 파트 앞 2자만 노출) | S |
| `components/player/MemberEndScene.tsx` | `participantToken`·`isLoggedIn` 분기 제거(게스트 제거 시), `LegacyPanelCard` 제거(소프트 시트 직접), 신청/상태 완료 콜백 연결, `actionLabel` `홈으로`(시안) 검토 | M |
| `components/class/player/member/MemberFullView.tsx` (`MemberEndView`) | 시트 닫기 콜백을 패널에 전달(`확인`/`남기기` 후 닫힘), 메인 카드에 완료 상태(`오늘 상태를 남겼어요` 비활성 버튼), 리포트 신청 완료 표시 여부 결정, 행 라벨 `수업`→`클래스`(`:95`, `:141`) | M |
| `components/class/SelfCheckinPanel.tsx` | 카드 외곽·중복 제목(`:209`) 제거, 버튼 `남기기`/`건너뛰기`, `수업`→`클래스` 문구, 완료/건너뜀 시 `return null` 대신 `onSubmitted`/`onSkipped` 로 시트를 닫게 함, 게스트 인자(`participantToken`, `isLoggedIn`) 정리 | M |
| `components/class/GuestCompletePanel.tsx` | 삭제(죽은 코드, `requestOtp/verifyOtp/requestReportEmail` 호출) | S |
| `lib/api/session.ts:181-186` `ReportEmailRequest` | `participant_token`·`email_verify_token` 을 선택/제거(백엔드 B1 적용 여부에 따라) | S |
| `pages/class-join-page.tsx:515-529` | `MemberEndScene` 에 넘기는 props 정리, `participantId` 출처가 초대 입장에서 `session.participants` 매칭으로 바뀜(다른 조사와 합의) | S~M |
| `lib/api/auth.ts` `requestOtp/verifyOtp` | **유지**(가입 페이지 사용) | - |
| 테스트 | `tests/report-email-request-panel.test.tsx` 게스트·OTP 3건 삭제, 1탭(마스킹 표시, 1회 호출 인자, 완료 뷰, 중복 탭 무시, 상태별 문구, 오류 매핑) 추가. `tests/member-end-scene.test.tsx`·`self-checkin.test.ts`·`class-player-member-fullview.test.tsx` 갱신. E2E `live.mjs:298-300` 에 신청 완료까지 확장 권장 | M |

### 백엔드
| 엔드포인트/모델/마이그레이션 | 변경 | 분류 | 기존 데이터 호환 | 필요 테스트 |
|---|---|---|---|---|
| 없음(현행 그대로 1탭 가능) | 프론트가 `participant_id` + 계정 이메일 + `email_verify_token: null` 로 호출 | 필수 0건 | 변경 없음 | 아래 회원 경로 테스트 |
| B1 `POST /sessions/{id}/report-email` — 회원 참가자는 **계정 이메일 강제** | `participant.user_id` 가 있으면 body `email` 을 무시(또는 선택 필드로)하고 계정 이메일 사용, OTP 토큰 경로 차단. `schemas/session.py:484` `email` 을 `EmailStr | None` 으로 완화 | 권장 | 게스트 참가자(`user_id` 없음)는 기존 분기 유지 → 과거 데이터 무영향. 응답 스키마 불변 | 회원이 다른 이메일을 보내도 계정 이메일로 등록됨 / 다른 이메일+유효 OTP 토큰도 무시 |
| B2 `participant_id` 생략 시 서버 해석 | 로그인 회원이면 `(session_id, user_id)` 로 참가자 조회, 필드는 선택 | 권장 | 기존 요청(participant_id 포함)과 호환 | 생략 요청 202 / 참가자 아님 403 / 대기열 403 |
| B3 생성 중 재요청 중복 발행 방지 | `report.generation_status == 'processing'` 이면 `enqueue_report_generation` 건너뛰고 `generating` 응답. 현행은 `status in (pending_analysis, error)` 마다 재발행(`report_email_service.py:101-103`)하고 `generate_report_inline` 에 중복 실행 가드가 없다(`tasks/report_task.py:460-500`, 시작 시 `pending_analysis` 로 되돌림 `:491-492`). 1탭은 연타가 쉬워 비용(LLM) 영향 | 권장 | 기존 리포트 행 불변 | 연속 2회 호출 시 발행 1회 |
| B4 게스트 분기·`participant_token`·`email_verify_token`·`report_participant` 토큰 제거 | 게스트 경로 코드 삭제 | 보류 | **과거 게스트 참가자 읽기 호환 유지가 결정이므로 코드 제거는 후속**(`session_service.py:1633-1682`, `:1715-1718` 게스트 소유 증명이 입장 API 에도 얽힘) | 제거 시 기존 `tests/test_report_email.py` 게스트 테스트 재작성 |
| B5 신청 상태 조회(`participant.report_email_status` 노출) | 재진입·새로고침 시 `신청 완료` 복원 | 보류 | 컬럼 이미 있음(`models/session.py:109-111`), 응답 필드 추가만 | 응답 계약 테스트 |
| OTP 엔드포인트·`otp_service`·`email_verify_service` | **변경 없음**(가입 등 사용) | - | - | `test_mb2_high_severity_fixes_5.py:385-414` 유지 |

### 프론트만으로 가능한 대체안
- B1 없이도 프론트가 계정 이메일만 보내면 결정 1 은 UI 상 충족된다(서버는 느슨). 보안상 "회원이 임의 이메일로 직접 API 호출" 은 OTP 가 있어야 하므로 제3자 이메일로 리포트를 보낼 수는 없다(OTP 로 소유 입증 필요).
- B2 없이: `participant_id` 를 `session.participants` 에서 `user_id` 로 찾는다(`GET /sessions/{id}` 응답 사용, `session_service.py:121-142`).
- B3 없이: 버튼 연타 방지 + 제출 후 영구 비활성(시트 재오픈 시 상태가 초기화되므로 `MemberEndView` 수준 상태로 올려 보존).
- B5 없이: 신청 완료 여부를 `MemberEndView` 상태로만 보존(새로고침하면 잃음. 새로고침 시 종료 화면 자체가 `class-join-page` 상태 의존이라 어차피 재진입 경로가 제한됨 — 미확인).

### 필요한 백엔드 테스트(기존 위치: `backend/tests/test_report_email.py`, `test_sdd086_auto_report.py`, `test_sdd087_counselor_comment.py`)
기존은 전부 게스트(`SessionParticipant(guest_name=...)`)다. 회원 경로(인증 헤더 + 회원 참가자) 신규: ① 계정 이메일 + 토큰 없음 → 202 `pending_review`, ② 다른 이메일 + 토큰 없음 → 401(B1 적용 시 무시되어 202), ③ 남의 `participant_id` → 403, ④ 호스트 호출 → 403, ⑤ 대기열 참가자 → 403, ⑥ 미완료 세션 → 409, ⑦ 같은 요청 2회 멱등(`participant.report_email` 불변, 리포트 1건), ⑧ 신청 후 승인 → 메일 발송 예약(`test_report_email.py` 의 `test_approval_enqueues_client_email` 의 회원판).

## 4. 위험·주의
- **기존 데이터**: 과거 게스트 참가자(`user_id IS NULL`)·`participant_token` 은 서버 분기를 남겨 두면 그대로 동작. 프론트에서 게스트 UI 만 제거하면 과거 게스트가 새로 신청할 방법은 없어지는데, 결정상 신규 게스트는 없다.
- **회귀 지점**: ① `MemberEndView` 시트가 패널 언마운트로 상태 초기화(`MemberFullView.tsx:124`) — 완료 표시 유지 필요, ② `SelfCheckinPanel` 이 `null` 반환 시 빈 시트(`:202`), ③ `participantId` 출처 변경 시 `null` 이면 `참가 정보가 없어...` 로 막힘(`ReportEmailRequestPanel.tsx:121-123`) — 입장 경로 개편과 한 묶음으로 검증.
- **자동 승인 상담사**: 신청 직후 `queued`/`sent` 가 오므로 `상담사가 확인하면` 고정 문구는 부정확(`report_service.py:363`, `:406-411`). 문구를 응답 status 로 분기해야 한다.
- **이메일 불변 계약**: 신청 이메일은 이후 변경 시 409(`report_email_service.py:86-88`)이며 재발송은 상담사 측 `resend_report_email`(`:219-279`, `api/v1/reports.py:182`)만 가능. 회원이 계정 이메일을 바꾼 뒤 재신청하면 409 — B1 도입 시 이 케이스 처리 필요.
- **배포 순서**: B1/B2 는 필드를 *선택*으로 완화하므로 백엔드 먼저 배포해도 구 프론트와 호환. 프론트 먼저 배포하는 경우 현행 백엔드로도 동작(계정 이메일 + `participant_id` 전송). 순서 제약 없음.
- 호스트 리포트 화면에서 신청 이메일이 노출되는지는 변경 없음(`report_service.py:726`).

## 5. 사용자 결정 필요

| # | 결정 | 옵션 | 기본값 제안 | 영향 |
|---|---|---|---|---|
| 1 | 리포트 수신 이메일 | (a) 계정 이메일 고정 (b) 다른 주소 입력 허용 | **(a)** | (b)는 OTP 가 다시 필요해 결정 1(OTP 전면 제거)과 충돌. (a)면 B1 권장 |
| 2 | 완료 문구 | (a) 시안 고정 `상담사가 확인하면 이메일로 보내 드려요` (b) 응답 status 별 분기 | **(b)**(자동 승인 상담사 대응) | (a)는 구현 단순하나 자동 승인 시 사실과 다름 |

(승인 절차·영업일 `1~2일` 문구 유지, 신청해야 발송되는 구조는 시안·확정 결정 그대로 유지로 처리 — 별도 결정 아님)

## 6. 확인하지 못한 것
1. `GuestCompletePanel.tsx` 를 참조하는 동적 import/라우트가 없는지: `frontend/src` 정적 grep 으로는 import 없음. `frontend/tests`·`e2e` 와 문자열 기반 lazy 참조는 확인하지 않음.
2. 새로고침 후 종료 화면 재진입 동작(`class-join-page.tsx` 의 `complete` 단계 복원)은 읽지 않음 — `신청 완료` 복원 필요성 판단에 필요.
3. 상담사 `auto_approve_report` 기본값과 운영 비율 — DB/운영 데이터 접근 불가.
4. `PlayerSheet`(`components/class/player/shared/PlayerSheet`) 의 닫기 API(`onClose` 외 포커스 복귀·애니메이션)는 파일을 열어 보지 않음.
5. 실제 메일 발송 어댑터(`tasks/email.py` `send_report_email`) 의 SMTP 동작은 실행해 보지 않음.
6. 이 조사에서 백엔드 테스트·프론트 테스트는 **실행하지 않음**(읽기 전용 조사).
