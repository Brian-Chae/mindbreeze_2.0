# SDD-142 — 검증 체크리스트 (Stage ③)

## 기능 동작

- [ ] 다중기관 상담사가 비주소속 기관의 org_admin 으로 관리 가능한가? (AUTHZ-02)
- [ ] 청크 동시 중복 삽입 시 500 대신 기존 행 반환인가? (CONC-01)
- [ ] 계정 잠금이 이메일+IP 복합으로 동작하는가? (AUTHZ-04)
- [ ] 증빙 업로드가 매직바이트로 검증되는가? (SEC-12)
- [ ] 초대 링크가 설정 도메인 기반인가? (CFG-01)
- [ ] notify_event 가 조기 커밋하지 않는가? (TXN-01)
- [ ] 리마인더 중복 워커 실행 시 1회만 발송되는가? (REM-01)
- [ ] VerifiedTier 가 백엔드 계약값으로 통일되고 RoleGuard 가 'verified' 를 쓰는가? (SEC-03 FE)
- [ ] 프로덕션 번들에 dev 로그인 문자열이 없는가? (SEC-05 FE)
- [ ] 증빙 업로드가 apiClient 를 쓰는가? (SEC-06 FE)
- [ ] 내담자 프로필 상세가 상담사 역할 게이트에 걸리는가? (SEC-07 FE)

## 회귀 검증

- [ ] 백엔드 pytest 1009 passed / 0 failed
- [ ] 프론트 vitest 44 files / 318 tests
- [ ] 프론트 build 0 errors
