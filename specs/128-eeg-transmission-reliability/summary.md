# [SDD-128] — Summary

## What Was Built
| 파일 | 변경 |
|------|------|
| `frontend/src/hooks/useBand.ts` | 5초 REST flush를 WS 미연결 시에만 실행(이중 전송 제거). `handleFeatureAck`에 `saved===0` 가드(실패 항목 큐 유지). 주석 SDD-108 기준 정정 |
| `frontend/src/components/class/GuestMeditationPanel.tsx` | `readSnapshot` 분기 분리 — 접촉불량/링크 stale 시 전 지표 null(미측정) |

## Test Results
- ✅ `npm run build` — 0 errors (8.36s)
- ✅ `pytest` — 1009 passed (백엔드 무변경)

## Notes for Reviewer
- **②-22**: 서버 멱등 키는 유지(방어막). 클라이언트 중복 전송만 제거해 트래픽·비용 절감. 오프라인 폴백(재연결 시 retransmitPending)은 보존.
- **②-21**: `MemberMetricDial`은 이미 null→'—' 처리하므로 snapshot 산출부 분기 분리만으로 해결.
