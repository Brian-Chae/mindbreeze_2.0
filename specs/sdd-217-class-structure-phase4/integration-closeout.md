# SDD-217 검증 범위 통합·dev 배포 기록

## 사용자 승인과 범위
2026-10-20 사용자가 “217 미검증 내용을 제외하고 검증 완료된 내용들은 커밋 배포 및 통합작업 진행”을 승인했다. 대상은 develop 통합 및 dev 배포이며 main/production 배포는 포함하지 않는다.

검증 완료된 멤버십·출석·보강·비회원 자격/복구·가입 동의 복사·본인 기록 읽기·진행 상태 복원·즉시 완료 구현을 통합한다. 기존 독립 리뷰 Important4는 모두 수정·재리뷰 통과했다.

## 제외·후속 항목
- NV-03: 실제 카메라 녹화 켬/끔·장치 복구의 프레임 검증.
- V36: 외부 LiveKit 실제 권한 회수와 다중 워커.
- NV-08: 실제90초 벽시계 만료/정리 지연 및 다중 워커.
- 실제 메일/푸시 수신, Spark 외부 export·삭제 ack, 운영 보관 sweep 실측.
- 새 기능 스위치 활성화, RETENTION_APPLY_FROM 변경, 별도 운영 backfill·보관 삭제 실행.
- 기존 wizard navigation3 기준선 및 정규 다건 DTO N+1 후속 개선.

위 항목은 독립 미구현 모듈이 아니라 검증된 코드의 실환경 증거 한계 또는 이번에 수행하지 않는 운영 작업이다. 관련 코드를 임의 제거해 검증된 경로를 깨뜨리지 않는다. 실측 완료/전체 제품 출시 완료로 표시하지 않는다. 기존 dev 설정은 유지하며 새 스위치를 켜지 않는다.

## 마이그레이션
head e036a0000057. upgrade는 가산 스키마·기존 회차 동의 override 보수 보존·저장된 체크인 증거 backfill이다. DELETE/TRUNCATE/DROP 경로 없음. 기존 참가행이 이후 클래스 동의 기본값 자동전파 대상에서 빠지는 의도적 영향은 유지한다. downgrade 미지원이므로 장애 시 코드 롤백과 DB 전진 호환을 구분한다.

## 커밋 전 확인
- 최신 origin/develop: a4acf6ba0c434fd40f7eb70ce573e7ad1a7699b4. 기준과 같아 현재 충돌 없음.
- 최종 SDD217 PG 회귀: 225 passed, 7 기존 경고.
- 최종 SDD217 FE 회귀: 69 passed.
- Alembic 단일 head 및 git diff 공백 검사 통과.
- PR 필수 lint에서 일반 callback의 use 접두사와 불필요 callback dependency 2건 확인; 최소 수정·관련 회귀 후 커밋 예정.
- 전체 BE는 로컬 반복 대신 PR CI 게이트에서 확인한다.
- 실자격/환경파일/tmp 비밀번호/브라우저 인증 상태 제외. 증거는 합성 데이터. T11-failure*.png 임시 실패 캡처는 로컬 작업 기록으로 옮기고 배포 커밋에서 제외한다. RED 로그와 final-fix.diff는 재현/리뷰 이력으로 보존한다.

## 진행 상태
커밋·PR·CI·merge SHA·dev 배포·후속 E2E 결과는 완료 후 아래에 추가한다. 현재 이 문서는 배포 성공을 주장하지 않는다.

배포 전 lint2건은 일반 콜백 이름과 미사용 의존성만 수정했다. 관련66 테스트·빌드 통과, 독립 검토 PASS. 보고서는 evidence/release-lint-fix-report.md에 보존한다.

Commit hygiene: source/document whitespace checks exclude raw evidence logs/diffs, whose original terminal formatting is preserved. One whitespace-only source line was normalized. Full frontend lint passed.

## 첫 PR CI와 스키마 검사 정합 수정
- 제품 커밋: e24923b41f01f19fd32b3c53116a04b39ab23ac5, PR #20.
- CI 39296788201: 타입·lint·빌드 통과. PG는 404통과/2실패로, 과거 테이블 수77 및 ORM CHECK 없음 기대가057 계약과 충돌했다.
- 테스트 두 파일만 수정: 실제86개 테이블을 확인하고 기존214 제약 제외 검사를 유지하면서217 canonical guest CHECK/복합 FK를 이름·식·컬럼·참조·RESTRICT까지 정확히 허용한다. 제품 코드는 바꾸지 않았다.
- RED 2실패/35통과 → GREEN37통과, 독립 리뷰 PASS. 전체 PG 재검증은406통과/21deselected/8경고(71.62초). evidence/release-all-pg.log 참조.
- FE 비차단 전체 테스트:2090통과/15실패. 기존 textarea/input 검사 불일치4, Dashboard 글꼴검사1, 기록된 navigation기준선3, Vite5175 미기동 fetch실패5 및 브라우저 locator timeout2. 관련 파일은 base대비 변경없음; timeout2의 환경 원인은 로그 정황상 추론이다. 신규217 회귀 근거 없음. 전체FE 통과로 보고하지 않는다.
- 수정 push로 PR CI를 최신 커밋 기준 다시 실행하며, 최신 필수 게이트 결과를 병합 판단에 사용한다.
