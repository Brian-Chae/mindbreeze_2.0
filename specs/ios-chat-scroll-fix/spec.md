# iOS 모바일 채팅 스크롤 수정

## 미션
iOS 모바일 Safari에서 채팅 메시지 리스트가 스크롤되지 않는 문제를 해결한다.

## 현재 증상
- 페이지 전체(body) 스크롤은 막혀 있음 (AppShell `fixed inset-0`)
- 하지만 채팅 메시지 영역 안에서도 스크롤이 안 됨
- 데스크톱에서는 정상 작동
- `overflow-y-auto` + `min-h-0` + `flex-1` 조합이 이미 적용되어 있으나 iOS에서 무시됨

## 현재 구조 (레이아웃 체인)
```
AppShell: fixed inset-0, flex flex-col, overflow-hidden
  └─ <section>: flex flex-col overflow-hidden flex-1 min-w-0 min-h-0
       └─ content <div>: flex-1 min-h-0 overflow-hidden
            └─ ChatPage <div>: flex-1 min-h-0 flex flex-col
                 └─ <main>: flex-1 flex flex-col overflow-hidden
                      └─ <div>: flex-1 overflow-hidden
                           └─ ChatRoom: flex flex-col min-h-0 flex-1
                                ├─ message list: flex-1 min-h-0 overflow-y-auto  ← 여기가 스크롤 안됨
                                └─ input: shrink-0
```

## 시도할 접근법 (우선순위 순)

### 접근법 1: CSS Grid 기반 레이아웃
flex 대신 grid를 사용하여 iOS에서 더 예측 가능한 높이 계산 유도.
ChatRoom을 `grid grid-rows-[1fr_auto]`로 변경. 메시지 리스트는 `overflow-y-auto`.

### 접근법 2: position absolute 기반
가장 확실한 방법. ChatRoom의 부모를 `position: relative`로 만들고, 
메시지 리스트를 `position: absolute; top:0; bottom:[input-height]; overflow-y: auto`로.

### 접근법 3: max-height / calc() 접근
메시지 리스트에 `max-height: calc(100dvh - [header+input 높이])` 적용.

### 접근법 4: iOS Safari 전용 -webkit 속성 추가
`-webkit-overflow-scrolling: touch` 외에 추가 속성 시도.
- `touch-action: pan-y`
- `will-change: scroll-position`  
- `-webkit-transform: translateZ(0)` (하드웨어 가속)

## 진단 우선
1. 먼저 ChatRoom.tsx, ChatPage.tsx, AppShell.tsx의 현재 코드를 정확히 읽을 것
2. `AppShell.tsx`의 `noScroll` prop이 어떻게 동작하는지 확인
3. `npm run build`로 현재 상태 검증
4. 위 접근법 중 가장 유력한 것부터 순서대로 시도

## 절대 금지
- any 타입 사용 금지
- flex-col-reverse 사용 금지 (iOS 불안정)
- store 직접 import 금지
- body에 JS로 overflow 조작 금지
- BottomTabBar 관련 코드 변경 금지

## 검증
- `npm run build` 통과
- 최소한 데스크톱에서 기존 동작 유지
