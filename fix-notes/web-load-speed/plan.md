# 웹 로딩 속도 원인과 수정 계획

- 범위: fix/web-load-speed, frontend와 본 기록만. backend·배포·dev 데이터 변경 금지.
- 원인: 인증 완료 뒤 React.lazy가 시작되어 전역 Suspense fallback을 표시한다. React 19의 300ms fallback throttle이 청크 준비 뒤 커밋·effect·API 시작을 약 245ms 지연한다. CDP 타이머와 리소스 타임라인으로 확인.
- 주요 5개 목록 화면을 React Router lazy로 준비해 Suspense retry 지연을 제거한다. 인증은 엔트리에서 시작하여 청크 다운로드와 병렬 수행하며 RoleGuard의 서버 검증 조건은 유지한다.
- 기존 API client에 한정된 공통 GET(알림·알림 개수·방 목록·강사 후보)만 30초 공유. URL 전체로 키를 구분한다. 실패는 저장하지 않고 계정 전환·변경 요청·소켓 이벤트 시 무효화한다. 무효화 전 응답이 새 캐시를 덮어쓰지 않는다.
- 구현과 별도 에이전트의 diff 검증을 분리한다.
