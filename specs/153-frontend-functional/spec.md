# SDD-153 — 프론트 기능 오류 (11건)

## 배경

기능 오류 전수조사 중(중) 27건 중 프론트 기능 오류 11건.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | MB2-02 | setMetrics 업데이터 내부 ref 부수효과(StrictMode 위험) |
| 2 | MB2-04 | class-join cancelled 수신 시 대기 화면 고착 |
| 3 | MB2-05 | useSessionLiveSocket version 가드 역순 replay 시 isReady 영구 false |
| 4 | MB2-06 | SessionCreatePage applyTemplate 시 participants 미정리 |
| 5 | FUNC-03 | onboarding essentials dead route + 완료 처리 누락 |
| 6 | FUNC-04 | clients 페이지 org_admin 접근 거부 |
| 7 | FUNC-05 | ReportListPage 필터/정렬 서버 페이지네이션 누락 |
| 8 | FUNC-06 | ClientReportListPage 검색 서버 전달 누락 |
| 9 | FUNC-07 | onboarding 초대 확인 실패 시 재시도 불가 |
| 10 | FUNC-08 | resolve-narrative 6지표 전부 요구(결측 시 전체 null) |
| 11 | FUNC-09 | ClientSessionDetail access_code null 시 무동작 |

## 변경

1. 평균 계산 순수 함수 분리 + 커밋 밖에서 ref 비움.
2. cancelled → 코드 입력 단계 복귀(사유 표시).
3. joined 스냅샷 version 폐기 제거 + 단조 병합.
4. applyTemplate도 participants trim.
5. Google 가입 client essentials 라우팅 + 완료 처리 연결.
6. clients 접근 검사를 ['counselor','org_admin']로 확대.
7. 필터 시 전체 로드 + 페이지네이션 숨김.
8. 검색 시 전체 로드 + 병합·중복 제거.
9. '다시 시도' 버튼으로 재조회.
10. 가용 지표만으로 부분 서사 생성.
11. access_code null 시 버튼 비활성화 + 사유 안내.

## 검증

- 프론트 vitest 44/318 + build 0 errors
