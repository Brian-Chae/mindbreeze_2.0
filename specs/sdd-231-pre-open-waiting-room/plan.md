# SDD-231 plan

## 파일 담당 (단일 작성자, 병렬 없음)
| 영역 | 파일 | 변경 |
|---|---|---|
| 설정 | `backend/app/config.py` | `class_pre_open_entry_lead_minutes`, `class_pre_open_entry_grace_minutes` |
| 허용 구간 | `backend/app/services/class_code_service.py` | `pre_open_entry_window(session, now)`, `find_enterable_session` 확장 |
| 입장 | `backend/app/services/session_service.py` | `_enter_resolved` 허용 구간 완화·출석 보류, `join_session` 409 detail, `participant_livekit_token` 가드+출석 지연 기록 |
| 시간 포맷 | `frontend/src/lib/class/flow/member-format.ts` | `preOpenCountdown()` |
| 오류 해석 | `frontend/src/lib/class/flow/member-machine.ts` | `notYetScheduledAt(error)` |
| 화면 | `EntryConfirmView.tsx`, `MemberStateScreen.tsx`, `EntryPage.tsx`, 훅 `useNow.ts` | 남은 시간 표시·presence 활성 |
| 테스트 | `backend/tests/pg/test_sdd231_pre_open.py`, `frontend/tests/sdd231-*.test.ts(x)` | |

## 결정 이유
- 출석을 토큰 발급 시점에 늦춰 기록: `entry-state` 폴링에서 기록하면 초대만 받고 입장하지 않은 회원도 출석될 수 있다(마커 컬럼이 없음). 토큰은 실제 라이브 입장에서만 요청되므로 마이그레이션 없이 의미가 맞는다.
- `join_session`은 토큰을 바로 발급하므로 열지 않는다.
- 프론트 머신은 이미 `unopened → open` 자동 전이를 지원하므로 건드리지 않는다.
