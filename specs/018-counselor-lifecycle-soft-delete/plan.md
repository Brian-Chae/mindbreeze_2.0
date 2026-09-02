# SDD-018 계획

## 구현 전략
이번 변경은 상태모델, 인증, 기관 관리자 UX, 플랫폼 관리자 UX, 데이터 보존 정책이 얽힌 구조 변경이다. 따라서 하드 삭제 기능 위에 soft delete를 덧씌우지 말고, 상태모델 → 인증 게이트 → org 관리 → platform 관리 → blocked UX 순서로 단계 분리한다.

## 작업 스트림

### Track A — 데이터 모델 / 백엔드 정책
1. `users` 상태 확장 및 추적 컬럼 Alembic 마이그레이션 추가
2. 상태 상수/스키마 정리 (`pending/active/inactive/suspended/deleted`)
3. org_admin 보호 규칙 추가
   - 자기 자신 비활성화 금지
   - 마지막 org_admin 비활성화/강등 금지
   - `primary_admin_id` 비활성화/강등 금지
4. `soft_delete_user()`와 `hard_delete_user()` 분리
5. `remove_counselor()` 의미 정리 또는 deprecate

### Track B — 인증/세션 게이트
1. `/auth/login` 상태 검사
2. `/auth/refresh` 상태 재조회
3. `get_current_user()` 상태 검사
4. `password_reset_service` 상태 검사 + 절대 URL + 토큰 폐기
5. `org_invite_service.consume_invite()` 상태 검사
6. WebSocket 인증 경로 상태 검사
7. 상태 변경 시 `revoke_all_user_tokens()` 공통화

### Track C — 기관 관리자 API / UX
1. `PATCH /role`, `PATCH /status`, `POST /password-reset`, `POST /cancel-invite` 설계 반영
2. 기존 org dashboard의 초대/목록/행 액션 분리
3. `OrgCounselorManagementPage` 신설
4. 상태 배지/필터/행 액션 추가
5. org_admin UI에서 삭제/소속해제 액션 제거

### Track D — 플랫폼 관리자 UX / 위험 액션 구조화
1. `UserManagementPage` 상태 기반 표시로 전환
2. 정지/정지해제 유지
3. soft delete 기본화
4. deleted 탭 + 복구 버튼 추가
5. hard delete를 Danger Zone으로 격리

### Track E — 상담사 차단 UX
1. 로그인 오류 코드 표준화
2. `LoginPage` 상태별 메시지 분기
3. `/account-blocked` 페이지 추가
4. inactive/suspended/deleted/pending 별 문구 정의

## API 계약 초안
### Org
- `PATCH /org/{org_id}/counselors/{user_id}/role`
- `PATCH /org/{org_id}/counselors/{user_id}/status`
- `POST /org/{org_id}/counselors/{user_id}/password-reset`
- `POST /org/{org_id}/counselors/{user_id}/cancel-invite`
- 기존 `PUT /org/{org_id}/counselors/{user_id}` → deprecated
- 기존 `DELETE /org/{org_id}/counselors/{user_id}` → 삭제 의미로 사용 금지

### Admin
- `POST /admin/users/{user_id}/suspend`
- `POST /admin/users/{user_id}/unsuspend`
- `DELETE /admin/users/{user_id}` → soft delete
- `POST or DELETE /admin/users/{user_id}/restore`
- `DELETE /admin/users/{user_id}/hard-delete`

## 프론트 IA 초안
### org_admin
- `/dashboard/org`: KPI + 최근 초대/스냅샷
- `/dashboard/org/counselors` 또는 `/org/counselors`: 상담사 전용 관리 화면

### platform_admin
- `/admin/users`: 상태 필터 + deleted 탭 + danger zone

### counselor
- `/login`
- `/account-blocked?reason=inactive|suspended|deleted|pending`

## 리스크 및 완화
1. 상태 강제 추가 후 기존 토큰 세션이 대량 만료될 수 있음 → verify에 세션 폐기 테스트 포함
2. 기존 DELETE 의미 변경 시 회귀 위험 → 삭제 재해석 금지, 별도 엔드포인트로 우회
3. 이메일 재사용 정책 변경 혼란 → deleted 이메일 재사용 금지로 단순화
4. 과거 hard delete 데이터는 복구 불가 → summary에 운영 한계 명시
5. org_admin 목록에 org_admin도 함께 포함되어 자기 자신 조작 리스크 존재 → 서버/프론트 이중 보호

## 구현 순서 권고
1. 모델/마이그레이션
2. 인증 게이트
3. org API
4. admin API
5. org 프론트
6. admin 프론트
7. blocked UX
8. 회귀 테스트
