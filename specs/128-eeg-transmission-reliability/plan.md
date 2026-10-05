# [SDD-128] — Implementation Plan

## Files to Change
| File | Description |
|------|-------------|
| `frontend/src/hooks/useBand.ts` | 5초 flush 타이머 WS 가드 + ACK saved=0 가드 + 주석 정정 |
| `frontend/src/components/class/GuestMeditationPanel.tsx` | `readSnapshot` 분기 분리(접촉불량 시 전 지표 null) |

## Tasks
1. `useBand.ts` 타이머: `if (!wsConnectedRef.current) void retransmitPending();`
2. `handleFeatureAck`: `if (ack.saved === 0) return;`
3. 주석을 SDD-108 기준으로 정정.
4. `readSnapshot`: `if (!b)` / `if (metricsBlocked)` 분리.
