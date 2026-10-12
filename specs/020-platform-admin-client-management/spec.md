# SDD-020 — 플랫폼 관리자 회원(내담자) 관리

## 목표
플랫폼 관리자 콘솔에 "회원 관리" 메뉴를 추가하고, 내담자(client)의 목록·수동 추가(상담사 배정)·비활성화·삭제를 상담사 관리 페이지와 동일한 UX로 제공한다.

## 비목표
- SDD-018 soft delete 인프라 전체 도입 (별도 진행)
- SDD-018 inactive 상태 도입 (이번엔 suspend 재사용)
- 상담사 재배정/회원 상세 Drawer (MVP 이후)

## 핵심 결정
1. 별도 `/admin/clients` 페이지 + 사이드바 "회원 관리" 3번째 메뉴.
2. 목록 `GET /admin/users?role=client` 재사용 + 응답에 `primary_counselor` 확장.
3. 수동 추가 `POST /admin/clients`: 이름/이메일/상담사ID(필수) → pending 계정 + 초대 메일(비밀번호 설정 링크).
4. 상담사 배정: active + 인증완료 상담사만. ClientCounselorLink(active) 생성.
5. 비활성화 = `suspend_user` 재사용 (status="suspended").
6. 삭제 = 기존 hard delete 재사용 + 2단계 확인(이메일 입력).
7. 비활성화 실효성: login/refresh에서 suspended 상태 차단 추가.
8. consents는 pending 생성 시 만들지 않고 본인 온보딩에서 수집.

## 백엔드 변경
- `POST /admin/clients` (create_client) 신규
- `admin_service.create_client` + `client_service.assign_counselor` 공용화
- `list_users` 응답에 primary_counselor (ClientCounselorLink 조회)
- `list_users` role allowlist 검증 (platform_admin|org_admin|counselor|client 외 422)
- login/refresh에서 suspended/pending 상태 차단
- client 전용 초대 토큰 타입 (또는 기존 set-password 재사용)

## 프론트 변경
- `ClientManagementPage` (/admin/clients) + 사이드바 메뉴
- 회원 추가 모달 (이름/이메일 + 상담사 선택 combobox)
- 담당 상담사 컬럼 (미배정 시 "미배정" 배지)
- 정지/해제/삭제 액션 (2단계 삭제 확인)
- `UserManagementPage` role 드롭다운 제거 (상담사 전용화)

## 성공 기준
1. 사이드바에 "회원 관리" 메뉴 노출
2. 회원 목록에 담당 상담사 표시
3. 회원 수동 추가(상담사 배정 필수) → 초대 메일 발송
4. 비활성화 시 로그인 차단 (실효성)
5. 삭제 시 2단계 확인
