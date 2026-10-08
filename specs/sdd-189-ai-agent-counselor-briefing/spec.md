# [SDD-189] AI 에이전트 상담사 채널 — 아침 일정 브리핑 · 저녁 상담 정리

> 기획: `docs/AI-에이전트-양방향-채널-기획.md` v0.5 §2.2, §3.5 / 선행: SDD-188 (에이전트 코어, relay event, 푸시 Outbox)

## Goal
상담사가 **상담사:AI 채널**에서 하루 2회(아침 일정 브리핑, 저녁 상담 정리)를 받고, 내담자가 남긴 피드백·일정 변경 문의(SDD-188의 relay event)를 한곳에서 확인한다.

## Context
- SDD-188에서 내담자 피드백·일정 변경 문의·확인(ack)이 `agent_relay_events`에 쌓이지만 상담사가 볼 화면이 없다.
- 상담사는 건별 알림을 원하지 않는다(D6·기획 §1.2-6). **길찾기·장소·연락처는 상담사 채널에 넣지 않는다.** 내담자 표시는 **실명**(D12).
- 주기 작업은 OS cron(`*_cron.py`)이다. 푸시 발송은 SDD-190에서 처리하며 본 SDD는 Outbox에 `push` 행을 적재한다.

## Scope
### ✅ In-scope
**백엔드**
1. 신규 마이그레이션(`down_revision = e036a0000036`, **revision id 고정: `e036a0000037`**): `agent_counselor_settings`(user_id UNIQUE, morning_enabled, morning_time "HH:MM", evening_enabled, evening_time "HH:MM", skip_no_session_days bool, updated_at), `agent_briefing_logs`(user_id, kind `morning`|`evening`, briefing_date, UNIQUE(user_id,kind,briefing_date)), `agent_relay_events.handled_at`(nullable)
2. 상담사용 컨텍스트 `agent_policy.counselor_context(user_id, day)`: 본인(host) 세션(오늘/내일), 담당 내담자(`ClientCounselorLink` active) 한정 — 세션별 회차, 직전 세션 AI 요약(`SessionRecord`), 리포트 상태(승인 대기 포함), 내담자 확인 여부, 미처리 relay event. **타 상담사 데이터·내담자 동의 없는 데이터 제외**
3. 브리핑 빌더(`agent_briefing.py`): 아침 = 오늘 일정(시각·내담자 실명·회차·온라인/오프라인)·건별 한 줄·승인 대기 리포트·미확인 예약·일정 변경 문의 / 저녁 = 오늘 진행 상담별 정리(다룬 주제·남은 주제 후보·특이사항, 세션 AI 요약 기반)·불참/취소·리포트 상태·내담자 피드백(원문 그대로 표시)·내일 일정. **사실은 DB 값 템플릿, LLM은 건별 서술 보조(키 없음/실패 시 폴백)**, `agent_guard` 적용(진단·점수 금지). 기록 없음 세션은 "기록 없음"
4. 스케줄러 `sweep_agent_briefings_cron.py`(매 1분, `app/tasks/agent_task.py::sweep_agent_briefings`): 상담사 설정 시각(KST)이 도래했고(지정 시각 이후 최대 30분 보정) 오늘 로그가 없으면 생성. `skip_no_session_days`가 true이고 해당 일 일정이 없으면 건너뜀(저녁은 오늘 진행 세션 없고 내일도 없으면 건너뜀). `agent_briefing_logs` 유니크로 멱등
5. API (`/api/v1/agent/counselor/*`, role `counselor`만): 설정 조회/수정, 메시지 목록/전송/읽음/미읽음 수, CTA 실행(기록용), relay event 목록·처리(handled) — 아래 Contract
6. 상담사 AI 대화 응답: 규칙 기반 의도(오늘/내일 일정, "<이름> 지난 요약", 브리핑 시간 변경 안내) + 그 외는 정책 계층 컨텍스트만 사용한 가드된 LLM 응답. **데이터 변경·발송 실행 없음**(조회·초안만)
7. 푸시 Outbox(`channel="push"`) 적재 — 본문 비식별("AI 비서가 브리핑을 보냈어요"), 앱/웹 인앱 알림
8. `deploy-dev.yml`에 매 1분 cron 등록

**프론트엔드 (상담사)**
9. 상담사 AI 대화 화면(대시보드 내 진입점, 라우트 `/agent` 권장 — 기존 라우팅 방식 확인), 메시지·CTA 카드, 미읽음 배지
10. 브리핑 설정 시트(아침/저녁 시각·사용 여부·일정 없는 날 건너뛰기)
11. 내담자 피드백·일정 변경 문의 목록(relay event) — 미처리 우선, 처리 완료 표시, 일정 변경 문의는 세션 상세로 이동 CTA
12. CTA 동작: `open_schedule`, `open_client`(내담자 상세), `open_record`(세션 기록), `open_report`(리포트 승인 화면), `open_change_requests`

### ❌ Out-of-scope
- 푸시 발송·디바이스 토큰(SDD-190), 앱 셸/BLE, 안부 대화·프로파일, 상담사→내담자 AI 중계(제외 확정 D6), 건별 임박 알림·길찾기·연락처, org_admin용 브리핑

## Acceptance Criteria
- [ ] 상담사가 설정한 시각에 아침/저녁 브리핑이 1일 1회씩 생성되고 재실행해도 중복되지 않는다
- [ ] 일정이 없고 건너뛰기가 켜져 있으면 생성되지 않는다. 꺼져 있으면 "오늘 일정 없음" 메시지가 생성된다
- [ ] 브리핑에는 담당 내담자 실명·회차·온라인/오프라인만 있고 **장소·연락처·길찾기 없음**
- [ ] 저녁 정리에 오늘 상담 요약·남은 주제 후보·리포트 상태·내담자 피드백(원문 그대로)이 들어간다. 진단·점수 표현 없음
- [ ] 다른 상담사의 내담자·세션은 브리핑·대화에 나타나지 않는다
- [ ] relay event 목록은 본인(target_user) 것만, 처리(handled) 가능
- [ ] role≠counselor는 403, 내담자는 상담사 채널 접근 불가
- [ ] 푸시 Outbox payload에 이름·상담 내용 없음
- [ ] LLM 키 없이 폴백으로 동작
- [ ] `alembic heads` 단일(`e036a0000037`), 백엔드 pytest 전체 신규 실패 0, 프론트 build·tsc 통과, 신규 vitest 통과

## Dependencies
SDD-188(코어·relay·Outbox), `SessionRecord`, `ClientCounselorLink`, 리포트 상태머신

## Risks
| 리스크 | 대응 |
|---|---|
| 상담사 간 정보 유출 | `counselor_context`가 host/링크 기준 단일 진입점, 타 상담사 데이터 테스트 |
| 요약 환각 | 사실은 DB 템플릿, LLM은 서술 보조 + 가드 |
| 정시 발송 누락 | 지정 시각 이후 30분 보정 + 로그 유니크 |
| 마이그레이션 head 분기(SDD-190 병행) | revision id 고정(037), 190은 038 |
