# SDD-267 — Plan

## 소유
| 트랙 | 경로 |
|---|---|
| BE | `backend/app/services/upload_progress_service.py`, `upload_status_service.py`, `upload_status_overview_service.py`, `upload_member_service.py`, `backend/app/schemas/upload_status_overview.py`, `backend/tests/sdd267/**` |
| 문서 | `specs/sdd-267-final-pending-label/**` |
| FE | `frontend/src/**`, `frontend/tests/**` (contract.md 만 본다) |

## BE Task (TDD, RED 먼저)
| # | Task | 검증 |
|---|---|---|
| P1 | `upload_progress_service`: 상수 `FINAL_PENDING_AFTER_END_SEC=180`, `ParticipantProgress.final_pending: bool=False`, `ParticipantCounts.final_pending: int=0`, `build_participant_progress` 에서 D2 계산, `_count_states` 가산 | 순수 단위 시험(경계 표) |
| P2 | 상세 ETag: `_progress_time_key` 에 `since_end>=N` 불리언 추가 | ETag 시험 |
| P3 | 목록: items[]·최상위는 `aggregate/merge` 로 자동 전파 확인 | 목록 시험 |
| P4 | 회원 목록: `MemberSessionItem.final_pending` | 회원 시험 |
| P5 | contract.md 갱신, SDD-261~266 회귀, PG 스모크 | 실행 수치 |

## 구현 메모
- `final_pending` 은 state 계산과 독립 헬퍼 `_final_pending(inp, feature, raw)`; state 분기 불변.
- 수신 판단은 기존 `Component` 값 재사용. 기대량 미보고(any None)·`excluded`·`raw_failed>0` 이면 False.
- 캐시 TTL 변경 없음(종료 30분 내 10초 → 경계 지연 ≤10초, 허용).
