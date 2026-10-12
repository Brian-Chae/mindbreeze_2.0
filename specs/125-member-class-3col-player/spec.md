# [SDD-125] 회원용 클래스 뷰 3열 재구성 — 목업 정본 이식

## Goal
확정된 디자인 목업(`design/member-class-player/index.html`, 11인치 iPad 1194×834 기본 비율 3열)을 **정본**으로, 회원(내담자) 클래스 뷰를 2열에서 **3열**(좌=클래스정보+프로필+6지표+피드백 / 중=상담사 라이브+채팅 / 우=디바이스+EEG·PPG raw)로 재구성한다. 백엔드 변경 없음(프론트 표현층 + 데이터 바인딩만).

## Context
- SDD-124에서 회원 뷰 2열 + 절대 그룹 평균(6지표) 브로드캐스트 구현·배포 완료(`ba407c18`).
- Brian이 목업을 "완전 좋다"고 확정 → 목업 유사도 극대화 목표로 React 이식.
- **확정 규칙**: 좌우 패널 최대폭(좌 460 / 우 420) = 기본값. 상담사 라이브+채팅 = MAIN(flex). 우측 EEG/PPG 그래프는 화면 폭에 맞춰 자동 조절(ResizeObserver).
- PPG는 IR·RED 두 색 **overlap**, ACC(움직임) raw는 **제거**.
- 지표 카드: 링 게이지(62px)+숫자(13px)+단위, 그룹 평균 틱 마커(라벤더 4px 글로우), 캡션 "그룹 평균 N"+"추이 대기", 하단 범례 3항목.
- CHIP: EEG 위(집중·이완·감정안정), PPG 위(BPM·HRV·호흡수).

## Scope

### ✅ In-scope (프론트 전용)
- 3열 flex 레이아웃 + 리사이즈 핸들(좌우 SUB 폭 조정: 좌 min250/max460, 우 min220/max420, 중 flex min220).
- 클래스 정보 카드(상담사명·참여자수·밴드 착용수·그룹 집중도).
- 회원 프로필 카드(이름 + 성별·나이 + 밴드 연결 상태).
- 지표 다이얼: 게이지 62px / 숫자 13px / 단위, 그룹 평균 틱 마커(라벤더), 캡션 "그룹 평균 N"+"추이 대기", 범례.
- 피드백("지금 나를 알려요")을 지표 아래 배치.
- 중앙: 상담사 라이브 + 함께한 시간 + 채팅(채팅을 topbar→중앙으로 이동).
- raw: ACC 제거, EEG(집중·이완·감정안정)·PPG(BPM·HRV·호흡) CHIP, PPG IR/RED overlap.
- 모바일(≤1024): 단일 스택.

### ❌ Out-of-scope
- 백엔드 변경 없음(SDD-124 `class:group_average` 계약 재사용).
- 상담사(호스트) 뷰 변경 없음.
- 리포트·기록지·raw 영속화 변경 없음.

## Acceptance Criteria
- [ ] 3열(좌/중/우)로 렌더, 좌우 패널 기본 폭 = 최대폭(460/420), 드래그 리사이즈 동작(min/max clamp).
- [ ] 지표 카드 6종: 게이지 62px·숫자 13px·단위·그룹 평균 틱 마커·캡션("그룹 평균 N"+"추이 대기")·범례.
- [ ] raw: EEG 2ch + PPG IR/RED overlap, ACC 없음, CHIP 6종(EEG 3 + PPG 3).
- [ ] 우측 캔버스가 패널 폭 변경(드래그)·창 리사이즈 시 자동 재할당(ResizeObserver).
- [ ] `cd frontend && npm run build` 0 errors / `npx tsc --noEmit` 0 errors.
- [ ] 기존 회원 뷰 테스트 통과(회귀 없음).

## Dependencies
- SDD-124: `lib/class/group-average.ts`, `useSessionLiveSocket`, `MemberMetricDial`, `MemberRawData`, `MemberDeviceStrip`, `member-class-player.css`.
- `useBand`: `scoredIndices`(focus/relaxation/emotional), `heartRate`/`sdnn`/`respiratoryRate`, `getEegWaveformSamples`/`getPpgWaveformSamples`.
- `lib/api/client-profile.ts` → `getClientProfile()`(이름·성별·생년월일, 회원 전용).
- `lib/api/session.ts` → `getSession`(host_id·participants), `getSessionByCodeState`(host_name·participant_count).
- `useAuthStore`: `user`(이름·counselors).

## Risks
- **데이터 공백**: 클래스 정보·프로필 데이터는 회원/게스트 경로가 다름 → null 폴백(카드 최소 표기: 이름만 또는 "—").
- **250Hz 렌더**: rAF+supplier 패턴 유지, CHIP은 1Hz 스냅샷 재사용(리렌더 부하 최소).
- **리사이즈 성능**: ResizeObserver로 캔버스 재할당 — 드래그 중 일시 부하는 수용.
- **목업 유사도**: 색 토큰·타이포·간격은 정본 CSS 토큰 재사용으로 회귀 방지.
