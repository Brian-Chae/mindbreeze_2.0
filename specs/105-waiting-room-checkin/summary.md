# SDD-105 구현 결과

Brian의 명시적 구현·Verify 승인 후 구현했다. Stage ①②③ 문서는 기존 문서를 사용했고, verify.md는 승인 상태만 갱신했다. 최종 사용자 리뷰 전이며 커밋·배포하지 않았다.

## 구현

- ClassWaitingRoom을 설문 → 링크밴드 → 기기 테스트 탭으로 통합했다. 원형 번호/완료 체크와 커넥터, 준비 완료 카운트, 목업의 다크 퍼플·라벤더와 데스크톱 2열/모바일 1열을 적용했다. 사이드 영역에는 실제 클래스 이름·참여 이름·BGM만 표시한다.
- PreCheckinPanel의 SAM·전달 말·checkin API를 유지했다. 저장 성공 또는 건너뛰기로 완료하며 저장 실패는 미완이다. 숨겨진 탭도 마운트를 유지해 초안과 밴드 상태를 보존한다.
- WaitingRoomBandCheck에 실제 `/linkband-detail-1.png`, 전원/착용/연결 안내와 미사용 선택을 추가했다. 실제 연결 상태와 준비 완료를 구분한다.
- 마이크 자동 확인·레벨미터·선택 카메라·스피커 테스트음을 유지했다. 비동기 권한 응답이 화면 종료 뒤 도착해도 트랙을 정리하며, 카메라 미리보기 DOM에 스트림을 연결한다.
- MemberWaitingScene의 welcome/guide/wait를 제거했다. class-join-page는 하나의 waiting 씬에서 준비와 시작 대기를 처리한다. 시작 전 입장 클릭에도 인스턴스를 유지하고, 상담사 시작 시 같은 이름 게이트를 거쳐 MemberSessionScene으로 전환한다. Wake Lock·BLE singleton·종료/취소 및 state API fallback을 보존했다.
- 상담사 대기실의 넓은 참가자 영역에 준비 현황을 배치했다. 현재 대기 인원 기준 그룹 완료율·3뱃지·n/3·미완 강조를 제공한다. 체크인 내용, 기존 참가자 그리드와 녹음·타이머·카메라·밴드 제어는 유지한다.
- 기존 WS presence 계약에 선택적 readiness 3개 boolean만 추가했다. 즉시 갱신·heartbeat·재접속·leave·TTL을 유지하고 구버전은 설문만 추론한다.
- 리마인드는 상담사 권한과 세션 참가자를 검증한 뒤 참가자 개인 룸으로 전달한다. UI는 ack 수락과 실패를 구분하며 연결 끊김·전송 중·미완 0명에는 비활성화한다. 회원 화면은 접근 가능한 status로 안내를 받는다.

## 테스트와 리뷰

1. 변경 전 실패 확인: 회원 탭/완료, 자동 입장, 미디어 정리, 대기 화면 인스턴스 보존, 준비 중 시작·종료 감지, readiness 전달 및 패널 요구 시나리오.
2. 최종 관련 vitest: **11개 파일, 115개 테스트 통과** (통합 실행 113개 + 리마인드 수신 테스트 별도 2개).
3. 백엔드 WS 테스트: **14개 통과**.
4. `frontend`에서 `npm run build`: **종료코드 0**.
5. `git diff --check`: 통과.
6. 독립 코드 리뷰의 Important 2건(회원 알림 미연결, 최초 소켓 생성 시 패널 연결상태 race)을 수정했다. 범위 재리뷰에서 추가 Critical/Important 없음.

실행 명령:

```bash
cd frontend
npx vitest run tests/class-waiting-room.test.ts tests/class-waiting-room-flow.test.ts tests/class-waiting-room-presence.test.ts tests/class-waiting-room-band-check.test.ts tests/class-join-waiting.test.ts tests/pre-checkin-panel.test.ts tests/waiting-room-readiness-panel.test.ts tests/host-class-workspace.test.tsx tests/class-audio-sync.test.ts tests/self-checkin.test.ts tests/waiting-room-reminder.test.ts
npm run build
cd ../backend
uv run --python 3.12 --with-requirements requirements.txt --with fakeredis pytest tests/test_class_waiting_room_presence.py -q
```

빌드에 기존 디자인 토큰 CSS import 경고와 500kB 초과 chunk 경고가 남는다. pytest에는 Starlette/httpx 사용 중단 예고 1건이 있다. 실행 로그는 evidence/build.log, vitest.log, pytest.log에 보관했다.

## 렌더 검증

로컬 Chromium으로 **실제 앱 라우트** `/join?code=ABC123`, `/sessions/sdd105/player`를 열었다. 외부 서버 호출을 차단하고 REST/WS 테스트 응답을 제공했다. 따라서 운영 서버 E2E 검증으로 간주하지 않는다.

- 1440px 데스크톱: 회원 설문/밴드/기기/3단계 스킵 완료, 상담사 6명 중 3명 완료·3명 미완을 확인했다.
- 390px 모바일: 회원·상담사 가로 넘침 없음. 브라우저 실행 오류 없음.
- 리마인드: 회원 WS 알림의 실제 화면 표시와 상담사 버튼 → WS ack → 수락 메시지 표시를 확인했다.
- 제목에 전역 스타일이 적용돼 대비가 낮아진 부분은 명시적인 밝은 색으로 수정 후 다시 캡처했다.
- evidence/의 PNG와 render-results.json에 결과를 보관했다.

재실행: frontend에서 `VITE_API_BASE_URL=/api/v1 npm run dev -- --host 127.0.0.1 --port 5176` 실행 후, Playwright가 설치된 환경에서 `node frontend/tests/waiting-room-checkin.browser.cjs`를 저장소 루트에서 실행한다. 필요하면 NODE_PATH로 기존 Playwright 설치 경로를 지정하고 PLAYWRIGHT_CHROMIUM_EXECUTABLE로 Chromium 실행 파일을 지정한다. URL은 WAITING_ROOM_TEST_URL로 변경할 수 있다.

실제 LINK BAND 연결·EEG 전송, 실물 마이크/카메라/스피커, 화면 잠금 상태에서의 Wake Lock은 실기기 검증하지 않았다. 해당 로직은 보존하고 자동 테스트로 회귀를 확인했다.
