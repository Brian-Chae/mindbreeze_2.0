# 구현 전 검증 체크리스트

사용자의 구체적인 수정·검증 지시에 따라 아래 검증을 연속 수행한다.

- [x] 기준 SSH script 길이와 길이 상한 테스트 RED 확인
- [x] 수정 후 SSH script 15,000자 이하 및 회귀 상한 18,000자 통과
- [x] 기준/수정 크론 실행 결과 바이트·줄 집합 동일, 기존 작업 보존, 두 번 실행 멱등성 확인
- [x] retention_sweep_cron.py --dry-run 및 flock·--dev-env 유지
- [x] 번들 포함 및 번들 해제 이후 원래 순서에서 호출 확인
- [x] YAML 파싱·bash 구문·actionlint 확인
- [x] 워크플로 관련 기존 backend 테스트 통과 및 독립 리뷰
- [x] summary 작성

검증 후 전달 절차: 한글 커밋 → 지정 브랜치 푸시 → develop 대상 PR 생성. 실행 결과는 최종 응답과 PR에 기록한다.
