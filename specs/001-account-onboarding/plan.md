# Plan: F1 계정·인증·온보딩 구현 계획

- **Sprint**: 001-account-onboarding
- **Spec 참조**: `specs/001-account-onboarding/spec.md`
- **개발 순서 원칙**: **BE 먼저 → FE 나중**. BE는 모델 → 스키마 → 서비스 → 라우터 → 테스트 순. FE는 페이지 단위로 BE 완료 후 작업.

---

## 1. 구현 전략

### 1.1 핵심 설계 결정
1. **기존 엔드포인트 보존**: `/auth/register`·`/auth/login` 시그니처는 호환 유지하면서 필드만 추가(`email_verify_token`, `consents`). 파괴적 변경 없음.
2. **OTP/토큰 저장소**: Redis 사용 (`otp:{email}` TTL 600s, `pwd_reset:{token}` TTL 1800s). Redis는 기존 `redis_url` 설정 활용.
3. **Refresh 회전**: `RefreshToken` 테이블에 `jti, user_id, issued_at, revoked_at` 저장. 재사용 감지 시 user 단위 일괄 폐기.
4. **로그인 잠금**: `LoginAttempt` 테이블 + `locked_until` 컬럼(또는 Redis `lock:{email}` 15분 TTL — Redis 채택).
5. **온보딩 진행 상태**: `OnboardingProgress`(user_id PK, JSONB로 step별 데이터·완료 시각 보관). 단순 키-값 누적이라 별도 테이블보다 JSONB가 유리.
6. **이메일 발송**: Celery 태스크 `app/tasks/email.py`. 개발 단계에서는 콘솔 로그 출력, 운영은 SMTP/SES.
7. **상담사 코드**: `secrets.token_urlsafe` 기반 6자리 대문자+숫자, unique constraint + 충돌 시 재시도.
8. **DB 세션**: 현재 `auth.py`는 동기 `Session`을 사용 중. 본 스프린트 신규 코드는 **async** 패턴 도입 권장하나, 일관성을 위해 일단 기존 동기 세션을 유지하고 별도 마이그레이션 티켓으로 분리.

### 1.2 예상 변경 규모
- BE: 신규 모델 6개, 신규 라우터 3개(`auth_ext`, `password`, `onboarding`), 마이그레이션 1개, 라인 수 ~1500
- FE: 신규 페이지 7개(Register, ForgotPassword, ResetPassword, CounselorOnboarding[1-4 통합], ClientOnboarding[1-4 통합]), 라우팅·API 클라이언트·Zustand 인증 스토어, 라인 수 ~2500
- 테스트: pytest 케이스 ~40개, vitest 컴포넌트 테스트 ~20개

---

## 2. 변경할 백엔드 파일

### 2.1 신규 파일
| 경로 | 역할 |
|---|---|
| `backend/app/models/refresh_token.py` | Refresh 회전·폐기 추적 |
| `backend/app/models/consent.py` | 약관 분리 동의 기록 (tos / privacy / sensitive) |
| `backend/app/models/onboarding_progress.py` | 사용자별 온보딩 단계·페이로드 JSONB |
| `backend/app/models/client_counselor_link.py` | 내담자-상담사 매칭 |
| `backend/app/models/password_history.py` | 직전 3개 비밀번호 해시 보관 |
| `backend/app/models/counselor_profile.py` | 상담사 코드·성별·생년월일·경력·전문분야 |
| `backend/app/models/client_profile.py` | 내담자 성별·생년월일·호소·관심영역 |
| `backend/app/schemas/onboarding.py` | 온보딩 step별 Pydantic 스키마 |
| `backend/app/schemas/password.py` | 재설정 스키마 |
| `backend/app/schemas/consent.py` | 동의 스키마 |
| `backend/app/services/otp_service.py` | Redis OTP 발급·검증·쿨다운 |
| `backend/app/services/email_verify_service.py` | `email_verify_token` 발급·검증(JWT, 15분) |
| `backend/app/services/refresh_token_service.py` | 회전·재사용 감지·폐기 |
| `backend/app/services/login_attempt_service.py` | Redis 기반 실패 카운트·잠금 |
| `backend/app/services/password_reset_service.py` | 토큰 발급·검증·이력 비교 |
| `backend/app/services/counselor_code_service.py` | 6자리 코드 발급·중복 검사 |
| `backend/app/services/onboarding_service.py` | step별 저장·complete 처리 |
| `backend/app/tasks/email.py` | Celery 이메일 태스크 (OTP·재설정) |
| `backend/app/core/redis.py` | Redis 클라이언트 싱글톤 |
| `backend/app/api/v1/password.py` | 비밀번호 재설정 라우터 |
| `backend/app/api/v1/onboarding.py` | 상담사·내담자 온보딩 라우터 |
| `backend/alembic/versions/001_account_onboarding.py` | 신규 테이블 7개 마이그레이션 |
| `backend/tests/test_auth_register.py` | F1.1 QA 검증 |
| `backend/tests/test_auth_login.py` | F1.2 QA 검증 |
| `backend/tests/test_onboarding_counselor.py` | F1.3 |
| `backend/tests/test_onboarding_client.py` | F1.4 |
| `backend/tests/test_password_reset.py` | F1.5 |

### 2.2 수정 파일
| 경로 | 변경 내용 |
|---|---|
| `backend/app/api/v1/auth.py` | `/register`에 OTP 토큰·consents 검증 추가, `/login`에 잠금·실패카운트, `/refresh`·`/logout` 신규 추가 |
| `backend/app/schemas/auth.py` | `RegisterRequest`에 `email_verify_token`, `consents` 필드 추가, `LoginResponse`에 `user` 포함 |
| `backend/app/models/user.py` | 역방향 관계 추가(refresh_tokens, consents, password_history, onboarding_progress, counselor_profile, client_profile) |
| `backend/app/models/__init__.py` | 신규 모델 export |
| `backend/app/main.py` | 신규 라우터(password, onboarding) include |
| `backend/app/api/deps.py` | `get_current_user` 의존성 추가(기존에 없을 수 있으므로 점검) |
| `backend/app/config.py` | `otp_ttl_seconds`, `password_reset_ttl_minutes`, `login_lock_minutes`, `login_max_attempts`, `smtp_*` 설정 추가 |

---

## 3. 변경할 프론트엔드 파일

### 3.1 신규 파일
| 경로 | 역할 |
|---|---|
| `frontend/src/lib/api/client.ts` | fetch 래퍼(Bearer 자동, 401 → refresh 재시도) |
| `frontend/src/lib/api/auth.ts` | register/login/refresh/logout/otp 호출 |
| `frontend/src/lib/api/onboarding.ts` | onboarding step API |
| `frontend/src/lib/api/password.ts` | forgot/reset |
| `frontend/src/stores/authStore.ts` | Zustand: user, tokens, login/logout actions |
| `frontend/src/hooks/useAuth.ts` | 로그인 상태·역할 가드 |
| `frontend/src/components/auth/OtpInput.tsx` | 6자리 OTP 입력 컴포넌트 |
| `frontend/src/components/auth/ConsentCheckList.tsx` | 약관 분리 동의 체크리스트 |
| `frontend/src/components/onboarding/StepIndicator.tsx` | 4단계 진행 표시 |
| `frontend/src/pages/RegisterPage.tsx` | F1.1 회원가입 (이메일·OTP·비밀번호·역할·동의) |
| `frontend/src/pages/ForgotPasswordPage.tsx` | F1.5 |
| `frontend/src/pages/ResetPasswordPage.tsx` | F1.5 |
| `frontend/src/pages/onboarding/CounselorOnboardingPage.tsx` | F1.3 4단계 |
| `frontend/src/pages/onboarding/ClientOnboardingPage.tsx` | F1.4 4단계 |
| `frontend/src/components/auth/RoleGuard.tsx` | role/verified_tier 기반 라우트 가드 |
| `frontend/src/tests/RegisterPage.test.tsx` 외 | vitest |

### 3.2 수정 파일
| 경로 | 변경 내용 |
|---|---|
| `frontend/src/pages/LoginPage.tsx` | `/auth/login` API 연동, 잠금 메시지 UX, 실패 표시 |
| `frontend/src/App.tsx` | 라우트 추가 `/register`, `/forgot-password`, `/reset-password`, `/onboarding/counselor`, `/onboarding/client`, RoleGuard 적용 |
| `frontend/package.json` | (필요시) `zustand`, `@tanstack/react-query`, `react-hook-form`, `zod` 추가 |

---

## 4. 분할 디스패치 계획 (BE → FE)

### Phase A — BE 인프라 (선행)
- A1: Redis 클라이언트 + Celery 이메일 태스크 스켈레톤
- A2: 신규 모델 7개 + Alembic 마이그레이션
- A3: `user.py` 관계 추가, `__init__.py` export, `deps.py` `get_current_user`

### Phase B — BE 인증 (F1.1·F1.2·F1.5)
- B1: `otp_service` + `email_verify_service` + `/auth/email/*`
- B2: `/auth/register` 확장(동의 검증)
- B3: `refresh_token_service` + `/auth/refresh`·`/auth/logout`
- B4: `login_attempt_service` + `/auth/login` 잠금
- B5: `password_reset_service` + `/auth/password/*`
- B6: pytest 5종 작성·통과

### Phase C — BE 온보딩 (F1.3·F1.4)
- C1: `onboarding_service` + Counselor step1~4 + complete
- C2: Client step1~4 + 상담사 코드 매칭
- C3: pytest 2종

### Phase D — FE 인프라
- D1: api/client·authStore·useAuth·RoleGuard·App 라우팅
- D2: 공통 컴포넌트(OtpInput, ConsentCheckList, StepIndicator)

### Phase E — FE 페이지
- E1: `LoginPage` API 연동 (가장 작은 변경, 즉시 검증)
- E2: `RegisterPage` (F1.1)
- E3: `Forgot/ResetPasswordPage` (F1.5)
- E4: `CounselorOnboardingPage` (F1.3)
- E5: `ClientOnboardingPage` (F1.4)

### Phase F — 통합 검증
- F1: 백엔드 `pytest && alembic upgrade head` 통과
- F2: 프론트 `npm test && npm run build` 통과
- F3: 수동 E2E: 가입 → OTP → 역할 선택 → 온보딩 → 로그아웃 → 비밀번호 재설정 → 재로그인

---

## 5. 의존성 / 리스크

| 항목 | 리스크 | 완화 |
|---|---|---|
| Redis 미구동 환경 | OTP·잠금·재설정 동작 불가 | docker-compose에 redis 추가, README 보강 |
| 이메일 발송 인프라 부재 | 개발 단계 OTP 확인 불가 | 개발용 콘솔 출력 + 응답 헤더에 디버그 OTP(debug 모드만) |
| 동기 SQLAlchemy 세션 | async 라우터에서 블로킹 | 본 스프린트는 기존 동기 패턴 유지, 별도 async 마이그레이션 티켓 분리 |
| 상담사 코드 충돌 | 6자리 공간 한정 | 충돌 시 재발급 루프(최대 5회) + 향후 8자리 확장 가능 |
| F2·F3 미완성으로 Step 3 placeholder | 상담사 검증 흐름 임시 | Step 3는 파일 메타만 수집, 실제 검증은 F3 스프린트에서 연결 |

---

## 6. 작업 외 (Out of Scope)
- 소셜 로그인(Google/Kakao 버튼은 UI만 유지, API 미연동) — 별도 스프린트
- F3 자격 증빙 AI 검증 파이프라인
- F2 센터 등록·매핑
- 네이티브 푸시·앱 BLE
