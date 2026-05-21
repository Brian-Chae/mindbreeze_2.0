# SDD: 채팅 화면 재구현 (iOS 대응)

## 미션
ChatRoom 컴포넌트를 iOS 모바일에서 완벽하게 작동하도록 재구현.

## 핵심 요구사항

### 1. 스크롤 가능한 메시지 영역
- 과거 대화를 위로 스크롤해서 볼 수 있음
- 새 메시지가 오거나 전송하면 자동으로 최하단 스크롤
- 스크롤은 부드럽고 iOS momentum scroll 지원

### 2. 자동 최하단 스크롤
- 초기 진입 시 → 최하단
- 새 메시지 수신 시 → 최하단
- 메시지 전송 시 → 최하단
- 단, 사용자가 위로 스크롤해서 과거 메시지를 보고 있다면 자동 스크롤 하지 않음

### 3. 입력창 키보드 대응
- 키보드가 올라오면 → 입력창이 키보드 바로 위에 붙음
- 키보드가 없으면 → 입력창이 화면 하단에 위치
- **구현 방식**: `visualViewport` API 사용. `window.visualViewport.height` 변화를 감지하여 입력창 하단 여백(padding-bottom)을 동적으로 조정.

## 아키텍처

### 레이아웃 전략
```
┌─────────────────────────┐
│  헤더 (shrink-0)        │  ← AppShell 모바일 헤더
├─────────────────────────┤
│                         │
│  메시지 리스트           │  ← flex-1 overflow-y-scroll
│  (스크롤 가능)           │     visualViewport 변화에 따라
│                         │     하단 padding 동적 조정
│                         │
│  [최신 메시지]           │
├─────────────────────────┤
│  [에러 메시지]           │  ← 에러 표시줄
├─────────────────────────┤
│  [입력창]               │  ← shrink-0, 키보드 위에 붙음
├─────────────────────────┤
│  visualViewport 여백     │  ← 키보드 높이만큼 동적 padding
└─────────────────────────┘
```

### 컴포넌트 구조
```
ChatPage.tsx (기존 유지, 필요시 경미한 수정만)
  └─ ChatRoom.tsx (전면 재작성)
       ├─ useKeyboardHeight()       ← 신규 훅: visualViewport 감지
       ├─ useAutoScroll()          ← 신규 훅: 스크롤 자동/수동 관리
       ├─ MessageList              ← 인라인: 메시지 렌더링
       ├─ ErrorBar                 ← 에러 표시
       └─ ChatInput                ← 입력창 (기존 로직 유지)
```

## 구현 상세

### ChatRoom.tsx 구조
```tsx
export function ChatRoom({ roomId }: Props) {
  // 상태: messages, input, loading, error
  // 훅: useKeyboardHeight(), useAutoScroll()
  
  return (
    <div className="flex flex-col h-full bg-white">
      {/* 메시지 리스트 */}
      <div ref={listRef} className="flex-1 overflow-y-scroll px-4 py-2"
           style={{ paddingBottom: keyboardHeight + 'px' }}>
        {/* messages.map(...) */}
      </div>
      
      {/* 에러 */}
      {error && <div className="...">...</div>}
      
      {/* 입력창 — 항상 하단 */}
      <div className="shrink-0 border-t p-3 flex gap-2 bg-white">
        <input ... />
        <button>전송</button>
      </div>
    </div>
  );
}
```

### useKeyboardHeight() 훅
```tsx
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    
    const handler = () => {
      // 키보드가 올라오면 visualViewport가 줄어듦
      const keyboardH = window.innerHeight - vv.height;
      setHeight(Math.max(0, keyboardH));
    };
    
    vv.addEventListener('resize', handler);
    vv.addEventListener('scroll', handler);
    return () => {
      vv.removeEventListener('resize', handler);
      vv.removeEventListener('scroll', handler);
    };
  }, []);
  
  return height;
}
```

### useAutoScroll() 훅
```tsx
function useAutoScroll(listRef: RefObject<HTMLDivElement>, deps: unknown[]) {
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  
  // 사용자가 위로 스크롤했는지 감지
  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setUserScrolledUp(!isAtBottom);
  };
  
  // deps 변경 시 자동 스크롤 (새 메시지 등)
  useEffect(() => {
    if (userScrolledUp) return; // 과거 보는 중이면 방해하지 않음
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, deps);
  
  // 초기 로딩 완료 시 최하단
  useEffect(() => {
    const el = listRef.current;
    if (!el || loading) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [loading]);
  
  return { handleScroll, scrollToBottom: () => { ... } };
}
```

### ChatPage.tsx 변경
ChatPage의 ChatRoom을 감싸는 div:
```tsx
// 변경 전
<div className="flex-1 min-h-0 overflow-hidden">
  <ChatRoom roomId={selectedRoom.id} />
</div>

// 변경 후: overflow-hidden 제거 (ChatRoom이 내부에서 처리)
<div className="flex-1 min-h-0">
  <ChatRoom roomId={selectedRoom.id} />
</div>
```

## 파일 목록

### 신규 생성
- `frontend/src/hooks/useKeyboardHeight.ts`
- `frontend/src/hooks/useAutoScroll.ts`

### 수정
- `frontend/src/components/chat/ChatRoom.tsx` — 전면 재작성
- `frontend/src/pages/chat/ChatPage.tsx` — overflow-hidden 제거

## 절대 금지
- any 타입 사용 금지
- flex-col-reverse 사용 금지
- store 직접 import 금지 (useChatStore, useAuthStore는 예외)
- body에 JS로 overflow 조작 금지
- position: fixed 사용 금지 (iOS에서 불안정)
- setTimeout 기반 스크롤 금지 (requestAnimationFrame 사용)

## 검증
- `npm run build` 통과
- TypeScript 오류 없음
- 데스크톱에서 기존 채팅 기능 정상 동작
