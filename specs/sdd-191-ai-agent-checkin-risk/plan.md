# [SDD-191] — Implementation Plan

**Goal:** 안부 대화 + 프로파일 + 조용한 위험 알림.
**Architecture:**
```text
cron(5분) sweep_agent_checkins ─▶ agent_checkin.start ─▶ agent message(kind=checkin) ─▶ push outbox
내담자 자유 메시지 ─▶ agent_service.reply ─▶ agent_risk.detect ──(hit)─▶ risk_signal + counselor alert(+push)
                                           │                        └▶ 내담자: 고정 안전 응답 + talk_to_counselor CTA
                                           └─(no hit)▶ agent_checkin.respond(LLM+guard) ─▶ 턴수↑ ─▶ close ─▶ summary + agent_profile.extract
브리핑 빌더 ◀── 체크인 요약·미처리 위험 신호
```

## Contract (BE ↔ FE 단일 소스)
SDD-188/189 타입을 **확장**(기존 값 변경 금지): `AgentMessage.kind += 'checkin' | 'checkin_closing' | 'risk_alert'`, `AgentCtaAction += 'talk_to_counselor' | 'open_risk_signals'`. `talk_to_counselor`의 payload는 `{ room_id: string }`.
```ts
type MoodDirection = 'better' | 'same' | 'watch';
interface CheckinPrefs { available: boolean; paused: boolean }   // available = 상담사가 켬
interface CheckinClient { client_id: string; client_name: string; enabled: boolean;
  last_checkin_at: string | null; open_risk_count: number }
interface ProfileItem { id: string; category: 'sleep'|'stress'|'emotion'|'coping'|'people_events';
  text: string; status: 'ai_estimate'|'confirmed'|'dismissed'; evidence_count: number; updated_at: string }
interface CheckinSummary { id: string; client_id: string; started_at: string; closed_at: string | null;
  summary: string; mood_direction: MoodDirection | null }
interface RiskSignal { id: string; client_id: string; client_name: string; level: 'watch'|'high';
  excerpt: string; created_at: string; handled_at: string | null }
```
| Method | Path (prefix `/api/v1/agent`) | Body | Response | 권한 |
|---|---|---|---|---|
| GET | `/checkin-prefs` | — | `CheckinPrefs` | client |
| PUT | `/checkin-prefs` | `{paused: boolean}` | `CheckinPrefs` | client |
| GET | `/counselor/checkin/clients` | — | `{items: CheckinClient[]}` (담당 active 링크 내담자) | counselor |
| PUT | `/counselor/checkin/clients/{client_id}` | `{enabled: boolean}` | `CheckinClient` | counselor (담당만, 아니면 404) |
| GET | `/counselor/clients/{client_id}/profile` | — | `{items: ProfileItem[]}` (dismissed 제외) | counselor |
| PATCH | `/counselor/profile-items/{id}` | `{status?: 'confirmed'|'dismissed', text?: string(1~300)}` | `ProfileItem` | counselor |
| GET | `/counselor/clients/{client_id}/checkins?limit=20` | — | `{items: CheckinSummary[]}` 최신순 | counselor |
| GET | `/counselor/risk-signals?status=open|all&limit=50` | — | `{items: RiskSignal[]}` | counselor |
| POST | `/counselor/risk-signals/{id}/handled` | — | `RiskSignal` | counselor |
푸시 Outbox payload(비식별): 안부 `{"title":"AI 비서","body":"AI 비서가 안부를 물었어요","deeplink":"/app/ai"}` / 위험 `{"title":"AI 비서","body":"확인이 필요한 알림이 있어요","deeplink":"/agent"}`.

## 설계 결정
| 항목 | 결정 |
|---|---|
| 안부 대상 | enablement.enabled ∧ link.active ∧ ¬prefs.paused ∧ 동의함 ∧ 계정 활성 |
| 아웃리치 제한 | 하루 1회, 주 4회, 무응답 간격 1→2→4일, 22:00~08:00 KST 금지, 열린 체크인 있으면 신규 금지 |
| 체크인 길이 | 사용자 턴 5~10(기본 마무리 6턴, 6~10 사이 AI가 마무리 문장으로 종료) → closed_at, summary(LLM/폴백), mood_direction |
| 위험 레벨 | high: 의도·방법·계획 표현 / watch: 절망·소멸 소망 표현. 오탐 완화: 부정·인용·관용 표현("죽도록 맛있다", "죽겠다" 단독) 제외 |
| 위험 응답 | LLM 비사용 고정 템플릿 2종(high/watch). 감지 언급 금지 단어 목록을 테스트로 고정: 감지, 위험, 모니터링, 알림이 갔, 상담사에게 알렸 등 |
| 동일 신호 억제 | 같은 client·level 30분 내 재발 → 신호 미생성(excerpt 갱신 없음). level 상승(watch→high)은 새 신호 |
| 채팅방 | 기존 chat 서비스의 direct 방 조회/생성 헬퍼 재사용(코드 확인) |
| 프로파일 | 카테고리별 최대 5개 항목 유지, 중복 텍스트 병합, evidence message_id 누적 |
| 가드 | `agent_guard` 금지 패턴 추가: 조언 명령형("~하세요" 진료/약/치료 맥락), 진단, "항상 곁에", "제가 해결", 숫자 점수 |

## Files to Change
| Action | File | Description |
|---|---|---|
| Create | `backend/alembic/versions/e036a0000039_sdd_191_checkin_risk.py` | down=e036a0000038 |
| Modify | `backend/app/models/agent.py`, `models/__init__.py` | 5개 모델 |
| Create | `backend/app/services/agent_risk.py` | 탐지·신호 생성·상담사 알림·고정 응답 |
| Create | `backend/app/services/agent_checkin.py` | 대상 선정·아웃리치·대화·마무리·요약 |
| Create | `backend/app/services/agent_profile.py` | 항목 추출·병합 |
| Modify | `backend/app/services/agent_guard.py`, `agent_llm.py` | 가드 강화·프롬프트 |
| Modify | `backend/app/services/agent_service.py` | 내담자 자유 메시지 라우팅(위험→체크인→기존) |
| Modify | `backend/app/services/agent_briefing.py`, `agent_policy.py` | 브리핑 연동·상담사 컨텍스트 |
| Modify | `backend/app/services/agent_counselor_service.py`, `api/v1/agent_counselor.py`, `api/v1/agent.py`, `schemas/agent.py` | API (Contract) |
| Modify | `backend/app/services/notification_service.py` | 이벤트 `risk_signal` |
| Modify | `backend/app/tasks/agent_task.py`, Create `backend/sweep_agent_checkins_cron.py`, Modify `deploy-dev.yml` | 스윕 |
| Create | `backend/tests/test_agent_checkin_*.py`, `test_agent_risk_*.py`, `test_agent_profile_*.py` | 테스트 |
| Create/Modify | `frontend/src/lib/api/agent-checkin.ts` (+ agent*.ts 타입 확장) | 클라이언트·타입 |
| Modify | `frontend/src/pages/ClientProfilePage.tsx`(또는 내담자 상세) + 신규 컴포넌트 | 켜기/끄기·프로파일·타임라인 |
| Modify | `frontend/src/pages/agent/*` | 위험 알림 카드·목록 |
| Modify | `frontend/src/pages/client/ai-agent-page.tsx`, `lib/agent/actions.ts` | checkin 렌더·일시중지·talk_to_counselor |
| Create | `frontend/tests/agent-checkin*.test.ts(x)` | vitest |

## Tasks
1 마이그레이션·모델 2 가드·위험 탐지 3 체크인 엔진·프로파일 4 라우팅·위험 응답·상담사 알림 5 아웃리치 스윕·cron 6 상담사/내담자 API 7 브리핑 연동 8 BE 테스트 9 FE API·내담자 화면 10 FE 상담사 화면(내담자 상세·위험 목록) 11 FE vitest 12 통합 검증
BE(backend/)와 FE(frontend/) 병렬. 마이그레이션 id 039 고정.

## Testing Strategy
pytest 전체, `alembic heads`, `tsc`, `npm run build`, `vitest run`(기존 15 실패 외 신규 0), 계약 교차 대조, dev 배포 스모크(상담사 켜기→아웃리치 시뮬레이션→위험 문장→상담사 알림·CTA).
