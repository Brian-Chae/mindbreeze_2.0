# SDD-147 — 접근성·유지보수·데드코드 (11건)

## 배경

코드 리뷰 잔여 마지막 프론트 11건. 접근성 4건 + 데드코드 2건 + PDF alert + 유지보수성 3건 + Zustand selector.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | A11Y-01 | 관리자 모달 role=dialog/Escape/포커스 트랩 부재 |
| 2 | A11Y-02 | 클릭 가능한 테이블 행 키보드 접근 불가 |
| 3 | A11Y-03 | 필터 select/검색 input 라벨 부재 |
| 4 | A11Y-04 | 신규 비밀번호 autoComplete="new-password" 누락 |
| 5 | API-02 | lib/api/password.ts 데드코드(skipAuth 누락) |
| 6 | FE-DEAD-001 | BandGuidePanel.tsx 미사용 데드코드 |
| 7 | FE-REPORT-001 | PDF 버튼이 alert()로만 노출 |
| 8 | MAINT-01 | useRequireAuth 역할 검증 오해 |
| 9 | MAINT-02 | OtpInput padEnd(0,'') no-op |
| 10 | MAINT-03 | 알림 소켓 console.log 잔재 |
| 11 | PERF-02 | Zustand 무-selector 전체 구독 |

## 변경

접근성 개선, 데드코드 제거, alert→토스트, 코드 명확화, selector 구독 전환.
