# SDD-329 plan

## 원인 분석
- A: `session.py` 전이 엔드포인트 → `_v1_via_live` → `execute_v1` → `pin_session_protocol` → `lock_epoch`(FOR UPDATE). 종료 직후 두 번째 호출이 잠금을 기다리다 lock_timeout(10s) → 500. 이미 종료된 회차는 읽기만으로 응답 가능.
- B: `generate_report_inline`이 시작 시 `was_approved`를 스냅샷, 생성 완료 후 stale 값으로 `status`를 덮어씀(승인 경합 시 completed→pending_review). 저장 직전에 행을 `FOR UPDATE`로 다시 읽어 최신 status가 completed면 completed·approved 유지.
- C: presign은 권한 실패 시 매번 DB 조회(resolve_upload_participant) 후 403. 로그에 사유 없음.
- D: 미측정 → `band_status=not_worn` 축약본(빈 hero·narrative만). 자동승인은 `_skip_auto_approve_no_data`가 막아 pending_review 정체.

## Task
1. A: `session.py` end 엔드포인트에 completed 단락(잠금 없는 읽기) + 잠금 실패 폴백. 테스트 `tests/test_sdd329_end_idempotent.py`.
2. B: `report_task.py` 저장 직전 재조회·락, 중복 생성 가드(generation_status=processing 신선 시 skip), 로그. 테스트 `tests/test_sdd329_report_approval_guard.py`.
3. C: `app/services/raw_presign_guard.py`(사유 로그+Redis 60s 캐시), eeg-raw/biosignal-raw presign에 적용. 테스트 `tests/test_sdd329_presign_reject.py`.
4. D: 스키마 `GroupStory` 추가(선택 필드), 빌더 not_worn 분기 확장, wording, 책 렌더, 자동승인 예외 조정. 테스트 `tests/test_sdd329_group_member_report.py`.
5. 전체 테스트·summary.
