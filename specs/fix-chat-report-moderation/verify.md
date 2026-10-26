# [MB261026][FIX] 채팅 신고 운영 처리·게시 필터(D4) — Verify (구현 전)

- 작성 시점: **구현 전**(2026-10-26). 이 표가 합격 기준이다. 구현 후에는 아래 "결과" 절에만 기록하고, 시나리오를 사후에 바꾸지 않는다.
- 설계 근거: 같은 폴더 `plan.md`. 승인 근거: D4(2026-10-24) + Apple 1.2.
- 공통 전제: 합성 계정·합성 데이터만 사용. 실제 메일 발송 금지(outbox 소비자 미실행, 발송 함수 mock). 개인정보·토큰 출력 금지.
- 표기: [BE] pytest · [FE] vitest · [E2E] Playwright 실렌더 · [GREP] 정적 검사.

## 1. 권한

| ID | 전제 | 행동 | 기대 |
|---|---|---|---|
| V-01 [BE] | 회원(client) 로그인 | `GET /admin/chat-reports`, `GET /admin/chat-reports/{id}`, `POST …/transition`, `GET·POST·DELETE /admin/chat-filter-terms` | 6개 모두 403 "플랫폼 관리자만 접근 가능합니다". 신고·금칙어 상태 변화 0, 감사 행 0 |
| V-02 [BE] | 상담사, 기관관리자 각각 | V-01과 같은 6개 호출 | 모두 403, 변화 0 |
| V-03 [BE] | 토큰 없음 | V-01과 같은 6개 호출 | 모두 401 |
| V-04 [BE] | 플랫폼 관리자 | 없는 ID / 형식이 틀린 ID로 상세·전이·금칙어 삭제 | 404 |

## 2. 신고 → 목록 → 상태 전이 → 감사 로그

| ID | 전제 | 행동 | 기대 |
|---|---|---|---|
| V-05 [BE] | 회원 A·B 1:1 방, B의 메시지 1건 | A가 그 메시지 신고 → 관리자 목록 조회 | 목록 1건 `status=submitted`, 신고자 A·대상 B 표시 이름, `ack_due_at`·`decision_due_at` 존재. 응답 JSON에 `message_excerpt`·이메일 키 **없음**. 감사 `chat_report_list` 1행 |
| V-06 [BE] | V-05 | 관리자 상세 조회 | `message_excerpt`(원문 ≤500자)·신고자/대상 이메일 포함. 감사 `chat_report_view` 1행(target_id=신고 ID). 감사 행 어디에도 발췌 문자열 없음. 같은 방의 다른 메시지 내용은 응답에 없음 |
| V-07 [BE] | submitted | `transition {to:"reviewing"}`(메모 없이) | 200, `acknowledged_at` 설정, `handled_by`=관리자, `decided_at` 없음. 감사 `chat_report_transition` extra `{from:"submitted", to:"reviewing"}` |
| V-08 [BE] | reviewing | `{to:"actioned"}` 메모 없음 / 공백만 / 1001자 | 422, 상태 그대로 |
| V-09 [BE] | reviewing | `{to:"actioned", note:"경고 메일 발송함"}` | 200, `decided_at` 설정, `resolution_note` 저장, 감사 reason=메모 |
| V-10 [BE] | submitted(새 신고) | `{to:"dismissed", note:"…"}` 바로 | 200, `acknowledged_at == decided_at` |
| V-11 [BE] | actioned 또는 dismissed | 아무 상태로 전이 | 409 `REPORT_CLOSED`, 변화 0 |
| V-12 [BE] | reviewing | 다시 `{to:"reviewing"}` | 200, 시각·처리자 변화 없음, 감사 추가 0 |
| V-13 [BE] | submitted | `{to:"submitted"}` / `{to:"withdrawn"}` / `{to:"foo"}` | 422(허용 값 아님) 또는 409 `INVALID_REPORT_TRANSITION`, 변화 0 |
| V-14 [BE] | V-09 직후 | 대상 B 계정·메시지·차단 확인 | B `status` 그대로(active), B 메시지 행 그대로, `chat_blocks` 행 수 신고 직후와 동일 — **자동 삭제·자동 정지 0** |
| V-15 [BE] | 상태별 신고 여러 건 | `?status=reviewing`, `?overdue=true`, 페이지 크기 | 필터·정렬(최신순)·`counts` 정확 |

## 3. 철회된 신고

| ID | 전제 | 행동 | 기대 |
|---|---|---|---|
| V-16 [BE] | submitted | 신고자가 철회 → 관리자 목록 | 목록에 남아 있고 `status=withdrawn`, `ack_overdue=false`, `decision_overdue=false` |
| V-17 [BE] | withdrawn | 관리자 전이 시도 | 409 `REPORT_WITHDRAWN`, 변화 0 |
| V-18 [BE] | 관리자가 reviewing으로 옮김 | 신고자 철회 | 409 `REPORT_ALREADY_PROCESSED`(기존 코드), 상태 reviewing 유지 |
| V-19 [BE·PG] | submitted | 철회와 관리자 전이를 두 세션에서 동시에 | 하나만 성공, 최종 상태가 둘 중 하나로 일관(잠금 확인). PG 환경에서만 실행 |
| V-20 [FE] | withdrawn 항목 | 관리자 화면 렌더 | 회색 "신고자 철회" 배지, 상태 버튼 비활성 |

## 4. 영업일 기한 계산

모두 [BE] 단위 테스트, 접수 시각 고정. 기한은 해당 날짜 23:59:59 KST.

| ID | 접수 시각(KST) | 휴일 설정 | 기대 접수 확인 기한(2영업일) | 기대 1차 판단 기한(5영업일) |
|---|---|---|---|---|
| V-21 | 월 10:00 | 없음 | 같은 주 수 | 다음 주 월 |
| V-22 | 금 15:00 | 없음 | 다음 주 화 | 다음 주 금 |
| V-23 | 토 11:00 / 일 23:30 | 없음 | 다음 주 화 | 다음 주 금 |
| V-24 | 일 16:00 **UTC**(= 월 01:00 KST) | 없음 | 그 월요일 기준 수 (UTC 날짜가 아니라 KST 날짜로 계산) | 다음 주 월 |
| V-25 | 금 15:00 | 다음 주 월 | 다음 주 수 | 다다음 주 월 |
| V-26 | 월 10:00 | `"2026-13-01, abc"`(잘못된 값) | V-21과 동일, 경고 로그 1회, 예외 없음 |  |
| V-27 | 고정 now > ack 기한, `acknowledged_at` 없음 | – | `ack_overdue=true`, `?overdue=true` 결과에 포함 | – |
| V-28 | V-27에서 reviewing 전이 후 | – | `ack_overdue=false`. now > decision 기한이면 `decision_overdue=true` | – |

## 5. 게시 필터 (차단·오탐 경로)

| ID | 전제 | 행동 | 기대 |
|---|---|---|---|
| V-29 [BE] | 금칙어 목록 비어 있음 | 일반 문장·거친 표현 전송 | 모두 201 (장치는 있으나 막을 단어 없음) |
| V-30 [BE] | 관리자가 합성 금칙어 `테스트금칙` 등록 | 회원이 "이건 테스트금칙 이에요" 전송 | 422 `CHAT_CONTENT_BLOCKED`, 응답에 금칙어 문자열 없음. `chat_messages` 행 증가 0, 알림·푸시 outbox 증가 0 |
| V-31 [BE] | V-30 | 변형 전송: `테스트 금칙`, `테.스.트-금칙`, 전각/대문자 섞은 영문 금칙어 | 모두 422 |
| V-32 [BE] | V-30 | 금칙어 없는 문장 | 201 |
| V-33 [BE] | V-30 | 1:1·그룹·클래스 방 각각, 상담사·관리자 발신자 각각 | 모두 422 (방 유형·역할 예외 없음) |
| V-34 [BE] | V-30 | 시스템 메시지 생성(`system_message_service`)에 금칙어 포함 | 생성됨(필터 대상 아님) |
| V-35 [BE] | 금칙어 `시발` 등록(오탐 예시) | ① "시발점에서 출발" 전송 ② 관리자 `DELETE` ③ 같은 문장 재전송 | ① 422 ② 204 + 감사 `chat_filter_term_remove` ③ **즉시** 201(캐시 지연 없음) |
| V-36 [BE] | – | 금칙어 추가: 정규화 후 1자 / 51자 / 이미 있는 단어(공백·대소문자만 다름) / 501번째 | 422 / 422 / 409 / 409. 정상 추가는 감사 `chat_filter_term_add` |
| V-37 [BE] | V-30 | 같은 회원이 금칙어 메시지 10회 연속 전송 | 10회 모두 422, 회원 `status` 그대로, 새 차단·신고 0 (**자동 제재 0**). 로그에 메시지 내용 없음(user_id·term_id만) |
| V-38 [FE] | 전송 API가 422 `CHAT_CONTENT_BLOCKED` 반환(mock) | 채팅 입력 후 전송 | 입력란에 원문 그대로 복원, 안내 문구 표시, "다시보내기" 버튼 없음, 메시지 목록에 추가 0 |

## 6. 운영 주소·메일 발송

| ID | 전제 | 행동 | 기대 |
|---|---|---|---|
| V-39 [BE] | `moderation_notice_email="ops-test@example.invalid"`(합성) | 신고 1건 | email outbox 1행, `recipient`=설정값, 본문에 관리자 링크 `…/admin/chat-reports?report=<id>`·두 기한 포함, 본문에 발췌·이름·이메일 **없음**, status `pending` |
| V-40 [BE] | `moderation_notice_email=""`, `signup_notice_email`=임의값 | 신고 1건 | 신고·상호 차단 정상(201), email outbox **0행**, `signup_notice_email`로 가는 행 0, 경고 로그 1회(신고 ID만). 목록 API `notice_email_configured=false` |
| V-41 [BE] | 1~6절 전 시나리오 실행 중 | 메일 발송 함수(`tasks.email._send_email`, Resend 클라이언트) mock | **호출 0회**. outbox 소비자(`process_email_outbox`) 미호출 |
| V-42 [GREP] | 구현 후 | `rg "brian.chae@" backend/app/services/chat_moderation_service.py backend/app/services/chat_report_admin_service.py frontend/src/lib/api/chat.ts frontend/src/components/chat frontend/src/pages/admin/ChatReportsPage.tsx` | 0건. 새 설정 키 기본값은 빈 문자열. `CHAT_REPORT_CONTACT_EMAIL`은 `OPERATIONS_EMAIL`을 가리킴 |
| V-43 [GREP] | 구현 후 | `deploy/env-manifest.tsv` | `MODERATION_NOTICE_EMAIL`·`MODERATION_HOLIDAYS` 행이 `ssm 0`(선택), 값 칸 비어 있음 |
| V-44 [FE] | 목록 응답 `notice_email_configured=false` | 관리자 화면 렌더 | 상단 미설정 배너 표시. 주소 값은 화면 어디에도 없음 |

## 7. 프론트 동작 (vitest)

| ID | 전제 | 행동 | 기대 |
|---|---|---|---|
| V-45 | 목록 mock(접수·검토 중·철회·기한 초과 섞음) | 렌더 | 열(접수 일시·상태·사유·신고자·대상·접수 확인 기한·1차 판단 기한·처리자), 상태 배지, 기한 초과 빨간 배지 |
| V-46 | 행 선택 | 상세 패널 열기 | "신고된 메시지 보기" 누르기 전 상세 API 호출 **0회**, 누르면 1회, 발췌 표시 |
| V-47 | 상세 패널 | "조치 완료"/"조치 없음" 선택, 메모 비움 | 제출 버튼 비활성. 메모 입력 후 제출 → 전이 API 1회, 목록 상태 갱신 |
| V-48 | 금칙어 탭 | 추가·삭제(확인 대화상자) | API 호출·목록 갱신, 409는 "이미 등록된 단어" 안내 |
| V-49 | 신고 대화상자 완료 화면 | 렌더 | "영업일 기준 2일"·"5일" 문구, 연락처 링크 = `OPERATIONS_EMAIL` |
| V-50 | 차단 목록 항목 report_status = reviewing / actioned / dismissed | 렌더 | "운영 검토 중" / "처리 완료" / "처리 완료", 철회 버튼은 submitted일 때만 |
| V-51 | client·counselor 사용자 | `/admin/chat-reports` 진입 | 기존 `PlatformAdminRoute` 동작대로 접근 차단(관리자 로그인 안내 또는 리다이렉트) |
| V-52 | `terms-page`·신고 대화상자 문구 | `findPublicCopyViolations` + 금지 표현 검사 | 위반 0, "24시간"·"자동 삭제"·"자동 정지" 없음, "영업일 기준" 포함 |

## 8. 프론트 실렌더 (Playwright, 설치 Chrome `channel:"chrome"`)

- 환경: 로컬 백엔드(로컬 PG, `alembic upgrade head`) + 로컬 프론트 빌드(`vite preview` 또는 dev). 계정은 `dev_auth`로 만든 합성 플랫폼 관리자·회원 2명. 외부 서버·실데이터 사용 안 함. 스크립트 `frontend/e2e/chat-report-moderation.mjs`, 캡처 `specs/fix-chat-report-moderation/evidence/`.

| ID | 행동 | 기대 |
|---|---|---|
| V-53 [E2E] | 회원 A가 B 메시지 신고 → 관리자 로그인 → 사이드바 "채팅 신고" → 목록 → 행 선택 → "신고된 메시지 보기" → 검토 중 → 조치 없음(메모) | 각 단계 화면 상태가 바뀌고 처리 이력에 2줄. 1440px·390px 캡처 |
| V-54 [E2E] | 관리자가 합성 금칙어 등록 → 회원이 금칙어 포함 메시지 전송 → 관리자가 삭제 → 회원 재전송 | 첫 전송: 안내 문구 + 입력란 원문 유지, 목록에 메시지 없음. 재전송: 메시지 표시 |
| V-55 [E2E] | 회원 계정으로 `/admin/chat-reports` 직접 접속 | 관리자 화면 미노출 |
| V-56 [E2E] | V-53~V-55 전 구간 | 브라우저 콘솔 error 0, 네트워크 5xx 0, 배지·버튼 스타일이 실제 적용됨(캡처로 확인, 클래스만 있고 스타일 없는 상태 아님) |

## 9. 회귀·빌드

| ID | 행동 | 기대 |
|---|---|---|
| V-57 [BE] | `test_sdd220_chat_moderation.py`, `test_chat_unblock.py`, `test_chat.py`, `test_sdd093_chat.py`, `test_chat_push_outbox.py` + 신규 3파일 | 전부 통과 |
| V-58 [BE·PG] | `alembic upgrade head` → `downgrade -1` → `upgrade head`, `python3 scripts/check-alembic-heads.py` | 왕복 성공, 헤드 1개, 기존 `chat_reports` 행 보존(새 컬럼 NULL) |
| V-59 [FE] | vitest 전체, `tsc --noEmit`, 변경 파일 eslint, `npm run build` | 기준선 대비 신규 실패 0, 타입 오류 0, 빌드 성공 |
| V-60 [GREP] | `git diff --name-only origin/develop` | plan 3-3의 SDD-246 소유 경로 변경 0, `api/v1/admin.py` 변경 0 |

## 10. 별도 게이트 (이 카드 합격 기준 아님)

| 게이트 | 담당 | 내용 |
|---|---|---|
| G-1 dev 반영 검증 | DEPLOY | 머지·dev 배포 후 실제 dev 화면에서 V-53·V-54 재현(합성 계정) |
| G-2 운영 주소·발송 경로 | OPS (Brian 승인 후) | B2 주소를 SSM `MODERATION_NOTICE_EMAIL`에 등록, `email_app` worker·`process_email_outbox` 타이머 활성 확인, **본인 주소로만** 테스트 1통 |
| G-3 초기 금칙어 | 운영자 (B1 결정 후) | 관리 화면에서 승인된 목록 등록, 대표 오탐 사례 점검 |
| G-4 실기기 | APP | iOS·Android 앱에서 금칙어 안내·신고 완료 문구·연락처 링크 확인 |
| G-5 운영 반영 | DEPLOY (Brian 승인) | prod 마이그레이션·배포, 심사 메모에 신고 절차·기한·필터 반영 |

## 결과 (구현 후 기록, 2026-10-26)

| 시나리오 | 결과 | 근거(테스트) |
|---|---|---|
| V-01~V-04 권한 | PASS | `backend/tests/test_chat_report_admin.py` V01_V02·V03·V04 |
| V-05~V-15 목록·상세·전이·감사·자동 조치 0 | PASS | 같은 파일 V05~V15 (V-07에 "전이 응답에 발췌·이메일 없음" 단언 추가) |
| V-16~V-18 철회 | PASS | 같은 파일 V16_V17·V18 |
| V-19 동시 철회·전이 | PASS(PG) | `backend/tests/pg/test_fix_chat_report_moderation.py` V19 |
| V-20 철회 표시 | PASS | `frontend/tests/fix-chat-report-moderation.test.tsx` V-20 |
| V-21~V-26 영업일 | PASS | `backend/tests/test_business_days.py` |
| V-27~V-28 기한 초과 | PASS | `test_chat_report_admin.py` V27_V28·기한 전 |
| V-29~V-37 게시 필터 | PASS | `backend/tests/test_chat_content_filter.py` |
| V-38 차단 안내·원문 유지 | PASS | vitest V-38 + E2E V-54(실제 API 클라이언트 경로) |
| V-39~V-41 운영 주소·메일 0 | PASS | `test_chat_report_admin.py` V39·V40·V41(자동 fixture 가 모든 테스트에서 발송 경로 호출 0 단언) |
| V-42~V-43 하드코딩·매니페스트 | PASS | vitest V-42, `deploy/env-manifest.tsv` 선택 행 2개(값 없음) |
| V-44~V-52 프론트 | PASS | `fix-chat-report-moderation.test.tsx` |
| V-53~V-56 실렌더 | PASS 6/6 | `frontend/e2e/chat-report-moderation.mjs`, `evidence/` |
| V-57 회귀 | PASS | 채팅·신고 관련 기존 테스트 포함 백엔드 전체(summary 3절) |
| V-58 마이그레이션 왕복·헤드 | PASS | PG 테스트 `왕복에서_기존_신고_행이_보존된다`, `scripts/check-alembic-heads.py` 헤드 1 |
| V-59 vitest·tsc·eslint·build | PASS | vitest 17 fail/8 files(기준선과 같은 파일), tsc 0, eslint 0, build 성공 |
| V-60 범위 | PASS | SDD-246 경로·`api/v1/admin.py`·`backend/app/ws` 변경 0 |

- 추가 발견(E2E): 공용 오류 포맷터가 새 오류 코드를 "API 요청 실패 (422)"로 보여 주던 문제 → `client.ts` 코드 문구 8개 등록(RED 8 → GREEN). 상세는 summary 4절.
- 별도 게이트 G-1~G-5는 미실행(이 카드 범위 밖).
