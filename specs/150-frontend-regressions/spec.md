# SDD-150 — 프론트 기능 회귀 (4건)

## 배경

기능 오류 전수조사 상(상) 10건 중 프론트 기능 회귀·오류 4건.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | FUNC-01 | 상담사·관리자 Google 로그인 전면 차단(SDD-145 회귀) |
| 2 | FUNC-02 | 성별 '선택 안 함' 값이 백엔드 계약에 없어 422 |
| 3 | MB2-01 | 참가자 데이터 오귀속(3초 평균 flush 엔벨로프 재사용) |
| 4 | MB2-03 | 대기실 3단계 준비 게이트 우회 |

## 변경

1. 동의 게이트를 client 역할에만 적용(`loginRole === 'client'`).
2. prefer_not_to_say 옵션 제거.
3. 참가자별 마지막 이벤트 엔벨로프 저장 → pid별 자기 엔벨로프로 averaged 구성.
4. onSessionStateChanged는 status만 갱신(step 미전환).

## 검증

- 프론트 build 0 errors, vitest 44/318
