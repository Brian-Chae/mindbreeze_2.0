# [SDD-101] 클래스 세션 복원력 — MVP

## Goal
클래스 세션 생명주기(진행 → 일시정지 → 종료/취소)에서 발생하는 예외상황에 대한 복원력을 확보한다. 종료 지연을 제거하고, 정상/강제 종료 시 수집 데이터(음성·영상·EEG) 유실을 방지하며, 상태 전이 계약을 원자적으로 강화한다.

## Context
- 이전 작업으로 영상 청크 병합을 Celery 비동기화했으나, 남은 잠복 버그 5건(BUG-1~5)과 예외 카탈로그 22종이 3라운드 교차 리뷰(Claude/Codex/Cursor × 3)에서 확인됐다. 상세 근거는 `00-research-brief.md`·`06-final-plan.md` 참조.
- **Brian 확정 결정**(`07-decisions.md`): 고아 유예 24h·취소 시 데이터 폐기(상담사 확인), 누락 산출 50% 이상 + 복구 기한 24h + 상담사 리뷰 필수, MVP=재접속 복구만(워치독 생략), 배포=단일 EC2+systemd, 발행 유실 복구=파이프라인 아웃박스, 종료 후 `/record` 즉시 이동.

## Scope

### ✅ In-scope (MVP — 4 Phase)
- **Phase A — 종료 파이프라인 단일화**: STT·요약·병합·리포트 발행을 `finalize_on_session_end` 1곳으로 통합. `stop_recording`은 마킹만(발행 제거). `has_recording`은 `status in ("recording","processing")`. 리포트 적재 가드(실제 데이터 존재 시에만). 파이프라인 발행 아웃박스(durable 기록 + celery beat 재발행 + 멱등키). 운영 경로 인라인 동기 폴백 제거.
- **Phase B — 상태 전이 원자성**: `transition_status`를 조건부 UPDATE(CAS, `status IN (:allowed)` + `state_version` 원자 증가)로. `join_session` 직접 상태 대입 제거. `cancel` 시 미디어·기록 마감(데이터 폐기 + 상담사 확인).
- **Phase C — 청크 신뢰성·멱등**: `recording_id` 녹화 실행 원장 + `UNIQUE(recording_id, chunk_index)` + checksum(EEGRawChunk 패턴 재사용) + Alembic 마이그레이션. 병합·STT 조회를 recording_id 기준으로 전환. 업로드 대기 상한(timeout/재시도 예산). 수신 마감(`expected_count`) vs 후처리 분리 + 누락 인덱스 반환 + 지각 청크 유예(24h). `merge_failed` 재병합(무결성 실패 시 `video_s3_key` 보류 + truncation 로직 수정). 누락 50% 규칙.
- **Phase D — 예외 UX(필수 부분)**: 저장 미완료 표시, 누락 재전송 CTA, 종료 실패 복구 CTA, 종료 후 `/record` 즉시 이동.

### ❌ Out-of-scope (후속)
- 고아 복구 워치독(098-4) — MVP는 재접속 복구만.
- WS Redis manager·모니터링·리포트 `failed` 상태머신 전면 개편(098-5) — MVP는 최소 계약만.
- 예외 UX 후속(복구 배너·밴드 토스트·회원/게스트 고아 안내, 098-6 나머지).
- 오디오 S3 전환(단일 호스트 공유 `/tmp`로 연기).

## Acceptance Criteria
- [ ] 종료 API(`/end`, `/audio/stop`)가 STT·요약·병합을 동기 대기하지 않음(응답 즉시 반환).
- [ ] STT·요약·병합·리포트가 단일 정렬 체인으로 정확히 1회 발행됨(중복·유실 없음).
- [ ] 동시 종료 2건 중 1건은 409, finalize는 1회만.
- [ ] 강제 종료 후 재접속 시 저장 미완료·누락 청크를 감지하고 재전송 가능.
- [ ] `cancel` 시 수집 데이터 폐기(상담사 확인 후) + 고아 없음.
- [ ] 부분 산출은 50% 이상일 때만, 상담사 리뷰 후 리포트 발행.
- [ ] 백엔드 `pytest` 전체 통과 + 프론트 `npm run build` 0 errors.
- [ ] 기존 변경 파일 대상 테스트 37개 포함 전체 회귀 없음.

## Dependencies
- SDD-100(open 방치 세션 자동 취소, 진행 중) — Phase B의 `cancel` finalize와 정합 필요.
- Alembic 마이그레이션(recording_id·checksum·unique) — 단일 head 유지.

## Risks
- 마이그레이션 시 기존 AudioChunk/VideoChunk 중복 행 UNIQUE 충돌 → 기존 행 recording_id 역산·격리 전략 필수.
- 병합/STT 조회 전환 미완료 시 restart 중복 청크가 한 파일로 섞임 → Phase C에서 조회 전환 의무화.
- 아웃박스 재발행·워커 완료 경합 → 멱등키(recording_id+task)로 중복 리포트 방지.
