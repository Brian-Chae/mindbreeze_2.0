# SDD-229 — 배포·CI 시간 단축 (E2E 운영 전용·변경분 테스트)

- 상태: Stage ① Spec — Brian 승인(2026-10-22, "이대로 적용해", 야간 E2E는 하지 않음)
- 브랜치: `sdd/229-ci-speedup`
- 작성일: 2026-10-22

## 문제

최근 실측(2026-10-20~22):

| 구간 | 소요 | 원인 |
|---|---|---|
| dev 배포(develop push) | 약 10분 | E2E 6분 40초(65%) + 매번 `apt-get update`·`pip install` 약 1분 |
| develop 대상 PR CI | 약 26분 | 변경과 무관하게 백엔드 전체 pytest(약 25분) |

- 예: SDD-227 은 프론트 `LoginPage.tsx` 만 바꿨는데 백엔드 전체 pytest 가 돌았다.

## 목표

1. E2E(스모크·여정·회귀·전수)는 **운영 배포 준비(Release Build) 때만** 돈다. dev 배포에서는 돌지 않는다. 수동 실행은 유지.
2. PR 에서 백엔드가 바뀌지 않았으면 백엔드 테스트·PG 스모크를 건너뛴다. 프론트가 바뀌지 않았으면 프론트 검증을 건너뛴다.
3. 백엔드 일부만 바뀌었으면 **관련 테스트만** 돈다. 공통 영역(core·models·config·main·deps·conftest·requirements·alembic) 변경이나 관련 테스트를 못 찾는 경우는 전체로 자동 전환한다.
4. dev 배포 중 `requirements.txt` 가 그대로면 시스템 패키지·pip 설치를 건너뛴다.

## 비목표

- 야간 E2E(Brian 결정: 지금은 하지 않음).
- 테스트 자체 속도 개선(병렬화 등).

## 안전망

- Release Build 는 기존대로 **백엔드 전체 pytest** + 이번에 추가하는 **E2E** 를 통과해야 릴리스를 만든다.
- CI 설정·선택 스크립트 자체가 바뀌면 전부(전체) 돈다.

## 수용 기준

- 프론트만 바뀐 PR: backend·backend-pg-smoke 잡이 skip.
- develop push 후 Deploy Dev 에 e2e-smoke 잡이 없다.
- Release Build 실행 시 E2E 가 먼저 돌고 실패하면 build 가 돌지 않는다.
- 백엔드 서비스 1개 변경 PR: 관련 테스트 파일만 실행된다.
