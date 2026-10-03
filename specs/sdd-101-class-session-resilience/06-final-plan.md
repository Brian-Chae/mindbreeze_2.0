# SDD-101 — 최종 계획 (v4, 3라운드 수렴)

> 라운드 1(카탈로그) → 2(전략·SDD) → 3(adversarial) 수렴 결과.
> 리뷰: Claude·Codex·Cursor × 3라운드 (Cursor는 3라운드 사용량 한도로 1회 실패, UX는 1·2라운드에서 확보).

---

## 1. 검증 완료된 실버그 (Supervisor 소스 재확인)

| # | 버그 | 위치 | 영향 |
|---|---|---|---|
| BUG-1 | `stop_recording`의 `stt_task`/`summary_task` NameError → STT·요약 항상 동기 실행 | `audio_service.py:149-150` vs `:15-16` | `/audio/stop`이 STT+요약 동기 대기 → 종료 지연 |
| BUG-2 | `join_session` 상태·state_version·finalize 우회 | `session_service.py:1143-1144` | 상태 계약 깨짐 |
| BUG-3 | 상태 전이 read-modify-write, 행 잠금·CAS 없음 | `session_service.py:726-750` | 동시 end 2건 → 이중 finalize |
| BUG-4 | `cancel`이 미디어·기록 미마감 | `session_service.py:758` (`end` 분기만 finalize) | 녹화 중 취소 → 고아 |
| BUG-5 | 병합 부분 실패가 잘린 영상을 성공 처리 | `video_service.py` 병합 로직 + `video_merge_needed:219` | 영상 무결성 |

기존 메커니즘 확인: **SDD-100 `sweep_stale_open_sessions`**(`session_service.py:785-822`)가 `open` 방치 24h 세션을 이미 `cancel` 처리. S4는 이를 확장.

---

## 2. 수렴된 설계 원칙 (3라운드 반영 최종)

1. **파이프라인 소유권 단일화**: 발행은 `finalize_on_session_end` 1곳. `stop_recording`은 마킹만. `has_recording = status in ("recording","processing")` (단, `recording_ended_at` 세팅 순서를 먼저 정리 — AND절 회귀 방지).
2. **리포트 적재 가드**: 실제 데이터(started_at/recording/video 중 하나) 있을 때만 generate_reports 적재 — cancel 스윕이 빈 리포트를 양산하지 않도록.
3. **CAS**: `status IN (:allowed)` predicate + `state_version` SQL 원자 증가. rowcount 0 → 409 + finalize 생략.
4. **청크 멱등**: `recording_id` 원장 + `UNIQUE(recording_id, chunk_index)` + checksum. **병합·STT 조회를 recording_id로 전환**(안 하면 restart 중복 청크가 한 파일로 섞임).
5. **수신 마감 vs 후처리 분리**: 종료 요청에 `expected_count`, 서버가 누락 인덱스 반환. 누락 시 후처리 보류 + 지각 청크 유예. **유예 만료·재발행 주체를 명시**(없으면 드랍 1개가 파이프라인 영구 정체).
6. **merge_failed**: 무결성 실패 시 `video_s3_key` 보류(현행은 잘린 파일에 키를 세팅해 재병합 영구 봉쇄) + truncation 로직 수정.
7. **업로드 대기 상한**: fetch timeout/재시도 예산. 무한 대기 시 종료 지연 재발.
8. **finalize 레벨 멱등키**: 청크 멱등만으론 리포트 중복. 발행/재발행/워치독 경합 방지 키 필요.
9. **outbox**: `NotificationOutbox`(알림 발행기) 재사용은 부적합 → 파이프라인 발행 전용 outbox 또는 워치독 재트리거 **택1**. 운영 인라인 폴백 제거와 같은 카드에서 완결.
10. **오디오 영속 저장**: `/tmp` → S3 또는 공유 볼륨. API≠Celery 호스트면 STT 무음 실패.

---

## 3. 최종 SDD 분할

| # | 카드 | 범위 | MVP |
|---|---|---|---|
| 101-1 | 종료 파이프라인 단일화 | 소유권 이전, 리포트 가드, 인라인 폴백 제거+outbox, finalize 멱등 | ✅ |
| 101-2 | 상태 전이 원자성 | CAS, join 우회 제거, cancel finalize | ✅ |
| 101-3 | 청크 신뢰성·멱등 | recording_id+unique+checksum, 조회 전환, 업로드 상한, 수신 마감·발행 주체, merge_failed, 오디오 영속 저장 | ✅ |
| 101-4 | 고아 복구 워치독 | last_activity_at, SDD-100 확장, 아웃오브밴드 탐지 | ⚠️ 무인 자동마감 요구 시 |
| 101-5 | 모니터링·리포트 실패 | generation `failed` 계약+상태머신 5곳, WS Redis manager, 유예 만료 실행기 | 부분(MVP 계약 일부) |
| 101-6 | 예외 UX | 저장 미완료 표시·누락 재전송·종료 실패 복구(필수) / 배너·토스트·회원 고아 안내(후속) | 부분 |

**MVP (Codex 권고)**: 101-1 + 101-2 + 101-3 + 101-6의 "저장 미완료 표시·누락 재전송·종료 실패 복구". 단 "무인 자동 마감"까지 원하면 101-4 포함.

---

## 4. Brian 결정 사항 (비즈니스, 3자 수렴)

1. **자동 마감 정책**: 고아 유예 시간 + 종료 상태(completed vs cancelled) + **취소 시 수집 데이터 보존 vs 폐기**(STT·리포트 생성 여부).
2. **누락 산출 정책**: 부분 산출 허용 범위·복구 기한(ended_at+N분). "누락 숨긴 정상 완료" 금지.
3. **MVP 강제종료 복구 수준**: 재접속 복구만(=101-4 생략) vs 무인 자동 마감까지(=101-4 필수).
4. **배포 토폴로지**: API/Celery 공유 영속 저장소 여부(오디오 S3 전환 연기 가능), API 프로세스 수(WS Redis manager 우선순위).
5. **발행 유실 복구**: outbox(파이프라인 전용) vs 워치독 재트리거 택일.
6. **정상 종료 후 네비게이션**: `/record` 즉시 이동 vs 플레이어 종료 씬 N초 체류(failed 배지 노출 장소).

---

## 5. 리뷰 사이클 이력

- **라운드 1**: 예외 카탈로그 22종 검증 → BUG 1~5 발굴 + 카탈로그 정정(C1/C2/C3/D1) + UX 치명 5.
- **라운드 2**: v2 전략 검증 → 설계 정정 7(소유권 이전·CAS·recording_id·수신 마감·merge_failed·SDD-100·outbox) + SDD 순서 + MVP=1+2+3.
- **라운드 3**: v3 적대 검증 → 정정의 회귀 10건(has_recording 술어·빈 리포트 가드·outbox 부적합·마이그레이션 UNIQUE 충돌·업로드 상한 등) + 라운드1/2 해소 대조표.
