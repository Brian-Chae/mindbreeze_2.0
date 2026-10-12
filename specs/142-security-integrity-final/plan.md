# SDD-142 — 구현 계획

11건을 2개 그룹(백엔드 7 · 프론트 4)으로 병렬 구현.

| 그룹 | 건 | 방식 |
|---|---|---|
| A. 백엔드 | AUTHZ-02, CONC-01, AUTHZ-04, SEC-12, CFG-01, TXN-01, REM-01 | membership 통일 · savepoint 흡수 · IP 복합 키 · 매직바이트 · 설정 URL · flush 분리 · 로그 선점 |
| B. 프론트 | SEC-03/05/06/07(FE) | VerifiedTier 통일 · 동적 import · postForm · RoleGuard |

## 건별 설계

1. **AUTHZ-02** — `membership_service.is_member(role='org_admin', status='active')` 기반 판정 통일.
2. **CONC-01** — audio/video 청크 저장 `begin_nested()` + IntegrityError 흡수.
3. **AUTHZ-04** — 로그인 잠금 키 이메일+IP 복합.
4. **SEC-12** — 파일 헤더 8바이트 매직바이트(PDF/JPEG/PNG) 검증.
5. **CFG-01** — invite_url `settings.frontend_base_url` 기반(토큰 해시는 TODO 후순위).
6. **TXN-01** — `notify_event(commit=False)` flush 분리, 호출자 커밋.
7. **REM-01** — `_log_delivery` 원자적 INSERT 선점 → 성공 실행만 발송.
8. **SEC-03(FE)** — VerifiedTier 단일 정의('unverified'|'email'|'verified'), RoleGuard 'verified' 비교.
9. **SEC-05(FE)** — devAuth `import.meta.env.DEV` 동적 import(프로덕션 tree-shake).
10. **SEC-06(FE)** — `apiClient.postForm` 통일(FormData 지원).
11. **SEC-07(FE)** — ClientProfilePage `useRequireRole('counselor')`.

## 검증

- 백엔드 `pytest -q` → 1009 passed / 0 failed
- 프론트 `vitest run` → 44 files / 318 tests
- 프론트 `npm run build` → 0 errors
