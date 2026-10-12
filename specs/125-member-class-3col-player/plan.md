# [SDD-125] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 구현 시작.

**Goal:** 회원 클래스 뷰를 목업 정본(3열)으로 재구성. 프론트 표현층 + 데이터 바인딩만.

**Architecture:**

```
[Frontend — React 18 + TS + Canvas 2D]
GuestMeditationPanel.tsx (3열 컨테이너)
├─ header (topbar): 브랜드·클래스명·상태·나가기
└─ .member-workspace (flex, 리사이즈 가능)
   ├─ .col-metrics (460px 기본, min250/max460)  ← SUB
   │   ├─ MemberClassInfoCard  (상담사·참여자·밴드착용·그룹집중)
   │   ├─ MemberProfileCard    (이름·성별나이·밴드상태)
   │   ├─ metrics (MIND 3 + BODY 3 → MemberMetricDial ×6 + 범례)
   │   └─ signal-box ("지금 나를 알려요" → QuietSignalButtons)
   ├─ .resize-handle (점3개, 드래그로 좌우 조정)
   ├─ .col-live (flex:1, min220)                 ← MAIN
   │   ├─ video-card (CounselorLiveTile + 함께한 시간)
   │   └─ chat-card (ClassChatPanel)
   ├─ .resize-handle
   └─ .col-device (420px 기본, min220/max420)    ← SUB
       ├─ MemberDeviceStrip
       └─ MemberRawData (EEG 2ch + PPG IR/RED overlap, ACC 제거, CHIP)
```

**데이터 바인딩 (신규):**
| 카드/요소 | 데이터 소스 |
|---|---|
| 클래스 정보 · 상담사명 | 회원: `host_id`→`user.counselors` 매칭 / 게스트: `host_name`(by-code) |
| 클래스 정보 · 참여자수 | `getSession().participants.length` / `participant_count` |
| 클래스 정보 · 밴드착용수 | `GroupAverageEvent.wearer_count` |
| 클래스 정보 · 그룹집중도 | `groupAverage.focus` |
| 프로필 · 이름/성별/나이 | `getClientProfile()`(회원) / 게스트는 이름만 |
| CHIP(EEG 3) | `band.scoredIndices`(focus/relaxation/emotional) |
| CHIP(PPG 3) | `band.heartRate`/`band.sdnn`/`band.respiratoryRate` |

**Tech Stack:** React 18 + TS / Canvas 2D(rAF) / CSS custom-props 토큰.

## Files to Change

| Action | File | Description |
|--------|------|-------------|
| Modify | `frontend/src/components/class/GuestMeditationPanel.tsx` | 3열 구조 재구성 + 클래스정보/프로필/채팅 위치 변경 |
| Create | `frontend/src/components/class/MemberClassInfoCard.tsx` | 클래스 정보 카드 |
| Create | `frontend/src/components/class/MemberProfileCard.tsx` | 회원 프로필 카드 |
| Modify | `frontend/src/components/class/MemberMetricDial.tsx` | 게이지 크기·틱 마커(라벤더)·캡션("그룹 평균 N"+"추이 대기") |
| Modify | `frontend/src/components/class/MemberRawData.tsx` | ACC 제거 + CHIP + PPG IR/RED overlap |
| Modify | `frontend/src/components/class/member-class-player.css` | 3열 flex + 리사이즈 핸들 + 카드/칩/다이얼 스타일 |

## Tasks

### Task 1: CSS — 3열 flex + 리사이즈 핸들
**Objective:** `.member-workspace`(flex) + `.col-metrics`(460)·`.col-live`(flex:1)·`.col-device`(420) + `.resize-handle`(점3개) + 카드·칩·다이얼 스타일. 모바일(≤1024) 단일 스택.
**Files:** `member-class-player.css`
**Estimate:** 30min

### Task 2: 클래스 정보·프로필 카드
**Objective:** `MemberClassInfoCard`(상담사·참여자·밴드착용·그룹집중) + `MemberProfileCard`(이름·성별나이·밴드상태). null 폴백.
**Files:** `MemberClassInfoCard.tsx`, `MemberProfileCard.tsx`
**Estimate:** 25min

### Task 3: GuestMeditationPanel 3열 재구성
**Objective:** 2열 grid → 3열 flex. 채팅 topbar→중앙 이동. 리사이즈 핸들 드래그 로직. 클래스정보/프로필/피드백 배치.
**Files:** `GuestMeditationPanel.tsx`
**Estimate:** 30min

### Task 4: MemberMetricDial 정본 스타일
**Objective:** 게이지 48→62px, 숫자 15→13px, 틱 마커 민트→라벤더(4px 글로우), 캡션 델타("±N")→"그룹 평균 N"+"추이 대기", 범례 라인.
**Files:** `MemberMetricDial.tsx`
**Estimate:** 20min

### Task 5: MemberRawData — ACC 제거 + CHIP + IR/RED
**Objective:** ACC 블록·accMagnitude 제거. EEG(집중·이완·감정안정)·PPG(BPM·HRV·호흡) CHIP. PPG IR/RED overlap 유지.
**Files:** `MemberRawData.tsx`
**Estimate:** 20min

## Notes
- 리사이즈 핸들 드래그는 `useRef` + pointer events, 폭을 min/max clamp.
- 캔버스 재할당은 `MemberRawData` 내 기존 ResizeObserver 재사용(패널 폭 변경 시 자동).
- `ClassChatPanel`·`CounselorLiveTile`·`QuietSignalButtons`·`MemberDeviceStrip`는 표현 위치만 변경, 내부 계약 보존.
