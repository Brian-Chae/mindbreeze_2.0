# SDD-018 Verify

## 구현 전 반드시 검증할 질문
1. `inactive`는 로그인 자체 차단으로 갈지, 로그인 허용 + 업무 차단으로 갈지? 본 기획은 로그인 차단을 권고한다.
2. `deleted` 계정의 `org_id`를 유지할지 별도 tombstone 컬럼으로 분리할지? 본 기획은 유지 + 일반 목록 필터를 권고한다.
3. `verification_audits`를 hard delete에서 제외할 수 있는지 법무/운영 관점 확인이 필요한가?
4. deleted 이메일 재사용 금지 정책이 운영상 수용 가능한가?

## 백엔드 검증 시나리오
- `pending/inactive/suspended/deleted` 로그인 실패
- 상태 변경 후 refresh token 재발급 실패
- `get_current_user()`가 비활성/정지/삭제 계정을 차단
- org_admin은 `active/inactive`만 설정 가능
- org_admin은 `suspended/deleted` 변경 불가
- org_admin은 자기 자신/마지막 org_admin/primary_admin 비활성화 및 강등 불가
- `DELETE /admin/users/{id}`가 물리 삭제가 아니라 soft delete 수행
- hard delete만 데이터 물리 삭제 수행
- password reset 링크는 절대 프론트 URL 사용
- password reset 완료 후 기존 refresh token 폐기
- pending 초대 취소 후 set-password 실패

## 프론트 검증 시나리오
- org_admin 사이드바에 상담사 관리 메뉴 노출
- 기관 관리자 목록에서 삭제 UI 미노출
- 활성/비활성 토글과 플랫폼 정지 뱃지 구분
- pending/active/inactive/suspended/deleted 상태 배지 및 필터 동작
- platform admin에서 deleted 탭/복구/영구삭제 분리 노출
- LoginPage가 `ACCOUNT_*` 코드별로 다른 메시지 표시
- `/account-blocked`가 상태별 안내 문구 표시

## 회귀 포인트
- SDD-017 초대/수락 플로우가 깨지지 않아야 함
- org dashboard의 기존 초대/재발송 기능이 유지되어야 함
- platform admin 사용자 목록 필터/페이지네이션 응답 shape가 프론트 타입과 일치해야 함
- public org counselor 노출이 active만 대상으로 유지되어야 함

## 출시 게이트
- 백엔드 pytest 전체 통과
- 프론트 타입체크/빌드 통과
- 상태변경 후 토큰 차단 수동 검증
- soft delete 후 과거 세션/리포트/EEG 보존 수동 검증
- hard delete는 deleted 상태에서만 가능한지 수동 검증
