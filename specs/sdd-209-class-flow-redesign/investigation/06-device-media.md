# I6 기기·미디어 — 코드 조사

조사 기준: develop `32fa5533`, 조사일 2026-10-17. 경로는 프론트 `frontend/src/`, 백엔드 `backend/app/` 기준 상대경로. 읽기 전용 조사이며 코드·시안은 수정하지 않았다.

## 0. 한 줄 결론

1. 회원 대기실 기기 점검(`components/class/ClassWaitingRoom.tsx:445-559`)과 상담사 세팅 프리뷰(`components/session/SessionPreJoinPreview.tsx`)는 **같은 일을 하는 복제 코드**다(RMS 계산식·오류 문구 함수 중복). 새 "내 영상·소리"는 `useMediaCheck` 훅 + 표시 컴포넌트로 한 번만 만들어 둘 다 쓰게 할 수 있다.
2. **칩 문구 버그의 원인은 상태 모델**이다. `getUserMedia` 가 던지는 모든 오류를 `'denied'` 한 값으로 저장(`ClassWaitingRoom.tsx:244-248`)하고, 칩은 그 값을 "권한이 거부되었습니다"로 찍는다(`lib/class/class-waiting-room.ts:100-101`). 정확한 분류(`NotFoundError`/`NotReadableError` 등)는 이미 `mediaErrorMessage`(`:108-121`)에 있으나 경고 상자 문자열로만 쓰이고 칩에는 안 간다.
3. 마이크 레벨은 현행 식 `level = min(1, RMS × 3)`(`ClassWaitingRoom.tsx:186`)를 그대로 재사용해 **5단계 링 = `ceil(level × 5)`**, 칩 판정은 최근 3초 피크로 하는 안을 제안한다(임계값은 시안 샘플과 일치하나 **실기기 측정 전**).
4. 마이크 권한 요청은 지금 **페이지 진입 즉시** 자동 발생한다(`:253-265`). 기기 단계 진입 시점으로 옮기고, 오디오 컨텍스트는 사용자 탭 안에서 `resume()` 해야 한다(현행은 `resume()` 호출 없음, iOS Safari 동작 미확인).
5. `SessionPreJoinPreview` 의 마이크 OFF 확인 다이얼로그는 **어느 경로로도 열 수 없다**(확인: `handleStart` 는 `startButton` 만 호출, `startButton` 은 `!compact` 일 때만 렌더, 유일한 호출처는 `compact`). 게다가 프리뷰는 마운트 직후 `{cameraOn:false, micOn:false}` 를 부모에 보고해 권한 확인 전에 헤더 버튼을 누르면 의도치 않게 수동 기록 모드가 선언될 수 있다.
6. 오프라인에서 기기 단계 생략: 게이트(`class-waiting-room.ts:87`)가 장소와 무관하게 `deviceDone` 을 요구하고 `ClassWaitingRoom` 은 `locationType` 을 BGM 에만 쓴다. 게이트 입력에 장소를 추가하면 되고 `checkin` REST payload 는 기기 정보를 담지 않아 변하지 않는다.
7. 백엔드 변경은 **필수 0, 권장 0, 보류 1**. 모든 변경이 프론트에서 끝난다.

## 1. 현재 코드 상태

| 항목 | 판정 | 근거 |
|---|---|---|
| 회원 대기실 마이크 점검(자동 요청·레벨·토글) | 있음 | `ClassWaitingRoom.tsx:230-265, 449-500` |
| 회원 대기실 카메라 점검(선택, 미리보기) | 있음(칩 없음) | `:202-227, 503-537` — 헤더에 켜기/끄기 버튼과 오류 상자만, 상태 칩 없음 |
| 스피커 테스트음 | 있음 | `:293-314, 540-554` |
| 장치 상태 모델 | 일부 | `WaitingRoomDeviceState = 'pending'\|'on'\|'off'\|'denied'\|'unsupported'` (`lib/class/class-waiting-room.ts:16-22`). 장치 없음/사용 중 구분 없음 |
| 오류 분류 함수 | 있음, 칩에 미연결 | `mediaErrorMessage` `class-waiting-room.ts:108-121`(NotAllowed/Security, NotFound/Overconstrained, NotReadable 분리) |
| 칩 문구 | **버그** | `deviceStateLabel` `class-waiting-room.ts:92-105`, 사용처 `ClassWaitingRoom.tsx:461` |
| 마이크 레벨 → 5단계 링 | 없음 | 현재는 연속 가로 막대(`:465-473`) |
| 카메라 켜짐 ↔ 마이크 막대/링 전환 | 없음 | 마이크 섹션과 카메라 섹션이 분리(`:449-500` / `:503-537`) |
| 마이크 자동 권한 요청 시점 | 페이지 진입 즉시 | `:253-265` (마운트 0ms 타이머로 `openMic()`) |
| 상담사 프리뷰의 카메라·마이크 | 있음 | `SessionPreJoinPreview.tsx:140-206`(마운트 시 카메라+마이크 동시 요청 `:180-181`) |
| 프리뷰 마이크 OFF 확인 다이얼로그 도달 | **불가** | 아래 §2.7 |
| 합친 컴포넌트 공용화 | 없음 | 호출처는 `pages/sessions/ClassPlayerPage.tsx:1889` 하나 |
| 입장 payload 의 `cameraOn/micOn` 이 진행 화면에 반영 | 없음 | `pages/class-join-page.tsx:215-227` 이 payload 의 `nickname` 만 쓴다. 진행 화면 초기값은 고정(`MemberMediaControls.tsx:96-97` 마이크 true, 카메라 false) |
| 오프라인에서 기기 단계 생략 | 없음 | 게이트 `class-waiting-room.ts:87`, `ClassWaitingRoom.tsx:49,139,365,638` 만 장소 사용(BGM) |
| 허용 방법 시트 | 있음(일반 문구 1종) | 회원: `lib/class/member-player-case.ts:172-177` + 렌더 `components/class/player/member/MemberStage.tsx:124-139`; 상담사: `components/class/player/host/HostMediaSheet.tsx:171-183` |
| OS·브라우저별 안내 분기 유틸 | 없음 | `userAgent` 사용은 `lib/web-push.ts:75`(기기 라벨)뿐. 플랫폼 구분 `lib/native/platform.ts:4-8` 만 있음 |
| 마이크 OFF 경고(FH05 `mic-off-warn`) 로직 | 없음 | 아래 §2.7 |

## 2. 상세 조사

### 2.1 회원 대기실 기기 단계 구조 (`ClassWaitingRoom.tsx`)

- 상태: `cameraState` 초기 `'off'`, `micState` 초기 `mediaSupported ? 'pending' : 'unsupported'`(`:115-118`), `micLevel` 0~1(`:121-122`), 오류 문자열 `cameraError`/`micError`(`:119-120`).
- `mediaSupported = Boolean(navigator.mediaDevices?.getUserMedia)`(`:105-107`). 비보안 컨텍스트(http)에서는 `navigator.mediaDevices` 가 없어 `'unsupported'` → "이 브라우저는 마이크를 지원하지 않습니다"가 나온다(`class-waiting-room.ts:102-103`). 브라우저 문제가 아니라 http 문제인 경우에도 같은 문구다(`window.isSecureContext` 확인 없음).
- 단계 완료: `completeDevices`(`:95`) 하나가 `deviceDone` 을 true 로 만든다. "기기 테스트 건너뛰기"와 "기기 확인 완료" 두 버튼이 모두 같은 함수를 호출한다(`:557-558`) → **마이크·카메라 상태와 무관하게 통과**. 시안도 마이크를 필수 칩으로 표기하나 하단 "다음"은 항상 활성이고 "마이크는 입장한 뒤에도 다시 켤 수 있어요"(`member-b.html` FM06d)이므로 일치한다.
- 입장 확정: `handleEnter`(`:324-336`)가 `onEnter({nickname, cameraOn, micOn})` 을 호출하고, 진행 중 전환이면 미리보기 스트림과 오디오 컨텍스트를 정리(`:328-334`).
- **리렌더 부하**: 레벨 state 가 루트 컴포넌트에 있어 10Hz 로 설문·밴드 패널까지 포함한 전체 656줄 컴포넌트가 다시 렌더된다(`:121, 186-192`).

### 2.2 마이크 레벨 측정 방식

| 위치 | 방식 |
|---|---|
| `ClassWaitingRoom.tsx:169-199` | `new AudioContext()` → `createMediaStreamSource(stream)` → `createAnalyser()`, `fftSize = 512`(`:176`), 버퍼 `new Uint8Array(analyser.frequencyBinCount)`(`:178`), `requestAnimationFrame` 루프에서 `getByteTimeDomainData`, RMS = `sqrt(mean(((b-128)/128)^2))`, **`level = min(1, RMS × 3)`**(`:186`). `setState` 는 100ms 이상 간격(10Hz, `:187-192`, SDD-130) |
| `SessionPreJoinPreview.tsx:113-135` | 같은 식·같은 `fftSize`, 단 **매 프레임 `setMicLevel`**(`:130`, 스로틀 없음) |
| 값 범위 | 0~1 |
| 정지 | `stopMeter`(`:154-160`)가 rAF 취소·`AudioContext.close()`·레벨 0 복귀 |

관찰: (a) `frequencyBinCount` 는 `fftSize / 2 = 256` 이라 시간 영역 버퍼가 256샘플(48kHz 기준 약 5ms)뿐이다(`:178`). 낮은 음(주기 3~10ms)에서는 RMS 가 요동할 수 있다. 새 컴포넌트는 `new Uint8Array(analyser.fftSize)`(512)를 권한다(코드 읽기 기반 추론, 실측 안 함). (b) 메터용 `AudioContext` 에 `resume()` 호출이 없다(`:170-176`, 토글톤 컨텍스트만 `resume` `:299-300`). 사용자 탭 직후가 아닌 자동 요청 시점에 만들어진 컨텍스트가 브라우저(특히 iOS Safari) 정책상 `suspended` 로 남아 레벨이 0 에 머무를 수 있는지는 **미확인**(실기기 필요).

### 2.3 카메라 미리보기·스피커 테스트음

- 카메라: `getUserMedia({video:{facingMode:'user'}})`(`:208`, 전면 이상적(ideal) 지정), 열기 경쟁 방지용 요청 id(`cameraRequestRef`, `:77, 203-211`). 영상 `<video autoPlay playsInline muted>` + `-scale-x-100 object-cover`(`:521-531`, 거울 모드), `aspect-video`. 비디오 요소가 카메라 켜짐에서만 마운트되므로 `srcObject` 를 `cameraOn` 효과에서 한 번 더 건다(`:345-347`). 전면/후면 전환은 없다(상담사 프리뷰에만 `SessionPreJoinPreview.tsx:482-490`, 비 compact).
- 스피커: C5(523.25Hz) 0.9초, 게인 지수 램프 0.0001→0.18(`:293-314`), 컨텍스트 재사용·`resume()`. 시안 `-spk` 케이스의 "재생 중" 표시는 현행에 상태가 없으므로(`playTestTone` 은 void) 1초짜리 `playing` state 가 필요하다.

### 2.4 칩 문구 버그 — 원인과 상태 모델 제안

원인 위치(체인):
1. `ClassWaitingRoom.tsx:244-248` — `openMic` 의 `catch` 가 오류 종류와 무관하게 `setMicState('denied')`. 카메라도 같다(`:222-226`).
2. `lib/class/class-waiting-room.ts:108-121` `mediaErrorMessage` 는 `NotFoundError`/`OverconstrainedError` → "사용 가능한 마이크를 찾지 못했습니다", `NotReadableError` → "다른 앱이 … 사용 중"으로 **정확히 분류**하지만 결과는 `micError` 문자열(상자 `:495-499`)에만 저장된다.
3. 칩은 `deviceStateLabel(micState,'마이크')`(`ClassWaitingRoom.tsx:461`) → `case 'denied'` → "마이크 권한이 거부되었습니다"(`class-waiting-room.ts:100-101`). 그래서 장치가 없어도(`NotFoundError`) 칩은 권한 거부로 나오고 아래 상자는 "찾지 못했습니다"로 서로 모순된다.
4. 같은 패턴이 상담사 프리뷰(`SessionPreJoinPreview.tsx:172-173` `setMicState('denied')`)와 SDD-208 진행 화면에도 있다: 회원 `MemberMediaControls.tsx:115-121`(마이크 실패는 종류와 무관하게 `'denied'`, 카메라만 `PermissionDenied` 와 그 외를 구분), 상담사 `resolveMicUi`(`host-media-control.ts:106-109`, 마이크 `notfound` 는 `denied` 로도 `nodevice` 로도 안 가고 켜짐/꺼짐으로 떨어짐; `CamUi` 에만 `nodevice` 가 있고 `MicUi` 에는 없음 `lib/class/player-case.ts:11-12`). 진행 화면은 비범위지만 같은 결함임을 기록한다.

시안이 요구하는 구분(`member-b.html` FM06d): 마이크 `ok`(칩 "정상") / `denied`(칩 "권한 필요") / `nodev`(칩 "마이크를 찾지 못했어요") / `unsup`(칩 "지원 안 됨"), 카메라 `on|off|denied|unsup`. 시안에는 **"다른 앱이 사용 중(NotReadable)" 케이스가 없다**. FH05 는 `mic-denied`("권한 필요"), `cam-denied`, `nodevice`("장치 없음"), `unsupported`("확인 불가").

제안 상태 모델(신규 `lib/class/class-media.ts`):

```ts
export type MediaDeviceUi =
  | 'pending'     // 권한 확인 중
  | 'on'
  | 'off'
  | 'denied'      // NotAllowedError, SecurityError
  | 'nodevice'    // NotFoundError, OverconstrainedError
  | 'busy'        // NotReadableError, AbortError (다른 앱·탭이 사용 중)  ← 시안에 없음, 문구 결정 필요
  | 'unsupported' // mediaDevices 없음(미지원 브라우저·비보안 컨텍스트)
  | 'error';      // 그 외
export function classifyMediaError(err: unknown): MediaDeviceUi;
export function deviceUiLabel(state: MediaDeviceUi, device: '카메라' | '마이크'): string; // 칩 문구
```

문구 대응(시안 우선): `denied` → "권한 필요", `nodevice` → "마이크를 찾지 못했어요"(카메라: "카메라를 찾지 못했어요"), `unsupported` → "지원 안 됨", `busy`/`error` → 시안 없음(제안: "다른 앱에서 쓰는 중이에요" / "확인하지 못했어요", 디자인 확인 필요).

타입 확장 시 영향 파일:

| 파일 | 영향 |
|---|---|
| `lib/class/class-waiting-room.ts` | `WaitingRoomDeviceState` 확장 또는 폐기·`MediaDeviceUi` 이동, `deviceStateLabel`, `mediaErrorMessage` 와 `classifyMediaError` 정합 |
| `components/class/ClassWaitingRoom.tsx` | 칩·`micProblem`(`:350`)·`catch` 2곳 |
| `components/session/SessionPreJoinPreview.tsx` | 자체 `DeviceState` 타입(`:11-12`)과 `mediaErrorMessage` 중복(`:40-52`) 제거 |
| `components/class/player/member/MemberMediaControls.tsx:115-121` | (선택, 진행 화면) 마이크 실패 종류 구분 |
| `components/class/player/host/host-media-control.ts:12-13,106-118` | (선택) `MediaFailureReason` 과 통합 가능 |
| 테스트 | `tests/class-waiting-room.test.ts`, `class-waiting-room-flow.test.ts`, `session-prejoin-theme.test.tsx` |

### 2.5 합친 "내 영상·소리" 컴포넌트 구현 방법

**구조**: 훅 `hooks/useMediaCheck.ts`(스트림·메터·오류 분류·재시도) + 표시 컴포넌트 `components/class/MyAvCheck.tsx`. 레벨은 React state 로 올리지 않고 ref + CSS 변수(rAF 10Hz)로 링·막대에 직접 반영해 마법사 전체 리렌더를 피한다.

**레벨 → 5단계 링 매핑(제안, 현행 식 재사용)**

```
rms   = sqrt(mean(((b-128)/128)^2))            // 현행과 동일(ClassWaitingRoom.tsx:180-185)
level = min(1, rms × 3)                         // 현행과 동일(:186). 막대 너비 = level × 100%
smooth = max(level, smooth × 0.85)  // 100ms 마다 피크 유지 + 감쇠(깜박임 방지)
steps = smooth < 0.04 ? 0 : min(5, ceil(smooth × 5))   // 링 점등 칸 수. 막대와 같은 스케일을 5등분
peak3s = 최근 3초 smooth 최댓값
chip  = (마이크 켜진 뒤 2초 미만) '확인 중'
        : peak3s > 0.2 ? '정상'   // steps ≥ 2
        : '조용해요'              // steps ≤ 1
icon 밝기 = chip==='조용해요' ? 0.55 : 1          // 시안 --io
```

근거: 막대와 링이 같은 `level` 을 쓰므로 회원이 이미 본 "초록 막대가 움직인다"와 일관된다. 시안 샘플과의 정합: 회원 시안 `camon` = 3칸(정상), `camon-quiet` = 1칸·아이콘 0.55(`member-b.html:448-450`), 상담사 시안 `ok` = 4칸, `quiet` = 1칸(`host-b.html` `ringBtn`, `lv 80→4, lv 20→1`). 일상 대화 음성의 RMS(0.03~0.15, 코드 읽기 기반 가정)를 `×3` 하면 `level` 0.09~0.45 → 1~3칸이라 "3칸 = 정상" 샘플과 맞는다. **이 임계값(0.04 / 0.2 / 0.85 감쇠 / 3초)은 실기기 측정으로 검증하지 않았으며**, verify 항목으로 실제 마이크·노트북 내장·이어폰 3종 측정이 필요하다. 시안 상담사 `ringBtn` 은 `lv ≥ 60`(=`level ≥ 0.6`)을 정상 경계로 쓰는데 그대로 쓰면 일반 음성이 `조용해요` 로 보일 가능성이 높아(위 가정 기준) 채택하지 않는다.

**카메라 켜짐 ↔ 꺼짐 전환**(시안 `member-b.html:446-461`): 카메라 켜짐 → 영상 오버레이 하단에 `마이크 토글 + 5단계 링` 과 `카메라 토글`, 칩은 영상 위 오버레이. 카메라 꺼짐/없음 → 낮은 카드에 10칸 가로 막대(`.w-level`, `round(smooth × 10)`칸) + 토글 2개. **같은 `smooth` 값을 두 표현이 공유**하고 표현만 `camState==='on'` 로 분기한다. 둘 다 구현은 SVG(링은 `pathLength=100`, 대시 `16 84`, 오프셋 `-20i-2` 5조각)로 통일 권장(상담사 시안은 `conic-gradient` 로 다름 `host-b.html:362-366`; 두 시안 구현이 달라 하나로 고정해야 함).

**영상 프리뷰(미러)**: 현행 `-scale-x-100 object-cover`(`ClassWaitingRoom.tsx:528`) 유지. 상담사 프리뷰는 `object-contain` + 전면일 때만 미러(`SessionPreJoinPreview.tsx`의 video 클래스) — 전면 카메라 기준 미러는 동일. 회원은 전면 고정, 상담사 `compact` 는 전환 버튼 없음.

**토글 버튼 44px**: 현행 회원 마이크 토글 36px(`h-9 w-9`, `ClassWaitingRoom.tsx:487`)로 미달. SDD-208 `components/class/player/shared/IconCircleButton.tsx`(44px, `aria-label` 필수, `aria-pressed`, 토큰 `--tap: 44px` `player-tokens.css:31`)를 재사용하고 링은 그 안쪽에 SVG 로 겹친다. 시안 `.w-tg { width: var(--tap) }`(`member-b.html:126`)와 동일 크기.

**접근성**: 링 버튼 `aria-label="마이크 끄기 · 입력 정상 (5단계 중 3단계)"`(시안), 레벨은 매 tick SR 에 읽히지 않게 하고 상태 전이(정상↔조용해요)만 `role="status"` 로 알린다(현행 SDD-132 패턴 `ClassWaitingRoom.tsx:474-477`).

**마이크 자동 권한 요청을 사용자 동작 후로 옮길지(survey 회원 §3 문제 ②)**: 현재 요청은 대기실 마운트 0ms(`:253-265`), 즉 설문·밴드 단계보다 먼저 권한 프롬프트가 뜨고 마이크 스트림·표시등이 대기 내내 켜져 있다(언마운트 시에만 정지 `:258-263`). 제안: **기기 단계가 활성이 되는 순간(이전 단계의 "다음" 탭 직후)에 요청**하고, 단계를 떠나면 스트림을 정지한다(진행 화면 LiveKit 이 다시 요청하며 권한은 브라우저가 기억). 메터용 컨텍스트는 같은 탭 핸들러에서 생성·`resume()` 한다. 비디오는 사용자가 카메라 토글을 누를 때만 요청(현행 유지). 실패 후 재시도는 "다시 확인하기"(시안 `micnodev`), 허용 후 재시도는 "허용했어요, 다시 확인하기"(시안 시트)가 `getUserMedia` 를 다시 호출한다(상담사 쪽 `HostLiveContainer.tsx:195-206` `recheckPermission` 와 같은 동작). Chrome 은 제스처 없이도 프롬프트를 띄우지만 Safari 계열은 오디오 컨텍스트가 제스처를 요구하므로 이 순서가 안전하다는 점은 **미확인(실기기)**.

### 2.6 오프라인에서 기기 단계 생략

- 현행 게이트: `resolveWaitingRoomGate`(`class-waiting-room.ts:82-90`)가 `deviceDone` 을 장소 무관하게 요구. 오프라인 회원도 마이크 권한 프롬프트와 기기 단계를 겪는다. 진행 화면은 오프라인에서 미디어 방이 없다(`MemberMediaControls.tsx:110` `hasRoom = place==='online' && Boolean(token)`).
- 시안: 오프라인은 기기 점검 단계 자체가 없다(온라인 5단계·오프라인 4단계, `member-b.html:552`, FM06e 기기 행은 "참여 방식 · 현장에서 함께해요" `:477`). 상담사 시안 오프라인 FH06 행의 기기 셀은 `na`(`host-b.html` `if (cfg.loc === 'off') d = 'na'`).
- 변경: `WaitingRoomGateInput` 에 `place: 'online'|'offline'` 추가 → 오프라인이면 `deviceDone` 요구 제거(`readiness.deviceDone` 은 자동 true 로 둬 presence 의 boolean 계약 `_sanitize_readiness` 를 건드리지 않음). 단계 목록은 `buildPrepSteps({place, linkbandMode})` 순수 함수(I5 와 공유). 오프라인에서는 마이크 권한 요청을 하지 않는다. 입장 확정 payload 는 `cameraOn:false, micOn:false`.
- **게이트·`checkin` payload 변화**: `checkin` REST 요청 `CheckinPayload`(`lib/api/checkin.ts:32-39`)는 `phase, arousal, valence, emotion, note, participant_id, participant_token` 뿐이라 **기기 정보가 없어 변화 없음**. 변화는 (1) 게이트 `missing` 목록에서 '기기 테스트' 제외, (2) presence `readiness.deviceDone` 이 자동 true. 상담사 `WaitingRoomReadinessPanel`(`components/class/waiting-room-readiness-panel.tsx:9-13`)은 셀 3개 고정이므로 호스트가 `session.location_type` 으로 기기 셀을 제외해야 한다(I4 와 공유).
- 상담사 오프라인: 시안 FH05 `offline` 은 "카메라와 마이크는 쓰지 않아요 · 대면 클래스라 장비 점검 없이 바로 열 수 있어요"(`host-b.html` `fh05`)인데, FH07 `offline` 은 마이크 행 대신 장소 행을 두면서도(`fh07` 의 `rowMic = off ? 장소 …`) 녹음·AI 기록지 동의 카드는 그대로 둔다(시안 가정 S4: "오프라인도 이 기기 마이크로 녹음할 수 있다"). 진행 화면 오프라인도 "녹음 마이크"를 쓴다(`HostMediaSheet.tsx:98-104`). 현행 코드는 장소와 무관하게 설정 씬에서 프리뷰를 항상 띄운다(`ClassPlayerPage.tsx:1888-1897`, `isSetup` 만 조건). **시안 내부 불일치**: 오프라인 상담사가 녹음을 한다면 마이크 권한을 사전에 확인하는 단계가 시안에 없다(§5-3).

### 2.7 SessionPreJoinPreview 공용화 · 마이크 OFF 경고 · SDD-208 재사용

**현재 구조**
- props(`SessionPreJoinPreview.tsx:20-36`): `onStart(prefs)`, `starting`, `canStart`, `startDisabledReason?`, `startLabel?`, `dark?`, `compact?`, `onPrefsChange?`. 출력은 `PreJoinMediaPrefs {cameraOn, micOn}`(`:17-21`) 하나뿐이고 권한 상태·레벨은 밖으로 안 나간다.
- 요약줄(`startSummaryLine`, `:55-61`): 카메라·마이크 4조합 문구. **이모지를 사용**한다(`:56-58`, 그리고 `:362,378,396,413`) → 확정 규칙 "이모지·문자 글리프 0"과 충돌(회원 대기실도 `🎤🔇` `ClassWaitingRoom.tsx:491`, `✓ ✧` `:430,558,595,610`).
- `compact`: 항상 세로 스택, 전환 버튼·시작 버튼·사유 문구 숨김(`:482, 498-499`).
- `onMediaDeviceFailure`: **이 컴포넌트에는 없다.** LiveKit 연결 이후의 실패는 `HostLiveKitBridge.tsx:88`(`reasonOf`: denied/notfound/other)과 `MemberMediaControls.tsx:163`이 처리한다. 프리뷰는 자체 `getUserMedia` 오류를 `mediaErrorMessage` 복제본으로 처리.

**마이크 OFF 확인 다이얼로그가 도달 불가인 근거**
1. `handleStart`(`:237-243`)가 `micOffConfirmOpen` 을 true 로 만드는 유일한 호출 지점이다.
2. `handleStart` 를 쓰는 곳은 `startButton`(`:245-256`) 하나다.
3. `startButton` 은 `{!compact && startButton}`(`:498`)로만 렌더된다.
4. 유일한 호출처가 `compact` 로 쓴다(`ClassPlayerPage.tsx:1895`).
5. 실제 오픈은 헤더 버튼 `onClick={() => void openClass(mediaPrefs)}`(`:1543`, `openClass` `:1033`)가 직접 호출한다. 프리뷰의 대체 시작 버튼(`:321, 338` — 권한 전부 거부 시 폴백)은 `confirmStart` 를 직접 호출해 다이얼로그를 건너뛴다.

**추가 결함(코드 읽기 기반)**: 프리뷰는 마운트 직후 카메라·마이크 상태가 `pending` 이라 `cameraOn=false, micOn=false` 이고, 효과(`:225-226`)가 이를 곧바로 `onPrefsChange` 로 보고한다. 부모의 초기값 `{cameraOn:true, micOn:true}`(`ClassPlayerPage.tsx:592`)가 덮여, 권한 응답 전에 헤더의 오픈 버튼을 누르면 `openClass({false,false})` → 이후 `startClass`(`:1050`)가 `!mediaPrefs.micOn` 으로 `startAudio(id, false)`(`:1062`, 수동 기록 선언)를 호출한다. 확인 없이 일어난다. 실제 재현은 하지 않았다.

**FH05 `mic-off-warn` 구현 위치**
- 시안(`host-b.html` FH05 `mic-off-warn`): 마이크가 꺼진 채 "클래스 열기"를 누른 직후 시트 "마이크가 꺼져 있어요 — 마이크 켜고 열기 / 꺼진 채로 열기(수동 기록) / 돌아가기".
- 로직 위치: (1) 순수 판정 `needsMicOffWarning({place, micOn, micState})` 를 신규 `lib/class/class-media.ts` 에 두고, (2) 오픈 버튼 핸들러를 `ClassPlayerPage.tsx:1540-1550` 의 `openClass(mediaPrefs)` 직접 호출에서 `requestOpen()`(판정 → 시트 열기 → 선택 시 `openClass`)로 교체, (3) 시트는 `components/class/player/shared/PlayerSheet.tsx`(`:20`)를 사용. `startClass`(`:1050-`)의 `startAudio(id,false)` 선언은 그대로 두고 사용자 선택이 `mediaPrefs.micOn` 에 반영된 뒤 호출되게 한다. 프리뷰 내부의 죽은 다이얼로그(`:258-290`)는 제거.

**공용 컴포넌트 props 설계안**

```ts
interface MyAvCheckProps {
  audience: 'member' | 'host';
  micRequirement: 'required' | 'optional';          // 시안 '필수' 태그. 회원 필수, 상담사는 FH05 표기 확인 필요
  value?: { micOn: boolean; cameraOn: boolean };    // 이전 선택 복원(마법사 왕복·세팅 재진입)
  autoRequest: 'on-mount' | 'manual';               // 회원: 단계 진입 시 on-mount
  speakerTest?: boolean;                            // 회원·상담사 모두 true(시안 둘 다 있음)
  onChange: (r: MediaCheckResult) => void;          // 권한 확인이 끝난 값만 보고(pending 중 false/false 보고 금지)
  onOpenPermissionHelp: (kind: 'camera' | 'microphone') => void;
  hint?: ReactNode;                                  // 상담사: AI 기록 안내줄·요약
}
interface MediaCheckResult {
  prefs: { micOn: boolean; cameraOn: boolean };      // 기존 PreJoinMediaPrefs 와 호환
  micState: MediaDeviceUi; camState: MediaDeviceUi;  // §2.4
  micQuality: 'checking' | 'normal' | 'quiet' | null;
  settled: boolean;                                   // pending 이 끝났는가(부모의 버튼 활성 판단용)
}
```

입력(`value`, `autoRequest`) / 출력(`onChange` → `MediaCheckResult`) / 권한 상태(`micState`/`camState`) / 레벨(`micQuality`, 내부 `steps` 는 표시 전용)로 나뉜다. `SessionPreJoinPreview` 는 이 위의 얇은 래퍼(기존 `onStart`/`startLabel`/`compact` 유지)로 남기거나, 호출처가 하나뿐이므로(`ClassPlayerPage.tsx:1889`) 래퍼 없이 대체해도 된다(테스트 `tests/session-prejoin-theme.test.tsx` 는 함께 수정).

**SDD-208 진행 화면에서 재사용 가능한 부분**
| 부분 | 재사용 | 근거 |
|---|---|---|
| `IconCircleButton`(44px 원형, 라벨 필수) | 가능 | `components/class/player/shared/IconCircleButton.tsx` |
| `PlayerSheet`/`PlayerShell` | 가능(허용 방법·마이크 OFF 경고 시트) | `player/shared/PlayerSheet.tsx:20` |
| `HostPermissionSheet`(3단계 문구 + 다시 확인) | 문구·구조 재사용, 플랫폼 분기 추가 필요 | `HostMediaSheet.tsx:171-183` |
| `MIC_STEPS`/`deriveSlot` 허용 방법 카드 | 문구 출처 통일 | `lib/class/member-player-case.ts:172-177` |
| `recheckPermission`(권한 재확인) | 로직 재사용(훅으로 추출) | `HostLiveContainer.tsx:195-206` |
| `MediaFailureReason`/`reasonOf` | 상태 모델과 통합 가능 | `host-media-control.ts:12-13`, `HostLiveKitBridge.tsx:24-28` |
| `MemberMediaControls`·`HostMediaSheet` 행 UI | **불가** | LiveKit 연결·스위치 행에 묶여 있음 |
| 하니스 패턴 `?case=` | 가능 | `lib/class/player-harness.ts`, `lib/class/fixtures/*.ts` |

### 2.8 허용 방법 시트의 브라우저·OS 분기

- 코드에 UA 분기 유틸이 **없다**. 유일한 구분은 Capacitor `getPlatform()`(`lib/native/platform.ts:4-8`, `'web'|'ios'|'android'`). SDD-208 허용 방법 카드는 데스크톱 문구 하나뿐: 회원 `MIC_STEPS`("주소창의 자물쇠 아이콘을 눌러요 / 마이크를 허용으로 바꿔요 / 페이지를 새로 고쳐요", `member-player-case.ts:172`), 상담사 `HostPermissionSheet`(`HostMediaSheet.tsx:171-183`).
- 시안 FM06d 시트(`member-b.html` 시트 정의)도 OS 분기 없이 3단계 + "스마트폰에서는 설정 앱의 브라우저 항목에서도 바꿀 수 있어요" 한 줄이다. FH05 는 힌트 한 줄("주소창 왼쪽 설정에서 …")뿐.
- 제안: `lib/class/permission-help.ts`(신규)에 `permissionHelpVariant(): 'desktop' | 'mobile-web' | 'app-ios' | 'app-android'` — `getPlatform()` 으로 앱 구분, 웹은 `navigator.userAgent`(`/Android/`, `/iPhone|iPad|iPod/`, iPadOS 는 `Macintosh` + `maxTouchPoints > 1`)로 모바일 구분. 문구: desktop/mobile-web 은 시안 3단계(+모바일은 설정 앱 안내 한 줄), 앱은 "설정 앱 > MIND BREEZE > 마이크/카메라". 시안 범위(한 줄 추가)면 `desktop|mobile-web` 두 갈래만으로 충분하고 앱 분기는 §5-2 결정에 달렸다.
- **앱(Capacitor) 권한 선언 점검**: iOS `ios/App/App/Info.plist` 에는 `NSBluetoothAlwaysUsageDescription`(`:59`)만 있고 `NSMicrophoneUsageDescription`/`NSCameraUsageDescription` 이 **없다**(`grep UsageDescription` 결과 1건). Android `AndroidManifest.xml` 의 `RECORD_AUDIO`/`CAMERA`/`MODIFY_AUDIO_SETTINGS`(`:55-56` 부근)는 **현재 작업 트리의 미커밋 변경**이다(`git status`: `frontend/android/app/src/main/AndroidManifest.xml` M). 앱에서 기기 점검이 동작하는지는 **미확인**(실기기).

### 2.9 백엔드 영향

- 기기 점검 결과를 서버에 저장·전송하는 경로는 없다(`CheckinPayload` 에 없음, presence `readiness` boolean 만). 시안(FH06 셀: 설문·밴드·기기)도 상담사가 마이크·카메라 상세 상태를 받는 것을 요구하지 않는다.
- 오프라인 기기 셀 생략·마이크 상태 표시는 프론트에서 `session.location_type`/로컬 상태로 판단 가능.
- 보류 1건: 회원의 마이크·카메라 가용성(권한·장치 없음)을 상담사에게 보내는 것은 시안에 없다(예: FH07 "마이크 꺼짐 회원 n명"이 필요하면 presence 에 선택 필드 추가, I5 안 A 와 같은 방식). 현재 시안 범위에서는 불필요.

## 3. 변경 목록

### 프론트

| 파일 | 변경 | 규모 |
|---|---|---|
| `lib/class/class-media.ts`(신규) | `MediaDeviceUi`, `classifyMediaError`, `deviceUiLabel`, 레벨 계산(`levelFromRms`, `ringSteps`, `classifyMicQuality`), `needsMicOffWarning` 순수함수 | M |
| `hooks/useMediaCheck.ts`(신규) | 마이크·카메라 스트림, 메터(`fftSize` 길이 버퍼·ref/CSS 변수 갱신, `resume()`), 오류 분류, 재확인, 스피커 테스트 | M |
| `components/class/MyAvCheck.tsx` + 플로우 CSS(신규) | 합친 컴포넌트: 카메라 켜짐(영상+링+칩 오버레이)/꺼짐(10칸 막대)/차단·없음·미지원 슬롯, 토글 44px, 스피커 카드 | L |
| `components/class/ClassWaitingRoom.tsx`(마법사 전환은 타 조사와 공유) | 인라인 `getUserMedia`·메터·톤 코드(`:97-347` 일대) 제거, 기기 단계에서 `MyAvCheck` 사용, 마이크 요청을 단계 진입 시점으로 이동, 이모지·글리프 제거 | L |
| `lib/class/class-waiting-room.ts` | 장치 상태 타입·`deviceStateLabel` 정리(`class-media.ts` 로 이동), 게이트에 `place` 추가, 단계 목록 함수 | S~M |
| `components/session/SessionPreJoinPreview.tsx` | 새 훅/컴포넌트 기반으로 교체, 마운트 시 `false/false` 보고 제거(`settled` 후 보고), 죽은 확인 다이얼로그·이모지 제거 | M~L |
| `pages/sessions/ClassPlayerPage.tsx:1033, 1540-1550, 1888-1897` | 오픈 버튼을 `requestOpen()` 으로, 마이크 OFF 경고 시트 추가, 오프라인 상담사 프리뷰 정책 반영 | S~M |
| `components/class/PermissionHelpSheet.tsx` + `lib/class/permission-help.ts`(신규) | 플랫폼 변형 문구, 회원·상담사 시트 공용(`HostPermissionSheet` 흡수) | S~M |
| `pages/class-join-page.tsx:215-227` → `MemberSessionScene` → `MemberClassContainer` → `MemberMediaControls.tsx:96-97` | 대기실에서 고른 `micOn/cameraOn` 을 진행 화면 초기 `micWanted/camWanted` 로 승계(§5-1) | S~M |
| `ios/App/App/Info.plist`, `android/.../AndroidManifest.xml` | 마이크·카메라 사용 설명 키 추가 / 권한 선언 커밋(앱 사용 시) | S |
| 테스트 | `tests/class-waiting-room.test.ts`, `class-waiting-room-flow.test.ts`, `session-prejoin-theme.test.tsx` 수정, 신규 `class-media` 단위(분류·단계·판정), 훅 테스트(jsdom 에는 `AudioContext` 없음 → 모킹), 하니스 fixtures(FM06d 케이스, FH05 케이스) | M |
| `components/class/waiting-room-readiness-panel.tsx` | 오프라인에서 기기 셀 제외(I4/I5 와 공유) | S |

### 백엔드

| 엔드포인트/모델/마이그레이션 | 변경 | 분류 | 기존 데이터 호환 | 필요 테스트 |
|---|---|---|---|---|
| (없음) | 이 조사 범위의 모든 항목이 프론트에서 완결 | 필수 0 | — | — |
| presence `waiting_room` 선택 키(회원 기기 상태) | 상담사에게 회원 마이크·카메라 가용성을 보여야 할 때만 | 보류 1 | 키 없음 = null(I5 안 A 와 같은 방식) | `tests/test_class_waiting_room_presence.py` 확장 |

필수/권장/보류 개수: 필수 0, 권장 0, 보류 1.

프론트만으로 가능한 대체안: 해당 없음(전부 프론트). 단 §2.6 오프라인 상담사 마이크 권한 확인 시점이 정해지지 않으면 FH05 offline 은 "장비 점검 없음"으로만 구현하고 녹음 시작 시점의 권한 실패에 의존한다.

## 4. 위험·주의

- **결함 이관 주의**: 새 컴포넌트가 `getUserMedia` 오류를 분류하더라도 SDD-208 진행 화면(`MemberMediaControls.tsx:115-121`, `host-media-control.ts:106-109`)은 계속 마이크 `notfound` 를 `denied`/켜짐으로 처리한다. 사전 흐름과 진행 화면의 문구가 어긋날 수 있다(진행 화면은 비범위).
- **프리뷰 `false/false` 보고**: 위 §2.7 추가 결함. 공용화 시 `settled` 이전 보고 금지가 필수 회귀 방지 항목이다.
- **레벨 임계값 미검증**: 칩 `정상`/`조용해요` 가 실제 마이크에서 의도대로 나오는지 측정이 없다. 노트북 내장 마이크(자동 이득), 이어폰 마이크, 모바일에서 값이 크게 다를 수 있다.
- **오디오 컨텍스트 정책**: 자동 요청 위치를 옮겨도 iOS Safari 에서 `suspended` 가 되면 레벨 0 → `조용해요` 오표시 가능(미확인). `ctx.state` 가 `suspended` 면 칩을 `확인 중` 으로 유지하고 탭으로 `resume()`.
- **리렌더**: 레벨을 React state 로 두면 마법사 루트가 10Hz 로 리렌더(현행 문제 `ClassWaitingRoom.tsx:121`).
- **스트림 정리**: 기기 단계를 벗어나면 트랙을 `stop()` 해야 브라우저 녹화 표시등이 꺼지고 진행 화면 LiveKit 의 재요청과 충돌하지 않는다(현행은 언마운트에서만 정지 `:258-263`). 카메라 요청 경쟁 방지 id 패턴(`:203-211`)을 훅으로 옮길 때 유지할 것(상담사 프리뷰에는 이 가드가 없다).
- **이모지 규칙**: `SessionPreJoinPreview`·`ClassWaitingRoom` 의 이모지/글리프(위 목록)를 같이 제거하지 않으면 균형 규칙 검사에 걸린다.
- **앱 권한**: iOS Info.plist 에 마이크·카메라 설명이 없으면 앱에서 `getUserMedia` 가 거부·종료될 수 있다(미확인). Android 선언은 미커밋 변경.
- **카메라 송출 승계**: 대기실에서 켠 카메라를 입장 후에도 송출하면 SDD-208 합의("회원 영상은 기본 비공개, 회원이 켠 경우에만" `MemberMediaControls.tsx:3`)와의 해석 충돌 가능(§5-1).
- **기존 테스트**: 게스트 `feature` 흐름 등 일부 백엔드 테스트는 I1(게스트 제거)에서 영향받으나 이 조사와는 무관.

## 5. 사용자 결정 필요

1. **대기실에서 켠 카메라·마이크 선택을 입장 후에도 이어갈지** (프라이버시 정책)
   - 옵션 A: 이어간다 — 대기실에서 카메라를 켰으면 입장 직후부터 상담사(·그룹)에게 송출. 시안 FM06d 문구("카메라를 켜면 상담사에게 내 모습이 보여요")와 일치.
   - 옵션 B: 이어가지 않는다 — 입장 후 카메라는 항상 꺼짐에서 시작하고 직접 켠다(SDD-208 합의 "기본 비공개"와 일치). 대기실 문구를 "입장한 뒤 켤 수 있어요"로 바꿔야 한다.
   - 기본값 제안: **A**(사용자가 명시적으로 켠 선택이며 시안 의도). 영향: 마이크는 그룹 기본 뮤트 정책(`MemberMediaControls`)이 우선이므로 카메라만 해당. B 는 시안 문구 수정 필요.
2. **앱(iOS/Android) 사용자용 허용 방법 문구 분기 범위** (제품 범위)
   - 옵션 A: 웹 두 갈래(데스크톱 / 모바일 웹)만. 옵션 B: 앱 전용 문구까지 4갈래.
   - 기본값 제안: **A**, 앱 권한 선언 점검 후 필요 시 B. 영향: B 는 Info.plist·Manifest 확인과 실기기 검증이 선행.
3. **오프라인 상담사의 마이크 권한을 어디서 확인할지** (시안 내부 불일치)
   - FH05 오프라인은 "장비 점검 없음"이나 FH07 은 오프라인에도 녹음 동의 카드를 두고(S4) 진행 화면은 오프라인 "녹음 마이크"를 쓴다(`HostMediaSheet.tsx:98-104`). 마이크 권한을 사전에 확인하는 곳이 시안에 없다.
   - 옵션 A: FH05 오프라인에도 마이크만 점검(카메라 제외). 옵션 B: 시안대로 점검 없음(녹음 시작 시점의 권한 요청·실패 안내에 의존).
   - 기본값 제안: **B**(시안 FH05 그대로). 단 권한 거부 시 수동 기록으로 이어지는 안내 문구는 필요. 영향: A 는 FH05 시안 수정.
4. **"다른 앱이 마이크를 쓰는 중"(NotReadable) 칩 문구** (디자인 확인) — 시안에 없음. 기본값 제안: 칩 "다른 앱에서 쓰는 중이에요" + 재확인 버튼. 영향: 시안 갱신 필요 여부.

## 6. 확인하지 못한 것

1. 마이크 레벨 임계값(0.04 / 0.2 / 감쇠 0.85 / 3초)의 실제 마이크별 분포 — 측정 환경 없음.
2. iOS Safari·Android Chrome 에서 자동 요청으로 만든 메터 `AudioContext` 가 `suspended` 로 남는지.
3. Capacitor 앱(iOS/Android)에서 `getUserMedia` 권한 동작, iOS Info.plist 키 누락의 실제 영향.
4. `SessionPreJoinPreview` 의 `false/false` 보고로 인한 수동 기록 선언 시나리오의 실제 재현(코드 읽기 기반).
5. `Analyser` 256샘플 버퍼가 실제 레벨 변동에 주는 영향(추론, 비교 측정 없음).
6. `navigator.permissions.query({name:'microphone'})` 로 프롬프트 없이 상태를 읽는 방식의 브라우저 지원(Safari 지원 여부 미확인) — 도입하지 않아도 설계는 성립.
7. 상담사 FH05 의 `마이크 필수` 태그 여부(시안 FH05 에 필수/선택 태그가 있는지 세부 미확인).
