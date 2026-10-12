# SDD-202 [Fix] 루시 LLM 실패 시 폴백 문구 제거 → 오류 + 재시도 안내 — Verify (구현 전)

## 원인
- dev `AGENT_LLM_MODEL=gemini-3.1-pro-preview`(thinking 전용). 서버 실측 첫 토큰 7~10s(flash 3.5~5s).
- 스트리밍 read 타임아웃 15s(`GEMINI_TIMEOUT_SECONDS` 공용값)에 꼬리 지연이 걸려 `REPLY_FALLBACKS`
  고정 문구가 사용자 발화와 무관하게 나갔다(동문서답처럼 보임).

## 결정
- 모델은 pro 유지, **스트리밍 read 타임아웃만 40s로 상향**(에이전트 전용 상수, 리포트 공용값 불변).
- 일시 오류(429/5xx/연결오류)는 첫 토큰 전에 한해 **1회 자동 재시도**. read 타임아웃은 재시도 안 함.
- 스트리밍 경로에서 LLM 실패 시 고정 폴백 대신 **`LLMUnavailableError` → SSE `{"error":"llm_unavailable"}`**.
  메시지(사용자·에이전트)는 저장하지 않는다(트랜잭션 롤백, turn_count 소모 없음).
- 프론트는 사용자 말풍선을 유지하고 "답변을 만들지 못했어요" 안내 + [다시 시도] 버튼을 보여준다.
- 비스트리밍 `POST /agent/messages`(프론트 미사용)와 브리핑·리마인더 등 템플릿 메시지는 불변.

## 시나리오
1. [BE] 스트림 정상 → 토큰 yield, 오류 없음.
2. [BE] 첫 요청 503 → 1회 재시도 후 성공 → 토큰 yield.
3. [BE] 연속 실패 / 빈 응답 / 키 없음 + raise_on_failure=True → `LLMUnavailableError`.
4. [BE] read 타임아웃은 재시도하지 않는다(시도 1회).
5. [BE] 일부 토큰 전송 후 끊김 → 재시도하지 않고 받은 만큼으로 종료(중복 방지).
6. [BE] raise_on_failure=False(기본) → 기존대로 fallback yield (하위호환).
7. [BE API] 체크인/동반자 스트림 실패 → SSE에 error 이벤트 + [DONE], DB에 user/agent 메시지·turn_count 변화 없음.
8. [BE] 로그에 API 키·URL·대화 원문이 남지 않는다(예외 클래스·HTTP 상태만).
9. [FE] error 이벤트 수신 → `AgentReplyError` throw → 안내 + [다시 시도] 표시, 사용자 말풍선 유지.
10. [FE] [다시 시도] → 같은 내용으로 재전송, 성공 시 안내 제거·확정 메시지로 교체, 중복 말풍선 없음.
11. [FE] 입력창에 새 글을 쓰고 전송하면 실패 안내는 사라진다.

---
# 추가(2차) — 타임아웃 60s + 상담사 연결 제안·버튼 (구현 전)

## 결정
- 에이전트 LLM 타임아웃 60s 통일: 비스트리밍 `AGENT_LLM_TIMEOUT_SEC`·내부 httpx timeout(기존 공용 15s가 12s 대기보다 길어
  사실상 12s였음)·스트리밍 read. 스레드풀 2→4(느린 호출이 풀을 점유하지 않게).
- 상담사 연결 방식 = A(이동만). "이야기해 보세요" 훈계형 문구 → "채팅을 연결해 드릴까요?" 제안형.
  실제 동작(채팅방 이동)과 문구가 일치해야 하므로 "상태를 전달"한다고 말하지 않는다(B는 후속).
- 연결 제안 문장이 나가는 응답에는 `talk_to_counselor` 버튼을 서버가 붙인다(LLM 마커 비의존:
  최종 문장에 상담사 연결 제안 패턴이 있을 때). 담당 상담사가 없으면 버튼 없음.

## 시나리오
12. [BE] `_call_gemini`/`_call_gemini_chat`/`_invoke` 가 60s 를 쓴다(공용 15s 불변).
13. [BE] OUT_OF_SCOPE·SAFE_FALLBACK·SAFE_REPLIES 가 제안형 문구이고 금지어(감지·위험·모니터링 등)가 없다.
14. [BE] OUT_OF_SCOPE 응답에 담당 상담사가 있으면 `talk_to_counselor` CTA(room_id 실제 방)가 붙는다.
15. [BE] LLM 응답에 연결 제안 문장이 있으면 CTA 부착, 없으면 미부착, 이미 CTA 가 있으면 중복 없음.
16. [BE] 담당 상담사가 없으면 CTA 없음(에러 없음).
17. [BE] 피드백 접수 문구("상담사님께 그대로 전해 드릴게요")에는 버튼이 붙지 않는다.
18. [FE] 기존 CtaCard 가 새 라벨로 렌더되고 누르면 `/app/chat/{room_id}` 로 이동(기존 로직 불변).
