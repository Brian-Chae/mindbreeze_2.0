# SDD-308 3차 — 독립 잠금 지도와 교착 분석

- 감사 기준: `76b1f0c3`, 구현 전 정적 조사. 아래 줄 번호는 이 기준 커밋의 `backend/` 상대 경로다.
- 범위: live v2 command, metric/device ingest, REST 입장/제거, projector, presence/heartbeat, 이들이 호출하는 공통 잠금 함수.
- 서버 접근·부하 시험 없음. dev 표본은 제공된 `v100-deadlock-sample.txt`만 읽었다. 표본의 PID를 요청 종류에 대응시키는 전체 PG statement 로그가 없어 **252건 전체의 개별 호출 쌍 확정은 불가**. 아래 고리는 코드와 SQL로 확인한 재현 가능한 후보이며 로컬 실행 증거는 별도 시험 결과로 확정한다.

## 1. 잠금 모드

`U` = FOR UPDATE, `N` = FOR NO KEY UPDATE, `K` = FOR KEY SHARE, `W` = 일반 UPDATE(비키 컬럼은 통상 N), `I→K` = INSERT FK 검사로 부모 행 K.

실제 설치된 SQLAlchemy PostgreSQL dialect로 컴파일 확인:

```sql
-- with_for_update(key_share=True)
SELECT sessions.id FROM sessions FOR NO KEY UPDATE
-- with_for_update(key_share=True, read=True)
SELECT sessions.id FROM sessions FOR KEY SHARE
```

`session_live_commands.py:213-216` 주석의 KEY SHARE 설명과 실제 SQL은 다르다. `class_write_service.py:36-44`는 같은 옵션을 정확히 NO KEY UPDATE로 설명한다. N은 K와 호환되지만 N끼리 충돌한다. U는 K와도 충돌한다.

## 2. 공통 잠금·FK

| 경로 | 실제 획득 순서 | 근거 |
|---|---|---|
| `lock_users` | users N, UUID 정렬 | `app/services/class_write_service.py:36-44` |
| `lock_class_session` | users N → classes U → class_members U(정렬) → 해당 클래스의 **모든 sessions U**(정렬) | `app/services/class_write_service.py:1069-1093` |
| `lock_context` | 클래스 있으면 위 순서, 없으면 sessions U → session_participants U(정렬) | `app/services/class_participation_service.py:16-26`, `class_attendance_service.py:19-20` |
| `lock_epoch` | epoch INSERT ON CONFLICT DO NOTHING(신규이면 sessions FK K) → live_session_epoch U | `app/services/session_live_ledger.py:76-84` |
| `append_outbox` | epoch.revision W 예약 → live_outbox INSERT 예약; flush 시 sessions FK K | `app/services/session_live_ledger.py:125-136` |
| `insert_entry` | live_command_ledger INSERT + flush → sessions FK K | `app/services/session_live_ledger.py:139-151` |
| live_outbox/ledger/epoch FK | 모두 sessions.id 직접 참조. outbox에서 epoch로 향하는 FK는 없음 | `app/models/live_state.py:35-37,62-64,97-99`, `alembic/versions/e246a0301001_live_command_ledger.py:23-71` |
| capture_stream INSERT | sessions 및 session_participants FK K | `app/models/live_state.py` CaptureStream FK 정의 |

관련 migration 전체 검색에서 live_outbox/epoch 사용자 정의 트리거는 발견하지 못했다. 따라서 표본의 `INSERT INTO live_outbox`가 sessions 잠금을 기다리는 것은 **sessions FK 검사만으로 설명 가능**하다. 실제 dev DB 트리거 카탈로그는 조회하지 않았다.

## 3. apply_command — kind별 지도

모든 명령은 마지막에 ledger INSERT/flush(sessions FK K), commit을 공유한다(`session_live_commands.py:274-282`). outbox를 내는 명령은 epoch W + outbox INSERT(sessions FK K)도 공유한다.

| kind | 구현 전 순서/변경 | handler 근거 |
|---|---|---|
| entry.enter | users N → classes/class_members/sessions U → epoch U → participant U → sessions participation_version W → outbox/ledger | `session_live_commands.py:192-222`; `class_participation_service.py:315-334`; `class_attendance_service.py:104` |
| entry.leave | epoch U → participant U → lease DELETE → sessions participation_version W(lease 존재 시) → outbox/ledger | `class_participation_service.py:337-352` |
| waiting.set_ready | epoch U → participant U → outbox/ledger | `class_participation_service.py:356-382` |
| waiting.remind | epoch U → participant 일반 SELECT → ledger; 알림은 commit 후 | `class_participation_service.py:385-407` |
| waitlist.cancel | epoch U → participant U/W → 다른 대기 participant W → outbox/ledger | `class_participation_service.py:421-434`; `session_service.py:2652-2659,1654-1661` |
| waitlist.promote | epoch U → participant U/W → 다른 대기 participant W → outbox/ledger | `class_participation_service.py:438-451` |
| hand.set/hand.lower/speaking.set | epoch U → participant U/W → outbox/ledger | `class_participation_service.py:457-515` |
| signal.send/signal.clear | epoch U → participant U → outbox/ledger | `class_participation_service.py:549-587` |
| audio.set | epoch U → outbox/ledger; sessions 읽기만 | `class_participation_service.py:594-620` |
| chat.set_enabled | epoch U → sessions.chat_enabled W → outbox/ledger | `class_participation_service.py:624-639` |
| session.open/start/end/cancel | **epoch U → users N → classes/class_members/sessions U** → sessions 상태 CAS W; end/cancel은 capture stream U/W 추가 → outbox/ledger | `class_participation_service.py:656-680,715`; `session_service.py:1168-1184`; `session_live_commands.py:492-500` |
| capture.start | sessions N → epoch U → participant U → 기존 capture streams U/W → 신규 stream INSERT(FK K) → outbox/ledger | `session_live_commands.py:211-216,361-401` |
| capture.renew | sessions N → epoch U → capture stream U/W → ledger(renew 자체 outbox 없음) | `session_live_commands.py:335-342,425-443` |
| capture.close/reanchor | sessions N → epoch U → capture stream U/W → outbox/ledger | `session_live_commands.py:404-422,446-468` |

`_own`/`_target`의 participant U는 `class_participation_service.py:222-252`이다. `_require_host`, `_is_speaking_manager`, `validate_instructor`는 조회·인가이며 class/users 행 잠금을 추가하지 않는다. 등록된 handler 중 class/users를 epoch 뒤에 잡는 경로는 entry.enter(이미 선잠금 있음)와 session 전이 4종이다. 후자는 선잠금 집합에서 빠져 있다.

## 4. 다른 실행 경로

| 경로 | 순서/실제 변경 | 근거 |
|---|---|---|
| live metric | participant/stream 일반 SELECT 후 rollback → epoch U → outbox INSERT(sessions K) + epoch W → commit | `live_ingest_service.py:148-214,350-369` |
| live device | stream 일반 SELECT → epoch U → stream refresh → outbox INSERT(sessions K) + participant band 필드 W → commit | `live_ingest_service.py:376-421` |
| REST feature batch | participant/stream 일반 SELECT → feature INSERT와 FK → commit; epoch 안 잡음 | `live_ingest_service.py:225-308` |
| REST join | 클래스이면 users N → classes/member/sessions U → participant W + sessions W → commit → 별도 participant_changed | `session_service.py:1959-1983` |
| REST enter | 반복 클래스이면 users N → classes/member/sessions U → 초대/동의/participant 변경; 비클래스 정원 보호 sessions U → participant 변경 → commit | `session_service.py:2187-2190`; `_lock_session_for_capacity:1632-1641` |
| REST remove_participant | 클래스이면 users N → classes/member/sessions U → epoch U → participant W → stream U/W + outbox → commit | `session_service.py:1837-1869`; `class_participation_service.py:770-815` |
| v1 participation snapshot/socket heartbeat/expire | lock_context → participant U → leases INSERT/UPDATE/DELETE, participant W, sessions participation_version W → commit; epoch 없음 | `class_participation_service.py:75-148` |
| v2 live:presence | Redis hash/expire만, PG 행 잠금 없음 | `ws/session_live_namespace.py:2315-2343` |
| seed_live_state | 기존 seed 있으면 SELECT+rollback; 처음만 epoch U → outbox INSERT(sessions K) → commit | `class_participation_service.py:727-767` |
| protocol pin | epoch U → ledger INSERT(sessions K) → commit/호출자 commit | `session_live_legacy.py:123-149` |
| 보통 projector drain | Redis fence → outbox processed_at W 후 commit → outbox/epoch SELECT → rollback → Redis projection → processed_at W+commit 반복. sessions/epoch 행 락 없음 | `session_live_outbox.py:92-104,256-315` |
| projector 초기 epoch 생성 | lock_epoch → commit | `session_live_outbox.py:81-89` |
| Redis 재구축 | Redis rebuild fence → epoch U → epoch 값 W(필요 시) + outbox SELECT → commit → Redis 복원 → processed_at W | `session_live_outbox.py:163-225` |
| publish_pending | coalesced drain 후 rollback → Redis emit-lock → outbox SELECT → 방송 → Redis watermark → rollback | `class_participation_service.py:961-998` |
| heartbeat self-heal | 프로세스 coalescing → publish_pending(위 경로) → Redis heartbeat | `ws/session_live_namespace.py:1981-1995,2360-2362`; `live_single_flight.py:39,70` |

## 5. 교착 고리와 증거 수준

| 고리 | A 보유 → 대기 | B 보유 → 대기 | 판정 |
|---|---|---|---|
| outbox FK 역순 | device/metric: epoch U → sessions FK K | entry.enter/REST remove: sessions U → epoch U | 코드로 고리 확인. dev 표본의 epoch SELECT / outbox INSERT와 일치; PID별 호출 종류 미확정 |
| sessions UPDATE 역순 | chat/entry.leave: epoch U → sessions W(N) | capture: sessions N → epoch U | 코드로 고리 확인. FK만 수정해도 남을 수 있음 |
| 클래스 전이 역순 | session.open/start/end/cancel: epoch U → users/classes U/N | entry.enter: users/classes/sessions U/N → epoch U | 코드로 고리 확인. 고빈도 경로만 고치면 종료/전이 시 남음 |
| v1 presence 결합 | device: epoch U → participant W / outbox sessions K | presence: sessions U → participant U | device가 participant를 먼저 가졌고 presence가 sessions를 먼저 가지면 outbox flush 순서에 따라 참가자·sessions 고리 가능; 공통 sessions 선잠금이 예방 |

제공된 dev 샘플은 28331 ↔ 28357 등 sessions/epoch 2자 및 tuple-lock 대기열을 포함한 3자 그래프를 보여 준다. 표본만으로 252건 전부가 동일 종류라고 단정하지 않는다.

## 6. 최소 수정 의견

1. `lock_epoch`의 최초 연산으로 sessions **N**을 확보하여 모든 epoch writer의 순서를 `sessions N → epoch U`로 통일한다. N은 일반 sessions UPDATE와 같은 강도로 승격 고리를 없애면서 FK K와 공존한다. epoch의 기존 직렬화·revision·ledger/outbox 원자성은 유지한다.
2. class를 잡는 entry.enter와 session.open/start/end/cancel은 **users → classes → class_members → sessions U**를 공통 epoch 진입 전에 확보한다. class 잠금 이후의 sessions N 재획득은 강도 약화가 아니므로 기존 U를 유지한다.
3. capture 전용 선잠금은 공통 함수로 이동하고 잘못된 KEY SHARE 주석을 정정한다. `lock_epoch_if_v2`의 epoch→class 주석도 정정한다.
4. 실제 KEY SHARE만을 공통 선잠금으로 쓰면 sessions UPDATE 명령이 epoch 이후 N으로 승격하고, capture/REST가 반대 순서를 만드는 위험이 남는다. 모든 sessions 잠금을 U로 강화하면 feature INSERT의 FK K까지 막으므로 N이 더 작다.
5. outbox flush를 끝으로 미뤄도 epoch를 계속 쥔 채 FK를 검사하므로 역순은 사라지지 않는다. optimistic/advisory 설계는 revision·멱등·fencing·방송 계약 재설계가 필요하므로 이번 최소 수정에서 제외한다.

검증 한계: 본 문서 작성자는 읽기 전용 코드 감사와 dialect SQL 컴파일만 수행했다. PG 동시 재현, 로컬 100명/40명 수치, 실제 HTTP·Socket.IO 동작은 별도 검증 담당 결과를 따라야 한다.
