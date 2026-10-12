# SDD-138 — Verify (구현 전 QA 체크리스트)

## PERF-01 EEG 모니터링 최적화
- [x] 평균 두뇌휴식도가 SQL AVG 로 계산되어도 기존 수치와 동일 (null 제외 평균)
- [x] 최신 윈도우가 created_at 기준으로 동일하게 선정 (pause/resume 재시작 대응)
- [x] 기존 백엔드 테스트 1009개 통과 (수치 회귀 없음)

## PIPE-01 cron 복구 안전망
- [x] 4개 cron 스크립트가 태스크 함수를 직접 호출해 정상 종료(exit 0)
- [x] dev 서버 crontab 에 5분(워치독·리마인더·export)·1분(아웃박스) 주기 등록
- [x] 로그 파일 생성 확인 (/var/log/mindbreeze-*.log)

## 종합 게이트
- [x] 백엔드 `pytest -q` 1009 passed / 0 failed
- [x] Deploy Dev 성공(Health check 통과)
- [x] dev 서버 cron 스크립트 수동 실행 검증
