# [SDD-191] — Summary

> 상태: Stage ④~⑥ 완료. Review 대기.

## What Was Built
| File | Description |
|------|-------------|
| `backend/alembic/versions/e036a0000039_sdd_191_checkin_risk.py`, `models/agent.py` | enablement / prefs / checkins / profile_items / risk_signals |
| `backend/app/services/agent_risk.py` | 규칙 기반 위험 탐지(high/watch, 띄어쓰기 변형, 오탐 완화), 신호 생성·중복 억제·상승, 상담사 알림(`risk_alert`·인앱 `risk_signal`·비식별 푸시), 내담자 고정 안전 응답 + `talk_to_counselor`(direct 채팅방 room_id) |
| `backend/app/services/agent_checkin.py`, `sweep_agent_checkins_cron.py` | 상담사가 켠 내담자만 대상, 하루 1회·주 4회·무응답 점증·22~08시 KST 금지, 체크인 대화·마무리·요약 |
| `backend/app/services/agent_profile.py` | 프로파일 항목 추출·병합(`ai_estimate`, 근거 message_id) |
| `agent_guard.py`, `agent_service.py`, `agent_briefing.py`, `agent_policy.py` | 가드 강화, 메시지 라우팅(위험→체크인→기존), 브리핑에 안부 요약·미처리 위험 신호 |
| `api/v1/agent.py`, `agent_counselor.py`, `schemas/agent.py`, `notification_service.py` | `/agent/checkin-prefs`, `/agent/counselor/checkin|profile|checkins|risk-signals` API |
| `.github/workflows/deploy-dev.yml` | 5분 cron |
| `frontend/src/lib/api/agent-checkin.ts` 외 | 내담자: 체크인 메시지·일시중지 토글(상담사가 켠 경우만)·`talk_to_counselor`→`/app/chat/:roomId` / 상담사: 내담자 상세 안부 켜기·프로파일(AI 추정 배지·확정/수정/기각)·요약 타임라인·위험 알림 카드·위험 신호 목록·사이드바 배지 |
| tests | 백엔드 신규 다수(위험 탐지·흐름·대화·프로파일·API·브리핑·아웃리치), 프론트 신규 vitest |

## Test Results (Supervisor 직접 재실행)
- ✅ 백엔드 전체 **1664 passed / 12 skipped / 0 failed**, `test_agent_*` 250 passed
- ✅ `alembic heads` 단일 `e036a0000039`
- ✅ 프론트 `tsc`·`build` 통과, vitest 405 passed / 15 failed(기존 무관 이슈, 신규 0)
- ✅ 위험 탐지 독립 점검: 진짜 표현 8종 탐지(high 5·watch 3), 오탐 사례(죽도록 맛있다·배고파 죽겠어요·캠페인 인용·드라마 장면 등) 미탐지
- 계약 대조: 백엔드 `schemas/agent.py` ↔ 프론트 `agent-checkin.ts` (BE 응답 모델·FE 타입 구현 시 동일 Contract 사용)

## Debugging Journey
- BE 워커가 API 서버 오류로 중간 종료(구현은 존재, 테스트 대부분 누락) → 이어받기 워커로 테스트 233개 추가·버그 수정, Supervisor가 전체 회귀 재실행.

## Notes for Reviewer — 출시 전 필수 검토
1. **위험 감지 비고지(D4)**: 내담자에게 감지 사실을 알리지 않는다. 동의 문구·개인정보 처리방침에 해당 처리가 어떻게 반영돼야 하는지 **법무·임상 검토 필수**.
2. **긴급 핫라인 안내 없음**: 현재 내담자 응답은 공감 + 상담사 대화 권유 + 채팅 연결 버튼뿐이다. 상담사가 즉시 응답하지 못하는 상황의 대비(핫라인 번호 노출, 기관 관리자 에스컬레이션)는 후속 결정 사항.
3. **미탐/오탐**: 규칙 기반이라 완곡 표현·3인칭·방언은 놓칠 수 있다. 상담사 피드백으로 사전 튜닝 필요(임상 자문 권장).
4. **위험 알림의 excerpt**: 상담사 판단을 위해 감지된 문장(최대 200자)만 상담사 채널에 전달한다. D1(요약만 전달)의 예외임.
5. 푸시는 FCM 자격증명 설정 전까지 발송되지 않는다(SDD-190 참고).
6. 안부 대화는 상담사가 내담자별로 켜야 시작된다(D5=②).
