# Summary — SDD-206
- Hermes 크론(10분) `mb-e2e-autofix.py`: E2E 실패 감지 → 분류 → Claude 헤드리스 수정 → 타입검사 → 변경범위 검사 → develop push → 배포 후 재검증 → 성공 보고 / 새 실패 시 revert+일시정지
- 실검증: 의도적 회귀(설정 카드 제목 중복)를 dev에 주입 → 실패 2건 감지 → 자동 수정(1파일) 반영 → 배포 후 스모크 7/7·여정 29/29 통과 → 성공 보고
- 모의 검증: revert+일시정지 파일 생성, 허용 범위 밖 파일(alembic/.github) 차단, 환경성 실패(HTTP 5xx·로그인 API) 분류
- 안전장치: 일시정지 파일(~/.hermes/data/mb-autofix.paused 삭제로 재개), 같은 실패 2회 상한, main 불가침, 수정 허용 경로 제한
- 한계: 수정은 Claude 한 번 시도, 타입검사만 로컬 게이트(단위 테스트는 CI가 별도 수행). 백엔드 로직 수정은 dev DB 없이 타입/정적 수준만 검증
