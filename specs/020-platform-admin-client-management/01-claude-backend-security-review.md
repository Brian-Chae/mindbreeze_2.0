# Claude 백엔드·보안 리뷰 회수본 (stdout 요약)

## 핵심 결론
1. 회원 생성 API: 초대형(invite-based)만 채택. 임시 비밀번호·관리자 지정 비밀번호는 배제(관리자가 내담자 자격증명을 알게 되는 것 자체가 data-privacy 위반). `org_service.invite_counselor`의 pending 패턴 재사용: status="pending" + 난수 해시 + set-password 활성화.
2. consents(특히 sensitive/EEG 동의)는 관리자가 대리할 수 없으므로 "생략이 아니라 내담자 본인에게 연기".
3. 상담사 배정: `link_invited_client`/`add_counselor_by_code`가 각자 채팅방·step4·재활성을 처리 중이라 admin-add를 3번째 분기로 붙이면 드리프트 확정. `client_service.assign_counselor()` 공용 함수로 수렴 권고. 배정 필수.
4. 비활성화/삭제: 비활성화는 `suspended` 재사용(별도 client 상태 신설 반대). 단 인증 계층 상태 강제 + 토큰 폐기가 선행 조건(현재 login/refresh에 status 검사 없어 suspend 실효 없음). 삭제는 hard delete 재사용 금지 → soft delete 기본, hard delete 격리. **SDD-020은 SDD-018 인프라를 client로 확장한 위에서 구현**해야 한다.

## 리스크 13개
- R1 인증 상태 미강제(Critical) — login/refresh에 status 검사 없음
- R2 관리자 대리 동의 위법(Critical) — consents 대리 체크 금지
- R3 hard delete 데이터 소실(Critical) — 상담/뇌파/리포트 연쇄 삭제
- R4 링크 3중 분기 드리프트
- R5 이메일 중복/삭제 재사용
- R6 무효 상담사 배정
- R7 온보딩 게이트
- R8 감사로그 부재
- R9 초대 재발송 벡터
- R10 부분 커밋 고아 client
- R11 pending/deleted 노출
- R12 UniqueConstraint 500
- R13 권한 경계
