# [SDD-188] AI 에이전트 코어 + 내담자 채널 (예약 노티·CTA·리포트 대화)

> 기획 근거: `docs/AI-에이전트-양방향-채널-기획.md` v0.5 (§1.2, §3.1~3.3, §7 확정 결정 D1~D14)
> 후속: SDD-189(상담사 아침/저녁 브리핑), SDD-190(Capacitor 앱 셸 + 푸시 + BLE), SDD-191(안부 대화, 2차)

## Goal

내담자가 **AI와 1:1로 대화하는 전용 채널**을 만들고, 이 채널에서 (1) 예약 2~3시간 전·1시간 전 사전 노티와 CTA, (2) 리포트 승인 시 리포트 링크와 리포트 기반 대화(사후 피드백)를 제공한다. 상담사에게 전달할 정보는 **중계 이벤트**로 저장한다 (상담사 화면은 SDD-189).

## Context

- 상담 사이·후에 내담자가 예약을 놓치거나, 리포트를 열어보고 끝나는 문제가 있다.
- 기존 자산: 예약 리마인더(SDD-097, 참여코드·준비물 안내), 리포트 승인(`approve_report` → `notify_event("report_ready")`), 알림 Outbox(`ws`/`email`), 1:1 채팅(`ChatRoom`), Gemini 2.5-flash(`report_comment_service._call_gemini`), `consents`.
- **주기 작업은 Celery beat가 아니라 OS cron(`*_cron.py`)** 이다 (`celery_app.py` INFRA-08, `deploy-dev.yml` §5.7~5.9). 신규 스케줄도 이 방식을 따른다.
- 알림은 **앱 푸시 전용** (D2). 푸시 발송·디바이스 토큰은 SDD-190 범위. 본 SDD는 Outbox에 `push` 채널 행을 적재하고 **웹 인앱 AI 대화창에서 확인 가능**하게 한다.

## Scope

### ✅ In-scope

**백엔드**
1. 모델/마이그레이션 (신규 단일 head 리비전)
   - `agent_conversations` — (user_id, channel `client`|`counselor`) 유니크
   - `agent_messages` — conversation_id, sender(`agent`|`user`|`system`), kind, content, cta(JSONB), ref_type/ref_id, read_at, created_at
   - `agent_relay_events` — 내담자→상담사 중계 이벤트 (kind: `feedback`|`schedule_change_request`|`ack`), source_user_id, target_user_id(상담사), session_id, payload(JSONB), status, created_at
   - `agent_delivery_logs` — 발송 중복 방지: UNIQUE(kind, ref_id, offset_min, user_id)
   - `sessions.location_address` (String 300, nullable) — D8
2. 동의: 기존 `consents`에 `type="ai_agent"` 추가 사용 (타입 길이 20 이내, 스키마 변경 없음). 가입 후 **첫 대화 진입 시 1회** 동의 (D1)
3. 에이전트 서비스
   - 대화 조회/전송/읽음 처리, CTA 처리
   - **정책 계층(`agent_policy`)**: 내담자 채널이 조회할 수 있는 데이터 범위를 코드로 제한 — 본인 예약, 본인 **승인·발송된(`status=completed`) client 리포트 본문**만. 상담사 리포트·`ClientCounselorLink.memo`·타 참여자 데이터 접근 불가
   - 사실 정보(일정·장소·시각)는 DB 값을 템플릿에 채우고, LLM은 리포트 대화 질문과 자유 응답에만 사용. LLM 키 부재/실패 시 규칙 템플릿 폴백
4. 예약 노티 스케줄러 — `sweep_agent_reminders_cron.py` (매 1분 OS cron). 대상: 예정 세션(1:1, `scheduled_at` 존재, 상태 scheduled/ready/open)의 활성 참여자. 시점: 기본 **180분 전, 60분 전**. 중복은 `agent_delivery_logs`로 방지. 취소·변경된 세션은 미발송, 변경 시 정정 메시지
5. 리포트 대화 — `approve_report`와 자동 승인 경로에서, client 리포트가 `completed`가 되면 AI 메시지(리포트 링크 + 리포트 핵심 문장 1~2개 인용 + 열린 질문 + 3지선다 피드백 CTA) 생성. **그룹 세션은 제외**. 사용자 응답은 리포트 본문 범위로 대화, 새 해석·진단 금지
6. 사후 피드백(D9/D10) — 3지선다(`helpful`/`neutral`/`disappointed`) + 자유 서술. **부정 피드백도 원문 그대로** 상담사 대상 `agent_relay_events`에 저장. 동의 문구에 이 사실 명시
7. 일정 변경 문의 CTA → 사유를 정리해 relay event 생성 + 상담사 인앱 알림(`notify_event`, 신규 이벤트 `schedule_change_request`)
8. 알림 Outbox: 에이전트 메시지 생성 시 `notification_outbox`에 `channel="push"` 행 적재(consumer는 SDD-190) + 기존 `ws` 인앱 알림. 푸시 본문에는 이름·상담 내용 미포함(예: "AI 비서가 메시지를 보냈어요")
9. 세션 생성/수정 API에 `location_address` 추가 — 오프라인 세션 생성 시 기본값을 세션 소속 기관 `organization.address`(없으면 상담사 `counselor_profile` 주소)로 채워 응답에 포함, 수정 가능. 온라인이면 null
10. API (`/api/v1/agent/*`, 내담자 권한): 대화 조회, 메시지 전송, 읽음, CTA 실행, 동의 상태/동의, 미읽음 수

**프론트엔드 (내담자 웹/앱 공용)**
11. 내담자 앱(`/app/*`)에 **AI 대화 화면** 추가: 메신저형 UI, CTA 카드 렌더링, 첫 진입 동의 화면, 미읽음 배지
12. CTA 동작: 확인했어요 / 길찾기(지도 URL) / 입장하기 / 일정 변경 문의(사유 입력) / 상담사에게 메시지(기존 채팅 이동) / 상담사에게 전화(`tel:`, 번호 없으면 숨김) / 리포트 보기 / 피드백 3지선다
13. 상담사 세션 생성·수정 화면에 **장소(주소) 입력란** (오프라인 시 기본값 자동 채움, 수정 가능)

### ❌ Out-of-scope
- 상담사 브리핑·상담사 AI 채널 UI (SDD-189), 중계 이벤트의 상담사 열람 화면
- 푸시 발송 consumer, 디바이스 토큰, Capacitor 셸, BLE (SDD-190)
- 안부 대화, 프로파일, 위기 감지(D4), 상담사→내담자 중계(D6 제외)
- 기존 SDD-097 리마인더 제거 (병행 유지, D7). 단 같은 시각(60분) 중복은 본 SDD에서 **푸시/AI 메시지 쪽에서 합치지 않고** 기존 리마인더는 그대로 두는 것을 기본으로 하되, 중복 체감을 줄이기 위해 plan의 T7에서 검토
- 그룹 세션, 연속 세션 알림 묶음(후속)

## Acceptance Criteria
- [ ] 내담자가 처음 AI 대화 화면에 들어가면 동의 화면이 보이고, 동의 후 대화가 열린다. 이후에는 다시 묻지 않는다
- [ ] 예약 3시간 전·1시간 전에 AI 메시지가 생성되고(웹 인앱 표시), 같은 시점이 두 번 생성되지 않는다
- [ ] 오프라인 세션에는 길찾기 CTA(주소 포함), 온라인 세션에는 입장하기 CTA가 붙는다. 주소가 없으면 길찾기 CTA가 없다
- [ ] 취소된 세션에는 알림이 발송되지 않는다. 일정 변경 후에는 예전 시각 기준 알림이 나가지 않는다
- [ ] 리포트 승인 시 해당 내담자에게만 리포트 링크 AI 메시지가 생성된다. 그룹 세션 리포트에는 생성되지 않는다. 승인 전(`pending_review`)에는 생성되지 않는다
- [ ] 3지선다 선택과 자유 서술이 상담사 대상 relay event에 **원문 그대로** 저장된다
- [ ] 일정 변경 문의가 relay event와 상담사 인앱 알림을 만든다
- [ ] 내담자가 타인(다른 내담자/상담사)의 대화·메시지를 조회·전송할 수 없다 (403/404)
- [ ] 정책 계층이 상담사 리포트, 상담사 비공개 메모, 타 참여자 리포트를 컨텍스트에 포함하지 않는다 (테스트로 검증)
- [ ] LLM 키 없이도 템플릿 폴백으로 모든 메시지가 생성된다
- [ ] 푸시 Outbox 행의 payload에 내담자 이름·상담 내용이 없다
- [ ] 오프라인 세션 생성 시 기관 주소가 기본값으로 채워지고 수정 가능하다. 온라인은 null
- [ ] `alembic heads` 단일 head, 백엔드 `pytest` 전체 통과, 프론트 `npm run build` 0 errors, 신규 vitest 통과

## Dependencies
- 기획서 `docs/AI-에이전트-양방향-채널-기획.md` v0.5
- 기존 코드: `report_service.approve_report`/자동 승인 경로, `notification_service`, `models/session.py`, `reminder_service` 패턴, `report_comment_service._call_gemini`
- 후행: SDD-189(상담사 열람), SDD-190(푸시 consumer, 디바이스 토큰)

## Risks
| 리스크 | 대응 |
|---|---|
| 리포트 대화에서 AI가 새 해석·진단 생성 | 시스템 프롬프트 제한 + 금지 표현 출력 필터 + 리포트 본문만 컨텍스트 |
| 채널 간 정보 유출 | 정책 계층 단일 진입점(`agent_policy`)만 컨텍스트 조회, 테스트로 고정 |
| 기존 리마인더와 이중 알림 | 병행 유지(D7). 수신자는 서로 다른 목적(안내 vs 대화형 CTA)임을 메시지 문구로 구분, 중복 체감은 plan T7에서 점검 |
| 1분 cron 부하 | 시간 윈도우(±) 조건으로 대상 세션만 조회, 로그 유니크 제약 |
| 동의 없이 대화·피드백 전달 | 동의 전에는 대화 API가 403, 중계 이벤트 생성 시 동의 재확인 |
| 영구 보관(D3) 법적 검토 필요 | 본 SDD는 보관 정책 코드 미구현. 출시 전 법무 검토 항목으로 summary에 명시 |
| Alembic head 분기 | 구현 전후 `alembic heads` 확인 |
