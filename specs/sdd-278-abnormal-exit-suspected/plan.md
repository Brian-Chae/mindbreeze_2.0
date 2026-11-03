# SDD-278 Plan

| # | 파일 | 변경 |
|---|---|---|
| T1 | backend/app/services/upload_progress_service.py | 상수, `ProgressInput.abnormal_after_sec`, `ParticipantProgress.abnormal_exit_suspected`, `ParticipantCounts.abnormal_exit_suspected`, 순수 헬퍼 `abnormal_exit_suspected()`, aggregate 수치에서 의심 제외 |
| T2 | backend/app/config.py | `upload_abnormal_exit_after_sec: int = 86400` |
| T3 | backend/app/services/upload_status_service.py | `ProgressInput` 에 설정값 전달, ETag 시간 키에 기한 경과 불리언(304 고착 방지) |
| T4 | backend/app/schemas/upload_status_overview.py, services/upload_member_service.py | 회원 행 `abnormal_exit_suspected` |
| T5 | frontend/src/lib/api/upload-progress.ts, my-upload-status.ts | 필드 정규화(없으면 false/0) |
| T6 | frontend/src/lib/upload-status/board.ts, components/class/{upload-status-table,upload-overview-screen,upload-attention-chip}.tsx | 별도 줄·접힌 목록·분모 제외 |
| T7 | tests: backend/tests/sdd278/*, frontend/tests/sdd278/* (구버전 파서 고정 사본 포함) | |

결정: 의심 판정은 개요 캐시(요약 TTL 최대 300초) 안에서 계산되므로 기한 경과가 최대 5분 늦을 수 있음(허용).
상세 ETag 는 기한 경과 불리언을 넣어 24h 시점에 반드시 갱신. 개요 ETag 는 응답 본문 해시라 자동 반영.
