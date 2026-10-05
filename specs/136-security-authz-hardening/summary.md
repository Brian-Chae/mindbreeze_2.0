# SDD-136 — 1순위 보안·권한 게이트 하드닝

## 원인 분석

전체 코드 리뷰(89건)에서 식별된 상위 심각도 보안 결함 7건. 공통 원인은 **인증·권한 게이트가 "로그인 성공"에만 의존**하고, 개별 엔드포인트/화면에서 역할·계정 상태·토큰 유효성을 재검증하지 않던 것.

| # | 결함 | 원인 |
|---|---|---|
| 1 | 무인증 자격증빙 승인 | `credential.py` admin_verify 가 `get_current_user_optional`(인증 없어도 통과) 사용 |
| 2 | 정지·대기 계정 지속 접근 | `get_current_user` 가 `user.status` 미검사 — login/refresh 시에만 검사 |
| 3 | JWT 서명 키 하드코딩 | `config.py` 기본값 `dev-secret-change-me` — 설정 누락 시 그대로 사용 |
| 4 | Google OAuth audience 미검증 | access_token 으로 userinfo 만 호출, client_id(audience) 대조 없음 |
| 5 | 비밀번호 재설정 후 세션 유지 | `complete_reset` 후 리프레시 토큰 미무효화 |
| 6 | 리포트 본문 수정 권한 없음 | `reports.py` update 가 `get_current_user`(역할 무관) 사용 |
| 7 | 프론트 화면 권한 가드 누락 | 상담사/내담자 화면이 RoleGuard 없이 노출 |

## 변경 내용

**백엔드 (6건)**
1. `credential.py` — admin_verify 를 `require_platform_admin` 으로 교체 (무인증 401, 비관리자 403). 미사용 `get_current_user_optional` import 제거.
2. `deps.py` — `get_current_user` 에서 `status == "suspended" | "pending"` 이면 403. 매 요청 차단.
3. `config.py` + `main.py` — `jwt_secret_key` 기본값 제거 + lifespan fail-fast(미설정 시 기동 중단).
4. `auth.py` — Google userinfo 조회 후 tokeninfo API 로 `aud` 대조, `google_client_id` 불일치 시 401.
5. `password_reset_service.py` — 비밀번호 변경 후 `revoke_all_user_tokens` 호출.
6. `reports.py` — update 를 `require_roles("counselor", "org_admin")` 로 교체.

**프론트 (1건)**
7. `RoleGuard.tsx` — `role` prop 을 `UserRole | UserRole[]` 로 확장. `App.tsx` 에서 상담사/기관관리자 화면(`/clients*`, `/credentials`, `/sessions`, `/sessions/new`, `/sessions/:id`, `/reports*`)에 `role={['counselor','org_admin']}`, 내담자 앱(`/app*`)에 `role="client"` 적용.

**테스트 정합 (부수)**
- `tests/conftest.py` — 로컬 테스트용 `VIDEO_CHUNK_DIR`/`AUDIO_CHUNK_DIR` 임시 경로 + `GOOGLE_CLIENT_ID` 설정.
- Google OAuth mock 4파일(`test_sdd_c01`, `test_sdd072_login_roles`, `test_sdd020`, `test_remember_me_login`) — userinfo/tokeninfo 를 URL 로 구분.
- SEC-01 증빙 승인 테스트(`test_credential`, `test_sdd093`) — platform_admin 토큰/401·403 기대로 갱신.
- SEC-02 상태 차단 테스트(`test_sdd075/076/077/080`) — pending/suspended user 를 테스트 내에서만 활성화.

## 검증 결과

| 검증 | 결과 |
|---|---|
| 백엔드 `pytest -q` | **1009 passed / 12 skipped / 0 failed** |
| 프론트 `vitest run` | **44 files / 318 tests 전부 통과** |
| 프론트 `npm run build` | **0 errors** |
| `py_compile` 수정 6파일 | 통과 |
| dev env 키 존재 | `JWT_SECRET_KEY`·`GOOGLE_CLIENT_ID` 둘 다 설정 확인 |
