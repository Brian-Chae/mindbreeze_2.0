# [SDD-196] Summary — 글씨 크기 전면 조정

## What Was Built
| File | Description |
|---|---|
| `frontend/tailwind.config.cjs` | `text-sm` 14→15px, 행간 22px (745곳 일괄) |
| `frontend/src/index.css` | 모바일(≤767px) 입력칸 16px 강제(iOS 자동 확대 방지) |
| `components/chat/MessageBubble.tsx`, `agent-bubble.tsx` | 본문 15 / 시간 12(#6F6F6F, 대비 5.0:1) / 이름 13 / 행간 1.5 / 폭 80% |
| `pages/client/ai-agent-page.tsx` | 루시 안내 문구 13px |
| `frontend/src/**` 코드모드 96파일·425라인 | 9~11→12, 12.5·13.5→13, 14·14.5→15, 17·19→18, 21→20, 23·26→24 |
| `frontend/tests/font-scale.test.ts` | 12px 하한·채팅 크기·text-sm 회귀 가드 |
| `docs/프론트_디자인_조사_글씨크기.md` | 조사 보고서 |

## Test Results
- ✅ TS1~TS3 `font-scale.test.ts` 3건, 빌드 CSS `.text-sm{font-size:15px;line-height:22px}` 확인(dev 배포본 포함)
- ✅ TS4 390px 폭 입력칸 computed 최소: 15→16px, 14→16px
- ✅ TS5 공개 6개 화면(로그인·가입·비번찾기·랜딩) 가로 넘침 0→0, 랜딩 12px 미만 텍스트 12→0
- ✅ TS6 `tsc -b`, `npm run build`. 전체 vitest 16건 실패는 **수정 전 HEAD에서도 동일한 16건**(client-report-list·modal, agent-page, 브라우저 .cjs 등)
- ⚠️ 로그인 필요 화면(내담자 홈·채팅·리포트·상담사 대시보드)의 390px 넘침 전/후 측정은 **미수행**(저장된 로그인 정보 없음) — 실기기 확인 필요

## 예외·제외
- 배지 숫자(16~20px 원) 15곳은 10~11px 유지.
- 제외: `pages/design`·`components/playground`, 다른 작업자 미커밋 파일 5개(`agent-checkin-panel.tsx`, `risk-signals.tsx`, `actions.ts`, `capacitor-ble-adapter.ts`, `native/push.ts`) — 해당 파일의 9~11px는 후속 정리 필요.

## Debugging Journey
- 코드모드 첫 실행: 배지 예외 정규식 오타(`bad character range`)로 실행 실패 → 파일 변경 전이라 수정 후 재실행.
- 기준선 비교용 worktree를 빌드 산출물 복사 전에 지워 재생성.

## Notes for Reviewer
- `text-sm` 일괄 상향이라 상담사 표·칩에서 줄바꿈이 늘 수 있음 — 화면 확인 후 개별 보정.
- 사용자 글씨 크기 설정(rem 전환), 작은 터치 영역(h-6~8) 확장은 범위 밖.
