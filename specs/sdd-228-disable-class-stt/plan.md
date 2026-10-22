# SDD-228 Plan

## 설계 결정
- 기존 SDD-220 `ai_features_enabled`(AI 전체)는 건드리지 않고 **STT 전용 스위치 `stt_enabled`를 AND 로 추가**한다. 이유: AI 전체를 끄면 리포트 AI 초안 등 다른 AI 도 꺼진다.
- STT 를 끄는 3지점(발행·큐 잔여 skip·transport 직전)을 모두 `is_stt_enabled`/`require_stt_enabled` 로 통일한다 — SDD-220 의 off 경로(completed 마감 → 리포트 이어짐)를 재사용.
- 요약(summary_task)은 전사가 입력이므로 STT off 면 함께 skip. 리포트 AI 초안은 그대로.
- 사유값은 새 문자열 `stt_disabled` — `ai_record.reason`·`report-status.reason` 은 자유 문자열이라 **DB 마이그레이션 불필요**.
- STT off 의 '전사 없음'은 결함이 아니므로 `generation_status_for_content` 가 ready 로 마감(마이크 오프·저신뢰는 기존 partial).
- 프론트: `VITE_STT_ENABLED`(기본 비공개) + `isSttEnabled/isSttProgressVisible/isSttAiRecordVisible`. 기존 `ENABLE_STT_AI_RECORD` 상수는 유지.

## 파일
| 파일 | 변경 |
|---|---|
| backend/app/config.py | `stt_enabled` |
| backend/app/core/ai_features.py | `is_stt_enabled`, `require_stt_enabled`, `STT_DISABLED_CODE` |
| backend/app/services/audio_service.py | 체인 발행·종료 마감 판정 |
| backend/app/tasks/stt_task.py, summary_task.py | 큐 잔여 skip, transport 가드 |
| backend/app/tasks/report_task.py | `stt_disabled` 사유 |
| backend/app/services/report_progress_service.py | 스텝 skipped·사유·ready 판정 |
| frontend/src/lib/features.ts, report-status.ts, ReportProgressStepper.tsx | 플래그·문구·단계 숨김 |
| backend/tests/test_sdd228_stt_switch.py, frontend/tests/sdd228-stt-switch.test.tsx | 신규 테스트 |
| backend/tests/conftest.py, 기존 vitest 6개 | on 계약 유지용 환경값 주입(단언 불변) |

## Task
- [x] T1 백엔드 스위치·가드
- [x] T2 발행·skip·사유·진행 스텝
- [x] T3 프론트 플래그·스텝퍼·문구
- [x] T4 테스트(pytest·vitest·tsc)
