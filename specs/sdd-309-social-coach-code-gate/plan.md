# SDD-309 — 구현 계획

1. 서버(커밋1): `GoogleAuthRequest`/`AppleAuthRequest.counselor_code`; `auth.py` 에 공용 헬퍼 `_require_social_counselor(req.invite_token, req.counselor_code, db)`(생성 전 검증)과 `_link_social_counselor(user, counselor, profile, db)`(assign_counselor create_room=False + onboarding step4 + current_step 보정). Google 신규 분기·Apple 신규 분기에서 호출, 커밋 후 채팅방 생성. config 플래그 추가, conftest autouse 로 시험 기본 해제.
2. 소셜 확인 화면(커밋2): `SignupConfirmPage` 에 "초대 코치 코드"(6자리 숫자) 필드(초대 토큰 있으면 숨김), `loginGoogle`/`loginApple` 페이로드에 `counselor_code` 전달, 오류코드별 문구. 순수 판정 함수는 `lib/auth/social-counselor-code.ts` 로 분리해 단위시험.
3. 코치 코드 화면(커밋3): `CounselorCodeScreen` 을 `MemberFlowFrame` + `FlowCard` 로 재구성(6칸), 뒤로 가기(`/join` 클래스 코드 입장) + "다른 계정으로 로그인"(로그아웃 → `/login?role=client`). 조회 실패 화면에도 동일 탈출 수단.
4. 증거: 390/768 캡처(로컬 합성 API) Before/After ≤6장 `evidence/`.
