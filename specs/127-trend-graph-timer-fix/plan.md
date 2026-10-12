# [SDD-127] — Implementation Plan

**Goal:** 추이 그래프 매초 갱신 + 1초 타이머 1회 생성.

## Files to Change
| File | Description |
|------|-------------|
| `frontend/src/components/class/GuestMeditationPanel.tsx` | `pushRingPoint` 불변화 + 호출부 새 배열 교체 + `readSnapshotRef` 안정화 |

## Tasks
1. `pushRingPoint` → `[...buf, value]` 새 배열 반환(불변).
2. 호출부 `series[def.key] = pushRingPoint(series[def.key], v)`.
3. `readSnapshotRef` 추가 + 타이머 `useEffect` 의존성 `[]`.
