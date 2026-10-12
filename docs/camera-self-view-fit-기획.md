# 카메라(셀프뷰) 종류·크기 대응 표시 기획

> 작성일: 2026-09-21
> 목표: **어떤 카메라(전면/후면)·어떤 해상도/비율·어떤 창 크기에서도 내 모습이 잘리지 않고 전체가 보인다** — 단일 목표.
> 범위: FE 전용. 프리조인 프리뷰 + 라이브 셀프뷰 2개 표면.

---

## 1. 현황 분석 (코드 근거)

### 1.1 카메라 표면 전수 조사

- `<video>` / `getUserMedia` 사용 파일은 정확히 2개 (grep 전수 확인):
  - `frontend/src/components/session/SessionPreJoinPreview.tsx` — 프리조인 프리뷰 (대형)
  - `frontend/src/components/session/SessionHostVideoView.tsx` — 진행 중 호스트 셀프뷰 (중형)
- 사용처: `frontend/src/pages/sessions/ClassPlayerPage.tsx` 단일 페이지
  - 세팅 씬(`isSetup`)에서 `SessionPreJoinPreview` (853행)
  - 진행 씬(`isRunning && isHost && cameraOn`)에서 `SessionHostVideoView` (889행)
- `SessionLivePage.tsx`, `components/player/*`(MemberSessionScene 등)에는 카메라 렌더 없음 → **이번 기획 범위 밖**.

### 1.2 스트림 획득(getUserMedia) 위치 — 3곳

| 위치 | 코드 | 제약 조건 |
|---|---|---|
| 프리조인 프리뷰 | `SessionPreJoinPreview.tsx:135` `openCamera()` | `{ video: { facingMode } }` — 해상도 미지정 |
| 라이브 셀프뷰(녹화 전) | `SessionHostVideoView.tsx:44` | `{ video: { facingMode } }` — 해상도 미지정 |
| 녹화 스트림 | `useVideoRecorder.ts:94` `openStream()` | `{ video: { facingMode }, audio: withAudio }` — 해상도 미지정 |

- 해상도/비율 제약이 전혀 없음 → 브라우저·장치 기본값 사용.
  - 데스크톱 웹캠: 보통 **640×480 (4:3)** 기본
  - 모바일 전면: 세로 방향에서 **portrait 비율** (예: 480×640 등)
  - 즉, 스트림 비율은 장치·브라우저마다 제각각이며 **코드가 이를 전혀 읽지 않음**.

### 1.3 렌더링 현황 — 잘림의 원인과 즉시 수정 상태

- **프리조인** (`SessionPreJoinPreview.tsx:327-336`):
  - 컨테이너: `relative min-h-[240px] overflow-hidden rounded-2xl bg-[#111]` — 비율 개념 없음
  - video: `h-full max-h-[380px] w-full object-contain` + 전면일 때 `-scale-x-100`
- **라이브 셀프뷰** (`SessionHostVideoView.tsx:69-83`):
  - 컨테이너: `relative min-h-[200px] overflow-hidden rounded-2xl bg-[#111]`
  - video: `h-full max-h-[320px] w-full object-contain` + 전면일 때 `-scale-x-100`
- **원래 문제**: `object-cover` + `w-full` + 고정 `max-h` → 컨테이너 박스 비율(부모 너비 ÷ 380/320px)이 스트림 비율과 다르면 상하 또는 좌우가 **잘려서** "내 모습이 절반만 보임".
- **즉시 수정 상태** (커밋 `57d66050`): `object-cover → object-contain`으로 변경. 잘림은 사라졌으나:
  - video 요소 박스는 여전히 `w-full` + `max-h` 클램프로 결정 → 박스 비율 ≠ 스트림 비율
  - 그 차이만큼 **검은 레터박스/필러박스**가 발생 (넓은 창 + 4:3 웹캠이면 좌우에 넓은 검은 여백)
  - 즉 "잘림"은 해결, "화면을 낭비 없이 꽉 채워 보여주기"는 미해결 → 본 기획의 대상.

### 1.4 전면/후면 전환 로직 현황

- 프리조인: `facingMode` 로컬 state (`SessionPreJoinPreview.tsx:68`), `handleFacingSwitch()`(198행)로 토글 + 스트림 재요청. 전면(`user`)일 때만 `-scale-x-100` 미러링.
- 녹화: `useVideoRecorder.switchCamera()`(127행) — 녹화 중이면 recorder 중지 → 스트림 교체 → 청크 index 이어서 재시작.
- `facingMode`는 `ideal` 취급 — 후면 카메라 없는 데스크톱에서도 실패하지 않음 (주석 명시, 134행).
- **연계 공백(발견 사항)**: 프리조인의 `facingMode`와 `useVideoRecorder`의 `facingMode`는 **서로 독립** — `onStart`로 전달되는 `PreJoinMediaPrefs`는 `{cameraOn, micOn}`뿐(15-18행). 프리뷰에서 후면으로 전환해 확인했어도 **녹화는 항상 전면(`user`)으로 시작**함. (§6 선택 과제로 제안)

### 1.5 문제 요약

- 스트림의 실제 비율을 아무도 읽지 않는다 → 컨테이너가 임의 비율(부모 너비 × 고정 max-h)로 그려진다.
- `cover`면 잘리고, `contain`이면 여백이 남는다. 둘 다 근본 해결이 아니다.
- **근본 해결 = 컨테이너 비율 자체를 스트림 비율에 맞추는 것.**

---

## 2. 핵심 설계 — 스트림 비율 감지

### 2.1 비율 읽는 방법

- **`video.videoWidth` / `video.videoHeight` 사용 (권장)**
  - `loadedmetadata` 이벤트 시점에 확정됨
  - 모바일 회전·드라이버 회전이 **반영된 실제 표시 크기** — 그대로 CSS에 써도 됨
- `track.getSettings().width/height`는 보조 수단 — 일부 플랫폼에서 회전 미반영 가능 → 채택하지 않음.
- 재계산 트리거 2개만 구독하면 충분:
  - `loadedmetadata` — 스트림 최초 연결·교체(전면/후면 전환) 시
  - `resize` (video 요소 이벤트) — 진행 중 스트림 해상도 변경·모바일 기기 회전 시
- 가드: `videoWidth === 0 || videoHeight === 0`이면 무시 (메타데이터 미확정 상태).

### 2.2 공통 훅 `useCameraAspect` 신설

- 파일: `frontend/src/hooks/use-camera-aspect.ts`
- 시그니처(안):
  ```ts
  /** video 요소의 실제 스트림 비율을 감지해 컨테이너 aspect-ratio 값을 돌려준다 */
  function useCameraAspect(videoRef: RefObject<HTMLVideoElement | null>): {
    /** "W / H" 형태 CSS aspect-ratio 값. 미확정이면 null (기본 비율 사용) */
    aspectRatio: string | null;
    /** 세로(portrait) 스트림 여부 — 레이아웃 분기용 */
    isPortrait: boolean;
  }
  ```
- 동작:
  - `loadedmetadata` / `resize` 리스너 등록 → `videoWidth/videoHeight` 읽어 state 갱신
  - **극단 비율 클램프**: 세로 9:16(0.5625) ~ 가로 21:9(2.33) 범위로 제한 — 비정상 장치 값이 레이아웃을 파괴하지 않도록. 클램프로 생긴 오차는 `object-contain`이 흡수
  - 스트림 해제·카메라 오프 시 `null` 복귀 (플레이스홀더는 기존 `min-h` 유지)
- 두 컴포넌트가 동일 훅을 공유 → 표면별 중복 구현 금지.

---

## 3. 표시 전략 비교 및 결정

| 전략 | 동작 | 판정 |
|---|---|---|
| A. `object-cover` + 고정 박스 | 박스는 예쁘지만 스트림 가장자리 잘림 | ❌ 원래 문제 (Brian 요구 위반) |
| B. `object-contain` + 고정 박스 | 안 잘리지만 검은 여백 큼 (현 상태) | △ 임시 조치 |
| C. **컨테이너 aspect-ratio = 스트림 비율** + `object-contain` 안전망 | 여백 없이 전체가 보임. 비율 불일치가 원천 제거됨 | ✅ **채택** |

- **결정: C.** 이유:
  - "전체가 보인다"는 단일 목표를 잘림 없이·여백 없이 동시에 만족하는 유일한 방식
  - CSS `aspect-ratio` 한 줄 + 이벤트 리스너 2개 — 과잉 설계 아님
  - 창 리사이즈 대응은 CSS가 자동 처리 (JS 재계산 불필요, 재계산은 스트림이 바뀔 때만)
- 세부 규칙:
  - 컨테이너: `style={{ aspectRatio }}` + **최대 높이 클램프** (프리조인 `max-h` 유지, §4 참조). `aspect-ratio`와 `max-h`가 충돌하면 높이가 이기고 너비가 줄어듦 → `mx-auto`로 중앙 정렬, 남는 좌우 공간은 부모 배경으로 자연 처리
  - video: `h-full w-full object-contain` 유지 — 클램프·서브픽셀 오차의 안전망 (이 경우 여백은 수 픽셀 수준)
  - `aspectRatio === null`(권한 확인 중·카메라 오프): 기존 `min-h-[240px]`/`min-h-[200px]` 플레이스홀더 그대로 — 레이아웃 점프 최소화

---

## 4. 카메라 종류·크기별 대응

### 4.1 종류별 (전면/후면)

- **전면(`user`)**:
  - 모바일 세로 파지 시 portrait 비율로 들어옴 → `useCameraAspect`가 그대로 반영 (별도 분기 불필요)
  - 미러링 `-scale-x-100` **유지** (현행과 동일). 셀프뷰 미러링은 화상회의 표준 — 사용자가 거울처럼 인식
  - 미러링은 CSS transform이므로 비율 계산과 무관
- **후면(`environment`)**:
  - 보통 landscape 비율. 미러링 **안 함** (현행 유지 — 후면은 실제 방향이 맞음)
- **전환 시**:
  - 스트림 교체 → `loadedmetadata` 재발생 → 비율 자동 재계산 (훅이 처리, 컴포넌트 추가 코드 없음)
  - 미러링은 기존 `facingMode === 'user'` 조건 그대로
  - 전환 순간 이전 비율이 잠깐 남을 수 있음 → 메타데이터 확정까지 이전 `aspectRatio` 유지(깜빡임 방지), `object-contain`이 순간 불일치를 흡수

### 4.2 크기/해상도별

- 대응해야 할 실측 비율: **4:3**(데스크톱 웹캠 기본), **16:9**(고급 웹캠·외장캠), **9:16 등 세로**(모바일), 기타 3:4, 1:1 등 임의 값
  - 전부 `videoWidth/videoHeight` 실측값 기반이므로 **비율 목록을 하드코딩하지 않는다** — 어떤 값이 와도 동작
- **기기 회전(orientation)**: 회전 시 브라우저가 스트림을 재구성 → video `resize` 이벤트 발생 → 훅이 재계산. `orientationchange` 별도 구독 불필요
- **창 크기**: 컨테이너 너비는 부모 따라 유동, 높이는 `aspect-ratio`로 파생 → 리사이즈에 JS 개입 없음
- **getUserMedia 해상도 제약은 추가하지 않는다** (결정):
  - 제약을 걸면 장치 호환성 리스크(OverconstrainedError)만 늘고, 표시 문제는 비율 반영으로 이미 해결됨
  - 녹화 화질 정책은 별도 주제 (`useVideoRecorder`의 비트레이트 정책과 분리 유지)

---

## 5. UX 설계

### 5.1 프리조인 프리뷰 (대형)

- 역할: 시작 전 "내 모습 확인" — **전체가 보이는 것**이 최우선, 크기는 그다음
- 레이아웃:
  - 컨테이너: 스트림 비율 + `max-h-[380px]` 유지 (임상 환경 노트북에서 우측 패널·시작 버튼이 스크롤 없이 보여야 함)
  - **세로 스트림(모바일)**: 비율 반영 시 `380px` 높이 × 좁은 너비 카드가 됨 → `mx-auto` 중앙 정렬, 좌우는 섹션 배경. 세로 화면을 억지로 가로 박스에 넣지 않는다
  - 기존 오버레이(카메라 배지·토글 버튼·마이크 꺼짐 배지)는 컨테이너 기준 절대배치라 수정 불필요
- 전환 버튼: 기존 "후면/전면 카메라로 전환" 버튼 유지 (`SessionPreJoinPreview.tsx:460-467`)
- 미러링 안내: 전면 카메라 배지(351행) 옆에 짧은 보조 문구 1줄 — "내 화면에서만 좌우 반전되어 보입니다" 수준. 별도 토글·설정 항목은 만들지 않는다 (단순화)

### 5.2 라이브 셀프뷰 (중형)

- 역할: 진행 중 "내가 어떻게 찍히고 있는지" 확인 — 모니터링 그리드를 밀어내면 안 됨
- 레이아웃:
  - 컨테이너: 스트림 비율 + `max-h-[320px]` 유지
  - **세로 스트림**: 320px 높이 × 좁은 너비로 자연 축소 → `mx-auto` 중앙 또는 좌측 정렬 (ClassPlayerPage 흐름상 중앙 권장)
  - "녹화 중 · 내 영상" 배지 현행 유지
- 프리조인 → 셀프뷰 전환 시 같은 훅·같은 규칙이므로 **비율 표현이 연속적** (기존 SDD-084/085의 "자연 전환" 원칙 유지)

### 5.3 공통 원칙

- 배경 `bg-[#111]` 유지 — 클램프 순간의 미세 여백이 자연스럽게 보이는 안전색
- 비율 미확정(pending)·카메라 오프 상태의 플레이스홀더 UI는 현행 그대로 (§3 세부 규칙)
- 새 설정·새 모드·점수화 없음 — 사용자에게 노출되는 조작 요소는 기존과 동일

---

## 6. 구현 범위 및 단계 (FE 전용)

### Phase 1 — 공통 훅 (핵심)

- [ ] `frontend/src/hooks/use-camera-aspect.ts` 신설 (§2.2 시그니처)
- [ ] vitest 단위 테스트: `loadedmetadata`/`resize` 발화 시 비율 갱신, 0값 가드, 클램프 경계(9:16~21:9), 언마운트 리스너 해제

### Phase 2 — 두 표면 적용

- [ ] `SessionPreJoinPreview.tsx`: 컨테이너에 `aspectRatio` 적용 + `mx-auto`, `max-h-[380px]`·플레이스홀더 `min-h` 유지
- [ ] `SessionHostVideoView.tsx`: 동일 적용 (`max-h-[320px]`)
- [ ] `object-contain`·미러링 조건 등 기존 코드는 변경하지 않음

### Phase 3 — 선택 (별도 판단 후 진행)

- [ ] 프리조인 `facingMode` → 세션 녹화 연계: `PreJoinMediaPrefs`에 `facingMode` 추가 → `ClassPlayerPage` → `useVideoRecorder` 초기값 전달 (§1.4 공백 해소). 표시 기획과는 독립적이므로 **범위 분리 가능** — Brian 판단 필요

### 수정 파일 요약

| 파일 | 변경 |
|---|---|
| `hooks/use-camera-aspect.ts` | 신설 |
| `components/session/SessionPreJoinPreview.tsx` | 컨테이너 aspect-ratio 적용 (수 줄) |
| `components/session/SessionHostVideoView.tsx` | 동일 (수 줄) |
| (선택) `SessionPreJoinPreview.tsx` / `ClassPlayerPage.tsx` / `useVideoRecorder.ts` | facingMode 연계 |

---

## 7. QA 체크리스트

| # | 시나리오 | 기대 결과 |
|---|---|---|
| 1 | 데스크톱 4:3 웹캠, 넓은 창 | 잘림 없음 + 큰 검은 여백 없음 (컨테이너가 4:3) |
| 2 | 데스크톱 16:9 웹캠 | 컨테이너 16:9, 여백 없음 |
| 3 | 모바일 전면 카메라 세로 파지 | 세로 비율 카드로 표시, 얼굴 전체 보임, 미러링됨 |
| 4 | 전면 → 후면 전환 | 비율 재계산, 미러링 해제, 잘림 없음 |
| 5 | 모바일 회전 (세로↔가로) | `resize` 이벤트로 비율 자동 갱신 |
| 6 | 창 리사이즈 (좁게/넓게) | CSS만으로 추종, 잘림·왜곡 없음 |
| 7 | 카메라 오프 → 온 | 플레이스홀더(min-h) ↔ 비율 컨테이너 전환 시 레이아웃 파손 없음 |
| 8 | 카메라 권한 거부 | 기존 폴백 화면 그대로 (회귀 없음) |
| 9 | 프리조인 → 클래스 오픈 → 라이브 셀프뷰 | 두 표면의 비율 표현이 일관됨 |
| 10 | 녹화 중 전면/후면 전환 (`switchCamera`) | 셀프뷰 비율 재계산 + 녹화 청크 연속성 유지 (기존 동작 회귀 없음) |

---

## 8. 비범위 (하지 않는 것)

- 내담자/회원 측 카메라 표시 — 현재 코드에 존재하지 않음 (§1.1)
- getUserMedia 해상도·화질 제약 추가 (§4.2 결정)
- 미러링 사용자 토글, 줌/크롭 조정 UI, 가상 배경 등 부가 기능
- `useVideoRecorder` 녹화 파이프라인(비트레이트·청크) 변경 — 표시 문제와 무관
