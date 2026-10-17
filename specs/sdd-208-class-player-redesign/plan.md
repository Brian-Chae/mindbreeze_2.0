# SDD-208 Plan — 클래스 진행 화면 리디자인 (회원·상담사)

> Stage ② Plan. 근거: 코드 조사(2026-10-16, 기준 커밋 `c9d5daa1`, develop) + `spec.md` 확정 결정 4건 + `designs/class-player-redesign/`(기획.md·케이스.md·균형.md·tokens.css·member.html·counselor.html·tools/).
> 표기: **있음**(기능·데이터 존재, 표현만 교체) / **일부**(기능 보강 필요, 프론트) / **없음**(신규, 프론트) / **백엔드**(서버 변경 필요). 확인하지 못한 사항은 "확인 필요"로 표시.

---

## 0. 조사로 확정한 사실 (spec·미션 가정과 다른 점 포함)

| # | 사실 | 근거 |
|---|---|---|
| F1 | **회원의 실제 진행 화면 경로 = `/join` → `ClassJoinPage`(step `meditation`) → `MemberSessionScene` → `GuestMeditationPanel`**. `ClassPlayerPage`는 회원 경로가 아니다. | `App.tsx:152`(`/join`), `class-join-page.tsx:458-476`, `MemberSessionScene.tsx:46`. 회원 진입 링크는 전부 `/join?code=`(`ClientSessionDetailPage.tsx:148`, `ai-agent-page.tsx:182`) |
| F2 | **`ClassPlayerPage`(`/sessions/:id/player`)는 상담사 전용 화면**이다. 호스트 분기 = `HostClassWorkspace`(329~504행) + 헤더·미디어 패널. 비호스트 분기(`monitorPanel`, `SessionParticipantDetailPanel`: 1889·1892·2125행)는 회원 진입 링크가 없는 경로다. 이 경로에 `RoleGuard`가 없어(`App.tsx:192`) 호스트가 아닌 로그인 사용자가 URL로 직접 열 때만 도달한다(기관관리자 목록 진입 여부는 확인 필요). | `SessionListTable.tsx:113`, `DashboardPage.tsx:274` |
| F3 | **적용 대상 경로**: 회원 = `GuestMeditationPanel`(진행 중 `in_progress`만) 교체. 상담사 = `ClassPlayerPage`의 `isRunning && isHost` 구간 교체. 대기실(`ClassWaitingRoom`, `MemberWaitingScene`)·세팅/오픈 씬(`isSetup`·`isLobby`)은 spec 범위 밖이라 유지. | spec "범위 메모" |
| F4 | 따라서 `HostClassWorkspace`와 `host-class-player.css`는 **세팅·대기 씬이 계속 사용**한다 → 삭제 불가. 진행 중 전용 분기만 교체. | `ClassPlayerPage.tsx:1805`(`isSetup\|\|isLobby\|\|isRunning` 모두 사용) |
| F5 | 회원 화면의 **그룹 평균·"그룹 N" 태그·그룹 평균 대비 배지**가 현재 존재(SDD-124/125: `GuestMeditationPanel.tsx:187,333,571,609`, `MemberMetricDial`, `MemberClassInfoCard`). spec 합의 #5(회원 평균 금지)와 **충돌** → 제거 대상. `class:group_average` 구독 자체를 회원 화면에서 끊는다. | `member-class-player.browser.cjs`가 이 기능을 검증 중 → 테스트도 반전 |
| F6 | 회원 화면에 **"편안하게 호흡에 집중해 주세요"**(강당형 오프라인 문구) 존재 → 호흡 지시 문구 제거 대상. | `GuestMeditationPanel.tsx:676` |
| F7 | **마이크/카메라 토글이 회원·상담사 모두 진행 중에는 없다.** 회원은 `LiveKitRoom video={canPublish} audio={canPublish}`로 **권한이 있으면 카메라·마이크가 자동 발행**된다. 상담사는 입장 전 선택(`mediaPrefs`)만 있고, LiveKit은 `VideoConference`(`video/audio=true`)가 **설정과 무관하게 발행**한다. | `CounselorLiveTile.tsx:148-155`, `VideoConference.tsx:23-24`, `ClassPlayerPage.tsx:596,1948` |
| F8 | **AI 기록(녹음)은 상담사 브라우저 마이크만 캡처**한다(`useAudioRecorder`: `getUserMedia({audio:true})` → 5초 청크 업로드). 회원 음성(LiveKit)은 서버 녹화(egress) 없이 기록되지 않는다(백엔드에 egress 코드 없음 확인). 참가자별 "기록 제외" 장치도 없다(`consent_audio`는 상담사 녹음 시작 선언용, 참가자별 설정 API 없음). | `useAudioRecorder.ts:49`, `audio_service.py:69-90` |
| F9 | 손들기 **취소 API 없음**, 회원이 스스로 **발언 종료하는 API 없음**(상담사만 `set_speaking`). 대기열 **입장 승인 API 없음**(자리 나면 자동 승격 `_promote_waitlist`). | `session_service.py:1818,1861,1247`; `lib/api/session.ts:438-460` |
| F10 | 대기열(`is_waitlisted`) 회원은 `/join`에서 **대기 화면 없이** 진행 화면으로 들어가 LiveKit 토큰 403("대기 중인 참여자입니다")으로 "상담사 영상을 불러오지 못했습니다"만 본다. | `session_service.py:1729`, `CounselorLiveTile.tsx:118-124` |
| F11 | **진행 중 BGM 무재생 정책**(`fd93da24`)이 있어 상담사 `useClassAudioPlayer`는 `isLobby`에서만 활성(`ClassPlayerPage.tsx:987-992`), 회원 진행 화면에 BGM 패널 없음(브라우저 테스트가 `.player-bgm` 0개를 검증). 시안의 "소리·BGM"·"미디어(BGM)" 항목과 충돌. | `member-class-player.browser.cjs:133` |
| F12 | 참가자 수 > 정원이면 `join`이 `is_waitlisted=True`로 등록. `join` 응답의 `session.participants[]`에는 `participant_id`·`is_waitlisted`가 **실려 오지만**(`schemas/session.py ParticipantInfo`) 프론트 타입 `SessionParticipant`에는 `participant_id`가 없다. | `lib/api/session.ts:20-42` |
| F13 | 상담사 그리드는 데스크톱에서 **페이지 버튼(‹ n/m ›)** 으로 분할(`ClassPlayerPage.tsx:349-363,500`)하고 단위 테스트가 이를 검증(`host-class-workspace.test.tsx:197`). spec 합의 #3(페이지 버튼 없음)과 충돌 → 이 동작은 새 뷰에서 제거. | — |
| F14 | 종료 확정(`finishSession`) 후 **즉시 `/sessions/:id/record`로 이동**(`1205행`). "종료 후 리포트 생성 중" 화면(`isEnded` 씬 + `ReportProgressStepper`)은 completed 세션을 직접 열 때만 보인다. | `ClassPlayerPage.tsx:1187-1213,2077` |
| F15 | dev 배포 빌드는 `npm run build`(production 모드, `.env`에 mock EEG 미설정)라서 **배포된 dev에서는 밴드 8상태·권한 거부·네트워크 끊김을 재현할 수 없다**(Web Bluetooth 없음). | `deploy-dev.yml` Build 단계, `useBand.ts:331 envMockEeg()` |
| F16 | `ci-feature.yml`은 `tsc --noEmit` + `eslint src/`(차단) + `npm run build` 차단. `npm test`는 `continue-on-error`(비차단). `e2e-smoke.yml`이 배포 직후 `full-journey.mjs`를 실행하며 **회원 진행 화면 문구 `지금 나를 알려요`를 단언**한다(`full-journey.mjs:199`). | — |

---

## 1. 아키텍처

### 1.1 설계 원칙
1. **표현(뷰)과 연결(컨테이너) 분리.** 뷰는 props만 받는 순수 컴포넌트, 컨테이너는 훅(`useBand`·소켓·LiveKit·녹음)을 조립해 뷰 모델을 만든다. 뷰를 픽스처로 직접 렌더할 수 있어 **39개 케이스를 서버·BLE 없이 결정적으로 검증**한다(F15 해소).
2. **케이스 = 입력 상태에서 파생되는 값.** 케이스를 저장하지 않고 순수함수로 계산한다(`lib/class/player-case.ts` 계열). 시안(`member.html`의 `state`, `counselor.html`의 `scn`)과 **같은 키 이름**을 써서 시안 ↔ 구현 대조가 1:1이 되게 한다.
3. **추가 후 교체.** 새 컴포넌트는 새 경로에 추가만 하고(기존 파일 무수정), 마지막 통합 Task에서 호출부만 교체한다. 롤백 = 통합 커밋 1개 되돌리기. 기존 `GuestMeditationPanel`·`member-class-player.css`는 교체 검증 후 삭제한다(§7 I3).
4. **다른 사람의 미커밋 변경과 충돌하지 않게** 기존 파일 수정은 호출부 교체 구간으로 한정한다(§8.3).

### 1.2 파일 구조 (신규)
파일명 규칙: 저장소 현행(컴포넌트 `PascalCase.tsx`, lib·훅 `kebab-case.ts`/`useXxx.ts`)을 따른다.

```text
frontend/src/
├─ lib/class/
│  ├─ player-case.ts                 # [T1] 공용 타입 + 파생(밴드·네트워크·미디어 UI 상태)
│  ├─ member-player-case.ts          # [M1] 회원 케이스 파생 deriveMemberCase()
│  ├─ host-player-case.ts            # [H1] 상담사 케이스 파생 deriveHostCase()
│  └─ fixtures/
│     ├─ member-cases.ts             # [M1] M01~M21 입력 픽스처 (하니스·단위테스트 공용)
│     └─ host-cases.ts               # [H1] C01~C18 입력 픽스처
├─ components/class/player/
│  ├─ shared/                        # [T2] 소유: T2 담당자만 수정
│  │  ├─ player-tokens.css           #   designs/…/tokens.css 이식(--mb-*, --tx-*, --sheet-*, 타이포 스케일)
│  │  ├─ PlayerBackdrop.tsx          #   FadingImageBackground 재사용 + 스크림
│  │  ├─ PlayerSheet.tsx             #   바텀/사이드 시트(균형.md S5: 가로형(폭≥1000 & 가로)만 사이드)
│  │  ├─ PlayerDock.tsx              #   균등 분배 도크(S6)
│  │  ├─ StatusRing.tsx              #   정적 게이지 링(호흡 애니메이션 없음)
│  │  ├─ NoticeBanner.tsx            #   톤(info/caution/coral/live) 배너·칩
│  │  └─ IconCircleButton.tsx        #   44px 원형 아이콘 버튼
│  ├─ member/                        # 소유: 회원 트랙
│  │  ├─ MemberClassView.tsx         #   props 전용 뷰
│  │  ├─ MemberClassContainer.tsx    #   훅 조립(= GuestMeditationPanel 대체)
│  │  ├─ MemberMediaControls.tsx     #   마이크·카메라·손들기(LiveKitRoom 내부)
│  │  ├─ sheets/…                    #   내 상태·채팅·조용한 신호·소리·기기 시트
│  │  └─ member-player.css
│  └─ host/                          # 소유: 상담사 트랙
│     ├─ HostLiveView.tsx            #   props 전용 뷰(진행 중 전용)
│     ├─ HostLiveContainer.tsx       #   ClassPlayerPage 진행 중 구간 대체
│     ├─ HostLiveKitBridge.tsx       #   헤드리스 LiveKitRoom(회원 영상 구독·내 마이크/카메라 제어)
│     ├─ sheets/…                    #   지표 기준·채팅·미디어·체크인·도구·손든 회원·필요 조치·대기·내 밴드
│     └─ host-player.css
├─ pages/design/ClassPlayerCasesPage.tsx   # [T3] 케이스 하니스 /design/class-player
└─ (수정) App.tsx                    # [T3] 하니스 라우트 1줄만
frontend/e2e/class-player/           # [T3] 측정 스크립트 포팅 + 케이스 러너
frontend/tests/class-player-*.test.ts(x)
```

- 하니스는 `import.meta.glob('../../lib/class/fixtures/*.ts')`로 픽스처를 자동 수집한다 → 두 트랙이 하니스 파일을 같이 수정하지 않는다.
- 하니스 경로 `/design/class-player`는 기존 `/design/*` 라우트 관례(`App.tsx:196-201`, 인증 없음)를 따른다. 픽스처만 렌더하고 서버 호출이 없다.

### 1.3 상태 모델 — 케이스 파생 순수함수

**공용(`player-case.ts`, T1)**
```ts
type BandUi = 'on' | 'off' | 'pending' | 'weak' | 'leadoff' | 'lost' | 'low' | 'unsupported';
type NetUi = 'ok' | 'reconnecting' | 'down';
type MicUi = 'on' | 'off' | 'denied' | 'muted' | 'none';      // muted = 그룹 기본 뮤트, none = 오프라인
type CamUi = 'on' | 'off' | 'denied' | 'nodevice' | 'none';

interface BandInput {                // useBand 출력에서 그대로 옮긴 값
  connectionState: 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'error';
  everConnected: boolean;            // 컨테이너가 보유(끊김 vs 미착용 구분용)
  deviceStatus: 'lead_off' | /* 그 외 DeviceStatus */ string | null;
  signalQualityLevel: 'ok' | 'degraded' | 'invalid' | 'unknown';
  battery: number | null;
  lastEegAt: string | null;
}
function deriveBandUi(i: BandInput, nowMs: number): BandUi;   // 우선순위: unsupported > pending > leadoff > lost > weak > low > on > off
function deriveNetUi(i: { socketConnected: boolean; browserOnline: boolean; downForMs: number }): NetUi;
```
- 밴드 판정은 **기존 함수를 재사용**한다: `resolveBandLinkState`(연결+최근 EEG → connected/stale/disconnected), `isLowBattery`(`LOW_BATTERY_PCT = 25`), `signalQualityLevel`, `deviceStatus === 'lead_off'`(`signal-status.ts`). 새 임계값을 만들지 않는다.
- `lost` = `everConnected && (disconnected | error | stale)`. `off` = `!everConnected && disconnected`. 시안 문구 "배터리가 15%예요"는 예시이며 실제 임계는 기존 25% 이하(포함)(변경 여부는 §5 결정 D8).
- `deriveNetUi`의 `reconnecting → down` 전환 시간(`downForMs` 임계값)은 **코드에 근거가 없어 확인 필요**(§5 D9). 기본값은 상수로 분리하고 테스트에 값을 주입한다.

**회원(`member-player-case.ts`, M1)**: 시안 `state` 키와 동일
```ts
interface MemberCase {
  view: 'live' | 'waitlist' | 'end';
  place: 'online' | 'offline'; mode: '1on1' | 'group';
  showHostPip: boolean;       // 온라인 && 상담사 카메라 발행 중 (오프라인 처리는 D2)
  showMyPip: boolean;         // 온라인 1:1 && 내 카메라 발행 중 또는 off/denied 표시 자리
  showMediaRow: boolean;      // 온라인에서만 true (M05·M06은 false)
  mic: MicUi; cam: CamUi; hand: 'idle' | 'waiting' | 'speaking';
  band: BandUi; net: NetUi;
  notice: { tone: 'info'|'caution'|'coral'|'live'; icon: string; text: string } | null;
}
```
**상담사(`host-player-case.ts`, H1)**: 시안 `scn`/`state` 키와 동일
```ts
interface HostCase {
  loc: 'online' | 'offline'; solo: boolean;
  cam: CamUi; mic: MicUi; rec: 'rec' | 'paused' | null;
  net: NetUi; phase: 'live' | 'confirm' | 'ending';
  headSlot: 'selfview' | 'summary';     // 오프라인이면 summary(셀프뷰 제거, CS3)
  chips: Chip[]; banner: Banner | null; // 손든 회원·발언 중·필요 조치·대기·내 밴드·녹음
  allOff: boolean;                      // 전원 미착용(C13)
}
```
케이스 문구(시안 원문)는 파생 함수 안에서만 만든다 → verify.md 문구 단언의 단일 출처.

### 1.4 데이터 원천 (훅·필드 매핑, 회원)
| 뷰 입력 | 원천 | 비고 |
|---|---|---|
| 밴드 상태 | `useBand`: `connectionState`·`deviceStatus`·`signalQualityLevel`·`battery`·`lastEegAt`·`isSupported`·`error`·`pendingCount` | 훅 인스턴스는 화면당 1개(`useBand.ts:77` 주석) → 컨테이너에서만 호출 |
| 6지표 | `band.scoredIndices`·`heartRate`·`respiratoryRate`·`sdnn` + 서버값 `remoteEfficiency`(소켓 `onEegFeature`) | 현행 `readSnapshot` 로직 이식 |
| 5분 추이 | 1Hz 링버퍼 `MAX_POINTS=300` | 현행 `seriesRef` 이식 |
| 상담사 영상 | `useMemberLiveKit`(token·canPublish·notReady·attemptCount) + `useTracks(Camera)` 원격 | `onHostCameraChange` 대체 |
| 손들기·발언권 | `useMemberLiveKit`: `raisedHand`·`speaking`·`raiseHand()` | |
| 내 마이크/카메라 | LiveKit `useLocalParticipant`(`isMicrophoneEnabled`·`isCameraEnabled`) + `onMediaDeviceFailure`(`LiveKitRoom` prop, `@livekit/components-react 2.9.21`에 존재 확인) | 신규 |
| 네트워크 | `useSessionLiveSocket().isConnected` + `navigator.onLine` + LiveKit `useConnectionState()` | 신규 파생 |
| 채팅 | `getSession`(로그인)·`getSessionByCodeState`(게스트) 폴링 5초 → `chat_enabled` | 현행 이식, 게스트는 `GuestChatNotice` |
| 대기열 | `joinSessionByCode` 응답 `session.participants[].is_waitlisted` (participant_id 매칭) | 타입에 `participant_id` 추가(프론트) |
| 종료 | `class-join-page` step `complete` → 종료 화면 | M21 |

### 1.5 기존 자산 재사용 매핑
| 기존 자산 | 처리 | 이유 |
|---|---|---|
| `FadingImageBackground` | **재사용**(그대로) | `/images/background1~10.webp` 교차 페이드, 시안의 자연 배경과 동일 소스 |
| `useBand`·`useSessionLiveSocket`·`useMemberLiveKit`·`useWakeLock`·`useClassAudioPlayer`·`useGuestAudioSync` | **재사용**(무수정) | 데이터 계약 유지(spec 비범위) |
| `QuietSignalButtons`·`lib/class/quiet-signal` | **재사용**(스타일만 신규 클래스) | 로직·테스트(`quiet-signal-ui.test.ts`) 유지 |
| `LeadOffModal` | **교체**(풀스크린 검정 모달 → 코랄 시트 + `SensorTracker` 재사용) | M10 시안은 "접촉 확인 안내 시트" |
| `ClassChatPanel`·`ChatRoom` | **재사용 + `embedded` 변형 추가**(T2) | 현행은 우측 고정 오버레이. 시트 안에 넣는 변형 필요. 안읽음 배지는 도크에 표시 |
| `GuestChatNotice` | 재사용 | 게스트 채팅 불가 안내 |
| `MemberMetricDial`·`MemberTrendGraph`·`MemberClassInfoCard`·`MemberProfileCard`·`MemberDeviceStrip`·`MemberRawData` | **신규 뷰에서 미사용**(교체 후 삭제). `MemberRawData`(EEG/PPG 파형)는 "기기" 시트에 재사용 가능 여부를 M3에서 판단(11px 이하 글자 위반 시 래핑) | 그룹 평균·10px 글자 포함(F5) |
| `CounselorLiveTile` | **분해**: 영상 구독 부분은 `MemberMediaControls`/PiP로 이전, 손들기 UI는 도크로 이동 | 현행은 타일 하단 오버레이 |
| `SessionHostVideoView`(셀프뷰) | **재사용** | 녹화 스트림 표시 |
| `SpeakingRightsPanel`·`SessionMonitorSummary`·`CheckinSummary`·`WaitingRoomReadinessPanel` | **재사용**(시트 안에 배치, 스타일 래핑) | 발언권 부여/회수·필요 조치 집계·체크인 요약 로직 보존 |
| `EndSessionModal`·`LeaveGuardModal`·`ReportProgressStepper`·`useReportProgress` | **재사용** | 종료 확인·리포트 진행 |
| `RecordingControls`·`MarkerButton`·`ConsentModal` | **재사용**(미디어 시트에 배치) | **시안 케이스표에 없는 기능**이므로 소실 위험 → 회귀 목록(verify §6)에 포함 |
| `HostClassWorkspace`·`host-class-player.css` | **유지**(세팅·대기 씬용). 진행 중 분기는 교체 후 미사용 | F4 |
| `GuestMeditationPanel`·`member-class-player.css`·`MemberSessionScene` | 교체 후 삭제(Scene은 호출부만 변경) | |
| `GuestCompletePanel` | **M21에서 래핑·재스타일**(이메일 신청·OTP·사후 체크인 로직 유지, 점수 비노출) | 결정 D5 |
| `tools/measure-symmetry-*.mjs` | **포팅 재사용**(§9.3) | |

---

## 2. 케이스 매핑표 — 현재 코드 대비

### 2.1 회원 M01~M21 (현재 구현 = `GuestMeditationPanel` + `CounselorLiveTile`)
| ID | 판정 | 현재 코드에 있는 것 | 없는 것 / 변경 | 데이터 원천 |
|---|---|---|---|---|
| M01 온라인 1:1 기본 | **있음** | 상담사 영상 타일, 내 셀프뷰(`MemberSelfView`, 권한 있을 때), 6지표·타이머 | 단일 지표 링 중심 구성, 상담사 PiP·내 PiP 짝 정렬(S4), 그룹 평균·6지표 상시 노출 제거 | `useMemberLiveKit`, `useTracks`, `useBand` |
| M02 그룹 기본 뮤트+손들기 | **있음** | 기본 뮤트(발언권 없으면 `can_publish=false`), `🙋 손 들기` 버튼 | 뮤트 안내 문구·아이콘(이모지 → 아웃라인) | `speakingManaged`, `raiseHand()` |
| M03 손들기 대기 | **일부 + 백엔드** | "손들기 완료 · 상담사 승인 대기" 표시 | **취소 버튼**(F9: 취소 API 없음) | `raisedHand` |
| M04 발언권 부여(말하는 중) | **일부 + 백엔드** | "발언권 부여됨 · 카메라·마이크 켜짐" 표시, `speaking_changed`로 토큰 재발급 | **말하기 종료 버튼**(F9). 카메라는 기본 꺼짐으로 변경(결정 #1) | `speaking`, `canPublish` |
| M05 오프라인+밴드 | **일부** | 오프라인 마이크 UI 없음(`can_publish=false`), 스피커 기본 음소거 | 오프라인에서 상담사 영상을 **현행은 표시**(≤20명) → 시안은 PiP 없음(D2). 현장 안내 카드, 도크 구성 | `locationType`, `participantMode`, `maxParticipants` |
| M06 오프라인+무밴드 | **일부** | 밴드 연결 버튼 카드 | 현장 안내·소리·체크인 중심 레이아웃(MS1), "측정 없이도 수업은 그대로 진행돼요" | 동일 + `useBand`(`!everConnected`) |
| M07 온라인+미착용 | **있음** | `!isLive`일 때 지표 카드 숨김 + 연결 버튼 카드 | 링 자리 "밴드 없이 참여 중이에요" 안내(빈 칸 금지) | `useBand.connectionState` |
| M08 연결 대기 | **있음** | 버튼 라벨 "연결 중..." | 3점 순차 페이드 + 취소. 취소는 `band.disconnect()`가 `connecting`에서 동작하는지 **확인 필요**(`useBand.ts` disconnect 구현 확인) | `connectionState='connecting'` |
| M09 신호 약함 | **있음** | `signalQualityLevel`(degraded/invalid) 계산, "신호 …" 텍스트(기기 스트립) | 링 유지 + 밀착 안내 칩 | `signalQualityLevel` |
| M10 리드오프 | **있음** | `LeadOffModal`(풀스크린 검정), 15초 "AI 분석중" 복귀 표시 | 링 회색 전환 + 코랄 안내 시트(모달 → 시트), "무시하기" 동작 유지 | `deviceStatus==='lead_off'`, `band.leadOff` |
| M11 끊김(재연결 중) | **일부** | `useBand` 자동 재연결 타이머(`useBand.ts:1173`), "미연결" 표시 | 마지막 값 흐림 + "다시 연결하는 중이에요" + 수동 재연결 버튼. 미착용과 구분하려면 `everConnected` 필요(신규 파생) | `connectionState`, `lastEegAt`(stale) |
| M12 배터리 부족 | **있음** | `isLowBattery`(≤25%), 배터리 % 텍스트 | 주의색 칩 | `battery` |
| M13 미지원 브라우저 | **있음** | `isSupported=false` → 버튼 "Chrome/Edge 필요" | 안내 문구("이 브라우저에서는 밴드 연결이 안 돼요 · Chrome/Edge로 열면…") + 밴드 없이 계속. iOS 앱(Capacitor)에서의 `isSupported`는 **확인 필요**(실기기) | `isSupported` |
| M14 내가 마이크 끔 | **없음** | — (자동 발행만) | 마이크 토글(`setMicrophoneEnabled`), 안내 문구. **문구의 "AI 기록에서 빠져요"는 F8 때문에 사실 관계 확정 필요(D4)** | LiveKit 로컬 참가자 |
| M15 마이크 권한 거부 | **없음** | — (오류 무표시) | `onMediaDeviceFailure` → 허용 방법 3단계 카드 | `MediaDeviceFailure` |
| M16 내 카메라 꺼짐(1:1) | **없음** | — | 카메라 토글 + 이니셜 아바타 자리 유지. **기본값이 꺼짐으로 바뀐다(결정 #1)** | 로컬 카메라 |
| M17 카메라 권한 거부/기기 없음 | **없음** | — | "카메라를 쓸 수 없어요" + 수업 계속 | `MediaDeviceFailure`(PermissionDenied/NotFound) |
| M18 네트워크 재연결 중 | **없음** | `QuietSignalButtons`의 큐잉 문구만 | 상단 코랄 배너 + PiP 정지 표시 | 소켓·`navigator.onLine`·LiveKit `Reconnecting` |
| M19 네트워크 끊김 | **없음** | `useBand`가 업로드 큐 보관(`pendingCount`, `drainPendingQueue`) | 전체 안내 카드 + 재시도 + "밴드 데이터는 보관 중" | 소켓 장시간 끊김 + `pendingCount` |
| M20 대기열 | **없음 + (백엔드 선택)** | 서버가 `is_waitlisted` 저장, 대기자 LiveKit 403(F10) | 대기 전용 화면 + 자동 입장 감지. 프론트 단독은 `join` 응답으로 최초 감지 가능, 승격 감지는 재호출 폴링(부작용·부하) → 백엔드 필드 추가로 대체 가능(B3). 시안의 "대기열에서 나가기" 버튼은 서버 호출 없이 `resetJoin`(로컬 초기화)만 가능해 서버에는 대기 행이 남음, "입장 알림은 푸시로" 문구는 로그인 회원(`session_waitlist_promoted` 알림)에게만 해당(게스트는 알림 없음) → 문구·버튼 확인 필요(D5와 함께) | `joinSessionByCode` 응답 |
| M21 종료 | **일부** | `GuestCompletePanel`(밝은 배경, 이메일 OTP 신청·사후 체크인) | 어두운 자연 배경·"수고하셨어요" 카드, **점수 비노출**. 이메일 신청·체크인 흐름 배치는 D5 | `ClassJoinPage` step `complete` |

**집계(회원 21)**: 있음 8(M01·02·07·08·09·10·12·13) / 일부 6(M03·04·05·06·11·21) / 없음 7(M14~M20). 이 중 백엔드가 걸린 항목 3(M03·M04·M20).

### 2.2 상담사 C01~C18 (현재 구현 = `ClassPlayerPage` 호스트 분기 + `HostClassWorkspace`)
| ID | 판정 | 현재 코드에 있는 것 | 없는 것 / 변경 | 데이터 원천 |
|---|---|---|---|---|
| C01 온라인 그룹 8 기준선 | **일부** | 참가자 그리드(`hcp-people`), 지표명 라벨(`hcp-person-label`), 밴드 상태점, 셀프뷰(`hcp-selfview`) | **지표 띠**(현재 "지금 보는 지표" 표시 없음, 칩 툴바만), 띠·타일 지표 고유색, 페이지 버튼 제거 후 **타일 영역 세로 스크롤**(F13), 도크/시트 구조 | `rows`(live-metrics 4초 폴링+`eeg_feature` 소켓), `HOST_METRICS` |
| C02 손든 회원 2 | **일부** | 타일 "발언 요청" 라벨, `SpeakingRightsPanel`(부여/해제), WS `speaking_changed` 반영 | 상단 "손든 회원 N" 칩, 타일 배지 강조 | `raise_hand`·`speaking`(`speakingPatch` 오버레이) |
| C03 발언권 부여 1 | **있음** | "발언 중" 라벨, 회수 버튼(`SpeakingRightsPanel`) | 타일 강조·상단 칩 "말하는 중 + 회수" | 동일 |
| C04 오프라인 그룹 | **일부** | 오프라인에서 발언권 UI 비노출(`speakingManaged`), 녹음 상태 pill(`hostStatusPanel`) | 셀프뷰 슬롯 **제거**(현행은 `mediaPrefs.cameraOn` 따라 표시) → 지표·요약 패널로 채움(CS3), 녹음 칩 | `session.location_type`, `recorder.state` |
| C05 온라인 1:1 | **없음** | 1명도 그리드 타일 + 상세 시트 | **큰 회원 카드 1 + 내 셀프뷰 + 6지표 바로 노출**(3×2 격자, CS5), 회원 영상 자리(결정 #1) | `participant_mode==='one_on_one'`, `metricSections()` 로직 재사용 |
| C06 오프라인 1:1 | **없음** | — | 큰 회원 카드 + 6지표 + 녹음 상태 | 동일 |
| C07 카메라 꺼짐 | **있음** | `mediaPrefs.cameraOn=false` → "카메라 꺼짐 · 녹화 안 함" | 진행 중 **토글**(없음 → H4), 셀프뷰 자리 유지 + 칩 | `mediaPrefs`, `videoRecorder.state` |
| C08 카메라 권한 거부 | **없음** | `videoRecorder` `error` 상태 → 문자열 오류 배너 | 셀프뷰의 코랄 "카메라를 쓸 수 없어요" + 설정 안내 시트 | `videoRecorder.state==='error'`, `onMediaDeviceFailure` |
| C09 마이크 꺼짐 | **일부** | "AI 분석 없음 (마이크 꺼짐)" pill(`hostStatusPanel`, 접힘 영역) | 상단 배너, **진행 중 토글**(현행은 입장 전 설정만). 끄면 `recorder.pause()`+LiveKit 마이크 off(F7·F8) | `mediaPrefs.micOn`, `recorder` |
| C10 마이크 권한 거부 | **없음** | `recorder` `error` → 문자열 오류 | 코랄 배너 + 허용 방법 + 시작/종료 영향 안내 | `recorder.state==='error'` |
| C11 녹음 중 | **있음** | `recorder.state`(recording/paused), 경과 `recordingElapsedSec` | 칩 형태(점+경과), 일시정지 칩 | `useAudioRecorder` |
| C12 리드오프 3·배터리 2 | **있음 + 백엔드(버튼 1개)** | `summarizeMetrics`(leadOff·lowBattery 집계), `SessionMonitorSummary` | 상단 "접촉 확인 3 · 배터리 2" 칩 → 시트 일괄 확인. 시안 시트의 **"모두에게 안내 보내기"**는 상담사→참가자 안내 전송 API가 없음(백엔드 검색 결과 없음, 채팅 브로드캐스트만 존재) → B6 | `device_status`, `band_battery` |
| C13 전원 미착용 | **일부** | 그룹 흐름 영역 "표본 없음" 안내 | 지표 띠 자리 "이번 수업은 밴드 없이 진행 중이에요" + 접속·체크인 요약 | `rows[].band_connected` 전부 false |
| C14 대기열 3명 | **일부 + 백엔드** | 세션 DTO `waitlist_count`·`participants[].is_waitlisted`(세션 상세 페이지는 표시) | 플레이어 상단 칩 "대기 3" + 시트 목록(읽기 전용). **입장 승인은 API 없음(F9)** | `session.waitlist_count` |
| C15 내 밴드(상담사) | **있음** | 호스트 `useBand`, "LINK BAND (호스트)" 블록(접힘 영역) | 칩 + 시트로 위치 이동 | `band.*` |
| C16 네트워크 재연결/끊김 | **일부** | `liveSocket.isConnected` 기반 "서버 연결 끊김 · 4초 주기 갱신" pill(접힘 영역), LiveKit `onDisconnected` 오류 | 배너 + 참가자 값 흐림 + "데이터 수신 일시 중단(복구 시 이어서 기록)" | `liveSocket.isConnected`, 4초 폴링 실패 |
| C17 종료 확인·리포트 생성 중 | **일부** | `EndSessionModal`, `isEnded` 씬 + `ReportProgressStepper` | 종료 후 이동 방식(F14, D6), 시안 3단계 표기 | `useReportProgress` |
| C18 20명 + 스크롤 + 손든 우선 | **일부** | `SpeakingRightsPanel`이 손든 회원 우선 정렬 | 그리드 **우선 정렬 옵션**(손든 회원 먼저), 스크롤(F13) | `rows`, 정렬 상태 |

**집계(상담사 18)**: 있음 5(C03·07·11·12·15) / 일부 9(C01·02·04·09·13·14·16·17·18) / 없음 4(C05·06·08·10). 백엔드가 걸린 항목 2(C12의 "모두에게 안내 보내기" 버튼, C14의 입장 승인) — 둘 다 대체안(버튼 제외·읽기 전용)으로 진행 가능.

### 2.3 시안 케이스표에 없지만 현재 존재해 **소실되면 안 되는 기능**
상담사: 녹음 시작/일시정지/종료(`RecordingControls`·동의 `ConsentModal`), 영상 녹화 제어(조합 C 무음 영상), 마커(`MarkerButton`), 클래스 채팅 켜기/끄기(`handleToggleChatEnabled`), 클래스 코드 복사, 입장 전 체크인 카드(`sessionCheckins`), 후면/전면 카메라 전환(`switchCamera`), 이탈 보호(`useLeaveGuard`·`LeaveGuardModal`), 종료 재시도(`endFailed`), 오류 배너(`liveKit.error`).
회원: 스피커 음소거, 화면 끄기(몰입), 종료 확인(`LeaveConfirmModal`), 온보딩 코치마크(`ClassOnboardingCoachmarks`), 조용한 신호 3종, 채팅(회원)/안내(게스트), 접촉불량 후 "AI 분석중" 15초 표시, `linkband_mode='none'`(밴드 UI 전체 숨김, 시안에 없음 → D7).
→ 새 도크·시트 구성안(M3·H2)에 위치를 배정하고 verify §6 회귀 표에 포함한다.

---

## 3. 백엔드 영향 분석

### 3.1 확정 결정 #1 "회원 영상 기본 비공개, 회원이 켜면 상담사에게 노출" — **프론트 단독으로 가능**
| 확인 항목 | 결과 | 근거 |
|---|---|---|
| 서버 토큰이 카메라/마이크를 구분하는가 | **아니오**. `VideoGrants(room_join, room, can_publish, can_subscribe)`만 설정하며 `can_publish_sources` 미사용 → `can_publish=True`이면 카메라·마이크·화면공유 모두 허용 | `session_service.py:1398-1423` |
| 회원 `can_publish` 규칙 | 온라인 1:1 = 항상 True / 온라인 그룹 ≤20 = `speaking`일 때만 True / 오프라인·그룹 >20 = False | `_compute_can_publish` `:1755-1770` |
| 현재 카메라가 켜지는 방식 | 클라이언트가 `video={canPublish}`로 **토큰 권한이 있으면 자동 발행** | `CounselorLiveTile.tsx:153` |
| 상담사가 회원 카메라를 강제로 켤 수 있는가 | **불가**. 상담사 토큰에 `room_admin` 없음, 원격 참가자 카메라는 해당 참가자만 발행 가능 | `generate_livekit_token` 인자 목록 |
| 상담사 화면에서 "발행할 때만 표시" 구현 | 원격 카메라 트랙(`useTracks([Track.Source.Camera])`에서 `!participant.isLocal`)이 **존재할 때만** 자리 렌더. 트랙이 없으면 자리 없음 | `HostCamera` 패턴(`CounselorLiveTile.tsx:37-60`)과 동일 |

**프론트 방안**
- 회원: `LiveKitRoom`에 `video={false}`(기본), `audio={canPublish}` 유지. 카메라 켜기 = `localParticipant.setCameraEnabled(true)`. 토큰이 `can_publish=true`일 때만 버튼 활성. 권한 변경으로 `LiveKitRoom`이 `key`로 재마운트되면(`CounselorLiveTile.tsx:148`) 카메라 선호를 컨테이너 상태(`camWanted`)로 보관했다가 재적용.
- 상담사: `VideoConference`(전원 그리드 UI) 대신 **헤드리스 `HostLiveKitBridge`**(`LiveKitRoom` + `RoomAudioRenderer` + 필요한 트랙 훅)로 교체. 1:1에서 회원 카메라 트랙이 있을 때만 큰 회원 카드 옆 영상 자리를 표시.
- **한계(문서화)**: 서버가 카메라 발행을 막지 않으므로 변조된 클라이언트는 카메라를 발행할 수 있다. 정책을 서버에서 강제하려면 B5(선택) 필요.

### 3.2 백엔드 변경 항목(B1~B6) — **승인 요청**(기본값 = 적용하지 않음, 프론트 대체안으로 진행)
| ID | 항목 | 영향 케이스 | 프론트 대체안(기본) | 백엔드 최소 안(승인 시) |
|---|---|---|---|---|
| B1 | 손들기 **취소** | M03 | 취소 버튼 생략(대기 안내만 표시) | `DELETE /sessions/{id}/participants/{pid}/raise-hand`(본인·게스트 토큰 검증은 `_authorize_participant_access` 재사용) + `speaking_changed` 이벤트 발행 |
| B2 | 회원 **말하기 종료**(발언권 반납) | M04 | "말하기 종료" = 로컬 마이크 끄기(`setMicrophoneEnabled(false)`). 서버의 `speaking`은 유지되어 상담사 화면엔 "발언 중"으로 남음 | `POST …/speaking/release`(본인) → `speaking=False` + 이벤트 |
| B3 | 대기열 상태 노출(게스트) | M20 | `join` 응답의 `participants[].is_waitlisted`로 최초 판별(타입에 `participant_id` 추가). 승격 감지는 5초 주기 `joinSessionByCode` 재호출(멱등, 단 `participant_changed` 알림 부작용 — 확인 필요) | `GuestSessionStateResponse`에 `is_waitlisted`·`waitlist_position` 추가(필드 추가만, 기존 클라이언트 영향 없음) |
| B4 | 대기열 **입장 승인** | C14 | 목록 읽기 전용 + "자리가 나면 자동으로 입장해요" 안내 | 승인 API + 정원 초과 정책 정의(신규 기획 필요 → 별도 SDD로 분리) |
| B5 | 회원 카메라 **서버 강제** | 결정 #1 | 클라이언트 정책만(§3.1 한계) | `can_publish_sources=[MICROPHONE]` 기본 발급 + 카메라 허용 API(회원 opt-in 시 토큰 재발급) |
| B6 | 상담사 → 참가자 **안내 전송**(C12 "모두에게 안내 보내기") | C12 | 버튼 제외. 채팅이 켜져 있으면 채팅 메시지로 대체하는 안은 D13에서 결정 | 안내 전송 이벤트·API 신규(푸시/소켓 정책 포함, 별도 기획 필요) |

### 3.3 백엔드 변경이 **필요 없는** 것으로 확인한 항목
- 상담사 마이크/카메라 진행 중 토글: LiveKit 로컬 참가자 + 녹음기 `pause/resume` 프론트 처리.
- 마이크 꺼짐 시 뇌파 유지: `useBand` 업로드 경로는 마이크와 독립(코드 상 연결 없음). 검증은 verify에서 계측.
- 필요 조치 집계(C12), 손든 회원 칩(C02), 상담사 네트워크 표시(C16), 회원 네트워크(M18·M19): 기존 필드·소켓 상태로 충분.

---

## 4. 파일 소유권 · 병렬 계획

### 4.1 소유권 표 (한 파일은 한 소유자만 수정)
| 소유자 | 파일 | 규칙 |
|---|---|---|
| **S (공용 담당)** | `lib/class/player-case.ts`, `components/class/player/shared/**`, `components/chat/ClassChatPanel.tsx`(embedded 변형), `pages/design/ClassPlayerCasesPage.tsx`, `App.tsx`(하니스 라우트 1줄), `e2e/class-player/lib.mjs`, `lib/api/session.ts`(`SessionParticipant.participant_id` 타입 추가) | T1~T3 병합 후 **동결**. 이후 변경은 S에게 요청 |
| **M (회원 트랙)** | `lib/class/member-player-case.ts`, `lib/class/fixtures/member-cases.ts`, `components/class/player/member/**`, `components/player/MemberSessionScene.tsx`(I1), `e2e/class-player/member.mjs`, `tests/class-player-member-*.test.tsx` | 상담사 파일 수정 금지 |
| **H (상담사 트랙)** | `lib/class/host-player-case.ts`, `lib/class/fixtures/host-cases.ts`, `components/class/player/host/**`, `pages/sessions/ClassPlayerPage.tsx`(I1에서 호출부만), `e2e/class-player/host.mjs`, `tests/class-player-host-*.test.tsx` | 회원 파일 수정 금지 |
| **통합 (I1~I3)** | 기존 테스트·`e2e/full-journey.mjs` 갱신, 기존 파일 삭제, 문서 | 두 트랙 병합 후 단일 담당자 |
- 회원·상담사 두 트랙이 공유하는 코드는 `shared/`와 `player-case.ts`뿐이다. 두 트랙은 **서로의 파일을 읽기만** 한다.
- 두 워커 병렬 가능 여부: **가능**. 선행 조건 = T1·T2·T3 병합. T2와 T3도 §9.2의 `data-pz` 측정 훅 계약을 먼저 합의하면 병렬 가능.

### 4.2 의존 관계
```text
T0 ─▶ T1 ─┬▶ T2 ─┐
          └▶ T3 ─┴▶ [M1→M2→M3→M4→M5]  ─┐
                  └▶ [H1→H2→H3→H4→H5]  ─┴▶ I1 → I2 → I3
```
- 트랙 내부는 직렬(같은 `…View.tsx`를 여러 Task가 확장). 트랙 간은 병렬.

---

## 5. 사용자 결정이 필요한 사항 (기본값과 근거)

| ID | 질문 | 기본값(결정 전 구현 기준) | 근거 |
|---|---|---|---|
| D1 | B1~B6 백엔드 변경 승인 여부 | 전부 미적용, §3.2 프론트 대체안 | spec 비범위 |
| D2 | **오프라인 회원에게 상담사 영상 PiP 표시 여부.** 현행은 오프라인 ≤20명에서 상담사 영상을 받고 스피커만 기본 음소거. 시안 M05·M06은 PiP·마이크·카메라 UI가 없는 구성 | 시안대로 PiP 제거(오프라인 = 같은 공간) | 케이스.md §4 "영상·마이크 UI 없음". 단 현행 기능 제거이므로 확인 필요 |
| D3 | 진행 중 소리 시트 내용. 진행 중 BGM 무재생 정책(F11)과 시안 "소리·BGM"이 충돌 | 소리 시트 = 상담사 음성 음소거·음량만, BGM 행 제외 | `fd93da24` 정책 유지 |
| D4 | **"마이크 꺼짐 = AI 기록에서 제외" 문구의 사실 관계.** 회원 음성은 어떤 경우에도 기록되지 않는다(F8). 상담사 마이크를 끄면 녹음기를 일시정지하므로 사실. 또 `ENABLE_STT_AI_RECORD=false`(`lib/features.ts`)로 AI 요약·전사가 화면에 노출되지 않음 | 상담사 화면은 시안 문구 그대로(녹음 일시정지와 연동). 회원 화면(M14)은 "마이크 꺼짐 · 상담사에게 내 목소리가 전달되지 않아요(뇌파는 계속 기록돼요)"로 변경 | 사실과 다른 안내 방지 |
| D5 | 종료 화면(M21)에서 **이메일 리포트 신청(OTP)·사후 체크인**을 어디에 둘지(시안엔 안내 문구와 "대시보드로 이동" 버튼만. 게스트는 대시보드가 없어 "홈으로"로 대체 필요) | 종료 카드 아래 "리포트 받기"·"오늘 상태 남기기" 버튼 → 기존 패널을 시트로 열기. 점수 표시 없음 | 기능 소실 방지 |
| D6 | 종료 확정 후 이동. 현행 = 기록 페이지로 즉시 이동, 시안 C17 = 같은 화면에서 리포트 생성 진행 표시 | 현행 유지(기록 페이지 이동), `isEnded` 씬만 시안 스타일 적용 | 흐름 변경 최소 |
| D7 | `linkband_mode='none'` 세션(밴드 UI 전체 숨김)의 링 자리 | M06 구성에서 밴드 연결 버튼·기기 도크만 제거, 링 자리는 현장/수업 안내로 대체 | 시안에 없는 경우 |
| D8 | 배터리 부족 임계값(시안 예시 15%, 코드 25% 이하 포함 — 코드 주석 "Brian 확정") | 코드값 25% 이하 유지 | `signal-status.ts:18-24` |
| D9 | 네트워크 `재연결 중 → 끊김` 전환 시간 | 상수 `NET_DOWN_AFTER_MS`로 분리, 값은 구현 전 확정 | 코드에 기준 없음 |
| D10 | 상담사 상세 시트의 추이 구간. 시안 "5분 추이" vs 현행 호스트 이력 약 3분(`190000ms`) | 시안대로 5분(이력 보관 300초+) | 시안 기준 |
| D11 | 기관관리자(org_admin)가 호스트가 아닌 세션을 열 때의 비호스트 화면 | 현행 유지(이번 범위 제외) | F2 |
| D12 | 회원 화면의 **본인 5분 변화 문구("5분간 +8")**가 "±델타 금지"(spec 합의 #5)에 해당하는지. 기획.md §4.1은 이 문구를 포함하고 "회원용 비교 장치 없음"으로 명시 | 본인 5분 변화 문구는 허용, 타인·그룹 대비 수치(그룹 평균·순위·상위/하위·종합점수)만 금지 | 기획.md §4.1 vs §P5 문구 해석 차이 |
| D13 | C12 "모두에게 안내 보내기"·C15 "밴드 연결" 안내 버튼의 실제 동작(시안은 토스트만 있는 모형) | 버튼 제외, 필요 조치 시트는 목록 확인 전용 | 대응 API 없음(B6) |

---

## 6. Task 분해

각 Task = 30~60분. 모든 Task는 **테스트 먼저**(RED → GREEN → 정리), 커밋은 Task 단위(`feat(sdd-208): …`), 푸시 금지(통합 Task에서만).

| Task | 이름 | 트랙 | 선행 | 병렬 | 소요 |
|---|---|---|---|---|---|
| T0 | 격리 작업 사본·기준선 | S | — | — | 30분 |
| T1 | 공용 케이스 모델 | S | T0 | T2∥T3 가능 | 45분 |
| T2 | 공용 UI 프리미티브·토큰·채팅 임베드 | S | T1 | T3과 병렬 | 60분 |
| T3 | 케이스 하니스·측정 스크립트 포팅 | S | T1 | T2와 병렬 | 60분 |
| M1 | 회원 뷰 골격·링·밴드 8상태(M01·05~13) | M | T2·T3 | H 트랙과 병렬 | 60분 |
| M2 | 회원 미디어(마이크·카메라·손들기·PiP)(M02~04·14~17) | M | M1 | 〃 | 60분 |
| M3 | 회원 도크·시트 5종·오프라인 현장 안내(M05·06) | M | M1 | M2와 파일 분리 시 병렬 | 60분 |
| M4 | 회원 전체화면 상태·네트워크(M18~21) | M | M1 | 〃 | 45분 |
| M5 | 회원 컨테이너 연결 | M | M2~M4 | — | 60분 |
| H1 | 상담사 뷰 골격·지표 띠·스크롤 그리드·도크(C01·13·18) | H | T2·T3 | M 트랙과 병렬 | 60분 |
| H2 | 칩 줄·배너·시트(C02·03·11·12·14·15) | H | H1 | 〃 | 60분 |
| H3 | 1:1·오프라인 헤드·상세 시트(C04~06) | H | H1 | H2와 파일 분리 시 병렬 | 60분 |
| H4 | 상담사 LiveKit 제어·권한·녹음 연동(C07~10) | H | H1 | 〃 | 60분 |
| H5 | 네트워크·종료·컨테이너 연결(C16·17) | H | H2~H4 | — | 60분 |
| I1 | 호출부 교체·기존 테스트·E2E 갱신 | 통합 | M5·H5 | — | 60분 |
| I2 | 전 케이스 측정·보정 | 통합 | I1 | — | 60분 |
| I3 | dev 배포·스모크·실기기 확인·정리·summary | 통합 | I2 | — | 60분 |

### T0 격리 작업 사본·기준선 (S)
- 파일: 없음(작업 환경).
- 작업: ① 다른 개발자의 미커밋 변경이 커밋·푸시됐는지 확인(§8.3). ② `git worktree add ../mindbreeze-sdd208 -b sdd/208-class-player origin/develop`(경로는 저장소 밖). ③ 기준선 실행·기록: `cd frontend && npm ci --legacy-peer-deps && npx tsc --noEmit && npx eslint src/ && npm test` → 실패 목록을 `specs/sdd-208-class-player-redesign/baseline.txt`에 저장(이후 회귀와 구분).
- TDD: 해당 없음(기준선 확보).
- 완료 기준: 기준선 결과 파일 존재.

### T1 공용 케이스 모델 (S)
- 파일: 생성 `lib/class/player-case.ts`, `tests/class-player-case.test.ts`.
- 인터페이스(후속 Task가 의존): §1.3의 `BandUi`·`NetUi`·`MicUi`·`CamUi`·`deriveBandUi`·`deriveNetUi`, 상수 `NET_DOWN_AFTER_MS`, 공용 지표 정의 `PLAYER_METRICS: { key; label; short; unit; group:'MIND'|'BODY'; scale:{member:[min,max]; host:[min,max]} }[]` — 값은 시안(`member.html` METRICS, `counselor.html` METRICS)과 현행(`GuestMeditationPanel.tsx:74-81` 회원 스케일, `ClassPlayerPage.tsx:228-235` 상담사 라벨)을 대조해 확정. 약칭: 집중·이완·감정·BPM·호흡·HRV. 지표 고유색 토큰 `--m-*`는 `player-tokens.css`(T2)에 둔다.
- 테스트 먼저: 밴드 입력 표(8상태 + 우선순위 충돌 6쌍: 리드오프+배터리부족 → leadoff, 끊김+약함 → lost 등), 네트워크 3상태, `everConnected` 유무에 따른 off/lost 구분, `PLAYER_METRICS` 6개·약칭·그룹(MIND 3/BODY 3) 단언.
- 실행: `cd frontend && npx vitest run tests/class-player-case.test.ts`

### T2 공용 UI 프리미티브 (S)
- 파일: 생성 `components/class/player/shared/*`(§1.2), 수정 `components/chat/ClassChatPanel.tsx`(`embedded` prop 추가, 기존 동작 불변), 테스트 `tests/class-player-shared.test.tsx`.
- 계약: 모든 측정 대상 요소에 `data-pz="…"` 부여(§9.2 표). 시트 분기는 CSS가 아니라 **한 곳의 판정 함수**(`isSideSheet(vw, vh)`: `vw>=1000 && vw>vh`)로 결정 → 균형.md S5와 동일.
- 테스트 먼저: ① `PlayerSheet`가 (390×844, 834×1194)에서 바텀, (1194×834, 1280×720)에서 사이드; ② `PlayerDock` 항목 폭 동일; ③ `StatusRing`에 애니메이션 클래스·"호흡" 문구 없음(스냅샷 grep); ④ `ClassChatPanel embedded`가 기존 `collapsed` 오버레이 동작을 바꾸지 않음(기존 `class-chat-panel.test.ts` 통과).
- 글자 크기 최소 12px(`--fs-12`), 터치 영역 `--tap: 44px`는 토큰으로 강제.

### T3 케이스 하니스·측정 스크립트 포팅 (S)
- 파일: 생성 `pages/design/ClassPlayerCasesPage.tsx`, `e2e/class-player/{lib,symmetry-member,symmetry-host,fit}.mjs`; 수정 `App.tsx`(라우트 1줄 `/design/class-player`).
- 하니스 사양: `?role=member|host&case=M10&sheet=device&viewport=…`. `fixtures/*.ts`를 `import.meta.glob`으로 수집. 픽스처 없으면 "케이스 미등록" 표시.
- 측정 포팅: `designs/class-player-redesign/tools/measure-symmetry-*.mjs`의 측정 함수(`page.evaluate` 본문)를 **셀렉터 맵 인자화**(§9.3). Chrome 경로 고정(`/Applications/Google Chrome`·`channel:'chrome'`)은 `PLAYWRIGHT_CHROMIUM`/기본 번들로 변경해 CI(`chromium-headless-shell`)에서도 실행.
- 테스트 먼저: 하니스에 더미 픽스처 1개(`__selftest`)를 넣고 측정 스크립트가 PASS/FAIL을 올바르게 판정하는지(의도적 비대칭 요소로 FAIL 확인).
- 실행: `cd frontend && npm run dev` 후 `node e2e/class-player/fit.mjs --role=member`

### M1 회원 뷰 골격·링·밴드 8상태 (M)
- 파일: 생성 `lib/class/member-player-case.ts`, `lib/class/fixtures/member-cases.ts`(M01~M21 입력), `member/MemberClassView.tsx`, `member/member-player.css`, `tests/class-player-member-case.test.ts`, `tests/class-player-member-view.test.tsx`.
- 구현 범위: 상단 바(나가기·제목 필·연결 점, S3 대칭), 중앙 링(지표 1개, 기본 이완도), 링 아래 안내 칩/슬롯 카드(밴드 8상태별 시안 문구), 5분 추이 한 줄. 그룹 평균·델타·순위·종합점수 **코드 자체를 두지 않는다**.
- 테스트 먼저: `deriveMemberCase(fixture)`가 M01~M21 입력에서 시안 `CASES` 표와 같은 키 값을 내는지(표 구동 21행). 뷰 테스트: 밴드 8상태별 링 코어 문구·톤, 호흡 지시 문구 0, "그룹"/"평균"/"순위" 문구 0.
- 의존: `deriveBandUi`(T1), 공용 프리미티브(T2).

### M2 회원 미디어 컨트롤 (M)
- 파일: 생성 `member/MemberMediaControls.tsx`, `tests/class-player-member-media.test.tsx`.
- 구현: `LiveKitRoom`(`video={false}`, `audio={canPublish}`, `onMediaDeviceFailure`) 내부 마이크·카메라 토글, 손들기 상태(M02·M03·M04), 내 PiP(켜짐/꺼짐 아바타/불가 안내), 상담사 PiP(트랙 있을 때만). 카메라 선호 `camWanted`를 컨테이너 상태로 올려 재마운트에 대비.
- 테스트 먼저(LiveKit은 훅 모킹): ① 기본 `video=false`; ② 카메라 켜기 클릭 → `setCameraEnabled(true)`; ③ `PermissionDenied` → M15/M17 문구; ④ `canPublish=false`(그룹 뮤트)에서 토글 비활성 + 손들기 노출; ⑤ B1·B2 미적용 시 "취소" 버튼 없음·"말하기 종료"=로컬 마이크 끄기.

### M3 회원 도크·시트 5종·오프라인 현장 안내 (M)
- 파일: 생성 `member/sheets/*`(내 상태·채팅·조용한 신호·소리·기기), 확장 `MemberClassView.tsx`.
- 구현: 도크(오프라인은 상태·채팅·소리·기기만, 마이크/카메라 줄 없음 = MS1), 내 상태 시트 2×3 동일 크기 격자(MS2), 기기 시트(밴드 연결·해제·배터리·접촉·신호, 필요 시 `MemberRawData` 래핑), 소리 시트(D3), 채팅 시트(`ClassChatPanel embedded`, 게스트는 `GuestChatNotice`), 조용한 신호 시트(`QuietSignalButtons` 재사용), 오프라인 현장 안내 카드(M05·M06), 스피커 음소거·화면 끄기·온보딩 코치마크 배치.
- 테스트 먼저: 도크 항목 수(온라인 N / 오프라인 N-2), 시트 동시 1개, 시트 안에서 `QuietSignalButtons` 클릭 시 `sendSignal` 호출, 오프라인에 마이크·카메라 버튼 0.

### M4 회원 전체화면 상태·네트워크 (M)
- 파일: 생성 `member/MemberFullView.tsx`(대기열·종료·네트워크 끊김 공용 카드), 테스트 추가.
- 구현: M18 상단 배너+PiP 정지 표시, M19 전체 안내+재시도+"밴드 데이터는 보관 중"(`pendingCount>0`일 때), M20 대기열 화면, M21 종료 카드(점수 비노출, D5 버튼). 전부 화면 정중앙(MS3).
- 테스트 먼저: M19에서 "재시도" 클릭 시 재연결 콜백, M21에 숫자 점수 패턴(`/\d+\s*%/`) 0.

### M5 회원 컨테이너 연결 (M)
- 파일: 생성 `member/MemberClassContainer.tsx`, `tests/class-player-member-container.test.tsx`.
- 구현: `GuestMeditationPanel`의 데이터 로직 이식 — `useBand`(+`everConnected` 보관)·`useSessionLiveSocket`(`onGroupAverage` **구독 제거**)·1Hz 링버퍼·`useGuestAudioSync`·채팅 폴링·`useWakeLock` 유지·`LeadOffModal` 상태. 뷰 모델 조립. `class-join-page`가 `participantId`·`session.participants`로 대기열 여부를 넘기도록 props 추가는 I1에서.
- 테스트 먼저: 소켓 이벤트·밴드 상태 변화 → 뷰 모델 변화(훅 모킹). `class:group_average` 이벤트가 와도 뷰 모델에 평균 필드 없음.
- 주의: 이 Task까지 기존 파일 수정 0.

### H1 상담사 뷰 골격·지표 띠·스크롤 그리드·도크 (H)
- 파일: 생성 `lib/class/host-player-case.ts`, `lib/class/fixtures/host-cases.ts`(C01~C18), `host/HostLiveView.tsx`, `host/host-player.css`, `tests/class-player-host-case.test.ts`, `tests/class-player-host-view.test.tsx`.
- 구현: 상단 바(닫기·제목·함께한 시간/계획 시간·접속/전체·종료, 시간 숫자 15~18px — 결정 #3), **지표 띠**(지표명 큰 글자·지표 고유색 `--m-*`, 그룹 평균은 띠 안 유지 — 결정 #3), 타일(이름·지표 링·약칭 라벨·밴드점, 띠와 같은 색), **세로 스크롤 그리드**(페이지 버튼 없음, 마지막 행 가운데 정렬 CS2, 열 수 인원 균등 분배), 도크 5종(지표 기준·채팅·미디어·체크인·도구).
- 테스트 먼저: 열 수 선택 순수함수(8명→2·4열, 6명→3열, 12명→3·4열 — 균형.md CS2), 지표 순환(10초) 시 띠·타일 라벨 동시 변경, `‹ ›` 페이지 버튼 DOM 0, 20명 렌더에서 그리드 내부 스크롤 영역만 `overflow-y:auto`.
- 지표 정의는 `ClassPlayerPage`의 `HOST_METRICS`를 가져오지 않고 T1의 `PLAYER_METRICS`를 사용한다(복제 금지).

### H2 칩 줄·배너·시트 (H)
- 파일: 생성 `host/sheets/*`(손든 회원·필요 조치·대기·내 밴드·체크인·도구), 확장 `HostLiveView.tsx`.
- 구현: 칩 줄 가운데 정렬·넘치면 "+N"(CS4), 칩 종류(손든 회원 N / 말하는 중+회수 / 필요 조치(접촉 확인·배터리) / 대기 N(읽기 전용, B4 미적용) / 내 밴드 / 녹음 중·일시정지), 시트에 `SpeakingRightsPanel`·`SessionMonitorSummary`·`CheckinSummary`·`WaitingRoomReadinessPanel` 재사용.
- 테스트 먼저: C02·C03·C11·C12·C14·C15 픽스처 → 칩 목록과 문구(시안 원문), 손든 회원 우선 정렬 옵션(C18), 칩 8개 초과 시 "+N".

### H3 1:1·오프라인 헤드·상세 시트 (H)
- 파일: 생성 `host/HostSoloCard.tsx`·`host/HostSummaryPanel.tsx`·`host/sheets/ParticipantDetailSheet.tsx`.
- 구현: C05·C06 큰 회원 카드 + 6지표 3×2 + 5분 추이·체크인(CS5), 오프라인 헤드 행 = 지표 띠 + 요약 패널(셀프뷰 없음, CS3), 회원 영상 자리(트랙 있을 때만, 결정 #1), 참가자 상세 시트(6지표+추이+체크인 응답).
- 테스트 먼저: 오프라인에서 셀프뷰 DOM 0, 온라인 1:1에서 회원 영상 트랙이 없으면 영상 자리 DOM 0.

### H4 상담사 LiveKit 제어·권한·녹음 연동 (H)
- 파일: 생성 `host/HostLiveKitBridge.tsx`, `host/HostMediaSheet.tsx`, `tests/class-player-host-media.test.tsx`.
- 구현: `VideoConference` 대체 헤드리스 브리지, 마이크·카메라 토글(진행 중), **마이크 끄기 = LiveKit 마이크 off + `recorder.pause()` + 영상 녹화 오디오 트랙 비활성**, 켜기 = 복구, 권한 거부(`onMediaDeviceFailure`, `recorder.state==='error'`, `videoRecorder.state==='error'`) 배너·허용 방법 시트, 카메라 전환(전면/후면)·녹음 시작·마커 유지.
- 테스트 먼저: ① 마이크 off → `recorder.pause` 호출·청크 업로드 증가 없음·`band` 업로드 계속(뇌파 유지); ② 마이크 on → `resume`; ③ 권한 거부 문구(C08·C10); ④ 오프라인에서 카메라 토글 DOM 0(C04·C06).
- 확인 필요: `useVideoRecorder`는 `withAudio`가 훅 생성 시점 고정(`ClassPlayerPage.tsx:624`) → 진행 중 마이크 끄기 시 영상 녹화 오디오를 어떻게 멈출지(트랙 `enabled=false` vs 일시정지) 구현 전 실측.

### H5 상담사 네트워크·종료·컨테이너 연결 (H)
- 파일: 생성 `host/HostLiveContainer.tsx`, `tests/class-player-host-container.test.tsx`.
- 구현: C16 배너 + 참가자 값 흐림 + "데이터 수신 일시 중단", C17 종료 확인(`EndSessionModal` 재사용)·`isEnded` 씬 스타일(D6), `ClassPlayerPage`의 진행 중 상태·핸들러를 props로 받는 컨테이너. 이 Task까지 `ClassPlayerPage.tsx` 수정 0.
- 테스트 먼저: 소켓 끊김 → 배너, 4초 폴링 복구 → 배너 해제, `finishSession` 실패 시 "종료 재시도" 노출.

### I1 호출부 교체·기존 테스트·E2E 갱신 (통합)
- 파일: 수정 `components/player/MemberSessionScene.tsx`(→ `MemberClassContainer`), `pages/class-join-page.tsx`(대기열 판별 props), `pages/sessions/ClassPlayerPage.tsx`(진행 중 구간 JSX → `HostLiveContainer`), `lib/api/session.ts`(타입), `e2e/full-journey.mjs:199`(문구 단언 교체), 기존 테스트 갱신.
- 갱신 대상 테스트: `host-class-workspace.test.tsx`(진행 중 케이스는 새 뷰 테스트로 이전, 페이지 버튼 테스트 삭제, 세팅·대기 케이스 유지), `member-class-player.browser.cjs`(그룹 평균 단언 삭제, 새 구조로 재작성), `quiet-signal-ui.test.ts`(마크업 변경 시), `class-join-waiting.test.ts`(`MemberSessionScene` 모킹이라 영향 없음 — 확인).
- 이 Task에서만 기존 파일을 수정하므로 롤백 = 이 커밋 되돌리기.

### I2 전 케이스 측정·보정 (통합)
- 실행: `node e2e/class-player/fit.mjs --role=member && node e2e/class-player/fit.mjs --role=host` → `shots/` 결과표 생성, 위반 0 될 때까지 해당 소유 트랙 파일 수정. 시안 스크린샷과 눈으로 대조(`designs/…/shots/cases/`).

### I3 dev 배포·실기기·정리·summary (통합)
- §8.4 절차. 정리: 구 컴포넌트·CSS 삭제(`GuestMeditationPanel`, `member-class-player.css`, `MemberMetricDial`, `MemberTrendGraph`, `MemberClassInfoCard`, `MemberProfileCard`, `MemberDeviceStrip`(미사용 확인 후)), `summary.md` 작성.

---

## 7. 테스트 인프라 (조사 결과)

### 7.1 위치·실행
| 종류 | 위치 | 실행 | 비고 |
|---|---|---|---|
| 단위·컴포넌트 | `frontend/tests/*.test.{ts,tsx,cjs}` (vitest, jsdom은 파일 상단 `// @vitest-environment jsdom`) | `cd frontend && npm test` / `npx vitest run tests/<파일>` | `fileParallelism:false`, `testTimeout:120000`(`vitest.config.ts`) |
| 브라우저 QA | `frontend/tests/*.browser.cjs` | `npm run test:browser` (`vitest.browser.config.ts`, 로컬 Chrome·앱 서버 5176 필요) | CI 기본 제외 |
| dev E2E | `frontend/e2e/{smoke,journeys,regressions,full-journey,explore}.mjs` | `E2E_PASSWORD=… node e2e/full-journey.mjs` (`BASE_URL`·`API_URL`로 대상 변경, 기본 dev) | 배포 직후 `e2e-smoke.yml`이 자동 실행 |
| 정적 검사 | CI | `npx tsc --noEmit`, `npx eslint src/`(차단), `npm run build`(차단) | `react-refresh/only-export-components` 오류 포함 |

### 7.2 dev E2E 계정·방식
- 계정(`e2e/lib.mjs`): `e2e-client@e2e.looxidlabs.com`(내담자), `e2e-counselor@…`, `e2e-orgadmin@…`, `e2e-admin@…`. 비밀번호는 환경변수 `E2E_PASSWORD`(저장소에 없음 → 로컬 실행 시 사용자에게 요청 필요).
- 기존 클래스 흐름(`full-journey.mjs`): API로 온라인 1:1 세션 생성→오픈→시작, 내담자 UI로 `/join?code=` 진입 후 "건너뛰기"류 버튼을 눌러 진행 화면 도달, 문구 `지금 나를 알려요` 단언, API로 종료.
- 가짜 미디어 기기 사용 시(`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`) 실제 LiveKit과 카메라·마이크 토글을 dev에서 검증 가능. 권한 거부는 해당 플래그 없이(헤드리스 기본 거부) 재현.
- 밴드 상태·네트워크 끊김은 dev에서 재현 불가(F15) → 하니스 경로로 검증.

### 7.3 회귀 대상 기존 테스트
`host-class-workspace.test.tsx`(16건), `member-class-player.browser.cjs`(3개 시나리오군), `quiet-signal-ui.test.ts`, `quiet-signal.test.ts`, `class-audio-sync.test.ts`, `class-join-waiting.test.ts`, `class-waiting-room*.test.ts`, `class-chat-panel.test.ts`, `class-chat-api.test.ts`, `class-onboarding-coachmarks.test.ts`, `livekit-url.test.ts`, `group-aggregate.test.ts`, `e2e/full-journey.mjs`(클래스 참여 시나리오).

---

## 8. 구현 격리·병합·배포·롤백

### 8.1 격리
- 저장소 밖 worktree 1개(`sdd/208-class-player`)에서 T0~T3 후, 회원·상담사 트랙은 각자 하위 브랜치(`sdd/208-member`, `sdd/208-host`) 또는 별도 worktree에서 작업. 병렬 워커는 서로의 worktree를 건드리지 않는다.

### 8.2 병합 순서
1. T1→T2/T3 → `sdd/208-class-player`에 병합.
2. `sdd/208-member`, `sdd/208-host`를 각각 `sdd/208-class-player`에서 분기 → 트랙 완료 후 순서 무관 병합(수정 파일 집합이 겹치지 않음).
3. I1~I3는 병합된 브랜치에서 단일 담당자가 수행.
4. `develop` 병합은 I3 통과 후 1회(커밋 태그 `feat(sdd-208):`).

### 8.3 다른 사람의 미커밋 변경과 충돌 지점
기준 시점 working tree의 미커밋 수정: `ClassPlayerPage.tsx`(헤더 버튼 이모지 → lucide 아이콘·`hcp-hbtn` 클래스), `host-class-player.css`(`.hcp-hbtn*` 규칙 추가), 그 외 `SidebarNav.tsx`·`keyboard.ts`·`package.json`(cap 스크립트)·`android/*`(이 SDD와 무관).
| 충돌 지점 | 위치 | 이유 | 처리 |
|---|---|---|---|
| `ClassPlayerPage.tsx` import | 12행(`lucide-react` import 추가) | I1에서 import 정리 | 상대방 커밋 후 리베이스 시 두 변경 병합 |
| `ClassPlayerPage.tsx` `headerControls` | 1455~1529행 | 버튼 마크업이 상대방 변경으로 바뀜. 새 뷰가 헤더를 대체 | 상대방 의도(아이콘화·`hcp-hbtn`)를 `HostLiveView` 헤더에 반영. 세팅·대기 씬 헤더는 상대방 버전 유지 |
| `ClassPlayerPage.tsx` 헤더 "나가기" | 1734~1741행 | 동일 | 동일 |
| `host-class-player.css` | 181~196행 | 이 SDD는 파일 무수정(세팅·대기 씬이 계속 사용) | **충돌 없음** |
- **처리 원칙**: ① T0에서 상대방 변경이 `develop`에 커밋되었는지 확인하고, 되었다면 그 커밋을 기준으로 worktree 생성. ② 아직이면 I1 직전에 재확인 → 이 SDD는 `ClassPlayerPage.tsx`에서 진행 중 구간(1805~1888·1924~2074행 부근)과 헤더 일부만 수정하므로 3개 hunk만 수동 병합. ③ 사용자 승인 없이 상대방 변경을 되돌리거나 덮어쓰지 않는다.
- 새 기능은 가급적 신규 파일에 두어 `ClassPlayerPage.tsx` 변경량을 최소화(F4).

### 8.4 배포 (develop 푸시 → Deploy Dev) 절차
1. I2 통과 후 `npx tsc --noEmit && npx eslint src/ && npm run build && npm test` 로컬 통과 확인.
2. `develop`에 병합·푸시 → `deploy-dev.yml`(프론트 빌드 → EC2 `dist` 교체) → 성공 시 `e2e-smoke.yml` 자동 실행(스모크·여정·회귀·전수조사).
3. 하니스 경로(`/design/class-player`)로 dev 배포본에서도 `fit.mjs` 재실행(`BASE_URL` 지정).
4. 실기기 확인(verify §7) 후 summary 작성.
- 동시 배포는 워크플로 `concurrency`로 직렬화(`cancel-in-progress:false`).

### 8.5 롤백
| 상황 | 방법 | 근거 |
|---|---|---|
| 통합 후 화면 결함 | I1 교체 커밋 `git revert` → develop 푸시 → 자동 재배포 (구 컴포넌트는 I3 전까지 저장소에 존재) | 추가 후 교체 방식 |
| 배포 스크립트 실패 | 워크플로가 이전 `dist`를 `.deploy-backup`에서 자동 복원(트랩) | `deploy-dev.yml` 0단계 백업·`rollback()` |
| 수동 재배포 | GitHub Actions `Deploy Dev` → `workflow_dispatch`(항상 develop 최신) | `deploy-dev.yml` |
- 백엔드 변경이 없으므로 DB 마이그레이션 롤백 불필요(D1 미승인 기준). 승인되어 B1~B5를 적용하면 별도 SDD로 분리하고 롤백 절차를 따로 둔다.

---

## 9. 측정 스크립트 재사용 평가 (`designs/class-player-redesign/tools/`)

### 9.1 판정
| 스크립트 | 재사용 | 수정 필요 |
|---|---|---|
| `measure-symmetry-member.mjs` | **측정 함수 재사용 가능** | ① `file://…/member.html?case=` 로딩 → 하니스 URL, ② 셀렉터가 시안 클래스명(`.ring`·`.dock`·`.media-row`·`.sheet`·`.pip`·`.mypip`·`.topbar`·`.conn`·`.fullview .fv-card`·`#app[data-place]`·`window.__ready`)에 고정 → `data-pz` 맵으로 치환, ③ 실행 브라우저 `/Applications/Google Chrome` 고정 → 번들 Chromium |
| `measure-symmetry-counselor.mjs` | 〃 | 셀렉터 `.top`·`.col`·`#sheet`·`#btn-close`·`#btn-end`·`.ttl`·`#banner`·`#head`·`#chipline`·`#gridscroll`·`#grid .tile`·`.dock .dk`·`#mstrip`·`#selfview`·`.solo .mini` 등 치환, `file://` → 하니스, `?n=`·`?sheet=`·`?detail=` 파라미터 지원 필요 |
| `member-measure.mjs` | 재사용 가능(스크롤·11px·잘림·겹침·빈 영역·호흡 문구) | 셀렉터 목록 치환 |
| `capture-*.mjs`, `build-cases-gallery.py` | 스크린샷·갤러리 용도 | 하니스 URL로 경로만 변경 시 재사용 |

### 9.2 `data-pz` 측정 훅 계약 (T2·T3·M·H 공통)
시안 클래스 `.ring`은 Tailwind 유틸리티와 이름이 겹치므로 **클래스명을 그대로 쓰지 않고** 속성으로 분리한다.
| 회원 `data-pz` | 시안 셀렉터 | 상담사 `data-pz` | 시안 셀렉터 |
|---|---|---|---|
| `topbar`·`leave`·`conn`·`title` | `.topbar`·`.topbar>.circle-btn`·`.conn`·`.title-pill` | `top`·`btn-close`·`btn-end`·`ttl` | `.top`·`#btn-close`·`#btn-end`·`.ttl` |
| `ring`·`guide`·`trend` | `.ring`·`.guide`·`.trend` | `col`·`banner`·`head` | `.col`·`#banner`·`#head` |
| `pip`·`mypip` | `.pip`·`.mypip` | `mstrip`·`selfview`·`sumpanel` | `#mstrip`·`#selfview`·`#sumpanel` |
| `media-row`·`mbtn` | `.media-row`·`.mbtn` | `chipline`·`gridscroll`·`tile` | `#chipline`·`#gridscroll`·`.tile` |
| `dock`·`dk` | `.dock`·`.dk` | `dock`·`dk`·`sheet` | `.dock`·`.dock .dk`·`#sheet` |
| `sheet`·`mcell` | `.sheet`·`.mcell` | `solo`·`mini`·`trend`·`qas` | `.solo`·`.solo .mini`·`.solo .trend`·`.solo .qas` |
| `fullview`·`fv-card`·`net-down` | `.fullview .fv-card`·`.net-down` | — | — |
- 장소 정보: 루트에 `data-place="online|offline"`(회원 MS1이 사용). 준비 완료 신호: 하니스가 `window.__ready = true` 설정.

### 9.3 실제 앱에서의 평가 방식
- **하니스 경로(결정적·전 케이스)**: 39 케이스 × 4 뷰포트(390×844, 834×1194, 1194×834, 1280×720) + 시트 변형. 서버·BLE 불필요. CI 가능.
- **실제 흐름 경로(dev)**: 가짜 미디어 플래그 + 실제 LiveKit·소켓으로 M01·M02·C01·C05 등 대표 케이스만 같은 측정 함수 실행(밴드 상태는 재현 불가이므로 제외).
- 폰트: 레이아웃 수치가 폰트에 의존하므로 측정 환경에서 Pretendard 로딩 여부를 고정(`mb-tokens.css`는 외부 폰트 로딩 — 오프라인 CI에서는 대체 폰트가 쓰일 수 있음). 측정 실행 전 `document.fonts.ready` 대기 + 폰트 소스 확인 → **확인 필요**.

---

## 10. 리스크

| # | 리스크 | 영향 | 완화 |
|---|---|---|---|
| R1 | **회원 카메라 기본 꺼짐**으로 현행 1:1 상담 경험 변경(상담사는 회원 얼굴을 못 봄) | 사용자 체감 | 결정 #1 반영, 상담사 화면 "회원 영상 자리는 회원이 켠 경우에만" 문구, 회원 화면에 켜기 버튼 상시 노출 |
| R2 | 오프라인 회원 상담사 영상 제거(D2) | 기존 오프라인 수업 기능 축소 | D2 확정 전 구현 보류 항목으로 표시 |
| R3 | 회원 마이크 꺼짐 문구가 사실과 다름(F8·D4) | 신뢰·개인정보 안내 | D4 확정, 상담사 측만 "기록 일시정지"와 연동 |
| R4 | `useBand` 인스턴스 중복 시 BLE 연결·업로드 충돌(`useBand.ts:77` 주석) | 밴드 데이터 유실 | 컨테이너에서만 호출, 뷰는 props 전용, 시트가 `useBand`를 직접 부르지 않음 |
| R5 | `LiveKitRoom` 재마운트(권한 변경)로 카메라 선호 소실·영상 끊김 | M04·발언권 흐름 | 선호 상태를 컨테이너에 보관, 재마운트 후 재적용 테스트 |
| R6 | 호스트 영상 녹화의 오디오 트랙이 훅 생성 시점에 고정 | C09 마이크 끄기 시 영상 녹화 음성 처리 | H4 실측 후 방식 확정(확인 필요) |
| R7 | 기존 `full-journey.mjs` 문구 단언이 깨져 배포 후 스모크 실패 | CI 알림 | I1에서 단언 교체(새 도크 라벨 기준), 회귀 표에 포함 |
| R8 | 측정 환경 폰트·렌더 차이로 ±2px 판정 흔들림 | 위반 오탐 | 측정 시 폰트 고정, 최종 판정은 실기기 시각 확인 병행 |
| R9 | 11px 이하 글자·44px 미만 터치가 재사용 컴포넌트(`ChatRoom`·`MemberRawData`·`SpeakingRightsPanel`)에 존재 | 공통 합격 기준 위반 | 시트 안 재사용 시 래핑 CSS로 하한 적용, 불가하면 해당 컴포넌트 최소 수정(소유자 S 경유) |
| R10 | 진행 중 BGM 정책·`ENABLE_STT_AI_RECORD=false`와 시안 문구 충돌 | 문구 오안내 | D3·D4 |
| R11 | 대기열 승격 감지 폴링의 부작용(`join` 재호출 시 참가자 변경 알림) — 확인 필요 | 서버 부하·상담사 화면 깜빡임 | B3 승인 시 필드 추가로 대체 |
| R12 | 하니스 라우트가 prod 번들에 포함 | 픽스처 노출(민감 정보 없음) | `/design/*` 선례 준수, 필요 시 `import.meta.env.MODE`로 비활성(확인 필요) |
| R13 | `ClassPlayerPage.tsx` 병합 충돌(§8.3) | 일정 | 변경 구간 최소화, I1 직전 재확인 |
| R14 | 비호스트(org_admin) 분기 구 UI 잔존(D11) | 화면 불일치 | 범위 제외로 명시, summary에 후속 과제 기록 |
