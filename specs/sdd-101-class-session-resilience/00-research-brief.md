# SDD-101 클래스 세션 복원력(Resilience) — 예외상황 기획 브리프

> **목적**: 클래스 세션 생명주기(개설→오픈→진행→일시정지→종료/취소) 전반에서 발생할 수 있는
> 예외상황을 전수 정리하고, 각각의 대응 전략을 설계하여 SDD 카드로 분할한다.
> 이 문서는 **연구 브리프**이며, 아래 "확정 사실"은 실제 소스 근거(파일:라인)에 기반한다.
> 멀티에이전트(Claude/Codex/Cursor) 3-round 교차 리뷰의 입력이 된다.

**레포 루트**: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0`

---

## 1. 배경

- 최근 영상 청크 병합이 세션 종료 API 응답 내에서 동기 실행되어 **종료 버튼이 수 분간 멈추는** 문제를
  발견·해결했다(병합을 Celery 비동기화 + 병렬/스트리밍 개선). 그 과정에서 확인한 사실:
  - 종료 파이프라인은 `[영상 병합] → [STT → 요약] → [리포트]` Celery chain으로 **서버 사이드 비동기**.
  - 청크 업로드는 녹화 중 **스트리밍**(3초/5초 단위)이고, 종료 시 `stop()`이 마지막 청크 flush + in-flight 대기를 수행.
- 그러나 **녹화 중 브라우저 강제종료(크래시·탭닫기 강행)** 시 마지막 청크 유실 + 세션 고아화를 자동 복구하는
  장치가 없고, 그 외에도 업로드 실패 버퍼링 미재시도, finalize 예외 삼킴 등 다수 갭이 존재한다.
- 본 기획은 이 갭들을 전수 식별하고 우선순위를 매겨 대응한다.

---

## 2. 확정 사실 (소스 근거)

### 2.1 세션 상태머신
`backend/app/services/session_service.py:24-36`
```python
ACTIVE_STATUSES = ("ready", "scheduled", "open", "in_progress", "paused")
TRANSITIONS = {
    "open":   ({"ready", "scheduled"}, "open"),
    "start":  ({"ready", "scheduled", "open"}, "in_progress"),
    "pause":  ({"in_progress"}, "paused"),
    "resume": ({"paused"}, "in_progress"),
    "end":    ({"in_progress", "paused"}, "completed"),
    "cancel": ({"ready", "scheduled", "open", "in_progress", "paused"}, "cancelled"),
}
```
- **`end`는 `open` 상태에서 불가능** — 오픈만 하고 시작 안 한 세션의 퇴로는 `cancel`뿐(주석 26-28행에 의도 명시).

### 2.2 종료 전이 구현
`backend/app/services/session_service.py:721-804`
- 액션/상태 검증 후 `s.status = target`, `state_version += 1`, `db.commit()`(739-751).
- `action == "end"` 시 `video_service.finalize_on_session_end` → `audio_service.finalize_on_session_end`
  호출이 **`try/except Exception: pass`로 감싸져 실패가 조용히 삼켜짐**(761-770).
- `_notify_session_state`(776), `_notify_participants_event`(797)는 best-effort.

### 2.3 상태 필드 타입
`backend/app/models/session.py:30`
```python
status: Mapped[str] = mapped_column(String(20), nullable=False, default="scheduled")
```
- **`status`는 enum이 아니라 자유형 `String(20)`** — 상태 유효성은 서비스 레이어 `TRANSITIONS`에서만 강제.

### 2.4 종료 파이프라인 (비동기 chain)
`backend/app/services/audio_service.py:170-236`
- `finalize_on_session_end`: record가 `recording`이면 `processing`으로 전환 후,
  `chain([병합?] → [stt, summary?] → [generate_reports])` 큐 적재.
- Celery 실패 시 **인라인 폴백**(218-236): 병합/stt/요약 인라인 + 리포트 동기 생성.
- 리포트 생성은 `generate_reports_for_session`(report_task.py), `video_s3_key`를 읽어 영상 리플레이 표시.

### 2.5 Celery beat 스케줄
`backend/app/core/celery_app.py:27-32`
```python
beat_schedule = {
    'cleanup-data-exports':    {'task': 'tasks.cleanup_data_exports', 'schedule': 60.0},
    'sweep-session-reminders': {'task': 'tasks.sweep_session_reminders', 'schedule': 300.0},
    'sweep-stale-reports':     {'task': 'tasks.sweep_stale_reports', 'schedule': 300.0},
}
```
- **세션 고아(강제종료로 남은 in_progress/recording)를 마감하는 워치독은 없음.**

### 2.6 녹화 업로드 (프론트)
- `frontend/src/hooks/useVideoRecorder.ts`
  - 3초 청크 스트리밍 업로드(61-76), 실패 시 `pendingRef` 버퍼링 **재시도·플러시 없음**(68-72),
  - `stop()`은 마지막 청크 flush + `Promise.allSettled([...inflightRef.current])` 대기(163-168).
- `frontend/src/hooks/useAudioRecorder.ts`
  - 5초 청크 `await uploadChunk` 순차 업로드(47-58), 실패 시 `pendingRef` 버퍼링 재시도 없음(53-57),
  - `stop()`은 `rec.stop()` + cleanup만, **in-flight 업로드 대기 없음**(88-94).

### 2.7 이탈 가드
`frontend/src/hooks/useLeaveGuard.ts:18-32`
- `beforeunload`(18-23) + `useBlocker`(29-32). `open/in_progress/paused`에서만 활성.
- 강행·크래시·기기 강제종료는 막을 수 없음.

### 2.8 종료 흐름 (프론트)
`frontend/src/pages/sessions/ClassPlayerPage.tsx:837-860`
- `finishSession` → `handleStop`(818-834: 오디오/비디오 stop) → `transitionSession('end')`.
- `videoRecorder.stop()`이 flush·대기 후 `end` 호출 → 청크는 `end` 이전에 전부 업로드 완료.

### 2.9 STT/요약 실패 마감
`backend/app/tasks/summary_task.py:198-228`
- 실패/저신뢰 시 `record.status = "completed"`, reason(`low_confidence`/`summary_failed`) 기록.

### 2.10 디바이스/기타
- `frontend/src/hooks/useWakeLock.ts:23-78` — 화면 wake lock, 실패·미지원 조용히 무시.
- `frontend/src/hooks/useBand.ts:828-864` — 밴드 disconnect 시 `drainPendingQueue` + 상태 reset.

---

## 3. 예외 시나리오 카탈로그

> 심각도: 🔴 Critical(기능 마비/데이터 유실) / 🟡 High(기능 저하) / 🟢 Medium(UX/경고)

### 카테고리 A — 세션 상태머신

| ID | 시나리오 | 현재 동작 | 갭/리스크 | 심각도 |
|---|---|---|---|---|
| A1 | 오픈만 하고 시작 안 한 세션 종료 | `end` 400, `cancel`만 가능(2.1) | 상담사 UX 혼란·"완료"로 남기려면 새로 시작해야 함 | 🟡 |
| A2 | status 자유형 String | 서비스 레이어 검증만(2.3) | DB 직접 조작/이관 시 무효값 유입 가능 | 🟢 |
| A3 | finalize 예외 삼킴 | `except Exception: pass`(2.2) | 종료 파이프라인 실패가 무음·추적 불가 | 🟡 |
| A4 | 종료 버튼 연타 | 2회째 `end` 400 | 이중처리는 보호되나 프론트 흔들림 가능 | 🟢 |

### 카테고리 B — 녹화/녹음 신뢰성

| ID | 시나리오 | 현재 동작 | 갭/리스크 | 심각도 |
|---|---|---|---|---|
| B1 | 녹화 중 강제종료(크래시/탭닫기 강행) | beforeunload 가드만(2.7) | 마지막 청크 유실 + 세션 고아화, **자동 복구 없음**(2.5) | 🔴 |
| B2 | 업로드 실패 시 버퍼링 | `pendingRef`에 push만(2.6) | 재시도·플러시 없음 → 정상 종료에도 청크 유실 | 🔴 |
| B3 | 오디오 마지막 청크 | `stop()`이 in-flight 미대기(2.6) | 비디오는 대기하나 오디오는 유실 가능 | 🟡 |
| B4 | getUserMedia 권한 거부/미지원 | recorder start 실패·에러 표시 | 대체 흐름(동의 재요청/무녹화 진행) 안내 부족 | 🟢 |
| B5 | 마이크 오프 세션 | AI 기록 제외, EEG/PPG/ACC 유지 | 설계 의도(확인 필요) | 🟢 |

### 카테고리 C — 비동기 파이프라인

| ID | 시나리오 | 현재 동작 | 갭/리스크 | 심각도 |
|---|---|---|---|---|
| C1 | Celery 워커 다운 | apply_async 성공(큐 적재), 워커 없으면 미처리 | 리포트 'processing'만 워치독 커버(2.5), 병합/STT 정체 감지 없음 | 🔴 |
| C2 | 리포트 생성 실패/타임아웃 | sweep_stale_reports(300s) 마감(2.5) | 커버됨(단, 주기 5분) | 🟢 |
| C3 | STT/요약 실패 | completed로 마감+reason(2.9) | 커버됨 | 🟢 |
| C4 | 영상 병합 실패 | 예외 로그만, video_s3_key 미설정 | 리포트 영상 리플레이 없음(조용한 실패) | 🟡 |

### 카테고리 D — BLE/LINK BAND

| ID | 시나리오 | 현재 동작 | 갭/리스크 | 심각도 |
|---|---|---|---|---|
| D1 | 밴드 연결 끊김(중간) | disconnect + drainPendingQueue + reset(2.10) | 세션 계속, 상담사 인지·재연결 안내 부족 | 🟡 |
| D2 | Web Bluetooth 미지원(Safari/Firefox) | 미지원 감지 | 안내 UX 존재(기설계, 재확인) | 🟢 |
| D3 | 밴드 미착용(opt-in) | EEG 기능 가드 | 설계 의도(확인) | 🟢 |

### 카테고리 E — 네트워크/실시간/기타

| ID | 시나리오 | 현재 동작 | 갭/리스크 | 심각도 |
|---|---|---|---|---|
| E1 | Socket.IO 끊김 | useSessionLiveSocket 재연결 | 커버(재확인) | 🟢 |
| E2 | LiveKit 연결 실패 | catch 처리 | 커버(재확인) | 🟢 |
| E3 | WakeLock 상실/화면 꺼짐 | visibilitychange 재요청(2.10) | 백그라운드 탭 녹화 지속 여부 미검증 | 🟢 |
| E4 | 리포트 메일 발송 실패 | email worker(별도 systemd) | 워커 미가동 시 미발송(재확인) | 🟡 |

---

## 4. 대응 전략 초안 (SDD 분할 제안)

> 리뷰 라운드에서 우선순위·범위를 검증 후 확정한다.

### S1. 세션 고아 복구 워치독 (핵심)
- 강제종료로 남은 `in_progress`/`recording` 세션을 주기적으로 탐지·마감.
- 탐지 기준: `started_at` 이후 일정 시간(예: 예정 종료 시각 + 유예) 경과 & 하트비트 없음.
- 마감 시: 상태를 `completed`(또는 `cancelled`)로 전이 + 보유 청크로 병합·리포트 트리거.
- 프론트: `beforeunload`에서 `navigator.sendBeacon`으로 종료 신호 + 마지막 청크 flush 시도.

### S2. 업로드 신뢰성 (pendingRef 재시도/플러시)
- `pendingRef` 실패 청크를 재시도 큐로 전환(백오프 + 상한), `stop()`/종료 시 플러시.
- 오디오 `stop()`도 비디오처럼 in-flight 대기(`Promise.allSettled`).

### S3. 상태머신 견고화
- `open` 상태 종료 경로 정리(오픈→종료를 `cancel`로 명시하거나 `end` 허용 + UX 안내).
- finalize 예외를 삼키지 말고 로깅 + 진행상태 `failed` 마킹.
- `status`를 enum/검증 계층으로 강화(선택).

### S4. 비동기 파이프라인 모니터링
- 병합/STT/리포트 task 지연·실패 감지 워치독(기존 sweep 확장).
- 실패 시 상담사 알림(리포트에 "처리 실패" 배지 + 재시도 버튼).

### S5. 디바이스/네트워크 예외 UX
- 밴드 연결 끊김 토스트 + 재연결 가이드, BLE 미지원 안내 통일.

---

## 5. 미해결 질문 (Brian 결정 필요 후보)

1. 강제종료 세션의 자동 마감 정책: 유예 시간(예: 예정 종료 + N분)과 종료 상태(`completed` vs `cancelled`).
2. 데이터 유실 우선순위: "유실 방지(복잡·비용)" vs "유실 시 명확한 실패 표시(단순)" 중 어느 쪽을 우선?
3. 본 기획의 구현 범위: 위 S1~S5 전체를 한 번에, 아니면 S1(고아 복구)부터 MVP?

---

## 6. 검토 대상 파일 목록 (리뷰 에이전트용)

백엔드:
- `backend/app/services/session_service.py` (상태머신 24-36, 전이 721-804, 1147-1150, 1487, 1562, 1600)
- `backend/app/services/audio_service.py` (finalize 170-236)
- `backend/app/services/video_service.py` (merge_video_chunks, video_merge_needed)
- `backend/app/services/record_service.py` (298: cancelled 처리)
- `backend/app/tasks/report_task.py` (generate_reports, sweep_stale_reports 373+)
- `backend/app/tasks/summary_task.py` (198-228)
- `backend/app/tasks/video_task.py`, `stt_task.py`
- `backend/app/core/celery_app.py` (beat 27-32)
- `backend/app/models/session.py`, `models/record.py`
- `backend/app/ws/session_live_namespace.py` (195: TTL, 863: 상태)

프론트엔드:
- `frontend/src/pages/sessions/ClassPlayerPage.tsx` (finishSession 837-860, handleStop 818-834)
- `frontend/src/hooks/useVideoRecorder.ts`, `useAudioRecorder.ts`
- `frontend/src/hooks/useLeaveGuard.ts`
- `frontend/src/hooks/useBand.ts` (disconnect 828-864)
- `frontend/src/hooks/useWakeLock.ts`
- `frontend/src/hooks/useSessionLiveSocket.ts`, `useRecordSocket.ts`
- `frontend/src/components/player/EndSessionModal.tsx`
