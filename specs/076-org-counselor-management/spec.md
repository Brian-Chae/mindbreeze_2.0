# SDD-076 — 플랫폼 관리자 상담사 관리 (역할 변경 + 소속 해제)

> 기획안 `docs/org-management-crud-기획.md`의 2-1단계(상담사 관리).
> SDD-075에서 기관 스냅샷(귀속 이력)을 추가했으므로, 상담사 역할 변경과 소속 해제를 구현한다.

## 1. 범위
- 상담사 역할 변경: counselor ↔ org_admin
- 상담사 소속 해제: User.org_id = None (계정 삭제 아님)
- 보호: 주 담당자(primary_admin)/마지막 활성 org_admin/개인 기관 소유자(owner)는 해제·강등 불가
- 상태 변경(정지/해제)은 기존 /admin/users/{id}/suspend/unsuspend 재사용 (별도 구현 아님)

## 2. 구현 (codex gpt-6-astra)

### T1. BE — 상담사 역할 변경
- `PATCH /admin/orgs/{org_id}/counselors/{user_id}` → {role, reason}. require_platform_admin
- counselor ↔ org_admin만 허용. platform_admin/client 변경 거부
- 대상이 URL 기관 소속인지 검증. 주 담당자/마지막 활성 org_admin/개인 기관 소유자 강등 차단
- 감사 기록(행위자/대상/행위/전후/사유)

### T2. BE — 상담사 소속 해제
- `DELETE /admin/orgs/{org_id}/counselors/{user_id}` → 204. {reason}
- User.org_id = None (소속 해제만, 계정 삭제/탈퇴 아님). org_admin이면 counselor로 변경
- 진행/예정 세션 또는 활성 내담자 연결 있으면 409 차단
- 주 담당자/마지막 활성 org_admin/개인 기관 소유자 해제 불가
- 감사 기록, 권한 캐시 재평가

### T3. FE — 상담사 탭 행 메뉴
- 상담사 테이블 행에 역할 변경/소속 해제 메뉴
- 역할 변경 확인(역할 변경 안내 + 사유), 소속 해제 확인(영향 안내 + 사유)
- 주 담당자/소유자 배지 표시 (조작 비활성화 + 이유)

## 3. 주의
- 소속 해제는 계정 삭제 아님 — User.org_id만 제거, 과거 기록 보존
- 마지막 org_admin 보호 (기관에 관리자 1명 이상 유지)
- 개인 기관 소유자(owner)는 해제·역할 변경 불가
- 감사 기록, 동시 요청 방지

## 4. 완료 기준
- 상담사 역할 변경(counselor↔org_admin) + 소속 해제
- 보호 대상(주 담당자/마지막 관리자/소유자) 차단
- BE pytest 통과, FE build 0 error
