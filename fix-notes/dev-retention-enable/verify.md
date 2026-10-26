# 구현 전 검증 계획

Brian의 10/24 요청으로 구현·검증·PR 제출까지 승인됨. 배포·실데이터 삭제 실행 제외.

- [x] 표준 baseline/model/constants 및 원천/FK/cascade 전수 판정 기록.
- [x] 기간 경과 세션의 raw 삭제와 baseline/model 전체 값·상수 파일 바이트 보존 확인.
- [x] 빈 하한+retroactive execute, 기존 빈 하한 차단, 잘못된 하한 차단, 명시 dry-run 우선 확인.
- [x] 연구 미ack 보류·acked 삭제 기존 회귀 유지.
- [x] 파일 crontab 스텁에서 retention 줄만 변경·중복 등록 멱등·17개 유지.
- [x] deploy-dev.yml 18,000자 상한 및 retention·normalization·dev_deploy 집중 pytest.
- [x] 전체 backend pytest, 독립 검토 및 diff 경계 재확인.
