# SDD-075 — 플랫폼 관리자 기관 수정 + 비활성화

> 기획안 `docs/org-management-crud-기획.md`의 2단계(기관 수정) + 3단계(기관 비활성화).
> SDD-074(조회 MVP) 위에 기관 정보 수정과 비활성화/재활성화를 구현한다.
> 상담사 관리(역할 변경/소속 해제)는 귀속 이력 정책 확정 후 별도 단계(2-1)로 둔다.

## 1. 범위
- 기관 수정: 기관명/전화/주소/인증 상태 (기관 코드·유형·생성일·소유자 읽기 전용)
- 기관 비활성화/재활성화: 상태 변경 (데이터·계정·기록 삭제 없음)
- 상담사 관리(역할 변경/소속 해제)는 제외 (다음 단계)

## 2. 구현 (codex gpt-6-astra)

### T1. BE — 기관 수정 API
- `PATCH /admin/orgs/{org_id}` → 수정된 상세 반환. require_platform_admin
- 입력: name?, phone?, address?, verified?, reason?. 수정 버전 If-Match 전달
- 누락 필드 유지, phone/address의 명시적 null은 삭제, 기관명 공백/빈 문자열/null 거부
- 인증 false→true 시 verified_at 기록, true→false 시 비우고 이전 값 감사 기록. 동일 값 재저장 시 시각 불변
- 길이 제한: 기관명 200, 전화 20, 주소 300

### T2. BE — 기관 비활성화/재활성화 API
- `GET /admin/orgs/{org_id}/deactivation-impact` → 소속 계정 수, 활성 연결 수, 진행/예정 세션 수, blockers, can_deactivate, version
- `POST /admin/orgs/{org_id}/deactivate` → 비활성화 (reason, confirmation_value, If-Match). 진행/예정 세션 있으면 409 차단
- `POST /admin/orgs/{org_id}/reactivate` → 재활성화 (reason). 감사 기록
- 신규 Organization 필드: deactivated_at, deactivated_by, deactivation_reason, version (Alembic 마이그레이션)
- 비활성화 기관: 목록 기본 제외, 상태 필터로 조회, 기관 코드 가입/초대/새 세션 차단

### T3. FE — 모달에 수정/비활성화 UI
- 기관 정보 탭에 "정보 수정" 모드: 기관명/전화/주소/인증 상태 편집 → 저장 (If-Match 버전 충돌 안내)
- 하단 구분 영역 "기관 비활성화" 버튼 → 영향 조회 표시 → 기관 코드 입력 + 사유 + 보존 안내 동의 → 실행
- "기관 운영 종료(비활성화)" confirm, 재활성화 버튼(비활성화 기관)
- 목록: 상태 필터(운영/비활성화), 기본 운영 기관

## 3. 주의
- 비활성화는 상태 변경일 뿐, 데이터·계정·기록 삭제 금지. 재활성화 가능
- 기관 코드/사업자 식별자 재사용 금지
- 감사 기록: 행위자 ID·대상·행위·변경 전후·사유·시각
- 플랫폼 관리자라도 상담 내용·리포트·채팅 열람 금지
- 개인 기관(kind=individual) 비활성화는 초기 차단 (별도 승인)

## 4. 완료 기준
- 기관 정보 수정(이름/전화/주소/인증) + 감사 기록 + 버전 충돌 처리
- 기관 비활성화(진행 세션 시 차단) + 재활성화 + 상태 필터
- BE pytest 통과, FE build 0 error
