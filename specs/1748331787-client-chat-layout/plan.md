# Client Chat Layout — 구현 계획

## 접근법: React Portal

`ClientChatRoomPage`가 `ClientShell`의 DOM 트리 밖에서 렌더링되도록 `createPortal` 사용.

### 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `pages/client/ClientChatRoomPage.tsx` | Portal 적용, 레이아웃 간소화 |

### 단계

1. `ClientChatRoomPage`에 `createPortal` 적용
2. `document.body` 직속으로 마운트 (`#client-chat-portal` div 생성)
3. 데스크탑에서는 `ClientShell` 내부에 정상 렌더링하도록 `useMediaQuery` 사용
4. 빌드 + 배포 검증

### 핵심 코드 구조

```tsx
import { createPortal } from 'react-dom';

// 모바일에서만 portal 사용
const isMobile = !window.matchMedia('(min-width: 768px)').matches;

if (isMobile) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <header>...</header>
      <div className="flex-1 min-h-0">
        <ChatRoom roomId={roomId} />
      </div>
    </div>,
    document.body
  );
}

// 데스크탑: ClientShell 내부에서 정상 렌더링
return (
  <div className="h-full flex flex-col bg-white">
    <header>...</header>
    <div className="flex-1 min-h-0">
      <ChatRoom roomId={roomId} />
    </div>
  </div>
);
```
