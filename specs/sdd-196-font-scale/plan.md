# [SDD-196] Plan

**Architecture:** (1) Tailwind `theme.extend.fontSize.sm` 오버라이드로 745곳 일괄, (2) 코드모드로 임의 px 정렬, (3) 전역 CSS로 모바일 입력 16px, (4) 채팅 컴포넌트 직접 수정.

## Files to Change
| Action | File | Description |
|---|---|---|
| Edit | `frontend/tailwind.config.cjs` | `sm`=15px/22px |
| Edit | `frontend/src/index.css` | 모바일 입력 16px |
| Edit | `components/chat/MessageBubble.tsx`, `agent-bubble.tsx`, `pages/client/ai-agent-page.tsx` | 채팅 크기 |
| Edit | `src/**` (코드모드) | 임의 px 정렬 |
| Create | `frontend/tests/font-scale.test.ts` | 하한·예외 회귀 가드 |
| Create | `scripts/font-audit.py` | 전/후 분포 |

## Tasks
1. 전/후 가로 넘침 기준선 스캔(390px)(10m) 2. Tailwind·CSS(5m) 3. 채팅(10m) 4. 코드모드(15m) 5. 회귀 테스트(10m) 6. 빌드·테스트·넘침 재스캔(15m)
