# SDD-308 evidence — 잠금 순서 반대 구간 (항목 2)

로컬 PG16 임시 DB에서 50·40스레드 교차 시험으로 재현했다(`backend/tests/sdd308/test_s2_lock_order.py`). 운영·dev 접근 없음.

## 통일한 순서
**epoch 행(v2 회차만) → 클래스/회차 행(`lock_class_session`) → 참가자 행 → 스트림 행**

## 정독 결과 (경로별)
| 경로 | 수정 전 순서 | 반대 구간 | 조치 |
|---|---|---|---|
| REST 입장 `_enter_resolved` | 클래스·회차 `FOR UPDATE` → 참가자 | 기준 순서 | 변경 없음 |
| live 명령 `entry.enter` (`_h_entry_enter`) | epoch → **참가자 `FOR UPDATE`** → (mark_entered) 회차 `UPDATE` | **있음(사실)**: 참가자→회차. REST 입장은 회차→참가자 | `lock_class_session`을 참가자 잠금 앞에 추가 |
| `remove_participant` + `emit_participant_removed` | 참가자 `UPDATE` → epoch 잠금 | **있음(사실)**: 참가자→epoch. 명령은 epoch→참가자 | v2 회차는 epoch를 먼저 잠금(`lock_epoch_if_v2`) |
| `capture.*` (`apply_command`) | 회차 `KEY SHARE`(SDD-285) → epoch → 참가자 → 스트림 | 없음(SDD-285에서 정리) | 변경 없음 |
| `ingest_device` | 스트림 읽기(무잠금) → epoch → `refresh(stream)` | 없음 — 읽기만 한 뒤 epoch를 잡고 상태를 재확인 | 변경 없음(재확인 로직 보존) |
| `_project_latest` | epoch 단독 | 없음 | 변경 없음 |
| `seed_live_state` | (수정 전) epoch 단독 | 없음 | ①에서 선확인 추가 |
| `pin_session_protocol`, `session_live_outbox` | epoch 단독 | 없음 | 변경 없음 |

## 재현 수치 (수정 전 → 후, 3회 반복)
| 시험 | 수정 전 교착 | 수정 후 교착 |
|---|---|---|
| V-2-2 REST 입장 25 + entry.enter 25 동시 | 24, 24, 25건 (`UPDATE sessions SET participation_version` 등에서 DeadlockDetected) | 0, 0, 0 |
| V-2-1 remove_participant 20 + entry.enter 20 동시 | 19, 20, 20건 | 0, 0, 0 |

## 확인 못 한 것
- dev 서버 실부하(100명)에서 같은 수치가 나오는지는 감독 재측정 몫.
- `lock_class_session`은 비반복 클래스(`recurrence_rule` 없음) 회차도 클래스 행을 잡는다. 기존 `_enter_resolved`가 반복 클래스에서만 잡는 것과 달리 `entry.enter`는 `class_id`가 있으면 항상 잡는다 — 회차 단독(클래스 없음)은 영향 없음.
