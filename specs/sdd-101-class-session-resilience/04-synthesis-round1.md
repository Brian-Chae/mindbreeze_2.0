# SDD-101 — 라운드 1 종합 (3-way 교차 리뷰 수합)

> 리뷰: Claude(백엔드·보안) / Codex(구현·API) / Cursor(UX·프론트). 원문은 `/tmp/sdd101-review-*.md`.
> Supervisor(직접 소스 검증)로 확인한 항목은 **[검증됨]** 표기.

---

## 1. 검증 완료된 치명 결함 (Supervisor가 소스로 재확인)

### 🔴 BUG-1. `stop_recording`의 `stt_task`/`summary_task` NameError → STT/요약이 항상 동기 실행 (Codex 발굴, [검증됨])
- `backend/app/services/audio_service.py:149-150`에서 `stt_task.si(...)`/`summary_task.si(...)` 참조.
- 그러나 모듈 상단(15-16행)은 `from app.tasks.stt_task import run_stt_inline`, `from app.tasks.summary_task import run_summary_inline`만 import. `stt_task`/`summary_task` **미정의**.
- 결과: `/audio/stop` → `stop_recording`의 Celery chain 시도가 `NameError`로 즉시 실패 → `except`(153행)에서 `run_stt_inline`+`run_summary_inline` **동기 실행**.
- **영향**: 종료 흐름에서 `/audio/stop`이 STT(Whisper)+요약(LLM)을 동기 대기 → 종료 버튼 지연. 영상 병합과 동일한 종류의 잠복 버그(아직 미해결).

### 🔴 BUG-2. `join_session`이 상태머신·state_version·finalize 우회 (Claude 발굴, [검증됨])
- `backend/app/services/session_service.py:1142-1144`: `s.status = "in_progress"` 직접 대입.
- TRANSITIONS 검증·`state_version+1`·`_notify_session_state`·finalize 모두 미실행 → SDD-026 상태 계약 깨짐.

### 🔴 BUG-3. 동시 상태 전이 경합 — 행 잠금/CAS 부재 (Claude D-4 + Codex #7, 2자 공통)
- `transition_status`(726-750): read→검증→대입→`state_version+1`(read-modify-write)→commit, `SELECT FOR UPDATE`/조건부 UPDATE 없음.
- 동시 `end` 2건 → finalize·체인 2회 적재(리포트 중복, 영상 중복 병합) + lost update.

### 🔴 BUG-4. `cancel`이 미디어·기록 미마감 → 정규 고아 (Claude D-2 + Codex 위험5, [검증됨])
- finalize는 `action == "end"`에서만 실행(758행). `cancel`은 `in_progress`/`paused`에서도 허용(TRANSITIONS 35행).
- 녹화 중 취소 → record.status `recording` 고착 + 병합·STT·리포트 체인 미적재 + `recording_ended_at` 미설정으로 스윕에도 안 걸림.

### 🔴 BUG-5. 영상 병합 "부분 실패"가 잘린 영상을 성공 처리 (Claude R-4 + Codex #5, [검증됨])
- `video_service.py` 병합에서 `_load` 실패 시 `data=None`으로 건너뛰고 `next_idx`가 멈춰 뒤 정상 청크까지 누락.
- 그 불완전 파일로 `video_s3_key`까지 설정 → 리포트는 "완료+키 없음" 또는 "잘린 영상" 모순.

---

## 2. 카탈로그 정정 (Codex #8, [검증됨])

| 항목 | 브리프(오기) | 정정 |
|---|---|---|
| C1 STT 정체 | "감지 없음" | `sweep_stale_reports` 2단계가 `record.status='processing'`+`recording_ended_at`으로 **STT/요약 정체도 이미 감지** |
| C2 타임아웃 | "300초 주기" | 스윕 주기 300초, 실제 타임아웃 기준은 **30분** |
| C3 STT 실패 | "completed+reason" | STT 실패는 `failed`. `completed+reason`은 저신뢰/요약실패 분기 |
| D1 disconnect | `useBand.ts:828-864` | 명시적 `disconnect()`. 실제 연결 유실 콜백은 `988-995`이며 `drainPendingQueue` 미호출 |

---

## 3. 그 외 주요 리스크 (권고)

1. **워치독이 Celery 위에 있음** (Claude R-3 + Codex 위험6): `sweep_*`도 `@shared_task`로 동일 워커 풀 소비 → "워커 다운" 상황에선 스윕도 못 돎. → **아웃-오브-밴드 모니터 필수**(systemd timer/`celery inspect ping`/큐 깊이 폴링).
2. **finalize 예외 삼킴** (`except Exception: pass`, 764/769행): 세션은 completed, 파이프라인은 전무(무음·무추적). `generation_started_at` 선기록 + `finalize_error` 마킹 필요.
3. **오디오 청크가 `/tmp` 로컬 저장** (Claude R-6): `CHUNK_STORAGE_DIR=/tmp/mindbreeze_audio`(20행). 멀티호스트/재부팅 시 STT가 파일 못 찾음.
4. **WS 상태가 프로세스-로컬** (Claude R-7): `_audio_states` 등 dict가 단일 프로세스 가정. 멀티워커/수평확장 시 비전파.
5. **pendingRef 재시도의 인덱스 정합성** (Codex #2): Blob만 저장(인덱스 없음), 재전송 시 서버가 새 UUID 행 생성 → 중복. `{recordingId,index,blob,checksum,attempts}`+서버 멱등 필요.
6. **sendBeacon 신뢰성 한계** (Codex #6): 크래시 보장 없음, Bearer 헤더 불가, 0.75MB keepalive 한도 초과 → "보조 신호"로만 사용.
7. **리포트 `generation_status` 최상위 `failed` 부재** (Cursor #5): `pending|processing|ready|partial`뿐 → "처리 중" 무한 정지.
8. **정상 종료 후 기록 페이지 즉시 이탈** (Cursor #4): 실패 고지 기회 구조적 부재.

---

## 4. 대응 전략 v2 (라운드 1 반영)

### S1. 종료 파이프라인 정합성·비동기화 (신설, 최우선)
- **BUG-1 수정**: `stop_recording`에 `stt_task`/`summary_task` import 추가 → STT/요약 진짜 비동기화.
- **finalize 책임 단일화**: `/audio/stop`과 `/end`의 이중 finalize 경로를 정리(실행 주체 1개로).
- **finalize 예외 마킹**: `except pass` → `logger.exception` + `finalize_error`/`generation_started_at` 선기록.
- **outbox 패턴**: 세션 완료 commit과 태스크 발행을 원자화(프로세스 사망 시 유실 방지).

### S2. 상태 전이 원자성·일원화
- **BUG-2/3 수정**: `transition_status`를 조건부 UPDATE(`WHERE status IN (:allowed) AND state_version=:v`, rowcount 0이면 409)로. `join_session` 직접 대입 제거.
- **BUG-4 수정**: `cancel` 시에도 finalize(미디어·기록 마감) 실행.

### S3. 업로드·청크 신뢰성
- **BUG-5 수정**: 병합 누락 시 `video_status='merge_failed'` 명시 + 리포트 `integrity`(기대 vs 실제 청크 수).
- pendingRef → 영속 재시도 큐(IndexedDB) + `{recordingId,index,blob,checksum}` + 서버 멱등(콘텐츠 해시 dedupe).
- 청크 연속성 계약(종료 요청에 마지막 인덱스/예상 수 포함, 서버가 누락 인덱스 반환).
- 오디오 `stop()` in-flight 대기 + 공통 업로드 큐.
- (R-6) 오디오 청크 S3 일원화.

### S4. 세션 고아 복구 워치독 (아웃-오브-밴드)
- **신규 영속 컬럼** `Session.last_activity_at`(청크 저장·feature 수신 시 갱신).
- 하트비트 경과(예정 종료+유예) 탐지 → 자동 마감(completed/cancelled) + 보유 청크 병합·리포트.
- **Celery 밖에서 실행**(systemd timer/CronJob) — 워커 다운에도 동작.

### S5. 비동기 파이프라인 모니터링 + 예외 UX
- 아웃-오브-밴드 워커 liveness 감시 + 실패 시 상담사 알림.
- 리포트 `generation_status`에 `failed` 추가 + 실패 배지·재시도.
- (R-7) WS 멀티워커 정합(Socket.IO Redis manager) 확인.
- 프론트: 강제종료 재접속 복구 배너, `end` 실패 복구 CTA, 업로드 실패 재시도/무녹화 CTA, 밴드 끊김 토스트.

---

## 5. SDD 분할 제안 (v1 — 라운드 2에서 검증)

| 카드 | 범위 | 심각도 |
|---|---|---|
| SDD-101-1 종료 파이프라인 정합성 | BUG-1, finalize 단일화, 예외 마킹, outbox | 🔴 |
| SDD-101-2 상태 전이 원자성 | BUG-2/3/4, 조건부 UPDATE, cancel finalize | 🔴 |
| SDD-101-3 업로드·청크 신뢰성 | BUG-5, 영속 재시도 큐, 멱등, 연속성 계약, 오디오 S3 | 🔴 |
| SDD-101-4 고아 복구 워치독 | last_activity_at 컬럼, 아웃오브밴드 워치독 | 🔴 |
| SDD-101-5 모니터링·리포트 실패 상태 | liveness 감시, generation failed, WS 정합 | 🟡 |
| SDD-101-6 예외 UX | 복구 배너/CTA, 토스트, 무녹화 안내 | 🟡 |

---

## 6. Brian 결정 사항 (3자 공통 수렴)

1. **자동 마감 정책**: 고아/강제종료 세션의 유예 시간(예: 예정 종료+N분)과 종료 상태(completed vs cancelled). 취소 시 수집 데이터 폐기 vs 보존.
2. **유실 산출 정책**: 누락을 숨긴 "정상 완료" 금지 → 부분 산출에 누락 표시. 허용 누락 범위·부분 리포트 자동 제공 여부.
3. **배포 토폴로지**: API/Celery 동일 호스트 여부, WS 단일 프로세스 여부 → R-6/R-7 선행 여부 결정.
4. **아웃-오브-밴드 모니터 채택**: 워커 liveness 감시를 인프라 중 무엇으로(systemd timer/Flower/큐 깊이).
