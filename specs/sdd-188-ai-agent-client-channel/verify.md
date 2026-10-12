# [SDD-188] — Verification (Pre-Implementation)

> 구현 전 작성. 구현 후 Stage ⑤에서 아래 시나리오를 실제 실행하고 결과를 summary.md에 기록한다.

## Test Scenarios

### TS1: 동의 흐름 (D1)
1. 신규 내담자로 `GET /agent/consent` → `agreed=false`
2. 동의 전 `POST /agent/messages` → 403 `agent_consent_required`
3. `POST /agent/consent {agreed:true}` → 200, 이후 `GET` → `agreed=true`
4. 동의 후 `POST /agent/messages` 성공. 재동의 요구 없음
- **Expected:** 동의는 사용자당 1회. `consents`에 `type=ai_agent` 1행

### TS2: 예약 3시간 전 노티
1. 내담자 참여 + 오프라인 세션(`scheduled_at = now+180분`, `location_address="대전 …"`) 생성
2. `sweep_agent_reminders()` 실행
- **Expected:** 해당 내담자 대화에 `kind=reminder_3h` 메시지 1건. CTA에 `ack`, `open_map`(url에 주소 인코딩), `request_change`, `open_chat`. 내용에 상담사 이름·시각·장소가 DB 값 그대로 포함

### TS3: 예약 1시간 전 노티 — 온라인
1. 온라인 세션 `scheduled_at = now+60분`
2. 스윕 실행
- **Expected:** `kind=reminder_1h`, CTA에 `join_session`. `open_map` 없음

### TS4: 멱등
1. TS2 직후 스윕을 3회 더 실행
- **Expected:** `reminder_3h` 메시지 여전히 1건, `agent_delivery_logs` 1행

### TS5: 주소 없음
1. 오프라인 세션인데 `location_address` 없음(기관·상담사 주소도 없음)
- **Expected:** `open_map` CTA 없음. 메시지에 "장소 정보 없음" 대신 장소 문장 자체 생략 + `open_chat` CTA 유지. 오류 없음

### TS6: 취소·변경
1. `reminder_3h` 발송 전 세션을 `cancelled` 로 변경 → 스윕: **메시지 없음**
2. 3h 발송 후 `scheduled_at` 을 +2시간 늦춤 → 스윕: `kind=schedule_changed` 정정 메시지 1건, 이후 1h 노티는 **새 시각 기준**
3. 정정 메시지는 같은 변경에 대해 1회만
- **Expected:** 틀린 시각 기준 알림 없음

### TS7: 시간 윈도우
1. `scheduled_at = now+240분` → 스윕: 메시지 없음
2. `scheduled_at = now+5분` (이미 임박) → 1h 노티 **발송 안 함**(시작 10분 이내 보정 제외)
3. 서버 중단 시뮬레이션: `scheduled_at = now+55분`, 로그 없음 → 1h 보정 발송 1회
- **Expected:** 윈도우 규칙대로 발송/미발송

### TS8: 리포트 승인 → 링크 메시지
1. 세션 종료 → client 리포트 `pending_review` → 이 시점 메시지 **없음**
2. 상담사 `approve_report` → 내담자 대화에 `kind=report_ready` 메시지(리포트 링크 CTA `open_report`, 열린 질문 1개, 피드백 CTA 3종 `feedback_choice`)
3. 중복 승인(멱등 재호출) → 추가 메시지 없음
- **Expected:** 승인 완료 시점에만 1회

### TS9: 자동 승인 경로
1. `auto_approve_report=True` 상담사 세션 종료 → 리포트 자동 승인
- **Expected:** TS8과 동일하게 메시지 1건

### TS10: 제외 대상
1. 그룹 세션 리포트 승인 → 메시지 없음
2. 게스트(`report.user_id=None`) 리포트 승인 → 메시지 없음, 오류 없음
3. counselor 타입 리포트 승인 → 내담자에게 메시지 없음
- **Expected:** 위 3경우 모두 생성 안 됨, 승인 자체는 정상

### TS11: 피드백 (D9/D10)
1. `feedback_choice` `disappointed` 선택
2. 이어서 사용자가 자유 문장 "상담사 말투가 불편했어요" 전송
- **Expected:** `agent_relay_events`에 `kind=feedback` — `payload.choice="disappointed"`, `payload.texts`에 사용자 원문 **그대로**(요약/순화 없음). target_user_id = 세션 host. 같은 CTA 재선택 시 중복 이벤트 없음(`done`)

### TS12: 일정 변경 문의
1. `request_change` CTA에 `reason` 없이 호출 → 400
2. `reason="회사 일정이 생겼어요"` 호출
- **Expected:** relay event `schedule_change_request`(session_id, reason 원문) 1건, 상담사 인앱 알림 1건(이벤트 `schedule_change_request`), 내담자에게 접수 확인 agent_message

### TS13: 정책 경계 (채널 분리)
1. 상담사 리포트에 고유 문자열 `COUNSELOR_SECRET`, `ClientCounselorLink.memo`에 `MEMO_SECRET`, 다른 내담자 리포트에 `OTHER_SECRET` 삽입
2. `agent_policy.client_context(user)` 반환값과, LLM에 전달되는 프롬프트 문자열 검사
- **Expected:** 세 문자열 모두 **없음**. 본인 승인 완료된 client 리포트 본문만 포함. 승인 전(`pending_review`) 리포트 본문도 **없음**

### TS14: 접근 제어
1. 내담자 A 토큰으로 내담자 B의 메시지 ID에 `cta` 호출 → 404(또는 403)
2. 상담사 토큰으로 `/agent/messages` → 403
3. 비로그인 → 401
- **Expected:** 타인 대화 조회·조작 불가

### TS15: 푸시 Outbox 비식별
1. 에이전트 메시지 생성 후 `notification_outbox` 확인
- **Expected:** `channel="push"` 1행(`pending`), payload에 내담자 이름·상담 내용·리포트 문장 **없음** (`body="AI 비서가 메시지를 보냈어요"`). 기존 이메일/ws 아웃박스 소비 cron이 `push` 행을 건드리지 않음(상태 `pending` 유지)

### TS16: LLM 폴백
1. `gemini_api_key=""` 상태로 TS8 재실행
- **Expected:** 템플릿 문장으로 메시지 생성 성공. 예외 없음
2. Gemini 호출 예외 모킹 → 폴백
- **Expected:** 승인 트랜잭션 정상 완료, 메시지 생성(폴백)

### TS17: 가드 (진단·점수 금지)
1. LLM 응답을 "우울증으로 보입니다. 불안 점수는 82점입니다."로 모킹
- **Expected:** `agent_guard.sanitize` 가 진단/점수 표현을 제거하거나 안전 문구로 대체. 최종 저장 메시지에 해당 표현 없음

### TS18: 사용자 자유 메시지
1. 리포트 메시지 뒤 "이완이 빨리 돌아왔다는 게 무슨 뜻이에요?" 전송
- **Expected:** 리포트 본문 범위 내 설명. 진단·치료 지시 없음. 응답 1건. 리포트 밖 질문("제 병명이 뭐예요?")에는 "상담사님과 이야기해 보세요" 취지의 안내

### TS19: 세션 장소 (D8)
1. 오프라인 세션 생성, `location_address` 미지정, 기관 주소 있음 → 응답 `location_address`=기관 주소
2. 기관 주소 없음 + 상담사 프로필 주소 있음 → 상담사 주소
3. 둘 다 없음 → `null` (오류 없음)
4. 수정 API로 `location_address` 변경 → 반영
5. 온라인 세션 → `null`, 입력해도 무시 또는 null
- **Expected:** 위와 같음

### TS20: 프론트 — 동의·대화
1. 내담자 로그인 → AI 탭 진입 → 동의 시트 표시, 동의 후 대화 목록 표시
2. 미읽음 배지 표시 → 대화창 진입 시 0으로 감소
3. reminder 메시지의 CTA 렌더(확인/길찾기/일정변경 문의/상담사 메시지)
- **Expected:** 동작대로. 동의 거절 시 대화 접근 불가

### TS21: 프론트 — CTA 동작
1. 길찾기 → 새 창/지도 URL 열림(주소 인코딩)
2. 입장하기 → 세션 입장 경로 이동
3. 일정 변경 문의 → 사유 입력 시트 → 전송 → 접수 메시지 표시, 버튼 비활성
4. 피드백 3지선다 → 선택 후 비활성, 열린 질문 이어짐
5. 전화 CTA → 번호 없으면 버튼 숨김
- **Expected:** 각 동작 확인

### TS22: 프론트 — 세션 장소 입력
1. 오프라인 세션 생성 화면에서 장소란에 기관 주소 기본값 표시, 수정 가능
2. 온라인 전환 시 장소란 숨김
- **Expected:** 위와 같음

### TS23: 계약 정합 (교차 대조)
1. 백엔드 `schemas/agent.py` 응답 필드명 ↔ 프론트 `lib/api/agent.ts` 타입 비교
2. 실제 API 응답을 curl/pytest로 받아 프론트 타입에 있는 필드가 모두 존재하는지 확인
- **Expected:** 필드명·nullable·enum 값 불일치 0건

### TS24: 회귀·마이그레이션
1. `alembic heads` 단일 head, `upgrade e036a0000035:head --sql` 렌더 정상
2. 백엔드 `pytest` 전체, 프론트 `npm run build`, `npx vitest run`
- **Expected:** 신규 실패 0. 기존 리마인더(SDD-097) 테스트 영향 없음

## Edge Cases
- [ ] 같은 내담자가 같은 세션에 중복 참여 행이 있어도 알림 1건
- [ ] 한 내담자가 같은 시각 두 세션 → 각각 별도 메시지(세션별 ref_id)
- [ ] 세션 `scheduled_at` 이 null(즉석 클래스) → 알림 없음
- [ ] `participant` 상태가 invited/declined/removed 인 경우 → 알림 대상 제외 (active 참여자만)
- [ ] 내담자 계정 비활성(suspended/deleted) → 메시지 생성 안 함
- [ ] 서버 시간대/UTC 혼용(`scheduled_at` tz-aware, naive 입력) → 기존 `reminder_service._ensure_aware` 와 동일 처리
- [ ] 리포트 승인 후 리포트 재생성/재승인 → 중복 메시지 없음(report_id 기준 로그)
- [ ] 사용자 메시지 1000자 초과 → 422
- [ ] 동시에 같은 CTA 두 번 클릭 → 이벤트 1건(멱등)
- [ ] LLM 응답 지연 시 API 타임아웃 → 폴백 응답으로 5초 이내 응답
- [ ] 마이크 오프/기록 없음 세션의 리포트 → 본문이 비어도 링크 메시지는 생성(빈 본문 인용 안 함)

## Security Review
- [ ] 모든 `/agent/*` 엔드포인트 인증 + role=client 검증, 대화·메시지는 **소유자 검증** (IDOR 없음)
- [ ] 정책 계층 외 경로로 리포트/메모/타인 데이터를 LLM 프롬프트에 넣는 코드 없음 (`grep` 검사)
- [ ] 푸시/이메일 payload에 PII·상담 내용 없음
- [ ] relay event 생성 시 동의 재확인 (미동의면 생성 안 함)
- [ ] 사용자 입력은 프롬프트 인젝션 대비: 시스템 지시와 분리, 출력 가드 적용, 도구 호출 없음(조회·초안 외 실행 권한 없음)
- [ ] 로그에 대화 원문·리포트 본문 미출력 (ID/길이만)
- [ ] 영구 보관(D3): 삭제 API 미구현 상태를 summary에 "법무 검토 필요"로 명시
- [ ] 프론트에서 `open_map` URL은 허용 도메인(지도 검색 URL)만 렌더, 서버 제공 URL 외 임의 스킴(`javascript:`) 차단
