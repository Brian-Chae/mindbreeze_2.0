# [SDD-191] 안부 대화(2차) + 상담사 전용 프로파일 + 조용한 위험 알림

> 기획: `docs/AI-에이전트-양방향-채널-기획.md` v0.5 §3.4 / 결정: **D5=②(상담사가 내담자별로 켬)**, **D4=조용히 상담사에게만 알림 + 내담자에게는 상담사 대화 유도 버튼** / 선행: SDD-188(내담자 채널)·189(상담사 채널)·190(푸시)

## Goal
상담사가 켠 내담자에게 AI가 **먼저 안부를 건네고**(하루 최대 1회) 짧은 감정 대화를 나누며, 대화에서 **상담사 전용 프로파일**을 구축·요약해 상담사에게 전달한다. 위험 표현이 감지되면 **내담자에게는 감지 사실을 알리지 않고** 상담사에게만 즉시 조용히 알리며, 내담자에게는 상담사와의 대화를 권하고 **[상담사님과 대화하기] 버튼으로 기존 1:1 채팅에 바로 연결**한다.

## Context
- AI는 경청·공감·열린 질문만 한다(조언·진단·처방·"항상 곁에 있어요" 금지). 점수·숫자 척도 금지.
- 상담사에게는 원문이 아닌 **요약**을 전달(D1). 단 위험 알림에는 판단에 필요한 **감지된 문장(excerpt)만** 포함한다.
- 감지는 **내담자에게 비노출**(D4 결정). 동의 문구/UI에 감지 사실을 드러내지 않는다. (윤리·법적 검토 필요 항목으로 summary에 명시)
- 기존: `agent_conversations/messages/relay_events`, `agent_policy`, `agent_guard`, `agent_llm`, 브리핑 빌더, 푸시 Outbox, 1:1 채팅(`ChatRoom` direct).

## Scope
### ✅ In-scope
**백엔드** (마이그레이션 **`e036a0000039`**, down `e036a0000038`)
1. 테이블: `agent_checkin_enablements`(counselor_id, client_id, enabled, updated_at, UNIQUE(counselor_id,client_id)), `agent_checkin_prefs`(client_id UNIQUE, paused bool), `agent_checkins`(id, client_id, counselor_id, started_at, closed_at, turn_count, summary, mood_direction), `agent_profile_items`(id, client_id, counselor_id, category `sleep|stress|emotion|coping|people_events`, text, status `ai_estimate|confirmed|dismissed`, evidence JSON(message_id 목록), updated_at), `agent_risk_signals`(id, client_id, counselor_id, message_id, level `watch|high`, excerpt, status/handled_at, created_at)
2. **상담사가 켠 내담자만** 안부 대상(`ClientCounselorLink` active + enablement enabled + 내담자 paused 아님 + 동의함 + 계정 활성)
3. 아웃리치 스윕 `sweep_agent_checkins_cron.py`(매 5분): 트리거 = 무응답 3일 이상 / 직전 대화가 힘든 감정(watch 이상 또는 부정 정서)로 끝남 / 상담 완료 다음 날 / 평소 응답 시간대. 제한 = 하루 최대 1회, 주당 상한(기본 4), 무응답 시 간격 점증(1→2→4일), **방해금지 22:00~08:00 KST**, 열린 체크인이 있으면 새로 시작하지 않음. 생성 메시지 `kind=checkin`, 푸시 Outbox(비식별 "AI 비서가 안부를 물었어요")
4. 대화 엔진: 내담자의 자유 메시지에 공감·열린 질문으로 응답(LLM + 폴백 템플릿, `agent_guard` 강화: 조언·진단·약속 표현 제거). 체크인당 5~10턴 후 마무리 메시지(`kind=checkin_closing`, 상담사 연결 방향 문구) 후 `closed_at`·요약 저장. 숫자·점수 표현 금지
5. 프로파일 구축: 체크인 종료(또는 턴마다) 대화에서 항목 추출(LLM JSON + 키워드 폴백), `ai_estimate`로 upsert하고 근거 message_id 보관. 내담자에게 **절대 미노출**(API 권한)
6. **위험 감지(조용히)**: 내담자의 모든 자유 메시지(체크인·리포트 대화 포함)에 규칙 기반 탐지(자살/자해/죽고 싶다/사라지고 싶다/살기 싫다/끝내고 싶다 등 한국어 표현, 부정문·인용 오탐 완화) + 선택적 LLM 보조. `high`/`watch` 레벨. 감지 시: (a) `agent_risk_signals` 생성(동일 내담자·레벨 30분 내 중복 억제, 상승 시 새 신호) (b) 상담사 즉시 알림: 상담사 채널 메시지 `kind=risk_alert`(CTA `open_client`, `open_risk_signals`) + 인앱 알림 이벤트 `risk_signal` + 푸시 Outbox(비식별 "확인이 필요한 알림이 있어요") (c) 내담자 응답은 **감지를 언급하지 않는 고정 안전 템플릿**: 공감 + "상담사님과 이야기 나눠보시면 좋겠어요" + CTA `talk_to_counselor`(label "상담사님과 대화하기") → payload.room_id = 해당 상담사와의 direct 채팅방(없으면 생성)
7. 상담사 API(`/api/v1/agent/counselor/*`): 안부 대상 목록·켜기/끄기, 프로파일 조회·항목 확정/수정/기각, 체크인 요약 타임라인, 위험 신호 목록·처리. 내담자 API: 안부 일시중지 설정(`/api/v1/agent/checkin-prefs`)
8. 브리핑 연동: 아침/저녁 브리핑에 내담자별 "세션 사이 안부 요약"(변화 방향 좋아짐/비슷함/주의)과 **미처리 위험 신호** 섹션 추가
9. `deploy-dev.yml` 5분 cron 등록

**프론트엔드**
10. 상담사: 내담자 상세(`/clients/:id`)에 "AI 안부 대화" 켜기/끄기 카드, 프로파일 뷰(카테고리별, "AI 추정" 배지, 확정/수정/기각), 안부 요약 타임라인. 상담사 AI 화면(`/agent`)에 위험 알림 카드(`risk_alert`)와 위험 신호 목록(미처리 우선, 처리 완료). 숫자 점수 UI 금지
11. 내담자: AI 대화 화면에서 `checkin` 메시지 렌더, 상담사가 안부를 켠 경우에만 "안부 일시 중지" 토글 노출, `talk_to_counselor` CTA → `/chat/:roomId`로 이동. **위험 감지를 암시하는 UI/문구 금지**

### ❌ Out-of-scope
- 긴급 전화번호/위기 핫라인 안내 화면(추후 결정), 상담사 부재 시 에스컬레이션, 기관 관리자 알림, 음성 대화, 앱 푸시 자격증명, 영구 보관 정책 코드

## Acceptance Criteria
- [ ] 상담사가 켠 내담자에게만 안부가 생성되고, 켜지 않았거나 내담자가 일시 중지했거나 동의 전이면 생성되지 않는다
- [ ] 하루 1회·주당 상한·방해금지(22~08시 KST)·무응답 점증 규칙이 지켜지고 스윕 재실행에 멱등하다
- [ ] 안부 대화에 AI가 조언·진단·점수·"항상 곁에 있어요" 표현을 쓰지 않는다(가드 테스트)
- [ ] 체크인이 5~10턴 후 마무리되고 요약이 저장되며 상담사 프로파일 항목(`ai_estimate`)이 생긴다. 내담자는 프로파일 API/화면에 접근할 수 없다(403/비노출)
- [ ] 위험 표현 메시지 → 상담사에게 `risk_alert` 메시지·인앱 알림·비식별 푸시가 즉시 생성되고, 내담자 응답에 "감지/위험/모니터링" 등 감지를 암시하는 단어가 없으며 `talk_to_counselor` CTA가 붙는다
- [ ] CTA의 `room_id`가 해당 상담사와의 실제 direct 채팅방이며 프론트에서 바로 열린다
- [ ] 위험 신호 중복 억제와 레벨 상승 시 재알림이 동작한다. 비위험 문장("죽도록 맛있다", "자살 예방 캠페인 봤어요")의 오탐이 완화된다
- [ ] 상담사 A는 상담사 B 내담자의 프로파일·체크인·위험 신호를 볼 수 없다
- [ ] 브리핑에 안부 요약과 미처리 위험 신호가 포함된다
- [ ] 푸시 payload에 이름·상담/위험 내용이 없다
- [ ] LLM 키 없이도 폴백으로 동작한다
- [ ] `alembic heads` 단일 `e036a0000039`, 백엔드 pytest 전체 신규 실패 0, 프론트 tsc·build 통과·신규 vitest 통과

## Dependencies
SDD-188/189/190, `ChatRoom`(direct) 생성 헬퍼, `ClientCounselorLink`

## Risks
| 리스크 | 대응 |
|---|---|
| 위험 미탐/오탐 | 규칙+LLM 보조, 레벨 구분, 중복 억제, 임상 자문·튜닝 전제(summary에 명시), 상담사가 처리 상태로 관리 |
| 감지를 내담자에게 알리지 않는 윤리·법적 이슈 | 결정(D4) 반영, **출시 전 법무·임상 검토 필수 항목**으로 summary 기재, 개인정보 처리방침 점검 |
| AI 의존·애착 | 금지 문구 가드, 마무리 멘트는 상담사 연결 |
| 프로파일 AI 추측 | `ai_estimate` 표시 + 근거 + 상담사 확정 |
| 알림 피로 | 하루 1회·주당 상한·점증·일시중지 |
| 긴급 핫라인 미제공 | 이번 범위 밖, summary에 후속 결정으로 표시 |
