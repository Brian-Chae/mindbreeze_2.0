# 관리자 비밀번호 재설정 기획안

> 플랫폼 관리자·기관 관리자가 **활성(active) 계정**(기관 주 담당자·상담사)의 비밀번호를 재설정하는 기능.
> 기관 관리 화면(기관 상세 모달)에서 동작한다. 작성일: 2026-09-17

---

## 1. 배경 및 문제 정의

- 상담사·주 담당자가 비밀번호를 분실하면 현재는 **본인이 직접** `비밀번호 찾기`(`POST /auth/password/forgot`)를 써야 함
- 그러나 현장에서는 관리자에게 전화·메신저로 "비밀번호 풀어달라"는 요청이 먼저 들어오는 경우가 많음
  - 이메일 수신 문제(스팸함, 사내 메일 필터), 고령·비숙련 사용자, 긴급 세션 직전 등
- 관리자가 대신 처리할 수 있는 공식 경로가 없어 임시 방편(계정 재생성, DB 직접 수정 등)이 발생할 위험
- **pending 계정**(초대 수락 전)은 기존 `resend-invite`로 해결되지만, **active 계정**은 관리자가 개입할 수단이 전혀 없음 — 이 공백을 메우는 것이 본 기획의 범위
- 원칙: **이메일 = 아이디(변경 불가)**, 관리자가 재설정하는 것은 **비밀번호뿐** (Brian 확정 방침)

---

## 2. 현재 구조 분석

### 2.1 비밀번호 재설정 (사용자 본인용)

- `backend/app/services/password_reset_service.py`
  - `initiate_reset(email)` — JWT(jti 포함, **TTL 30분**) 발급 → Redis `pwd_reset:{jti}` 저장 → 재설정 링크 이메일 발송
  - `complete_reset(token, new_password)` — JWT+Redis 검증 → 비밀번호 변경 + `PasswordHistory` 기록 + jti 삭제(일회용)
  - 미존재 이메일도 조용히 통과(계정 존재 노출 방지)
- API: `POST /auth/password/forgot`(항상 204), `POST /auth/password/reset`
- 비밀번호 정책: 8자 이상 + 영문·숫자·특수문자 (`_PASSWORD_RE`), 직전 3개 재사용 검사(`check_password_history`)

### 2.2 초대 토큰 인프라 (`org_invite_service.py`)

- `_issue(user, token_type)` — JWT(jti, **TTL 7일**) 발급 → Redis `{prefix}:{jti}` 저장 → `/set-password?token=` 링크 반환
- token_type 화이트리스트: `org_admin_invite` / `counselor_invite` / `client_invite` (`ALLOWED_INVITE_TYPES`)
- `consume_invite(token, new_password)` — 검증 → 비밀번호 설정 + **`status = "active"` 강제 전환** + 계정 활성화
- 재발송 쿨다운: `check_resend_cooldown` / `mark_resent` — 기관당 60초 1회 (Redis)
- 설계 철학(코드 주석 명시): **"임시 비밀번호를 메일로 보내지 않으므로, 유출 시에도 계정이 곧바로 탈취되지 않는다"**

### 2.3 기존 관리자 기능

- `POST /admin/orgs/{org_id}/resend-invite` — **pending** 주 담당자에게 초대(비밀번호 설정) 링크 재발송
- `POST /orgs/{org_id}/counselors/{user_id}/resend-invite` — pending 상담사 초대 재발송 (기관 관리자)
- `POST /admin/clients` — 내담자 수동 추가(pending + 초대)
- 프론트: `org-detail-modal.tsx`(주 담당자 카드 + 상담사 탭), `org-counselor-action.tsx`(행 드롭다운 — 역할 변경/소속 해제), `org-management-actions.tsx`
- `SetPasswordPage` — 초대 토큰으로 최초 비밀번호 설정 화면(`/set-password?token=`)

### 2.4 재사용 가능한 인프라 (이번 기획의 토대)

| 인프라 | 위치 | 재사용 포인트 |
|---|---|---|
| 감사 기록 | `VerificationAudit(target_type, target_id, admin_id, action, reason, extra)` | 기관 수정·비활성화에서 이미 사유 필수 + before/after 스냅샷 패턴 확립 (`org_management_service.commit_change`) |
| 세션 무효화 | `refresh_token_service.revoke_all_user_tokens(user_id, db)` | 리프레시 토큰 재사용 감지 시 이미 사용 중 — 재설정 후 강제 로그아웃에 그대로 활용 |
| 토큰 발급 | `org_invite_service._issue` / `password_reset_service` | JWT+Redis jti 일회용 토큰 메커니즘 동일 — token_type만 추가하면 됨 |
| 비밀번호 정책 | `_PASSWORD_RE` + `PasswordHistory` | 재설정 시에도 동일 정책 적용 |
| 쿨다운 | Redis `setex` 60초 패턴 | 남용 방지(이메일 폭탄)에 재사용 |

### 2.5 계정 상태와 기능 공백

- `User.status`: `active` / `pending`(초대 수락 전) / `suspended`
- **공백**: active 계정 비밀번호를 관리자가 재설정하는 기능 부재 (resend-invite는 pending 전용)

---

## 3. 재설정 방식 설계 — 비교와 권고

### 3.1 후보 비교

| 항목 | A. 임시 비밀번호 발급 | B. 재설정 링크 (신규 token_type) | C. 초대 토큰 그대로 재사용 |
|---|---|---|---|
| 동작 | 관리자가 임시 비밀번호를 생성해 전달, 대상자가 로그인 후 변경 | 관리자가 트리거 → 대상자 이메일로 일회용 링크 → 대상자가 새 비밀번호 직접 설정 | 기존 `counselor_invite` 등 초대 토큰을 active 계정에 재발급 |
| 유출 위험 | **높음** — 비밀번호 원문이 화면·메신저·메일에 노출, 관리자가 대상자 비밀번호를 아는 구간 발생 | 낮음 — 링크만 노출, 비밀번호는 대상자만 앎, 일회용+TTL | 낮음 (B와 동일 메커니즘) |
| 이메일 소유 증명 | 없음 (전달 경로 통제 불가) | **있음** — 등록 이메일로만 수신 가능 | 있음 |
| 기존 코드 재사용 | 낮음 — 임시 비밀번호 생성·강제 변경 플래그 등 신규 개발 | **높음** — `_issue` 메커니즘 + `SetPasswordPage` 재사용 | 높음 |
| 시멘틱 문제 | 강제 변경 플래그(`must_change_password`) 신규 필요 | 없음 — 신규 type으로 초대/재설정 구분 명확 | **있음** — `consume_invite`가 `status="active"` 강제 전환·`verified_tier` 갱신 등 "초대 수락" 시멘틱 수행. pending 초대 재발송과 감사·통계·문구가 뒤섞임 |
| 감사 추적 | 비밀번호 원문 취급 이력 관리 부담 | 명확 — 발급·사용 각각 기록 가능 | 초대와 재설정 로그 구분 불가 |
| 대상자 UX | 임시 비번 입력 → 강제 변경 2단계 | 링크 클릭 → 새 비밀번호 설정 1단계 | 문구가 "초대"로 표시되어 혼란 |

### 3.2 권고: **B안 — 재설정 링크 (신규 token_type `admin_password_reset`)**

- 근거
  - `org_invite_service` 설계 철학과 일치: 비밀번호 원문을 어떤 채널에도 흘리지 않음
  - 관리자가 대상자 비밀번호를 알 수 없음 → 상담 데이터 접근 통제(데이터 프라이버시 규칙) 관점에서 필수
  - 기존 JWT+Redis jti 일회용 토큰 인프라와 `SetPasswordPage`를 최소 수정으로 재사용 — 실용성·단순화 원칙 부합
  - C안은 코드는 아끼지만 초대 시멘틱 오염(상태 강제 전환·감사 혼선)이 커서 배제
  - A안(임시 비밀번호)은 유출 위험으로 배제 — 단, 이메일 수신이 불가능한 예외 상황 대응은 §6.6에서 별도 검토
- 세부 설계
  - **token_type**: `admin_password_reset` — `ALLOWED_INVITE_TYPES`에 넣지 않고 별도 소비 경로로 처리(초대 수락 로직과 격리)
  - **TTL: 24시간** — 본인용(30분)보다 길게: 관리자가 발급한 시점에 대상자가 자리에 없을 수 있음. 초대(7일)보다는 짧게: active 계정 탈취 창을 최소화
  - **일회용**: Redis `admin_pwd_reset:{jti}` → 소비 즉시 삭제 (기존 패턴 동일)
  - **재발급 시 기존 토큰 무효화**: 같은 대상자에게 재발급하면 이전 jti 삭제 — 유효 링크는 항상 1개
  - **소비 시**: 비밀번호 정책 검증 + `PasswordHistory` 기록 + **`revoke_all_user_tokens` 호출(전 세션 강제 로그아웃)** — status는 건드리지 않음(active 유지)
  - **pending 계정 요청 시**: 409 등으로 거부하고 "초대 재발송을 사용하세요" 안내 (기능 경계 명확화)
  - **suspended 계정 요청 시**: 거부 — 정지 해제가 선행되어야 함

### 3.3 재설정 후 처리 방침

- **기존 세션 무효화: 필수(무조건)**
  - 재설정 사유의 대부분이 "계정 접근 문제 또는 보안 우려" — 기존 리프레시 토큰을 남겨둘 이유가 없음
  - `revoke_all_user_tokens(user_id)` 1회 호출로 구현 가능. 액세스 토큰은 짧은 만료로 자연 소멸
  - 옵션 토글 없이 고정 동작으로 단순화 (Brian 실용성 원칙)
- **대상자 안내: 필수**
  - 재설정 **발급 시**: "관리자 ○○○(역할)이 회원님의 비밀번호 재설정을 요청했습니다" + 링크 + 유효기간 + "본인이 요청하지 않았다면 문의하세요" 문구를 이메일로 발송
  - 재설정 **완료 시**: "비밀번호가 변경되었고 모든 기기에서 로그아웃되었습니다" 알림 (이메일 + 인앱 알림 `notification_service`)

---

## 4. 권한 매트릭스

| 행위자 ＼ 대상 | 기관 주 담당자 (org_admin) | 상담사 (counselor) | 내담자 (client) |
|---|---|---|---|
| **플랫폼 관리자** | ✅ 모든 기관 | ✅ 모든 기관 | 🔲 범위 외 (후순위 검토) |
| **기관 관리자(주 담당자)** | ❌ (본인 포함 — 본인은 `비밀번호 찾기` 사용) | ✅ **소속 상담사만** | ❌ |
| 상담사 | ❌ | ❌ | ❌ |

- 부가 규칙
  - **자기 자신 재설정 금지**: 관리자 본인은 본인용 플로우(`/auth/password/forgot`) 사용 — 감사 로그 왜곡 방지
  - 기관 관리자의 대상 검증: 대상 상담사가 **해당 기관 소속**인지 서버에서 재검증 (`org_id` 경로 파라미터와 소속 대조, 기존 `_require_org_admin` 패턴)
  - 대상 상태 검증: `active`만 허용. `pending` → resend-invite 안내, `suspended` → 거부
  - 비활성화된 기관(deactivated org)의 구성원: 플랫폼 관리자만 가능 여부 검토 — 1차에서는 **거부**로 단순화(재활성화 후 처리)

---

## 5. 역할별 화면·기능 기획 (기관 관리 화면)

### 5.1 플랫폼 관리자 — 기관 상세 모달 (`org-detail-modal.tsx`)

- **주 담당자 카드**
  - 카드 액션 영역에 `비밀번호 재설정` 버튼 추가
  - 상태별 노출: `active`일 때만 노출. `pending`이면 기존 `초대 재발송` 버튼만 유지 (두 버튼이 동시에 보이지 않음 — 혼동 방지)
- **상담사 탭 — 행 드롭다운 메뉴 (`org-counselor-action.tsx`)**
  - 기존 항목(역할 변경 / 소속 해제) 아래에 `비밀번호 재설정` 항목 추가
  - `active` 상담사에게만 활성화. `pending` 상담사 행에는 기존 `초대 재발송`이 그 자리를 대신함

### 5.2 기관 관리자 — 소속 상담사 관리 화면

- 상담사 목록 행 메뉴에 동일한 `비밀번호 재설정` 항목 추가 (플랫폼 관리자와 동일 컴포넌트 재사용, 권한에 따라 API 경로만 분기)
- 주 담당자 본인 행에는 미노출 (자기 자신 금지 규칙)

### 5.3 공통 — 재설정 확인 다이얼로그

- 흐름: 메뉴 클릭 → 확인 다이얼로그 → 발송 → 결과 토스트
- 다이얼로그 구성
  - 대상 요약: 이름 · 역할 · 이메일(=아이디, 링크 수신 주소임을 명시)
  - **사유 입력(필수, 텍스트)** — 미입력 시 확인 버튼 비활성화 (기관 비활성화의 사유 필수 UX와 동일 패턴)
  - 효과 고지: "대상자 이메일로 재설정 링크가 발송됩니다(24시간 유효). 새 비밀번호 설정 시 모든 기기에서 로그아웃됩니다."
  - 확인 버튼: 파괴적 액션 아님 → 기본(primary) 색상, 단 라벨은 `재설정 링크 발송`으로 행위를 정확히 표기
- 발송 후: 성공 토스트("○○○님에게 재설정 링크를 발송했습니다") / 쿨다운 중이면 429 안내("60초 후 다시 시도")

### 5.4 대상자(상담사·주 담당자) 화면

- 이메일 링크 → `SetPasswordPage` 재사용 (`/set-password?token=`)
  - 토큰 type에 따라 헤딩·문구 분기: 초대("비밀번호를 설정하고 시작하세요") vs 재설정("새 비밀번호를 설정하세요")
  - 완료 후 로그인 페이지로 이동 (초대 플로우와 동일)
- 만료·사용된 토큰: "링크가 만료되었습니다. 관리자에게 재발급을 요청하세요" 안내

---

## 6. API 설계 방향

### 6.1 엔드포인트

| 메서드·경로 | 행위자 | 대상 | 비고 |
|---|---|---|---|
| `POST /api/v1/admin/orgs/{org_id}/primary-admin/password-reset` | 플랫폼 관리자 | 기관 주 담당자 | `require_platform_admin` |
| `POST /api/v1/admin/orgs/{org_id}/counselors/{user_id}/password-reset` | 플랫폼 관리자 | 상담사 | 기존 `/admin/orgs/{org_id}/counselors/{user_id}` PATCH/DELETE와 나란히 |
| `POST /api/v1/orgs/{org_id}/counselors/{user_id}/password-reset` | 기관 관리자 | 소속 상담사 | `_require_org_admin` + 소속 검증 |
| `POST /api/v1/auth/password/reset-by-token` (또는 기존 `consume` 경로 확장) | 대상자(비로그인) | — | `admin_password_reset` 토큰 소비. 초대 소비(`consume_invite`)와 **별도 함수**로 구현 |

- 요청 본문: `{ "reason": "string (필수, 공백 불가)" }` — 사유 없으면 422
- 응답: `{ "email_sent": bool, "expires_at": datetime }` — 토큰 원문은 절대 응답에 포함하지 않음 (기존 `_issue` 원칙: 토큰은 이메일 본문에만 존재)

### 6.2 서비스 계층

- 신규 `admin_password_reset_service.py` (또는 `password_reset_service` 내 함수 추가 — 파일 규모 작으므로 후자도 가능, 구현 시 결정)
  - `issue_admin_reset(target_user, admin, reason, db, redis)` — 검증(권한·상태) → 기존 jti 무효화 → 토큰 발급 → 이메일 발송 → 감사 기록
  - `complete_admin_reset(token, new_password, db, redis)` — 검증 → 비밀번호 변경 + `PasswordHistory` + `revoke_all_user_tokens` + 완료 알림 + 감사 기록
- 공통 로직(JWT 인코딩/디코딩, Redis jti 관리, 비밀번호 검증)은 기존 서비스에서 추출·재사용

### 6.3 권한 검사 (서버 필수 검증 순서)

1. 인증 + 역할 확인 (플랫폼 관리자 / 기관 관리자)
2. 기관 관리자인 경우: 요청 `org_id`의 관리자인지 + 대상이 해당 기관 소속 상담사인지
3. 대상 ≠ 요청자 본인
4. 대상 `status == "active"` (pending → 409 + resend-invite 안내, suspended → 409)
5. 기관 활성 상태 확인
6. 쿨다운 확인 (§7.4)

### 6.4 감사 기록

- 기존 `VerificationAudit` 재사용 — `org_management_service.commit_change` 패턴 준수
  - 발급: `action="password_reset_issued"`, `target_type="user"`, `target_id=대상 user_id`, `admin_id`, `reason`(필수), `extra={"org_id", "target_role", "expires_at"}`
  - 완료: `action="password_reset_completed"`, `extra={"issued_by": admin_id}` — 누가 발급한 재설정이 언제 소비됐는지 추적
- 데이터 프라이버시 규칙(접근 로깅 6개월 보관)과 정합

---

## 7. 보안 고려사항

### 7.1 사유 필수 + 감사

- 관리자 재설정은 계정 탈취 벡터가 될 수 있는 고위험 행위 → **사유 없이는 API가 동작하지 않음** (프론트 비활성화 + 서버 422 이중 방어)
- 발급·완료 모두 감사 기록 (§6.4) — 내부자 남용 사후 추적 가능

### 7.2 토큰 안전성

- 비밀번호 원문 무전송 원칙 유지 — 링크 방식만 사용
- 토큰 원문은 이메일 본문에만 존재 (DB·로그·API 응답 저장 금지 — 기존 `_issue` 원칙)
- 일회용(jti 즉시 삭제) + TTL 24시간 + 재발급 시 이전 토큰 무효화
- 링크 수신처는 등록 이메일 고정 — 관리자가 수신 주소를 바꿀 수 없음(이메일=아이디 불변 원칙과 일치)

### 7.3 세션 무효화

- 재설정 완료 시 `revoke_all_user_tokens` 무조건 호출 — 탈취된 세션이 있어도 차단
- 완료 알림에 "모든 기기에서 로그아웃됨"을 명시해 대상자가 이상 징후를 인지할 수 있게 함

### 7.4 남용 방지

- 쿨다운: 대상 사용자당 60초 1회 (Redis `admin_pwd_reset_cooldown:{user_id}` — 기존 60초 패턴 재사용). 기관 단위가 아닌 **대상자 단위**로 적용해 여러 상담사 연속 처리 업무는 막지 않음
- 일일 상한(예: 동일 대상 1일 5회) 검토 — 1차는 쿨다운만, 상한은 로그 모니터링 후 필요 시 추가
- 발급 알림 이메일에 "본인이 요청하지 않았다면 문의" 문구 — 관리자 계정 탈취 시 대상자가 조기 인지

### 7.5 기타

- 계정 존재·상태 정보는 관리자 화면에 이미 노출된 범위 내에서만 응답 (외부 노출 없음)
- 재설정 페이지에 새 비밀번호 정책 안내 + `PasswordHistory` 직전 3개 재사용 차단 적용 여부: 본인용과 동일하게 **적용** 권고

### 7.6 예외 상황 — 이메일 수신 불가 대상자 (후순위)

- 링크 방식의 한계: 등록 이메일 수신이 아예 불가능한 경우(메일 서버 폐쇄 등) 처리 불가
- 이 경우는 "이메일=아이디" 원칙상 사실상 계정 이전 문제 → 별도 운영 절차(플랫폼 관리자 수동 확인)로 다루고, 본 기능 범위에서 제외
- 임시 비밀번호 방식을 예외 경로로도 도입하지 않음 — 유출 위험이 예외 상황의 편익을 상회

---

## 8. 우선순위 및 단계

### Phase 1 — 핵심 (MVP)

- [ ] 토큰: `admin_password_reset` type 발급·소비 (TTL 24h, 일회용, 재발급 시 이전 무효화)
- [ ] API 3종: 플랫폼(주 담당자·상담사) + 기관 관리자(소속 상담사), 사유 필수
- [ ] 소비 시 세션 무효화(`revoke_all_user_tokens`) + `PasswordHistory` 기록
- [ ] 감사 기록: `VerificationAudit` 발급/완료 2종
- [ ] UI: 기관 상세 모달 주 담당자 카드 버튼 + 상담사 행 메뉴 항목 + 확인 다이얼로그(사유 입력)
- [ ] `SetPasswordPage` 문구 분기 (초대 vs 재설정)
- [ ] 이메일 2종: 재설정 링크 발송 + 완료 알림
- [ ] 쿨다운(대상자당 60초)

### Phase 2 — 보강

- [ ] 인앱 알림(`notification_service`) 연동 — 완료 시 대상자 알림
- [ ] 기관 관리자용 소속 상담사 화면 메뉴 통합(컴포넌트 재사용 확인)
- [ ] 감사 로그 조회 화면에 재설정 이력 노출 (기존 감사 뷰 확장)

### Phase 3 — 후순위 검토

- [ ] 일일 재설정 상한 (모니터링 결과 기반)
- [ ] 내담자(client) 계정 재설정 지원 여부 — 동의·프라이버시 검토 선행
- [ ] 이메일 수신 불가 예외 운영 절차 문서화

---

## 9. 미결 사항 (구현 착수 전 확인)

- TTL 24시간 확정 여부 (대안: 업무시간 고려 48시간)
- `admin_password_reset` 소비 엔드포인트를 기존 초대 소비 API에 통합할지, 별도 경로로 둘지 (권고: 별도 함수 + `SetPasswordPage`에서 type 무관 단일 제출 경로 유지가 프론트 단순)
- 재설정 링크 발송 이메일 템플릿 문구 (관리자 이름 노출 범위 — 이름 전체 vs 역할만)
