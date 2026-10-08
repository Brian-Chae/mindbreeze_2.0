# [SDD-188] — Summary

> 상태: Stage ④~⑥ 완료(로컬). **Stage ⑦ Review 대기.** 커밋·배포 전.

## What Was Built

### Backend
| File | Description |
|------|-------------|
| `backend/app/models/agent.py` | AgentConversation / AgentMessage / AgentRelayEvent / AgentDeliveryLog |
| `backend/alembic/versions/e036a0000036_sdd_188_ai_agent_client_channel.py` | 테이블 4종 + 인덱스 + `sessions.location_address` (head 단일) |
| `backend/app/services/agent_policy.py` | 내담자 채널 컨텍스트 단일 진입점 (본인 예약 + 본인 승인 완료 client 리포트만) |
| `backend/app/services/agent_guard.py` | 진단·점수 표현 출력 필터 |
| `backend/app/services/agent_llm.py` | Gemini 호출 + 템플릿 폴백 |
| `backend/app/services/agent_service.py` | 동의·메시지·읽음·CTA·relay 이벤트·푸시/인앱 알림 적재 |
| `backend/app/services/agent_reminder.py` | 예약 3시간/1시간 전 노티, 취소·변경·정정, 윈도우·보정 |
| `backend/app/services/agent_report_chat.py` | 리포트 승인 → 링크 메시지, 피드백 처리 |
| `backend/app/tasks/agent_task.py`, `backend/sweep_agent_reminders_cron.py` | 매 1분 cron 스윕 |
| `backend/app/api/v1/agent.py`, `schemas/agent.py` | `/api/v1/agent/*` (Contract 그대로) |
| `backend/app/services/report_service.py` | 승인·자동 승인 경로 훅 (실패해도 승인 트랜잭션 유지) |
| `backend/app/services/session_service.py`, `schemas/session.py`, `models/session.py` | `location_address` (오프라인 기본값: 기관→상담사 프로필→null, 온라인 null) |
| `backend/app/services/notification_service.py` | 이벤트 `schedule_change_request` |
| `.github/workflows/deploy-dev.yml` | 1분 cron 등록 + 파일 복사 |
| `backend/tests/test_agent_*.py`, `agent_helpers.py` | 76 tests |

### Frontend
| File | Description |
|------|-------------|
| `frontend/src/lib/api/agent.ts` | Contract 타입 + 클라이언트 |
| `frontend/src/pages/client/ai-agent-page.tsx`, `components/client/agent/cta-card.tsx`, `lib/agent/actions.ts`, `stores/agent-store.ts` | AI 대화 화면(동의·변경 문의 시트 포함), CTA 카드, CTA 동작 매핑·URL 스킴 검사, 미읽음 상태 |
| `BottomTabBar.tsx`, `ClientShell.tsx`, `ClientAppPage.tsx`, `SidebarNav.tsx` | 진입점·미읽음 배지·라우팅 |
| `SessionCreatePage.tsx`, `SessionDetailPage.tsx`, `components/session/session-location-editor.tsx`, `lib/class/session-location.ts`, `lib/api/session.ts` | 세션 장소 입력(D8) |
| `frontend/tests/agent-*.test.ts(x)`, `session-location*.test.ts(x)` | 신규 vitest |

## Test Results (Supervisor가 직접 재실행)
- ✅ 백엔드 신규 `test_agent_*.py`: **76 passed** (TS1~TS19 + Edge/Security 대응)
- ✅ 백엔드 전체 회귀: 1454 passed / 12 skipped / 신규 기능 실패 0 (기존 마이그레이션 head 하드코딩 테스트 4건은 아래 참조)
- ✅ `alembic heads` 단일 head `e036a0000036`, `upgrade e036a0000035:head --sql` 렌더 확인
- ✅ 프론트 `tsc -b --noEmit`, `npm run build` 통과
- ✅ 프론트 신규/관련 vitest 31 passed
- ⚠️ 프론트 전체 vitest: 328 passed / 15 failed — **전부 기존 이슈**(본 SDD 파일과 무관):
  - 하네스: 브라우저 테스트가 dev 서버(5175) 미기동으로 ECONNREFUSED
  - 오래된 테스트: `ClientReportDetailPage` import 경로 부재, 리포트 목록 텍스트 `NEW` 접두 기대 불일치
- ✅ TS23 계약 교차 대조: 백엔드 `schemas/agent.py` ↔ 프론트 `lib/api/agent.ts` 필드·enum 일치
- ⏳ **미실행**: TS20~TS22 브라우저 시나리오(dev 배포 후 스모크), 실제 서버 응답 기반 통합 확인

## Debugging Journey
- 병렬 워커의 모니터링 파일을 `~/.hermes/cache/scratch`에 두었더니 중간에 디렉토리가 정리되어 FE 워커가 중단·로그가 유실됨 → 브리프/로그를 `/tmp/sdd188/`로 옮겨 FE를 이어서 재디스패치.
- BE 워커 최종 보고는 유실됐지만 산출물로 판정: 신규 테스트 4건 실패(테스트 픽스처 결함 — `counselor_code` NOT NULL 누락, 세션 수정 API는 `PUT`인데 `PATCH` 호출)를 직접 수정해 통과.
- 마이그레이션 head를 `== e036a0000035`로 하드코딩한 기존 테스트 4건이 새 리비전 추가로 실패 → "단일 head + 해당 리비전이 체인에 포함"으로 완화.

## Notes for Reviewer
1. **푸시는 아직 나가지 않는다.** Outbox에 `channel="push"`, `pending` 행만 적재(비식별 본문). consumer·디바이스 토큰은 SDD-190. 현재는 **웹 인앱 AI 대화창**에서만 확인 가능하다.
2. **기존 SDD-097 리마인더와 병행**(D7). 1시간 전(60분)에는 기존 안내 + AI 메시지가 모두 생성될 수 있다. 중복 체감은 dev에서 확인 후 조정 필요.
3. **상담사 열람 화면 없음.** relay event(피드백·일정 변경 문의)는 DB에 쌓이고, 일정 변경 문의만 상담사 인앱 알림이 간다. 브리핑·열람은 SDD-189.
4. **영구 보관(D3) 법무 검토 필요**: 삭제·보관 기간 코드 없음.
5. **위기 감지 없음(D4).** 리포트 대화·예약 노티 범위에서는 자유 감정 대화 비중이 낮으나, 사용자가 자유 메시지를 보낼 수 있으므로 출시 전 재확인 권장.
6. `deploy-dev.yml`에 1분 cron이 추가됨 → dev 배포 후 `crontab -l`과 `/var/log/mindbreeze-agent-reminders.log` 확인.
7. 커밋·푸시는 하지 않았다. 변경 파일이 많아 Review 후 `feat(sdd-188):` 태그로 커밋 예정.
