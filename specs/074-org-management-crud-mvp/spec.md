# SDD-074 — 플랫폼 관리자 기관 관리 CRUD MVP (모달 + 조회)

> 기획안 `docs/org-management-crud-기획.md`의 1단계 MVP.
> 등록 기관 리스트 아이템 클릭 → 기관 정보 + 기관 내 상담사 리스트를 보여주는 두 탭 팝업 모달.
> 이번 단계는 조회만. 수정/비활성화/상담사 관리는 다음 단계.

## 1. 범위 (MVP)
- 기관 상세 조회 API (플랫폼 관리자 전용)
- 기관 내 상담사 리스트 조회 API (플랫폼 관리자 전용 — 기존 org_admin 전용과 분리)
- FE: 두 탭 모달(기관 정보 / 상담사) + 목록 검색·필터·유형 그룹핑
- 수정/비활성화/상담사 역할 변경·소속 해제는 제외 (다음 단계)

## 2. 구현 (codex gpt-6-astra)

### T1. BE — 관리자 기관 상세·상담사 API
- `GET /admin/orgs/{org_id}` → 기관 기본 필드(name, org_code, phone, address, verified, verified_at, kind, created_at) + primary_admin(주 담당자) + owner(개인 기관 소유자) 요약. 담당자/소유자 요약은 id/name/email/phone/role/status만, 없으면 null
- `GET /admin/orgs/{org_id}/counselors` → 기관 내 상담사+org_admin 목록. 항목: id, name, email, counselor_code, role, status, is_primary_admin, is_owner. 정렬 created_at ASC
- 둘 다 `require_platform_admin` 적용. 기존 `GET /org/{org_id}/counselors`(org_admin 전용)은 그대로 유지
- 상담 내용·비밀번호·초대 토큰 제외

### T2. FE — 두 탭 모달
- OrgManagementPage 기관 목록 행 클릭 → 모달 오픈 (기관명을 상세 열기 버튼으로, 행 빈 영역 클릭도 동일)
- 모달: 고정 헤더(기관명, 유형·인증 배지, 기관 코드+복사, 닫기) + 탭 2개
  - 기관 정보 탭: 이름/코드/전화/주소/인증 상태/생성일(KST) + 일반 기관 담당자(이름/이메일/전화/계정 상태) 또는 개인 기관 소유자(이름/이메일/상담사 코드)
  - 상담사(N) 탭: 이름/이메일/상담사 코드/역할/계정 상태 테이블 + 검색/필터
- 두 API 독립 로딩·재시도. 상담사 조회 실패 시 0명으로 간주하지 않음
- 키보드: 기관명 버튼 Enter/Space, Escape 닫기, 닫은 뒤 포커스 복귀
- 목록 검색(기관명/코드), 필터(인증 여부/유형), 유형 그룹핑(일반/개인)

## 3. 주의
- 플랫폼 관리자라도 상담 내용·리포트·채팅 본문 열람 금지
- 개인 기관(kind=individual)은 owner 표시, 담당자 없어도 오류 아님
- counselor_code는 CounselorProfile.counselor_code 원본 (없으면 '미등록')

## 4. 완료 기준
- 기관 클릭 → 두 탭 모달(기관 정보 + 상담사 리스트) 조회
- 검색/필터/그룹핑 동작, 권한 검사(플랫폼 관리자)
- BE pytest 통과, FE build 0 error
