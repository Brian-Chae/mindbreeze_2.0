# Spec: F1 계정·인증·온보딩

- **Sprint ID**: 001-account-onboarding
- **작성일**: 2026-05-19
- **대상 영역**: F1.1 ~ F1.5 (기능명세서 §71~129)
- **개발 단계**: MVP1 / **우선순위**: P0 (F1.5만 P1)
- **현재 코드 상태**:
  - `backend/app/api/v1/auth.py` — `/auth/register`, `/auth/login` 기본 구현 (해시·JWT 발급만)
  - `backend/app/models/user.py` — `User` 모델 존재 (role, verified_tier 컬럼)
  - `frontend/src/pages/LoginPage.tsx` — UI만, API 미연동
  - 회원가입 페이지·온보딩 페이지·비밀번호 재설정 페이지 **모두 미구현**
- **확장 방침**: 기존 `/auth/register`·`/auth/login` 엔드포인트를 확장(파괴적 변경 없이 응답 필드·검증 흐름만 보강)하고, 신규 엔드포인트는 `/auth/*`·`/onboarding/*` 하위에 추가한다.

---

## 공통 규칙

- 모든 API는 `/api/v1` 프리픽스. JSON body, JWT는 `Authorization: Bearer <token>` 헤더.
- Access Token 15분 / Refresh Token 14일, Refresh는 **회전(rotation)** + DB 화이트리스트(jti).
- 비밀번호: Argon2id, 8자 이상 영문·숫자·특수문자 필수.
- 모든 응답·오류 메시지는 한국어. 오류 포맷: `{"detail": "..."}`.
- 비동기 이메일(OTP·재설정 링크)은 Celery 태스크로 전송 (`app/tasks/email.py`).

---

## F1.1 회원 가입 (역할별 분리 진입 · OTP 이메일 인증 · 분리 동의)

### UX 진입점
- **랜딩 페이지**에 두 개의 가입 버튼 분리:
  - "상담사 가입" → `role=counselor` 고정 가입 플로우
  - "회원가입" → `role=client` 고정 가입 플로우 (내담자)
- **로그인은 통일**: 하나의 로그인 페이지, 내부에서 role로 분기

### 액터
Guest

### 메인 플로우 (공통)
1. **이메일 OTP 발급**: 사용자가 이메일 입력 → `POST /auth/email/request-otp` → 6자리 OTP를 이메일로 발송 (10분 유효, 60초 재발송 쿨다운).
2. **OTP 검증**: `POST /auth/email/verify-otp` → 검증 토큰(`email_verify_token`, 15분 유효) 반환.
3. **역할별 가입**: 진입점에 따라 role이 이미 결정된 상태로 호출
   - `POST /auth/register/counselor` — 상담사 가입 (role=counselor 고정)
   - `POST /auth/register/client` — 내담자 가입 (role=client 고정)
   - body: `email_verify_token`, `password`, `name`, `consents{ tos, privacy, sensitive }`
4. **약관 분리 동의**:
   - 서비스 이용약관(tos): 필수
   - 개인정보 처리방침(privacy): 필수
   - 민감정보(EEG·상담내용) 처리 동의(sensitive): **필수**
5. 가입 성공 시 `User` 생성(`verified_tier='unverified'`) + `Consent` 기록 + 즉시 Access/Refresh 발급 → 역할별 온보딩 페이지로 이동.

### 예외 처리
| 케이스 | 응답 |
|---|---|
| 이메일 중복 | 409 `이미 등록된 이메일입니다` |
| OTP 만료/불일치 | 400 `인증 코드가 올바르지 않거나 만료되었습니다` |
| 재발송 쿨다운(60초) | 429 `잠시 후 다시 요청해주세요` |
| 비밀번호 정책 위반 | 422 (Pydantic) |
| 민감정보 동의 누락 | 422 `민감정보 처리에 동의해야 가입할 수 있습니다` |

### API
- `POST /api/v1/auth/email/request-otp` — body: `{ email }` → 204
- `POST /api/v1/auth/email/verify-otp` — body: `{ email, code }` → `{ email_verify_token }`
- `POST /api/v1/auth/register/counselor` — body: `{ email, password, name, email_verify_token, consents }` → `{ user, access_token, refresh_token }` (role=counselor 고정)
- `POST /api/v1/auth/register/client` — body: `{ email, password, name, email_verify_token, consents }` → `{ user, access_token, refresh_token }` (role=client 고정)

### 수락 기준 (QA)
- [ ] "상담사 가입" 진입 시 role=counselor로 DB 저장된다
- [ ] "회원가입" 진입 시 role=client로 DB 저장된다
- [ ] 비밀번호는 Argon2id로 해시되어 저장된다 (DB에서 평문 미존재 확인)
- [ ] OTP는 10분 후 만료된다 (재시도 시 400)
- [ ] OTP 재발송은 60초 쿨다운 후에만 가능하다 (429 응답)
- [ ] 민감정보 동의(`sensitive=false`) 시 가입이 거부된다 (422)
- [ ] 동일 이메일 중복 가입은 차단된다 (409)
- [ ] 가입 성공 시 `Consent` 3종이 모두 DB에 기록된다
- [ ] `email_verify_token` 없이 register 호출 시 401

---

## F1.2 로그인 / 로그아웃 / 토큰 갱신 (실패 잠금 · Refresh 회전)

### 액터
Guest(로그인) / 인증 사용자(로그아웃·갱신)

### 메인 플로우
1. **로그인**: `POST /auth/login` → 검증 성공 시 Access(15분) + Refresh(14일) 발급, Refresh의 `jti`를 `RefreshToken` 테이블에 저장.
2. **실패 잠금**: 동일 이메일 5회 연속 실패 시 15분간 423 응답. 성공 시 실패 카운트 리셋.
3. **토큰 갱신**: `POST /auth/refresh` → 기존 Refresh를 폐기하고 새 Access+Refresh 발급(회전). 이미 폐기된 토큰 재사용 시 해당 사용자의 모든 Refresh 무효화(탈취 의심).
4. **로그아웃**: `POST /auth/logout` → 현재 Refresh `jti` 폐기.

### 예외 처리
| 케이스 | 응답 |
|---|---|
| 비밀번호 불일치 | 401 `이메일 또는 비밀번호가 일치하지 않습니다` (실패 카운트 +1) |
| 5회 초과 잠금 | 423 `로그인이 일시적으로 잠겼습니다. 15분 후 다시 시도해주세요` |
| 폐기된 Refresh 재사용 | 401 + 해당 user의 모든 Refresh invalidate |

### API
- `POST /api/v1/auth/login` (확장) — body: `{ email, password }` → `{ access_token, refresh_token, user }`
- `POST /api/v1/auth/refresh` — body: `{ refresh_token }` → `{ access_token, refresh_token }`
- `POST /api/v1/auth/logout` — 인증 필요, body: `{ refresh_token }` → 204

### 수락 기준 (QA)
- [ ] 5회 연속 실패 후 6회째 로그인 시 423 응답
- [ ] 잠금 시작 15분 경과 후 정상 로그인 가능
- [ ] 로그인 성공 시 실패 카운트가 0으로 리셋된다
- [ ] `/auth/refresh` 호출 시 기존 Refresh는 폐기되고 새 토큰 쌍 발급된다
- [ ] 폐기된 Refresh를 다시 사용하면 401 + 해당 사용자 모든 Refresh가 invalidate된다
- [ ] `/auth/logout` 후 동일 Refresh로 갱신 시 401

---

## F1.3 상담사 온보딩 4단계

### 액터
회원가입 직후 `role=counselor` 사용자 (`verified_tier='unverified'`)

### 메인 플로우
- **Step 1 — 기본 정보**: 이름·이메일(읽기전용)·연락처
- **Step 2 — 상세 정보**: 성별, 생년월일, 경력연수, 전문 분야(다중 선택)
- **Step 3 — 자격 증빙**: 소속 형태(센터 소속/프리랜서) + 자격증 파일 업로드 (F2/F3 연결). 본 스펙에서는 **placeholder API**만 정의(상세 검증 파이프라인은 F3 스프린트에서).
- **Step 4 — 프로필**: 프로필 사진(S3 업로드) + 한줄 소개(bio) + AI 검증 진행 안내 표시.
- **완료**: 상담사 코드 6자리 발급(unique), 인증 등급 뱃지 표시. `verified_tier`는 Step 3 미완료 시 `unverified` 유지.

### 예외 처리
- Step 3 미완료 시 가입은 보류(`unverified`). 본인 대시보드 접근은 가능하나 내담자 매칭 API는 403.
- 파일 업로드 실패 → 다시 시도 가능 (idempotent).

### API
- `GET /api/v1/onboarding/me` — 현재 진행 상태(완료 단계, 입력값) 조회
- `PUT /api/v1/onboarding/counselor/step1` — body: `{ name, phone }`
- `PUT /api/v1/onboarding/counselor/step2` — body: `{ gender, birth_date, years_of_experience, specialties[] }`
- `PUT /api/v1/onboarding/counselor/step3` — body: `{ affiliation_type, credential_files[] }` (placeholder)
- `PUT /api/v1/onboarding/counselor/step4` — body: `{ profile_image_url, bio }`
- `POST /api/v1/onboarding/counselor/complete` → `{ counselor_code, verified_tier }`

### 수락 기준 (QA)
- [ ] Step 1~4 순차 입력 시 `OnboardingProgress`에 단계별 완료 시각이 저장된다
- [ ] Step 3 미완료 상태에서 `/onboarding/counselor/complete` 호출 시 400
- [ ] 완료 후 상담사 코드 6자리(영숫자 대문자)가 유일하게 발급된다
- [ ] Step 3 미완료 사용자는 `verified_tier='unverified'`로 유지된다
- [ ] 프론트에서 새로고침 시 `GET /onboarding/me`로 현재 단계 복원이 가능하다

---

## F1.4 내담자 온보딩 4단계

### 액터
회원가입 직후 `role=client` 사용자

### 메인 플로우
- **Step 1 — 기본 정보**: 이름·연락처
- **Step 2 — 상세 정보**: 성별, 생년월일, 주요 호소(선택), 관심 영역
- **Step 3 — 프로필**: 프로필 사진 + 한줄 소개(선택)
- **Step 4 — 상담사 코드 입력**: 6자리 OTP 스타일 입력 → 검증 → 매칭

### 예외 처리
| 케이스 | 응답 |
|---|---|
| 잘못된 코드 | 404 `상담사 코드를 찾을 수 없습니다` |
| 매칭 상담사 `verified_tier < verified` | 403 `해당 상담사는 아직 인증이 완료되지 않아 매칭할 수 없습니다` |

### API
- `PUT /api/v1/onboarding/client/step1` — `{ name, phone }`
- `PUT /api/v1/onboarding/client/step2` — `{ gender, birth_date, concerns[], interests[] }`
- `PUT /api/v1/onboarding/client/step3` — `{ profile_image_url, bio }`
- `POST /api/v1/onboarding/client/step4-match` — `{ counselor_code }` → `{ matched_counselor }`
- `POST /api/v1/onboarding/client/complete`

### 수락 기준 (QA)
- [ ] 잘못된 코드(미존재) 입력 시 404 + 명확한 한국어 메시지
- [ ] `verified_tier='unverified'`인 상담사 코드로는 매칭 거부 (403)
- [ ] 매칭 성공 시 `ClientCounselorLink` 레코드가 생성된다
- [ ] Step 4 미완료여도 Step 1~3은 저장된다(중도 이탈 시 재진입 가능)

---

## F1.5 비밀번호 재설정 (이메일 링크 30분 · 직전 3개 차단)

### 액터
Guest(이메일 기억) / 로그인 사용자

### 메인 플로우
1. `POST /auth/password/forgot` — body: `{ email }` → 이메일에 30분 유효 토큰 링크 발송. (이메일 존재 여부와 무관하게 204, enumeration 방지)
2. 사용자가 링크 클릭 → 프론트 `/reset-password?token=...` → 새 비밀번호 입력 → `POST /auth/password/reset` — body: `{ token, new_password }`
3. 검증: 토큰 유효 + 새 비밀번호가 직전 3개와 다름 (별도 `PasswordHistory` 테이블, 항상 최근 3개 유지).
4. 성공 시 모든 Refresh 폐기(보안 조치).

### 예외 처리
| 케이스 | 응답 |
|---|---|
| 토큰 만료/무효 | 400 `재설정 링크가 만료되었습니다. 다시 요청해주세요` |
| 직전 3개 재사용 | 422 `최근에 사용한 비밀번호는 재사용할 수 없습니다` |
| 정책 위반 | 422 |

### API
- `POST /api/v1/auth/password/forgot` — `{ email }` → 204
- `POST /api/v1/auth/password/reset` — `{ token, new_password }` → 204

### 수락 기준 (QA)
- [ ] 미가입 이메일에도 동일한 204 응답을 반환한다(enumeration 방지)
- [ ] 토큰은 30분 후 만료된다
- [ ] 직전 3개 비밀번호 중 어떤 것이라도 재사용 시 422
- [ ] 재설정 성공 시 해당 사용자의 모든 Refresh가 폐기된다
- [ ] 토큰은 1회용(사용 후 즉시 폐기)

---

## 추적성 매트릭스

| F-ID | 핵심 변경 BE | 핵심 변경 FE |
|---|---|---|
| F1.1 | `auth.py`·`email_otp.py`·`consent.py`·`tasks/email.py` | `RegisterPage.tsx` |
| F1.2 | `auth.py`·`refresh_token.py`·`login_attempt.py` | `LoginPage.tsx`(API 연동) |
| F1.3 | `onboarding.py`·`onboarding_progress.py` | `CounselorOnboardingPage.tsx` (4 step) |
| F1.4 | `onboarding.py`·`client_counselor_link.py` | `ClientOnboardingPage.tsx` (4 step) |
| F1.5 | `password_reset.py`·`password_history.py` | `ForgotPasswordPage.tsx`·`ResetPasswordPage.tsx` |
