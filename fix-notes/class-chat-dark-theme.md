# 클래스 채팅 어두운 테마 수정

## 구현 전 원인·계획·검증
- 원인: ChatRoom과 말풍선·입력창의 밝은 색 고정. ClassChatPanel embedded 경로에 테마 구분 없음.
- 계획: 기본 light인 tone prop을 도입하고 embedded 경로에서만 dark 전달. CSS 변수와 기존 시트 토큰으로 하위 요소 전체 색상 지정. 기능·문구·백엔드 유지.
- 사전 검증 목록: embedded dark/일반 light 회귀 테스트, 관련 vitest, TypeScript, 변경 파일 eslint, 프로덕션 빌드.
- API mock Chrome 390px: 빈 상태/메시지/입력 중/일반 채팅 밝은 화면 캡처. computed style 및 알파 합성 대비 측정.
- 사용자 요청의 구현·검증·커밋·브랜치 푸시·PR 생성 범위에 따라 연속 수행. 머지·배포 없음.

## 적용 결과
- `ClassChatPanel.tsx`: embedded 분기만 `tone="dark"`. 상담사 로비·진행, 회원 진행과 ClassPlayerPage의 공통 embedded 경로에 적용.
- `ChatRoom.tsx` + `chat-room.css`: light 기본값, dark 범위 내 시트·입력부·버튼·안내·오류·하이라이트·신고 링크 색상.
- `MessageBubble.tsx`, `SystemMessage.tsx`: CSS 변수 + 기존 light 색 폴백. 날짜·이름·시간·시스템 배지까지 동일한 테마 사용.
- `class-chat-panel.test.ts`, `chat-room-multi-device.test.tsx`: embedded/일반 테마 경계 및 실제 ChatRoom 기본값 회귀 가드.
- `font-scale.test.ts`: 이름 13px·시간 12px·본문 15px 검증 유지. 기존 고정 색 검사만 `var(--chat-muted, #6F6F6F)` 폴백 표현에 맞춤. AI 말풍선 색 검사는 그대로 유지.
- 기능·문구·백엔드 변경 없음. 일반 ChatPage/ClientChatPage에는 tone을 전달하지 않음.

## 색 값과 대비
Chrome 390×844, 실제 컴포넌트 + API mock. 투명 배경을 조상 배경과 합성하여 WCAG 상대 휘도로 계산. 아래 대비는 변경 후 텍스트/배경 비율이다.

| 요소 | 전 | 후 | 대비 |
|---|---|---|---|
| 메시지 영역·빈 상태 | 배경 #FFF / 글자 gray-500 | --sheet-bg rgba(24,12,36,.58) / --tx-mid #CFC6D6 | 11.34:1 |
| 상대 말풍선 | #F5EDFC / #1F1F1F | rgba(255,255,255,.08) / --tx-hi #F7F4F0 | 14.10:1 |
| 내 말풍선 | #5F0080 / #FFF | #5F0080 / #FFF | 11.68:1 |
| 날짜·시스템 메시지 | #F2F2F7 또는 #F2F3F8 / #8E8E93 또는 #6F6F6F | 반투명 표면 / #CFC6D6 | 9.35:1 |
| 이름·시간·신고 | #6F6F6F | #CFC6D6 | 11.34:1 |
| 아바타 이니셜 | #E8E0F0 / #5F0080 | 반투명 표면 / --mb-lavender #B373EF | 4.87:1 |
| 입력창·입력 글자 | #FFF / #1F1F1F | --sheet-bg / #F7F4F0 | 15.98:1 |
| 입력창 placeholder | #9CA0AE | #CFC6D6 (불투명) | 10.60:1 |
| 전송 활성 | #5F0080 / #FFF | #5F0080 / #F7F4F0 | 10.65:1 |
| 전송 비활성 | 회색 + opacity .5 | rgba(255,255,255,.08) / #CFC6D6, opacity 1 | 7.35:1 |
| 차단·대상 메시지 상태줄 | #F8F8FB·purple-50 | 반투명 표면 / #F7F4F0, 링크 #B373EF | 링크 포함 4.87:1 이상 (색상 계산) |
| 오류 배너·재전송 | red-50 / red-600·700 | #381C32 / #FFC5CE | 10.24:1 (색상 계산) |

테두리·모서리: --sheet-border rgba(255,255,255,.14), --r-card 재사용. 입력창 테두리는 #CFC6D6, 포커스는 #B373EF로 식별한다. 장식 테두리에는 텍스트 대비 기준을 적용하지 않는다. 일반 밝은 테마의 기존 날짜/비활성 대비는 이번 범위에서 유지한다.

## 화면·측정 산출물
- `fix-notes/class-chat-dark-theme/class-empty.png`: 상담사 로비 빈 상태.
- `fix-notes/class-chat-dark-theme/class-messages.png`: 상담사 로비 메시지·시스템 배지·날짜·신고.
- `fix-notes/class-chat-dark-theme/class-typing.png`: 입력·포커스·활성 전송.
- `fix-notes/class-chat-dark-theme/class-host-live.png`: 실제 상담사 진행 ChatSheet + embedded 패널.
- `fix-notes/class-chat-dark-theme/class-member.png`: 회원 진행 시트의 embedded 패널.
- `fix-notes/class-chat-dark-theme/general-light.png`: 실제 ClientChatPage 밝은 테마.
- `computed-styles.json`: 각 화면의 computed 배경·텍스트·입력·버튼·본문 대비. 클래스 모든 본문 최소 4.87:1, 가로 넘침 없음, pageerror 없음.
- `capture.mjs`: API mock 재현 스크립트. Chrome headless, 외부 요청 차단. 프로덕션 빌드 CSS + 실제 소스 컴포넌트를 사용.
- 실제 iPhone Safari·키보드·LiveKit·운영 API 검증은 수행하지 않음.

## 검증 결과
- 관련 vitest: 9파일 187/187 통과. ClassChatPanel, ChatRoom 다중 기기/테마, ChatTextarea, 신고, 상담사 로비/진행 시트, 회원 진행/컨테이너 포함.
- `npx tsc --noEmit -p tsconfig.app.json`: 통과.
- 변경 TS/TSX 파일 ESLint: 통과.
- `npm run build`: 통과. 기존 토큰 CSS import 경로 경고, 동적 import/청크 크기 경고 존재.
- 전체 vitest 최종: **218파일 중 212통과/6실패, 2543건 중 2532통과/11실패** (기준선 4건 + 로컬 브라우저 서버 의존 7건). 최초 실행은 218파일 중 211통과/7실패, 2543건 중 2531통과/12실패. 이 중 font-scale 정적 문자열 1건은 이번 색 변수 표현 변경으로 발생하여 검증 의미를 유지한 채 갱신.
- HEAD를 /tmp에 별도 추출한 기준선에서도 `chat-message-deeplink.test.ts` 2건(input을 찾지만 실제 입력은 textarea), `agent-counselor-page.test.tsx` 2건 동일 실패 확인. 범위 밖 테스트는 수정하지 않음.
- 브라우저 의존 기존 테스트 실패: org-management-browser 2건, org-counselor-management-browser 1건, report-modal-pdf 2건, report-server-pdf 2건. 로컬 5175 서버 부재로 연결 실패/타임아웃. 실서버에 연결하지 않음.
- 초기 의존성 검증 오류: 기존 node_modules 안에 중첩 생성한 임시 심링크를 제거한 뒤 정상 기본 설정으로 재검증. 기존 설치 디렉터리는 유지. 의존성/빌드 출력은 커밋하지 않음.
- 독립 읽기 전용 코드 리뷰: 기능·문구·light 기본값 변경 없음. hp-legacy 덮어쓰기 우려를 확인했으며 실제 채팅 호출 경로에는 해당 래퍼가 없음.

## dev 반영 후 확인 시나리오
1. iPhone 상담사 로비 → 채팅: 회원 채팅 토글 카드와 아래 빈 메시지 영역이 같은 어두운 계열인지 확인.
2. 상담사 수업 시작 → 채팅: 내/상대 메시지·날짜·이름·시간·신고가 읽히는지 확인.
3. 회원 진행 → 채팅: 빈 상태와 수신 메시지 확인, 입력 포커스/키보드/전송 활성·비활성 확인.
4. 일반 상담사 채팅과 회원 채팅 페이지: 흰 배경 유지, 전송/읽음/실시간 수신 기존 동작 확인.
5. 이 PR은 머지·develop 푸시·배포하지 않음. dev 반영은 DEPLOY 창구에서 수행.
