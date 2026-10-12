# SDD-104 구현 결과

- ClassPlayerPage는 open에서만 ClassAudioPanel을 전달하고, HostClassWorkspace의 좌측 audio 렌더를 제거했다.
- 카메라 높이를 180/100/70/28px로 제한하던 규칙을 제거했다. 대기는 좌측 폭에 맞춘 16:9, 데스크톱 진행·일시정지는 남은 패널 높이로 확장한다. 영상은 object-fit:contain으로 비율을 보존한다.
- 카메라 꺼짐과 오류 안내도 같은 프레임 규칙을 사용한다. 낮은 데스크톱에서는 좌측 패널 내부 스크롤로 기존 제어 접근을 유지한다.
- 녹음/마커/밴드/타이머/코드복사 핸들러 변경 없음. any 추가 없음.

## 검증

- 상태 테스트를 먼저 변경해 in_progress/paused의 불필요한 BGM 렌더로 2건 실패를 확인했다.
- `npx vitest run tests/host-class-workspace.test.tsx`: 26개 통과.
- `npm run build`: 종료코드 0. 디자인 토큰 CSS import 해석 및 500kB 초과 청크 경고가 남아 있다.
- Chromium에서 실제 ClassPlayerPage + 로컬 API 테스트 데이터 + 가상 카메라로 1440×900, 1366×768, 1024×768, 768×768, 1024×600, 390×844의 open/in_progress/paused 18조합 검증. 대기 16:9, 대기에만 BGM 1개, 진행/일시정지 BGM 0개. 런타임 오류 0건.
- 1440×900 대기 카메라 프레임 278×156.375px, 진행 278×361.421875px. 1024×600 진행 278×194.421875px. 모바일은 패널 폭에 맞는 16:9 유지.
- 종료 확인·취소, 채팅 토글, 몰입, 사용 안내, 미디어 설정, 참가자 페이지 이동, 테이블 전환 조작 통과.
- 실제 하드웨어 녹음·BLE·카메라 권한 거부·실시간 BGM 송출은 이번 브라우저 검증에 포함하지 않았다.

## 전체 테스트 참고

`npx vitest run`: 25개 파일 / 222개 테스트 통과, 아래 기존 .cjs 파일 9개의 수집 실패로 종료코드 1.

테스트 스위트 없음:
- tests/login-page.test.cjs
- tests/login-role.test.cjs
- tests/narrative-sections.test.cjs
- tests/org-management-api.test.cjs
- tests/signal-metric-parity.test.cjs

Playwright 모듈 누락:
- tests/org-counselor-management-browser.test.cjs
- tests/org-management-browser.test.cjs
- tests/report-modal-pdf.test.cjs
- tests/report-server-pdf.test.cjs

## 증빙

- [대기](evidence/open.png)
- [진행](evidence/in_progress.png)
- [18조합 측정값](evidence/render-results.json)

커밋·배포는 수행하지 않았다. 사용자 최종 리뷰 대기.
