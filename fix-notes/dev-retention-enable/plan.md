# dev 보관 정리 실제 삭제 활성화 계획

- 2026-10-24 Brian 승인: 릴리즈 전 dev 실삭제, 과거분 소급 적용, 표준 데이터 유지. 연구 영구 보존은 A안(비식별 사본만), 미ack EEG 보류 유지.
- 표준 데이터 모델·API·마이그레이션과 raw/hold/pii/orphan 및 구 크론의 모든 쓰기 대상을 먼저 대조한다.
- 표준 baseline/model은 독립 JSON 값이며 세션/raw/S3 FK가 없으므로 제외 필터 대신 execute 보존 회귀 테스트를 추가한다.
- dev 크론 한 줄에 enabled=true 및 --retroactive를 명시한다. 빈 하한에서 이 명시 옵션만 전체 과거분을 허용한다. 운영의 하한 미설정 차단, jobs.tsv/install-release/config 기본값은 유지한다.
- 정책 테스트 RED → 최소 구현 → 집중/전체 pytest 및 독립 리뷰 → 한글 커밋·작업 브랜치 push·develop PR 제출.
- 서버/DB/.env 접근, 크론 실행, 데이터 삭제, 알림·메일, 머지·배포 금지. SQLite fixture와 파일 crontab 스텁만 사용한다.
