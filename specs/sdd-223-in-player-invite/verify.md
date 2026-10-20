# 구현 전 검증 항목

사용자가 명시한 구현·검증 요청을 기준으로 작성했다.

- 시트 열림/닫힘, 기존 회원 선택·초대 command(revision/operation_key), 실패 메시지.
- 이메일 정규화 및 초대 호출, 입장 코드 복사 콜백.
- active/invite 권한이 없을 때 진입점 숨김, open/in_progress에서 같은 시트 연결.
- 성공 후 명부 재조회 및 연속 초대 시 최신 revision 사용.
- 기존 LobbySheets/ClassPlayerPage 관련 테스트, npm run build, 빌드 CSS의 새 클래스 확인.
