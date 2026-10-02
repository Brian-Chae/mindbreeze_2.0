# SDD-101 — 라운드 2 종합 (v3 최종 계획)

> 라운드 1(카탈로그 검증) → 라운드 2(전략·SDD 분할 검증) 수합 결과.
> Claude/Codex/Cursor 3자 공통 지적을 우선 반영. [검증됨] = Supervisor 소스 재확인.

---

## 1. 라운드 2에서 확정된 설계 정정 (v2 → v3)

### 정정 1. BUG-1 수정 방향 반전 — "import 추가"가 아니라 "소유권을 finalize로 이전" (Claude D-1 + Codex, 2자 공통)
- v2의 "stop_recording에 import 추가"는 **리그레션**: `/audio/stop`이 `[stt,summary]`를 비동기 적재하고, 직후 `/end`가 `[merge,reports]`를 별도 체인으로 적재 → **리포트가 요약 완료 전에 생성**(partial 리포트).
- **v3**: 파이프라인 발행을 `finalize_on_session_end` **1곳**으로 이전.
  - `stop_recording`은 `recording_ended_at` 기록 + `processing` 마킹**만**(발행 안 함).
  - `finalize_on_session_end`의 `has_recording`을 `record.status in ("recording","processing") and recording_ended_at is not None`으로 확장 → 단일 정렬 체인 `[merge → stt → summary → reports]`.
  - 운영 경로의 인라인 동기 폴백 제거(종료 API 지연 재발 방지).

### 정정 2. CAS는 `status IN (:allowed)` predicate로 (Claude D-2)
- `AND state_version=:v`는 불필요·해로움(클라이언트가 버전을 안 보냄 → spurious 409). 순수 전이 가드는 `status IN (:allowed)` 충분.
- `rowcount==0` → rollback + **409** + finalize·알림 전부 생략. `rowcount==1` → commit(락 해제) 후 finalize.
- `join_session` 직접 대입 제거 시 그룹 start 가드(active≥1)로 host 단독 start 회귀 주의 → join 경로 전용 가드 완화.

### 정정 3. 청크 멱등은 스키마 선행 — `recording_id` + checksum + unique (Claude D-4 + Codex #3)
- 콘텐츠 해시 dedupe만으론 부족. 현재 `AudioChunk`/`VideoChunk`는 unique·checksum 없음(`record.py:46-71`; `EEGRawChunk`만 `UniqueConstraint + checksum` 보유).
- **v3**: 녹화 실행 원장(`recording_id`) 발급 + `UNIQUE(recording_id, chunk_index)` + 서버 계산 checksum. EEGRawChunk 패턴 재사용. 기존 데이터 마이그레이션(중복 조사·격리) 필수.

### 정정 4. 수신 마감 vs 후처리 시작 분리 + 지각 청크 유예 (Claude D-3 + Codex #4)
- `save_chunk`는 `recording/processing` 아니면 400(`audio_service.py:99-100`, `video_service.py:83-84`) → 워치독 마감 후 재전송이 영구 400.
- **v3**: 종료 요청에 `recording_id + expected_count` 전달, 서버가 누락 인덱스(0..N-1 차집합) 반환. 누락 시 수신 유예 유지·후처리 미발행. 마감 후 지각 청크 수용 윈도우(예: ended_at+N분) 설계.

### 정정 5. `merge_failed`가 재병합 후보가 되도록 (Claude D-5 + Codex #3)
- `video_merge_needed`는 `video_status != "completed"`면 False(`video_service.py:221-222`) → `merge_failed` 마킹 시 영구 재병합 불가.
- **v3**: `video_merge_needed`가 `("completed","merge_failed")` 모두 후보로 + 리포트 `video.integrity`(기대 vs 실제 청크 수) 필드.

### 정정 6. S4는 기존 SDD-100 확장 (Codex #4, [검증됨])
- **이미 존재**: `sweep_stale_open_sessions`(`session_service.py:785-822`, `celery_app.py:35`)가 `open` 방치 24h 세션을 `transition_status('cancel')` 재사용으로 취소.
- **v3**: 이를 `in_progress`/`recording` 고아로 확장. 탐지(아웃오브밴드)와 재처리(워커) 분리. 활동 신호는 `last_activity_at`(throttle) + 미디어 수신 시각과 호스트 생존 신호 구분(무녹화·밴드 미착용 오판 방지).

### 정정 7. outbox는 기존 NotificationOutbox 재사용 (Claude R-1)
- `NotificationOutbox` + `process_email_outbox`가 이미 존재. 신규 발명 대신 재사용/일반화.
- "유실 방지(outbox)" vs "유실 후 복구(워치독 재트리거)"는 **MVP에서 택1**(중복 투자 방지).

---

## 2. SDD 분할 v2 (라운드 2 반영, 의존 순서 정렬)

| # | 카드 | 범위 | 선후 관계 |
|---|---|---|---|
| 101-1 | 종료 파이프라인 단일화 | 정정1(소유권 이전), outbox(재사용), 운영 인라인 폴백 제거 | **최우선 단독** |
| 101-2 | 상태 전이 원자성 | CAS(정정2), join 우회 제거, cancel finalize | 101-1 이후 (직렬) |
| 101-3 | 청크 신뢰성·멱등 | recording_id+checksum+unique(정정3), 영속 재시도 큐, 수신 마감(정정4), merge_failed 재병합(정정5), 오디오 stop in-flight | 101-1/2와 병렬 가능, **스키마 마이그레이션 선행** |
| 101-4 | 고아 복구 워치독 | last_activity_at, SDD-100 확장(정정6), 아웃오브밴드 탐지 | 101-1/2/3 이후 |
| 101-5 | 모니터링·리포트 실패 상태 | generation `failed` 계약 + liveness 감시 + WS Redis manager | **101-4 이전에 terminal 상태 정의** |
| 101-6 | 예외 UX | 복구 배너/CTA, generation failed 상태머신 개편, 공용 ErrorState | 최후 |

**누락 보완**: 청크 스키마 마이그레이션(101-3 안에 명시), `last_activity_at` 마이그레이션(101-4 안에), Socket.IO Redis manager(101-5 선행 과제로 승격).

**MVP (Codex 권고)**: **101-1 + 101-2 + 101-3** (+ 101-6의 필수 종료복구: 저장 미완료 표시·누락 재전송·종료 실패 복구). 101-4/5/나머지 101-6은 후속. (단, "무인 자동 마감까지" 요구 시 101-4도 필수.)

---

## 3. UX 완결성 보완 (Cursor 라운드 2)

1. **정상 종료 후 `/record` 즉시 이탈**(라운드1 치명#4)이 S5에서 누락 → 플레이어 종료 씬 N초 체류 vs 즉시 이탈을 Brian 결정 + failed 배지 노출 장소 확정.
2. **generation `failed`는 계약만 아니라 상태머신 개편 필수**: `resolveReportGenerationStatus`(pending 폴백), `isReportGenerationDone`(`ready|partial`), `useReportProgress`(폴링 중단·완료 토스트), `ReportProgressStepper`(카피·재시도 버튼), `REPORT_GENERATION_LABELS` — 5개 지점 동시 변경.
3. **end 실패 복구**: `liveKit.disconnect()`가 end 전이므로, 실패 시 (a)녹화·LiveKit 재개 (b)미디어 정지 유지·종료 재시도 (c)새로고침 중 결정 필요.
4. **공용 ErrorState/EmptyState**: 배너 4종이 인라인 복제로 쌓이지 않도록 최소 1종 페이지 상단 복구 배너 슬롯 규약.
5. **회원(게스트) 측 고아 재접속 안내**(호스트 부재) — 라운드1 리스크9 미반영.

---

## 4. Brian 결정 사항 (3자 수렴, 라운드 2 통합)

1. **자동 마감 정책**: 고아/강제종료 세션 유예 시간·종료 상태(completed vs cancelled). 취소 시 수집 데이터 보존 vs 폐기(전체 end 체인 연결 여부).
2. **누락 산출 정책**: "누락 숨긴 정상 완료" 금지 → 부분 산출에 누락 표시. 허용 누락 범위·부분 리포트 자동 제공·복구 기한(예: ended_at+N분).
3. **배포 토폴로지**: API/Celery 공유 영속 저장소 여부(오디오 S3 전환 연기 가능성), API 프로세스 수(WS Redis manager 우선순위), 아웃오브밴드 워치독·outbox 발행기 운영 주체.
4. **MVP 강제종료 복구 수준**: "재접속 시 복구"만(=101-4 생략 가능) vs "무인 자동 마감"까지(=101-4 필수).
5. **정상 종료 후 네비게이션**: `/record` 즉시 이동 vs 플레이어 종료 씬 N초 체류.
6. **outbox vs 워치독 재트리거 택일** (발행 유실 대응 단일화).
