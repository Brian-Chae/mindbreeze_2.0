# dev 배포 길이 초과 원인과 수정 계획

- 기준: 953a1437, fix/dev-deploy-script-length. 사용자 지정 긴급 Fix 범위와 검증·커밋·푸시·PR 생성을 승인 범위로 적용한다.
- 원인: SSH action의 with.script에 반복 크론 등록이 누적되어 GitHub 표현식 길이 한도를 초과했다.
- 연속된 크론 등록 부분만 deploy/dev/register-crons.sh로 그대로 이동한다. 번들에 포함하고 원래 위치에서 bash로 호출한다.
- 로그 파일 생성, DEBUG=false 등록, 롤백, 나머지 배포 단계 및 운영 배포 경로는 유지한다.
- 18,000자 상한 회귀 테스트를 먼저 실패시키고 수정 후 통과시킨다.
- 크론 등록은 가짜 crontab과 임시 HOME에서 기준 커밋과 실행 결과를 비교한다. 실제 서버·crontab·DB·환경 파일에는 접근하지 않는다.
