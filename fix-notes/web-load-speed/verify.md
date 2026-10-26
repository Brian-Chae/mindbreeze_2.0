# 구현 전 검증 계획

작성 시점: 애플리케이션 코드 수정 전. 사용자가 요청한 수정·검증·PR 범위로 진행.

- CDP trace: dev /classes의 청크 완료, fallback 타이머 설치/실행, API 시작, 이미지 시작 비교.
- 변경 전후 동일 Chrome headless 1440×1000, CPU/네트워크 제한 없음, 로컬 Vite build(envFile:false, mode:speed, dev-api)와 preview.
- 홈·클래스·회원·리포트·채팅: 새로고침 및 실제 메뉴 링크 이동, 각 3회. 마지막 읽기 API responseEnd를 데이터 완료 지표로 사용. 정확한 URL 중복을 별도 계산.
- 읽기 전용: GET/HEAD/OPTIONS와 auth/login·refresh 외 API 차단. 소켓도 연결 차단. 메시지 방 열기·읽음 처리·서비스 데이터 생성 금지. 응답 본문/계정 정보/토큰 저장·출력 금지.
- 캐시 RED→GREEN: 동일 in-flight 공유, TTL, URL 파라미터 구분, 실패 재시도, 무효화 도중 과거 응답 격리, 계정 전환, 단일 caller abort, 쓰기 후 무효화.
- 실제 production React DOM을 사용하는 브라우저에서 300ms 대기 제거 확인.
- 알림/채팅 소켓 무효화는 로컬 mock 이벤트로 검증(실제 dev 알림 발송 금지).
- 관련 vitest와 전체 vitest, tsc --noEmit -p tsconfig.app.json, eslint. 기존 실패는 변경과 구분.
- 마지막에 diff/범위/시크릿 점검, 한글 커밋, 지정 브랜치 push와 develop 대상 PR. merge·배포 금지.
