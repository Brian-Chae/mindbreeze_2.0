# 상담사 진행 화면 수정 결과

## 변경과 결정

- origin/develop fetch/rebase 완료. 전용 fix/host-live-desktop-layout 유지.
- A안: 상단/헤드/참가자 컨테이너/신호/도크 최대1000px 동일 경계. 시트 열림 시 남은 메인 영역 안에서 같은 경계 유지.
- 신호 줄 모든 폭에서 도크 바로 위, 단일 DOM. 기존 모바일 padding과 gap 보존으로 신호→도크 실측14px(독립 시안8px과 다름).
- 도크 지표 기준/채팅/미디어/도구4개. 수업 상태는 머리글 오른쪽, 체크인 응답수와 details 내장.
- 셀프뷰 높이 기존112/136/120 유지. 영상 object-fit:cover, 카메라 꺼짐 동일16:9. 원본 영상이16:9가 아니면 cover 특성상 외곽 일부 크롭될 수 있으며 왜곡하지 않는다.
- 390 배너150.89px, 최소120px. 기본359px 이하/확대479px 이하에서는 두 행으로 전환하여 각 카드 높이 유지. 모바일 지표 정보는 숨기지 않고 줄바꿈. 오프라인 요약 패널 비율은 유지.
- 토스트 첫 수신0ms, 단일 패널 최대3주제 독립행. 기본6초(following만4초), 갱신 min(first+10초,max(expiry,now+3초)). 10초 쿨다운 제거. hover/focus 정지, 해제 후 최소3초(상한예외), 마지막행 닫기/언마운트 정지 누수 회귀 포함.
- 실명+현재집계. quiet는 회원별 최신1건/최근10초, 이름누락·익명은 참가자. 중복·역순·초기/재연결/회차전환 재알림 억제. 회원 변경은 안내1줄만.

## 셀프뷰 Chrome 전후(px, 기본 상태)

| 폭 | 전 | 후 |
|---|---|---|
|390|133 × 112|199.109 × 112|
|768|239.359 × 136|241.766 × 136|
|1280|334.563 × 120|213.328 × 120|
|1440|334.563 × 120|213.328 × 120|

## 검증

- vitest 18파일262개 통과: host player, SDD235, quiet, toast, 회원 hostvideo. 토스트16개 포함. 전체 저장소 테스트는 실행하지 않음.
- tsc --noEmit -p tsconfig.app.json 통과. 변경 TS/TSX eslint 통과.
- npm run build -- --config ../fix-notes/host-live-desktop/vite-check.config.ts: .env 접근을 막는 envDir override만 사용. 빌드는 exit0이나 design-system tokens.css @import 해석 경고와 동적 import/500kB chunk 경고가 남는다. 해당 공용 import/번들 구조는 이번 변경 밖이다.
- 지정 Google Chrome executable, 실제 /design/class-player C13/HostCaseHarness. 서버/API/socket 요청 차단, 가상 데이터.
- 390/768/1280/1440 × 없음/손1/손여럿/quiet/status =20상태 PNG+JSON. 5영역경계 오차1px이내, self폭-높이×16/9 오차1px이내·높이불변, overflow0, pageerror0, 도크4, 간격14px.
- 별도 browser-assertions:320 포함5폭 확대16:9/넘침0, 수업상태→체크인 펼침→Escape→포커스 복귀 확인.
- 독립 검토자가 diff와 toast16개 재실행, JSON20행 재계산. 발견된 절대위치/hover+focus/언마운트정지 문제 수정 확인.

## 재현과 한계

frontend/node_modules는 원본 저장소 임시 심링크이며 검증 후 해제한다. 프런트 Vite는 createServer({envDir:'/tmp/mindbreeze-no-env',server:{host:'127.0.0.1',port:5236}})로 실행. capture.cjs after → verify-browser.cjs 순서.

실제 서버 이벤트 지연, LiveKit 카메라 장치, BLE, 실휴대폰, 스크린리더 실제 발화는 미검증. 백엔드/.env/서버/DB 접근·메일·머지·develop 푸시·배포 없음. feature 브랜치 푸시와 PR만 수행.
