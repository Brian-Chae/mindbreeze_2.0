# SDD-020 에이전트 리뷰 종합

## 실행한 에이전트
- Claude: 백엔드/보안 (stdout 요약 회수)
- Codex: API/구현 (문서 생성 완료)
- Cursor: UX/프론트 (문서 생성 완료)
- Gemini: 실패 (UNSUPPORTED_CLIENT, 지속)

## 공통 합의
1. 별도 `/admin/clients` 페이지 + 사이드바 "회원 관리" 메뉴 (탭/필터 통합 비권장)
2. 목록은 `GET /admin/users?role=client` 재사용 + `primary_counselor` 확장
3. 수동 추가 = `POST /admin/clients` 신규 (이름/이메일/상담사ID 필수)
4. 수동 추가 방식 = 초대 메일(pending + set-password 링크), 임시/지정 비밀번호 금지
5. 상담사 배정 = ClientCounselorLink(active) + 공용 `assign_counselor` 함수로 수렴
6. 비활성화 = suspend 재사용 (SDD-018 inactive는 도입 안 함)
7. 삭제 = hard delete 재사용 + 2단계 확인 (SDD-018 soft delete는 별도)
8. `/admin/users`는 상담사 전용화 (role 드롭다운 제거)

## 에이전트별 차별 포인트
- Claude: "SDD-018 인프라 위에서 구현해야 한다" 강조. consents 대리 금지, 인증 상태 강제 선행, assign_counselor 공용화. 13개 리스크.
- Codex: 구체적 스키마/엔드포인트/재사용 지점 15개 보완 포인트. role allowlist, 타입 불일치, 트랜잭션 경계.
- Cursor: UX IA·CounselorPicker(debounced combobox)·2단계 삭제 확인·공통 컴포넌트 추출.

## 최종 설계 결정 (통합)
1. MVP 범위: suspend 재사용(비활성화) + login/refresh suspended 차단(실효성 보장) + hard delete 재사용(2단계 확인)
2. soft delete 전체 인프라는 SDD-018 별도로 유지 (이번에 도입 안 함 — 범위 과대 방지)
3. consents는 pending 생성 시 만들지 않고 내담자 본인 온보딩에서 받음
4. 상담사 배정은 active + 인증완료 상담사만 허용
5. 초대 메일은 기존 org_invite 방식 재사용 (client 전용 토큰 타입 추가)

## Gemini 실패 기록
- 로그: /tmp/mb-021-gemini-run.log
- 원인: 인증 티어 지원 종료(UNSUPPORTED_CLIENT) — 지속 블로커
