# SDD-143 — 검증 체크리스트 (Stage ③)

## 기능 동작

- [ ] 리포트 메일 요청이 생성 필요 시 비동기(202)로 응답하는가? (PERF-03)
- [ ] 리포트 timeline 이 300포인트로 다운샘플되는가? (RPT-02)
- [ ] STT 병합 핸들이 with 로 관리되는가? (STT-02)
- [ ] 관리자 회원 목록이 N+1 없이 일괄 조회하는가? (PERF-01)
- [ ] 기관 검색 링크가 빈 화면 없이 열리고 404 catch-all 이 있는가? (UX-01)
- [ ] 관리자 검색이 디바운스 + 시퀀스 가드되는가? (PERF-01 FE)
- [ ] onboarding_completed 미정의 필드가 제거됐는가? (API-01)
- [ ] 로그인 탭 전환 시 next 파라미터가 유지되는가? (UX-04)
- [ ] 사이드바에 알림 뱃지가 표시되는가? (UX-05)
- [ ] 온보딩 counselors 중복이 없는가? (UX-06)
- [ ] isOrgAdmin 이 org_admin 만 참인가? (UX-07)
- [ ] 게스트 생년월일 연도가 현재 연도 기준인가? (FE-JOIN-002)
- [ ] 시스템 테마 변경이 반영되는가? (FE-THEME-001)

## 회귀 검증

- [ ] 백엔드 pytest 1009 passed / 0 failed
- [ ] 프론트 vitest 44 files / 318 tests
- [ ] 프론트 build 0 errors
