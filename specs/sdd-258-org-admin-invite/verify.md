# SDD-258 — 검증 체크리스트 (구현 전 작성)

- TS1 org_admin 이 신규 이메일을 role=org_admin 으로 초대 → 201, 계정 role=org_admin·pending, 멤버십 role=org_admin·invited, CounselorProfile 없음, 비밀번호 설정 메일(org_admin 템플릿) 1건.
- TS2 TS1 토큰으로 set-password → 계정 active, 멤버십 active, 로그인 후 해당 기관 상담사 관리 API 접근 가능(org_admin).
- TS3 기존 상담사 이메일 초대 → 멤버십(org_admin, invited) 추가·소속 초대 메일(role=org_admin) → 수락 후 해당 기관 org_admin 멤버십 active, 다른 기관 소속 유지.
- TS4 이미 소속(초대 포함)된 이메일 → 409. 상담사가 아닌 계정(내담자) → 409.
- TS5 role 미지정 초대는 기존 동작(상담사) 그대로. 잘못된 role → 422.
- TS6 상담사 토큰/타 기관 org_admin 이 org_admin 초대 → 403.
- TS7 pending org_admin 재발송 → 200, org_admin 비밀번호 설정 메일. 상담사 재발송 기존 동작 유지.
- TS8 목록 응답 role 이 멤버십 역할(org_admin) 로 표시, status pending.
- TS9 org_admin 정지: 자기 자신 403 유지, 다른 활성 관리자가 없으면 409, 있으면 200, unsuspend 200.
- TS10 프론트: 기관관리자 초대 버튼 → 팝업, role=org_admin 으로 API 호출. tsc/eslint/vitest/build 통과.
- 메일 실제 발송 없음(목).
