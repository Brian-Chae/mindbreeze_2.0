# [SDD-101] — Verification (Pre-Implementation)

> 구현 전 QA 체크리스트. Stage ④ 전에 이 문서를 확정한다.

## Test Scenarios

### Phase A — 종료 파이프라인 단일화
**TS1. /audio/stop 응답 즉시 반환:** stop 직후 응답 latency < 500ms. STT·요약·병합이 동기 실행되지 않음.
- **Expected:** `/audio/stop`이 `recording_ended_at`만 기록, 발행은 0회. STT/요약 태스크 미호출.

**TS2. 단일 정렬 체인:** 정상 종료(handleStop→/audio/stop→/end) 시 `[merge → stt → summary → reports]`가 정확히 1회 순서대로 발행.
- **Expected:** 워커 로그에서 merge 완료 → stt → summary → reports 순서. 중복 발행 없음.

**TS3. has_recording 확장:** `/audio/stop` 없이 직접 `/end` 호출 시에도 STT·요약이 실행.
- **Expected:** `status="recording"` + `recording_ended_at=None`이어도 has_recording=True (recording_ended_at 세팅 후 판정).

**TS4. 리포트 가드:** 녹화·영상·started_at 모두 없는 세션(빈 세션) 종료/취소 시 리포트 미생성.
- **Expected:** generate_reports_for_session 미적재. Report 행 0건.

**TS5. 아웃박스 재발행:** 발행 직후 프로세스 사망(또는 브로커 다운) 시나리오에서 celery beat가 미발행 건 재발행.
- **Expected:** 아웃박스 행 남음 → sweep이 재발행 → 최종 산출물 생성. 중복 리포트 없음(멱등키).

**TS6. 인라인 폴백 제거:** 운영 요청에서 STT·요약 인라인 동기 호출이 0회.
- **Expected:** `run_stt_inline`/`run_summary_inline` 호출 없음. 발행 실패 시 아웃박스 경유.

### Phase B — 상태 전이 원자성
**TS7. 동시 end 2건:** 같은 세션에 종료 요청 2건 동시 도달.
- **Expected:** 1건만 성공, 다른 1건은 409. finalize·리포트 생성 1회.

**TS8. join 상태 우회 제거:** host가 scheduled 세션 join 시 `transition_status('start')` 경유.
- **Expected:** state_version 증가, 알림 발송, finalize 경유. 직접 대입 없음.

**TS9. cancel 미디어 마감:** 녹화 중 cancel 시 녹화·영상 기록 마감 + 데이터 폐기(상담사 확인 후).
- **Expected:** record.status 최종 상태로 전이, 고아 없음. SDD-100 sweep 취소 세션은 빈 리포트 미생성.

**TS10. 그룹 start 가드 회귀 방지:** 0-참가자 host 단독 start 미허용 유지.
- **Expected:** host 단독 start 400/거부 유지.

### Phase C — 청크 신뢰성·멱등
**TS11. recording_id 멱등:** 동일 (recording_id, chunk_index) 재전송 시 중복 행 없음.
- **Expected:** UNIQUE 제약으로 중복 차단. checksum 일치 시 idempotent 성공.

**TS12. restart 중복 분리:** 세션 중 녹화 재시작 시 두 세대 청크가 섞이지 않음.
- **Expected:** 병합·STT가 recording_id 기준으로만 조회 → 세대 분리.

**TS13. 업로드 대기 상한:** 영원히 응답 없는 업로드에서 UI가 제한 시간 내 복구.
- **Expected:** timeout 발동, 미전송 청크 IndexedDB 영속, 재시도 CTA 표시.

**TS14. 수신 마감·누락 인덱스:** 종료 시 expected_count 대비 누락 청크 감지.
- **Expected:** 서버가 누락 인덱스 반환, 유예 내 재전송 허용, 50% 미만이면 산출 보류.

**TS15. merge_failed 재병합:** 부분 실패 병합 후 재시도 가능.
- **Expected:** 무결성 실패 시 video_s3_key 미설정 → video_merge_needed True → 재병합. truncation 없음.

**TS16. 마이그레이션 단일 head:** `alembic heads` 단일 head.
- **Expected:** head 1개, 기존 행 recording_id 역산·중복 격리 정상.

### Phase D — 예외 UX
**TS17. 저장 미완료 표시:** 강제 종료 후 재접속 시 미완료 상태 표시.
- **Expected:** 기록 목록/스텝퍼에 "저장 미완료/처리 중" 표시.

**TS18. 누락 재전송 CTA:** 누락 청크 존재 시 재전송 버튼.
- **Expected:** CTA 클릭 → 누락 인덱스 재전송 → 산출물 갱신.

**TS19. 종료 실패 복구 CTA:** end 실패 시 복구 경로 제공.
- **Expected:** 미디어 재개 / 종료 재시도 / 새로고침 중 택1 가능.

**TS20. /record 즉시 이동:** 정상 종료 후 플레이어 체류 없이 `/record` 이동.
- **Expected:** 종료 완료 즉시 navigate. 실패 배지는 기록 목록에서 노출.

## Edge Cases
- [ ] 0 청크 세션 종료 (manifest 미확인) — 산출 보류, 오류 아님.
- [ ] 미시작 stop(멱등) — 200, 부작용 없음.
- [ ] 반복 stop/end 중복 호출 — CAS로 409/멱등 처리.
- [ ] 무녹화 + 밴드 미착용 세션 — 활동 신호 오판 없음(후속 워치독과 무관).
- [ ] 타 세션 recording_id 청크 — 거부.
- [ ] 동일 인덱스 다른 바이트 충돌 — 거부·재시도.
- [ ] 유예(24h) 만료 직전/직후 청크 — 만료 후 지각 청크 거부.

## Security Review
- [ ] recording_id 위조/타 세션 참조 차단(권한 검증).
- [ ] 아웃박스 페이로드에 민감 데이터(음성 내용) 미포함 — task 시그니처만.
- [ ] cancel 데이터 폐기가 되돌릴 수 없음을 상담사 확인 UI에서 명시.
- [ ] checksum 검증으로 무결성 위반 청크 차단.
