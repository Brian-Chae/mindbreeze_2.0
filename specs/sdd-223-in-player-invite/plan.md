# 구현 계획

1. 기존 FlowSheet·ClassMemberPicker·useClassOperation을 재사용하는 공용 초대 시트를 추가한다.
2. session.class_id로 클래스 상세를 조회해 권한을 판정한다. 대기실 초대 추가의 이동을 제거하고 진행 중 도구에 진입점을 연결한다.
3. 성공 후 클래스 revision·멤버·세션·metrics를 재조회한다. 대기실 presence는 기존 소켓 구독을 유지한다.
4. 컴포넌트/연결 회귀 테스트, frontend 빌드와 CSS 생성을 확인하고 로컬 커밋한다.
