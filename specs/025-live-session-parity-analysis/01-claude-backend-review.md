# Claude 백엔드·데이터 리뷰 (stdout 회수본)

## 요약

### 데이터 모델
- `play_group_id` 도입 → 유니크 제약을 `(session_id, participant_id, play_group_id, window_index)`로 확장. 현재 pause/resume 시 `window_index` 충돌로 신규 데이터가 **멱등 skip으로 소실**되는 결함(`session_service.py:895-911`)을 해결.
- DeviceStatus 4종 재설계: `lead_off`(접촉, 품질 파생) / `disconnected`(BLE, `last_eeg_at` staleness 파생) 분리. **현재 `device_fail`/"기기연결실패" 카운트가 항상 0인 dead code**(`session_service.py:680-683`) 지적.
- 효율 2해상도: 1초(`EEGFeatureWindow`) 유지 + 60초는 원천에서 파생(온디맨드 `window_index // 60` 집계 우선, 물화는 P2). 1.0의 이중 저장·단일지표는 계승 금지.

### 재연결 복구
2.0에 이미 절반 존재 — 게스트는 기존 `get_guest_session_state`(`session_service.py:719-774`) + `sessionStorage`, WS 단절 시 IndexedDB 오프라인 큐 → REST 5초 배치 flush(멱등 보장). 인덱스 기준선 = `play_group_id`.

### raw S3
`EEGRecord`는 정의만 있고 `user_id NOT NULL`이라 **게스트 raw 저장 불가**(`record.py:49`). `participant_id`/`play_group_id`/`file_count` 추가. raw 적재는 P2지만 스키마 선확장은 P1.

### 리포트 파이프라인
`Report`에 상태 필드 부재 → 1.0 ReportStatus 4단계(`pending_analysis→pending_review→completed/error`) 이식, **`pending_review`=2.0 승인 게이트**. `data_credibility`는 quality 게이트에서 파생. `Report`도 게스트 지원(`participant_id`/nullable `user_id`).

### 우선순위
P0(DeviceStatus 수정·playGroupId·재연결 계약) → P1(Report 상태머신·60초 롤업·라이브상태·스키마 선확장) → P2(raw S3·물화·배터리).

> 참고: Claude는 파일 쓰기 승인 대기로 종료 → stdout 요약 회수. 1.0 원본 .ts는 작업 디렉터리 밖이라 브리프 요약 기준 인용.
