# [SDD-124] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 구현 시작.

**Goal:** 회원 클래스 뷰 2열 재구성 + 절대 그룹 평균(6지표) 실시간 브로드캐스트.

**Architecture:**

```
[Backend]
group_aggregate.py
  compute_group_average(session_id, db) → { session_id, at, wearer_count, min_wearers,
    sample_status, metrics: { focus_index, relaxation_index, emotional_stability,
      heart_rate, respiratory_rate, sdnn }(각 { mean }) }
    └─ 착용자별 최근 RECENT_SEC(=60) 윈도우의 지표 평균 → 착용자 간 평균 (익명)
session_live_namespace.py
  publish_group_average() — AGGREGATE_INTERVAL_SEC throttle 재사용
  broadcast_group_average() — `_room_all`(호스트+전체 참가자)로 emit
  on_feature() 에서 publish_group_average() 호출 (기존 publish_group_aggregate와 병행)

[Frontend]
socket.ts: subscribeGroupAverage() + GROUP_AVERAGE_EVENT = "class:group_average"
useSessionLiveSocket.ts: onGroupAverage 콜백 + 구독
group-average.ts (신규): 타입/정규화(normalizeGroupAverage) — 마음 raw(0~1) → scoreIndices(0~100)
GuestMeditationPanel.tsx: 2열 재구성 + 그룹 평균 state 연결
MemberMetricDial.tsx: average(그룹 평균) prop + 마커 렌더
MemberRawData.tsx (신규): EEG/PPG/ACC dark 파형 (rAF + supplier)
MemberDeviceStrip.tsx (신규): 배터리/접촉/신호/연결시간
member-class-player.css: 2열 그리드 + 지표/디바이스·raw 3:2
```

**Tech Stack:** FastAPI + Socket.IO / React 18 + TS / Canvas 2D(rAF)

## Files to Change

| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/services/group_aggregate.py` | `compute_group_average()` 절대 6지표 평균 추가 |
| Modify | `backend/app/ws/session_live_namespace.py` | `class:group_average` 이벤트 + `_room_all` 브로드캐스트 |
| Modify | `backend/tests/test_class_group_average.py` | 신규 이벤트 계약·익명성 테스트 |
| Modify | `frontend/src/lib/socket.ts` | `subscribeGroupAverage` + 이벤트명 상수 |
| Modify | `frontend/src/hooks/useSessionLiveSocket.ts` | `onGroupAverage` 콜백 + 구독 |
| Create | `frontend/src/lib/class/group-average.ts` | 타입 + 마음 지표 `scoreIndices` 정규화 |
| Modify | `frontend/src/components/class/GuestMeditationPanel.tsx` | 2열 재구성 + 그룹 평균 연결 |
| Modify | `frontend/src/components/class/MemberMetricDial.tsx` | `average` prop + 그룹 평균 마커 |
| Create | `frontend/src/components/class/MemberRawData.tsx` | EEG/PPG/ACC dark 파형 |
| Create | `frontend/src/components/class/MemberDeviceStrip.tsx` | 디바이스 상태 스트립 |
| Modify | `frontend/src/components/class/member-class-player.css` | 2열 그리드 + 3:2 + dark 파형 스타일 |

## Tasks

### Task 1: 백엔드 — 절대 그룹 평균 서비스
**Objective:** `compute_group_average()` — 착용자별 최근 60초 지표 평균 → 착용자 간 평균(6지표), MIN_WEARERS 게이트, null 보존.
**Files:** `backend/app/services/group_aggregate.py`
**Estimate:** 20min

### Task 2: 백엔드 — WS 이벤트 브로드캐스트
**Objective:** `class:group_average` 이벤트를 `_room_all`로 emit(throttle 재사용), `on_feature`에서 호출.
**Files:** `backend/app/ws/session_live_namespace.py`
**Estimate:** 15min

### Task 3: 백엔드 — 테스트
**Objective:** 계약(6지표 mean)·익명성(개인 필드 부재)·표본 부족·_room_all 타깃 테스트.
**Files:** `backend/tests/test_class_group_average.py`
**Estimate:** 20min

### Task 4: 프론트 — 그룹 평균 타입·정규화 + 소켓 구독
**Objective:** `group-average.ts`(타입 + 마음 raw→scoreIndices) + `useSessionLiveSocket` `onGroupAverage` 구독.
**Files:** `frontend/src/lib/class/group-average.ts`, `frontend/src/lib/socket.ts`, `frontend/src/hooks/useSessionLiveSocket.ts`
**Estimate:** 15min

### Task 5: 프론트 — 다이얼 그룹 평균 마커
**Objective:** `MemberMetricDial`에 `average` prop 추가 — "그룹 평균 N" 라벨 + 다이얼 틱 마커(표본 부족 시 흐림).
**Files:** `frontend/src/components/class/MemberMetricDial.tsx`
**Estimate:** 15min

### Task 6: 프론트 — raw 파형 + 디바이스 스트립 컴포넌트
**Objective:** `MemberRawData`(EEG 2ch/PPG/ACC dark rAF 파형) + `MemberDeviceStrip`(배터리·접촉·신호·연결시간).
**Files:** `frontend/src/components/class/MemberRawData.tsx`, `frontend/src/components/class/MemberDeviceStrip.tsx`
**Estimate:** 25min

### Task 7: 프론트 — 2열 재구성 + CSS
**Objective:** `GuestMeditationPanel` 2열(좌 시그널·영상·시간 / 우 지표·디바이스·raw) + CSS 3:2.
**Files:** `frontend/src/components/class/GuestMeditationPanel.tsx`, `frontend/src/components/class/member-class-player.css`
**Estimate:** 25min

### Task 8: 검증 — 빌드·테스트
**Objective:** `tsc --noEmit` + `npm run build` + `pytest` 통과, 브라우저 레이아웃 스크린샷 검증.
**Estimate:** 15min

## Testing Strategy
- `cd backend && pytest tests/test_class_group_average.py -q` — 신규 이벤트 테스트
- `cd frontend && npx tsc --noEmit` — 타입 체크
- `cd frontend && npm run build` — 프로덕션 빌드
- Chrome headless 스크린샷(1280/390) + vision — 2열·그룹 평균·raw 파형·오버플로 검증
