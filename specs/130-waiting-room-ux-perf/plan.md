# [SDD-130] — Implementation Plan

**Goal:** 준비 재확인 복귀 경로 + 미터 리렌더 하향.

## Files to Change
| File | Description |
|------|-------------|
| `frontend/src/components/class/ClassWaitingRoom.tsx` | `lastMeterSetRef` 추가 + 미터 10Hz 하향 + "대기 화면으로" 버튼 |

## Tasks
1. `lastMeterSetRef = useRef(0)` 선언.
2. rAF tick에서 `setMicLevel`을 100ms 간격으로 throttle.
3. 헤더에 `recheckingPrep` 조건부 "대기 화면으로" 버튼 추가.
