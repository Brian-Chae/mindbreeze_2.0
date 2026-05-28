# Client Chat Layout — 상담사 채팅과 디자인 통일

## 문제 진단

`ClientChatRoomPage`(회원 채팅방)가 `ClientShell` 내부에서 렌더링될 때, `ClientShell`의 `main` 요소가 `overflow-y-auto pt-14 pb-14`를 강제 적용하여 다음과 같은 문제 발생:

1. **중첩 스크롤 충돌**: `ClientShell main`의 `overflow-y-auto` + `ChatRoom` 내부의 `overflow-y-auto` → 메시지 리스트 스크롤이 제대로 동작하지 않음
2. **입력창 위치 불일치**: `ClientShell`의 `pb-14`(하단탭바 여백)가 채팅 입력창 아래에 불필요한 공간 생성
3. **높이 계산 불안정**: `fixed` 오버레이로 우회했으나 `h-full` resolution이 브라우저마다 다르게 동작

## 목표

회원 채팅방(`ClientChatRoomPage`)의 레이아웃을 상담사 채팅방(`ChatPage`)과 **완전히 동일한 구조**로 통일한다.

## 상담사 채팅방 레이아웃 분석 (기준)

```
AppShell (noScroll, hideBottomTab, noBottomPad, contentPad="")
└── section.flex.flex-col.flex-1.min-w-0.min-h-0
    └── div.flex-1.min-h-0 (overflow 없음)
        └── ChatPage
            └── div.h-full.flex.flex-col (md:flex-row)
                ├── aside.w-80 (채팅방 목록, 모바일 숨김)
                └── main.flex-1.min-h-0.flex.flex-col
                    └── div.flex-1.min-h-0
                        └── ChatRoom (h-full)
                            ├── Message List (flex-1 overflow-y-auto) ← 유일한 스크롤
                            ├── Error Bar (shrink-0)
                            └── Input Area (shrink-0) ← 자연스럽게 하단 고정
```

**핵심 원칙**: `ChatRoom`을 감싸는 컨테이너 체인에는 `overflow`가 없어야 한다. `ChatRoom` 내부의 메시지 리스트만 스크롤된다. 입력창은 flex layout으로 자연스럽게 하단에 고정된다.

## 해결 방안: Portal + Full-Screen Overlay

`ClientChatRoomPage`를 `document.body`에 직접 마운트하는 React Portal로 변경하여 `ClientShell`의 DOM 계층에서 완전히 분리한다.

### 적용 구조

```
document.body
└── #client-chat-portal
    └── div.fixed.inset-0.z-50.flex.flex-col.bg-white
        ├── header.h-14.shrink-0 (뒤로가기 + 채팅방 이름)
        └── div.flex-1.min-h-0 (overflow 없음)
            └── ChatRoom (h-full)
                ├── Message List (flex-1 overflow-y-auto)
                ├── Error Bar (shrink-0)
                └── Input Area (shrink-0)
```

### 데스크탑
- `md:` 브레이크포인트에서 `fixed` 대신 `relative`로 `ClientShell` 내부에 정상 배치
- 또는 데스크탑에서도 동일한 portal 방식 사용 (더 단순)

## QA 체크리스트

- [ ] 모바일: 입력창이 화면 최하단에 고정 (safe-area 고려)
- [ ] 모바일: 메시지 리스트만 스크롤, 입력창은 스크롤되지 않음
- [ ] 모바일: 하단탭바가 채팅방 위로 올라오지 않음
- [ ] 모바일: 뒤로가기 버튼 정상 동작
- [ ] 데스크탑: 채팅방이 ClientShell의 좌측 네비게이션 영역을 침범하지 않음
- [ ] 데스크탑: 입력창이 하단에 정상 고정
- [ ] 로딩 시 최신 메시지로 자동 스크롤
- [ ] 키보드 등장 시 입력창이 키보드 위로 올라감 (keyboardHeight 적용)
- [ ] 날짜 구분선 정상 표시
- [ ] 메시지 시간 말풍선 옆에 작게 표시
