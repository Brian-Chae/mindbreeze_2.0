# I5 밴드·전극(A8) — 코드 조사

조사 기준: develop `32fa5533`, 조사일 2026-10-17. 경로는 프론트 `frontend/src/`, 백엔드 `backend/app/` 기준 상대경로. 읽기 전용 조사이며 코드·시안은 수정하지 않았다.

## 0. 한 줄 결론

1. **회원 본인 화면의 전극별(L·R) 접촉 판정은 이미 있다.** SDK 콜백 → `useBand.leadOff {ch1,ch2}` → `SensorTracker` 입력까지 연결돼 있다. 그러나 `SensorTracker`·`LeadOffModal`은 지금 **어떤 화면에서도 렌더되지 않는 죽은 코드**다(유일한 사용처 `GuestMeditationPanel`을 SDD-208이 교체함).
2. **상담사 화면까지 전극별 접촉은 가지 않는다. 기획 §9 A8의 "구현 확인" 가정은 코드와 다르다.** 프론트는 WS `feature` emit에 `lead_off`를 싣지만 백엔드 `on_feature`가 읽지 않는다. 백엔드의 `device_status`는 하드웨어 접촉이 아니라 **SQI(≥0.7→ok, 그 외→lead_off) + 10초 staleness**로 따로 산출한다. L/R 구분 필드는 백엔드 전체에 한 줄도 없다(`ch1|ch2|lead_off_|leadoff` grep 0건).
3. **대기실(로비) 회원의 접촉 정보는 상담사에게 갈 경로가 사실상 없다.** presence(`waiting_room`)의 `readiness`는 boolean 3개뿐이고, EEG feature 업로드는 밴드 단계 탭이 마운트된 동안만 돈다. 또 초대 회원은 `consent_eeg=False`라 업로드가 거부된다.
4. 최소 백엔드 변경안: (a) presence 에 선택 필드 `band` 추가(메모리 중계, DB 없음), (b) `on_feature` 가 `lead_off` 를 받아 `eeg_feature` 중계 payload 에 싣기(메모리, DB 없음). **마이그레이션 불필요.**
5. `linkband_mode` 는 대기실에 전달되지 않는다(`ClassWaitingRoom` props 에 없음). 게이트는 모드와 무관하게 밴드 단계 통과(연결 또는 건너뛰기)를 요구하므로 `none` 에서도 단계가 보인다. `required` 강제는 프론트·백엔드 어디에도 없다.
6. `deriveBandUi`(SDD-208)는 사전 흐름에서도 재사용 가능하지만 **L/R 분할, 연결 실패(`error`), 접촉 미확인(unknown)** 을 구분하지 못해 얇은 래퍼가 필요하다.

## 1. 현재 코드 상태

| 항목 | 판정 | 근거 |
|---|---|---|
| 회원 본인 전극별 접촉(ch1/ch2) 수신 | 있음 | `lib/eeg/bluetoothService.ts:642-647`(패킷마다 최신 샘플 leadoff_ch1/ch2 콜백) → `hooks/useBand.ts:1096-1104` |
| `useBand` 반환 `leadOff: LeadOffStatus\|null` | 있음 | `hooks/useBand.ts:190`, 반환 `:1453`; 타입 `lib/eeg/types/eeg.ts:99-102`(true=분리) |
| 접촉 요약 `deviceStatus`(ok/lead_off/disconnected/unknown) | 있음 | `hooks/useBand.ts:467-470` → `lib/session-live/signal-status.ts:65-72` |
| `SensorTracker`(L·기준·R LED) | 있음, **미사용** | `components/class/SensorTracker.tsx`; import 는 `LeadOffModal.tsx:5` 한 곳 |
| `LeadOffModal` | 있음, **미사용** | import 는 `GuestMeditationPanel.tsx:27,778` 한 곳. `GuestMeditationPanel` 은 어디에서도 import 되지 않음(`tests/member-session-scene.test.tsx:16`이 "쓰지 않음"을 단언) |
| SDD-208 진행 화면의 접촉 불량 시트가 SensorTracker 사용 | 아니오 | `components/class/player/member/MemberSheets.tsx:266-282`는 텍스트 3단계 + 버튼만. `MemberClassContainer.tsx:364-376` 의 `device` 객체에 `leadOff` 없음 |
| 기준 전극에 독립 상태 | 없음(파생) | `SensorTracker.tsx:19` `refOk = leftOk && rightOk`; 시안도 동일(`member-b.html:395`, `host-b.html` `leadOk()` 의 `ref: l && r`) |
| 프론트 → 서버 WS emit 에 `lead_off` 포함 | 있음 | `hooks/useBand.ts:494-505`(`device_status`, `lead_off`, `signal_quality_level`), 타입 `lib/socket.ts:148-162`(`lead_off` `:158`) |
| 백엔드 `on_feature` 가 `lead_off`/`device_status` 수신 | **없음** | `ws/session_live_namespace.py:587-690` 은 `session_id, participant_id, stream_id, sequence, feature` 만 읽음. 파일 내 `lead_off` 문자열은 docstring 두 곳(`:16,:25`의 이벤트 이름)뿐 |
| REST 폴백/큐 재전송에 접촉 포함 | 없음 | `hooks/useBand.ts:529-536` 은 `{participant_id, features}` 만. 큐 항목은 `leadOff` 를 들고 있지만(`lib/session-live/feature-queue.ts:23-24`) REST 로는 안 감 |
| 백엔드 `device_status` 산출 방식 | SQI 파생 | `services/session_service.py:2424-2439`(`_device_status_live`: stale→disconnected, null→unknown, ≥0.7→ok, 그 외→lead_off); 사용처 `:2497`, `:2220-2222`(게스트 상태); 테스트 `tests/test_sdd026_live_session_p0.py:18`("SQI 0.5 → lead_off, 0.9 → ok") |
| `device_status` 값 집합 | 전극 구분 없음 | `schemas/session.py:333` `Literal["ok","lead_off","disconnected","unsupported","unknown"]`. 백엔드가 실제로 내는 값은 ok/lead_off/disconnected/unknown(`unsupported` 는 산출 경로 없음) |
| `eeg_feature` WS(호스트 룸) payload | `lead_off` 없음 | `ws/session_live_namespace.py:991-1002` + 호출부 `:679-688`: `{participant_id, feature, saved}`. 프론트 타입은 `lead_off`/`device_status` 를 기대(`lib/socket.ts:349,347`)하지만 서버가 안 보냄 |
| `device_status_changed` WS payload | 접촉 없음 | `services/session_service.py:2691-2710`: `participant_id, band_connected, band_battery, version` 뿐. 프론트 타입은 `device_status`, `lead_off` 등을 기대(`lib/socket.ts:264-275`) |
| 호스트 라이브 행의 접촉 | SQI 파생 + 4초 폴링 | `pages/sessions/ClassPlayerPage.tsx:105`(4000ms), `:935-936` 응답으로 `metrics` 전체 교체; 호스트 밴드 상태 `components/class/player/host/host-live-model.ts:41-45` |
| 대기실 presence payload | boolean 3개 | `lib/socket.ts:236-240`(`surveyDone/bandDone/deviceDone`); 서버 `_sanitize_readiness` `ws/session_live_namespace.py:1412-1417`(boolean 세 키가 모두 있을 때만 통과); 테스트 `tests/test_class_waiting_room_presence.py:226` |
| 밴드 연결 vs 건너뜀 구분(호스트가 알 수 있나) | 없음 | `bandDone` 은 연결 후 "기기 테스트로" 클릭 또는 "밴드 없이 진행하기" 둘 다 true(`components/class/WaitingRoomBandCheck.tsx:117-121`). 건너뜀 상태는 `ClassWaitingRoom.tsx:86` 로컬 state |
| 로비 중 밴드 EEG 업로드 지속 | 일부 | 밴드 단계 탭이 마운트된 동안만(`ClassWaitingRoom.tsx:443` `activeStep === 1`, 훅 언마운트 시 수집 중단 `hooks/useBand.ts:1410-1437`). 다음 단계로 가면 BLE 는 유지되지만 업로드는 멈춤 |
| 초대 회원의 EEG 업로드 자격 | 막힘 | `services/session_service.py:2507-2517` `_assert_upload_eligible`(consent_eeg=False 거부); `consent_eeg=True` 가 되는 곳은 코드 참여 경로뿐(`:1594,1614,1618,1669`) |
| `linkband_mode` 세션 DTO | 있음 | `lib/api/session.ts:24,66,150`(`'none'\|'required'\|'optional'`); 백엔드 `schemas/session.py:17,34,168,239`, `models/session.py:61` |
| 대기실에 `linkband_mode` 전달 | **없음** | `ClassWaitingRoomProps`(`ClassWaitingRoom.tsx:33-55`)에 없음. `pages/class-join-page.tsx:547` 대기실 호출에 미전달(진행 화면 `:508` 에는 전달) |
| `required` 강제 | 없음 | 백엔드는 리마인더 문구에만 사용(`services/reminder_service.py:118`, `agent_reminder.py:158`). 프론트 게이트는 모드 무관(`lib/class/class-waiting-room.ts:86`) |
| 미지원 브라우저 판정 | 있음 | `lib/ble/index.ts:4-6`(`isNativeApp() \|\| 'bluetooth' in navigator`), `useBand.ts:332,335` |
| Capacitor 앱의 `isSupported` | 정적으로 true | `lib/ble/index.ts:5`, 어댑터 선택 `:8-14`. 실기기 동작은 미확인 |

## 2. 상세 조사

### 2.1 `useBand` 반환 필드와 접촉 상태의 계산 위치

반환 타입 `UseBandResult`는 `hooks/useBand.ts:179-236`, 실제 반환은 `:1445-1482`.

| 필드 | 의미·출처 |
|---|---|
| `isSupported` / `isMock` | `isMock \|\| isBleSupported()` (`:331-332`). mock 은 `VITE_USE_MOCK_EEG=true` 또는 `forceMock` |
| `connectionState` | `'unsupported'\|'disconnected'\|'connecting'\|'connected'\|'error'` (`:151-156`). 초기값은 미지원이면 `unsupported`, 전역 BLE 가 이미 살아 있으면 `connected` (`:334-339`) |
| `battery` | 연결 직후 `getBatteryLevel()`(`:1149-1155`) + 스트림의 `updateBatteryData` 콜백(`:1135-1142`). 0~100, 미상 null |
| `signalQuality` / `signalQualityLevel` | SQI. 분석 결과(`ingestMetrics`, `:718-719`)에서 갱신. `ok/degraded/invalid/unknown`(`signal-status.ts:44-52`, 임계 0.7/0.4) |
| `deviceStatus` | `deviceStatusFromLeadOff(connected, leadOff)`(`:467-470`). 미연결 `disconnected`, leadOff 미수신 `unknown`, ch1\|\|ch2 → `lead_off`, 아니면 `ok` |
| `leadOff` | `{ch1,ch2}` true=분리. **SDK 콜백 raw 가 그대로 들어온다**(`:1096-1104` `onSensorContactChanged(ch1, ch2)`). 계산 단계 없음 |
| `sensors` | `sensorFromLeadOff`(`:246-265`)로 `leftElectrode=ch1`, `rightElectrode=ch2` 매핑. playground 용 |
| `lastEegAt` | 분석 갱신 시각 ISO(`:720`). stale 판정은 `EEG_STALE_MS=10000`(`signal-status.ts:16`) |
| `pendingCount` / `uploadStatus` / `isWsConnected` / `error` | 영속 큐 미확정 수 / 업로드 상태 / `/session-live` 연결 / 오류 문자열 |
| `connect()` / `disconnect()` | 연결·해제. 사용자 취소("디바이스 선택이 취소되었습니다", `lib/eeg/bluetoothService.ts:436-441`)도 `catch`(`useBand.ts:1184-1190`)에서 `connectionState='error'` + `error` 문자열이 된다 → 취소와 실패를 구분하려면 메시지 문자열 비교뿐이다(취약) |

접촉 경로: SDK 패킷(`parseEEGPacket`) → `handleEEGData`(`bluetoothService.ts:633-651`)가 마지막 샘플의 `leadoff_ch1/ch2` 를 콜백 → `useBand` 가 `leadOffRef`/`leadOff` state 에 저장. 같은 값이 `StreamProcessor.ts:285-302` 에서 `calculateEEGSignalQuality`(둘 다 분리 0 / 하나 0.5 / 정상 1.0, `:482-486`)에도 쓰인다. 단 서버로 가는 feature 의 `signal_quality` 는 `analysis.getLatestEegFeature().signalQuality`(`useBand.ts:1114`)에서 오며, 이것이 위 `calculateEEGSignalQuality` 와 같은 값인지는 **미확인**.

ch1 = 왼쪽, ch2 = 오른쪽 매핑(`useBand.ts:256-257`, `SensorTracker.tsx:17-18`)이 실제 기기 이마 위치(FP1/FP2)와 일치하는지는 SDK 문서를 확인하지 못해 **미확인**.

**인스턴스 1개 규칙**(`useBand.ts:73-82`): 훅 상태(스트림·큐·타이머)는 인스턴스마다 따로 살고 BLE 연결만 singleton 이다. 주석에 거론된 호출처는 `WaitingRoomBandCheck`, `GuestMeditationPanel`, `PlaygroundPage`, `ClassPlayerPage`. 지금 실제 호출처는 `WaitingRoomBandCheck.tsx:37`, `MemberClassContainer.tsx:178`, `ClassPlayerPage.tsx:631`(상담사 본인 밴드), `pages/playground/PlaygroundPage.tsx:37`, 그리고 미사용 `GuestMeditationPanel.tsx:309`. 모듈 변수 `activeBandOwners`(`:82`)는 dev 경고용, `bandConnectInFlight`(`:83`)는 동시 `connect()` 차단용이다.

**함의(사전 흐름 설계)**: 현재 밴드 단계는 탭이 활성일 때만 마운트(`ClassWaitingRoom.tsx:443`)되어, 단계를 넘기면 `useBand` 가 언마운트되고 수집·업로드·접촉 표시가 모두 멈춘다(BLE 는 유지, `:1434-1436` 주석). 새 마법사에서 FM06c 접촉 불량 → FM06e 요약("연결됐어요 · 접촉 양호") → FM07 대기까지 밴드 상태를 보여 주려면 **`useBand` 를 마법사 컨테이너 한 곳에서 한 번만 호출**하고 하위 단계에 props 로 내려야 한다. 재마운트 시 `leadOff`(null)·`battery`(null)는 첫 패킷·배터리 읽기 전까지 비어 있다(`:1225-1230` 은 BLE 가 살아 있으면 `connect()` 로 스트림만 재시작).

### 2.2 `SensorTracker` / `LeadOffModal`

**입력 props**: `SensorTracker({ leadOff: LeadOffStatus | null, className? })` (`SensorTracker.tsx:7-10`). `LeadOffModal({ isVisible, leadOff, onDismiss })` (`LeadOffModal.tsx:7-11`).

**LED 의 의미**(`SensorTracker.tsx:17-19, 29-52`):
- 왼쪽 LED = `!leadOff.ch1`, 오른쪽 LED = `!leadOff.ch2`.
- **기준 LED 는 독립 상태가 없고 `leftOk && rightOk` 로 파생**된다. 즉 한쪽만 불량이어도 기준도 빨강이 된다. 시안 FM06c(`member-b.html:395`)·FH06(`host-b.html` `leadOk`)도 같은 규칙이라 시안과 일치한다. → 서버로 보낼 값은 `ch1`, `ch2` 두 개면 충분하다.
- 도형은 4개다(L 사각형 `:30-32`, 기준 사각형 `:33-35`, 가운데 기준 모양 `:44-48`, R 사각형 `:36-38`). 기준 사각형과 가운데 모양이 같은 `refOk` 를 쓴다. 시안도 `data-led="ref"` 그룹에 두 도형을 묶는다 → 논리 LED 3개, 도형 4개.
- **`leadOff === null` 이면 세 LED 모두 빨강**(`:17-19`: `leadOff ? !leadOff.ch1 : false`). 연결 직후 첫 패킷 전(`deviceStatus === 'unknown'`)에 그리면 거짓 "접촉 실패"가 보인다 → 3상태(양호/불량/미확인) 처리가 필요.
- **색만, v/x 아이콘 없음**(결정 2와 일치). 단 컴포넌트 안에 색 외 정보는 SVG 의 `L`/`R` 글자(`:49-54`)와 하단 범례 "접촉 양호/접촉 실패"(`:57-72`)뿐이다. SVG `aria-label` 은 고정 문구 "LINK BAND 센서 접촉 상태"(`:28`)라 전극별 상태를 읽어 주지 않는다. 시안은 SVG `aria-label` 에 왼쪽·기준·오른쪽 양호/실패를 넣고 LED 아래에 "왼쪽 양호/기준 양호/오른쪽 실패" 글자 줄을 둔다(`member-b.html:396-405`).
- **색 토큰**: 양호 `var(--mb-mint)` = `#01F0C8`(`mb-tokens.css:34`), 불량 `var(--mb-danger-deep)` = `#D33F3F`(`mb-tokens.css:80`). 외곽선 `#353842`/`#606276`/글자 `#EFEFEF` 는 하드코딩. 시안 값과 동일(`host-b.html:88` `.w-led.ok/.bad`, `member-b.html:395`). `--mb-mint` 는 SDD-208 `player-tokens.css:10` 에도 있어 소프트 시트 위에서 그대로 쓸 수 있다.
- 폭은 `width="288" height="64"` 고정(`:21-22`). viewBox 가 있어 `width:100%; max-width:288px` 로 바꾸면 390px 뷰포트에도 맞는다.

**`LeadOffModal`**: 검정 전체 화면 모달 + "무시하기"(`LeadOffModal.tsx:36-72`)로 새 디자인(소프트 시트·카드)과 맞지 않는다. 새 FM06c 는 모달이 아니라 카드 안에 `SensorTracker` 를 넣는다. 모달은 재사용하지 않고 삭제 대상.

**재사용 위치**: SDD-208 `components/class/player/member|host` 는 `SensorTracker` 를 쓰지 않는다. 상담사 본인 밴드 시트(`HostSelfBand`)도 접촉을 문자열(`contactLabel`)로만 받는다(`HostLiveContainer.tsx:226-238`, `ContainerBand` 에 `leadOff` 필드 없음 `:58-67`). 시안 FH06a `band-bad-l/r/lr`(상담사 **본인** 밴드)는 `ContainerBand` 에 `leadOff` 를 추가하면 **백엔드 없이** 구현된다.

### 2.3 상담사 화면까지 전극별 접촉이 가는가 — 경로별 필드 단위 확인

| 경로 | 프론트(전송) | 백엔드(수신·저장·중계) | 전극별(L·R) |
|---|---|---|---|
| WS `feature` emit | `lead_off{ch1,ch2}`, `device_status`, `signal_quality_level`, `band_battery`, `feature{...,signal_quality, band_battery}` (`useBand.ts:494-505`, `lib/socket.ts:148-162`) | `ws/session_live_namespace.py:587-690` 은 `feature` 안쪽만 `EEGFeatureItem.model_validate`(`:965-984`) 후 저장. **top-level `lead_off`/`device_status` 는 버림** | 서버 도달 전 소실 |
| REST `POST .../features` 폴백 | `{participant_id, features[]}` (`useBand.ts:529-536`) | `EEGFeatureItem` 필드만. 접촉 없음 | 없음 |
| 서버 → 호스트 `eeg_feature` | (수신) `SessionLiveEegFeatureEvent` 가 `device_status`, `lead_off`, `band_connected` 를 기대(`lib/socket.ts:347-349`) | 실제 payload `{session_id, participant_id, feature, saved}` (`ws/...:679-688`, `:991-1002`) | 없음 |
| 서버 → 호스트 `device_status_changed` | (수신) `DeviceStatusChangedEvent` 가 `device_status, lead_off, signal_quality…` 기대(`lib/socket.ts:264-275`); 핸들러 `ClassPlayerPage.tsx:741-` | 실제 payload `{participant_id, band_connected, band_battery, version}` (`services/session_service.py:2696-2707`). 발행 시점은 feature 저장 중 연결 전이 또는 배터리 값 존재 시(`:2679-2688`) — 매 feature 마다 배터리가 실려 사실상 저장 배치마다 발행 | 없음 |
| REST `GET /sessions/{id}/live-metrics` | (수신) `SessionLiveMetric.device_status` (`lib/api/session.ts:196-233`) | `get_live_metrics`(`services/session_service.py:2051-2150`) → `_aggregate_window_stats`(`:2442-`) → `_device_status_live`(SQI). `schemas/session.py:342-375` 에 L/R 필드 없음 | 없음 |
| join snapshot | `SessionLiveJoinSnapshot.participants: SessionLiveMetric[]` (`lib/socket.ts:174-186`) | 호스트 snapshot 은 위 `get_live_metrics` 와 동일 계열 | 없음 |
| presence `waiting_room` | `{session_id, action, nickname, checkin, readiness}` (`hooks/useWaitingRoomPresence.ts:69-80`) | `_sanitize_readiness`: boolean 3개만(`:1412-1417`), 호스트 룸으로 `waiting_room_changed` 중계(`:752-788`, `:1078-1091`), **저장 없음**(휘발) | 없음 |

DB 저장: 접촉 컬럼은 없다. `SessionParticipant`(`models/session.py:113-115`)에는 `band_connected`, `band_battery` 만, `EEGFeatureWindow` 에도 접촉 컬럼이 없다(`models/eeg_feature.py` 에 `lead_off` 관련 grep 0건).

**의미 불일치(주의)**: 프론트는 "접촉(LeadOff)은 SQI 로 추정하지 않는다"(`signal-status.ts:63-64`, `apply-eeg-feature.ts:73`)고 쓰고 있으나, 서버 `device_status` 는 SQI 0.4~0.7(`degraded`)도 `lead_off` 로 판정한다(`session_service.py:2437-2439`). 따라서 상담사 화면의 "접촉 불량"은 하드웨어 접촉 불량이 아니라 신호 품질 저하까지 포함한다. 회원 본인 화면(하드웨어 `leadOff`)과 상담사 화면(SQI 파생)이 같은 단어로 서로 다른 것을 가리킨다.

**대기실(로비) 시점 경로 — 사실만**:
1. presence: `readiness` boolean 3개뿐. 접촉·연결·배터리 정보 없음. 밴드 연결/건너뜀 구분도 없다(`bandDone` 하나).
2. feature 업로드: 밴드 단계 탭이 마운트된 동안(`WaitingRoomBandCheck.tsx:37-42` 의 `useBand({enabled: Boolean(sessionId && participantId)})`)만 올라간다. 단계를 넘기면 멈추고, 호스트 쪽 `device_status` 는 10초 후 `disconnected`, `hostBandOf` 는 `lost`(`host-live-model.ts:34-45`)가 된다. 즉 **밴드를 연결하고 다음 단계로 간 회원이 상담사 로비에는 "수신 끊김"으로 보일 수 있다.**
3. 서버 저장 자격: `_assert_upload_eligible`(`session_service.py:2507-2517`)이 `consent_eeg=False` 를 거부한다. 호스트가 초대한 참가자는 `consent_eeg=False` 로 남고(`:1586-1588` 주석), `True` 로 바꾸는 곳은 코드 참여 경로(`:1594,1614,1618,1669`)뿐이다. 결정 1(코드 제거)로 이 경로가 사라지면 **새 동의 저장 경로(FM06a, A1)가 `consent_eeg=True` 를 세팅해야** 로비·진행 중 업로드가 열린다. → I1/A1 과 겹침(사실만 기재).
4. 호스트 로비 행은 `get_live_metrics`(active 참가자)와 presence entries 가 `participant_id` 로 조인 가능하다(`useWaitingRoomCount.ts:29-34`, 서버 `session["participant_id"]` 사용 `ws/...:781`).

### 2.4 전극별 접촉이 상담사에 안 가므로 — 변경 범위

#### 백엔드 최소안 A: presence 에 `band` 선택 필드 추가 (로비 용, 필수)

- 이유: 로비 접촉은 업로드 파이프라인(동의·탭 마운트·참가자 행)에 의존하지 않고 가장 단순하게 흘릴 수 있다. DB·마이그레이션 없음. 기존 휘발 중계 구조(heartbeat 15초, TTL 45초, `useWaitingRoomCount.ts:19-20`)를 그대로 쓴다.
- 클라이언트 emit(`waiting_room`) 추가 키:
  ```
  band?: {
    state: 'idle' | 'connecting' | 'connected' | 'skipped' | 'unsupported' | 'error',
    lead_off: { ch1: boolean, ch2: boolean } | null,   // connected 이고 첫 패킷 이후에만 값
    battery: number | null                             // 0~100 정수, 미상 null
  } | null
  ```
- 서버: `_sanitize_band_presence(value)` 신설(상태 6값 화이트리스트, `lead_off` 는 두 값이 실제 bool 일 때만, `battery` 는 0~100 정수만, 아니면 None) → `waiting_room_changed` 의 `band` 로 중계. `_sanitize_readiness`(boolean 3개 고정, 테스트 `test_class_waiting_room_presence.py:226`)는 **그대로 두고** 새 키를 옆에 둔다.
- 기본값: 키 없음/None = 정보 없음(기존 동작).
- 구 클라이언트 호환: 구 클라이언트는 키를 보내지 않음 → `band: null`. 구 서버 + 신 클라이언트: 서버가 지정된 키만 읽으므로 새 키는 조용히 무시(오류 없음, `ws/...:752-788`). 신 호스트 + 구 서버: `band` 가 안 와 `null` → 시안의 `bad/skip` 셀 대신 기존 boolean 셀 표시(프론트가 null 을 폴백 처리).
- 프론트 전송 빈도: 변화 시 즉시(디바운스 ~1초) + 기존 15초 heartbeat에 동봉. `useWaitingRoomPresence.ts:105-119` 의 `readinessKey` 직렬화 패턴에 `band` 를 합치면 된다(플리커 방지 주석 FE-PRESENCE-001).
- 분류: **필수**(시안 FH06 `-contact` 와 로비 `밴드` 셀의 `skip/bad` 를 그대로 구현하려면). 아니면 보류 + 프론트 대체안.

#### 백엔드 최소안 B: 진행 중 `lead_off` 중계 (권장)

- `on_feature` 가 top-level `lead_off`(두 값이 실제 bool 일 때만)를 `_store_feature` 결과와 함께 `broadcast_session_eeg` payload 에 `lead_off` 로 싣는다(`:679-688`). 프론트 수신 타입은 이미 있다(`lib/socket.ts:349`). 프론트 `apply-eeg-feature.ts` 가 `lead_off` 를 행에 보관하도록 확장(`SessionLiveMetric.lead_off?` 추가).
- **폴링 덮어쓰기 주의**: 호스트는 4초마다 `getSessionLiveMetrics` 응답으로 `metrics` 를 통째로 교체한다(`ClassPlayerPage.tsx:935-936`). WS 로 받은 `lead_off` 는 다음 폴링에서 사라진다. 해결 둘: (1) 서버가 `(session_id, participant_id) → (lead_off, 시각)` 을 프로세스 메모리에 보관하고 `get_live_metrics` 행·join snapshot 에 포함(기존 패턴: 무음 시그널 `_active_signals` `ws/...:321-359`, TTL 정리), (2) 프론트가 `participant_id` 별 마지막 `lead_off` 를 ref 로 보관해 폴링 결과에 다시 합침(백엔드 REST 변경 없음). **권장은 (2)**(프로세스 수에 영향받지 않음). 메모리 보관 방식은 uvicorn 워커 수가 미확인이라 다중 프로세스에서 일관성을 보장하지 못한다(Socket.IO 는 Redis manager 지원 `ws/__init__.py:70-85`, API 프로세스 수는 `deploy/`에서 확인 불가).
- 기본값: `lead_off: null`. 구 클라이언트(필드 없음) → null. 신 클라이언트 + 구 서버 → 현행과 동일(무시).
- 마이그레이션: **불필요**(휘발). 영속이 필요하면 `EEGFeatureWindow` 에 컬럼 2개(`lead_off_ch1`, `lead_off_ch2` nullable bool) + Alembic 수동 리뷰 — **보류 권장**(상담사 화면 표시 용도에 영속 불필요, 과거 세션은 값 없음=null 로 읽기 호환).
- 분류: **권장**(진행 중 상담사 참가자 상세에서 L/R 이 필요할 때). FH06/FH06a 시안 범위는 로비 + 본인 밴드라 필수는 A만이다.

#### 보류

- DB 영속(위). 
- 서버 `device_status` 를 하드웨어 `lead_off` 로 교정(SQI 와 분리): 의미 불일치는 있으나 SDD-026 안정 동작·테스트(`test_sdd026_live_session_p0.py:18`)에 묶여 있어 SDD-209 범위 밖. **사용자 결정 후보**(§5).

#### 프론트만으로 가능한 대체안

1. **회원 본인 화면(FM06c)**: 전체 가능(`useBand.leadOff` 로컬). 백엔드 불필요.
2. **상담사 본인 밴드(FH06a band-bad-*)**: 가능. `ContainerBand`(`HostLiveContainer.tsx:58-67`)에 `leadOff` 추가 + `HostSelfBand` 시트에 `SensorTracker`.
3. **상담사 로비 행(FH06 `-contact`)**: 백엔드 없이는 L/R LED 불가. 대체: 접촉 불량 **여부만** 표시 — 로비 행을 `get_live_metrics` 의 `device_status === 'lead_off'`(SQI 파생)와 조인해 "접촉 불량" 셀만 표시하고 L/R LED 는 회원 본인 화면에서만 보여 준다. 한계: 회원이 밴드 단계에서 머무는 동안만 값이 갱신되고(위 2.3의 2), 초대 회원은 동의 전 업로드 거부, `skip`(건너뜀)과 `연결됨` 구분 불가.
4. 최소 대체: 현행 boolean `bandDone` 셀(✓/○)만 유지하고 접촉 정보는 표시하지 않는다.

### 2.5 `linkband_mode` 가 대기실에서 반영되지 않는 문제

- 세션 DTO 필드: `linkband_mode: 'none' | 'required' | 'optional'` (`lib/api/session.ts:24,66`, `SessionByCodeResponse :150`). 백엔드 기본값은 `"none"`(`schemas/session.py:34`)인데 상담사 생성 화면 기본값은 `'optional'`(`pages/sessions/SessionCreatePage.tsx:32`) — 필드를 안 보내는 API 호출로 만든 세션은 `none` 이 된다.
- 현재 대기실: `ClassWaitingRoom` 은 모드를 모른다. 밴드 단계는 모드와 무관하게 항상 렌더(`:443`)되고 "선택" 배지가 고정(`WaitingRoomBandCheck.tsx:54-57`), 게이트는 `bandDone` 을 항상 요구(`class-waiting-room.ts:86`) → `none` 모드에서도 회원이 "밴드 없이 진행하기"를 눌러야 입장 게이트가 열린다. `required` 모드도 동일하게 건너뛸 수 있다.
- 진행 화면은 이미 모드를 쓴다: `MemberClassContainer.tsx:42,76,330`(`bandEnabled = linkbandMode !== 'none'`), `class-join-page.tsx:508`.
- **필요한 변경(프론트)**:
  1. `pages/class-join-page.tsx:547` → `MemberWaitingScene`(`components/player/MemberWaitingScene.tsx`) → `ClassWaitingRoomProps` 에 `linkbandMode: LinkbandMode` 추가(진행 화면 `:508` 과 동일 출처 `session.linkband_mode`).
  2. 단계 목록을 순수 함수로(예: `buildPrepSteps({ place, linkbandMode })` → intro·status·band?·device?·done). 시안 주석: 온라인 5단계 / 오프라인 4단계 / 사용 안 함이면 밴드 단계 없음(`member-b.html:552`).
  3. `resolveWaitingRoomGate` 입력에 `linkbandMode` 추가: `none` → 밴드 항목 면제(`bandDone` 자동 true), `optional` → 연결 또는 건너뛰기, `required` → 연결 필요(정책 §5).
  4. 밴드 카드 모드별 문구/버튼(시안 FM06c): `optional` "밴드 없이 계속하기" 고스트 버튼, `required` "이 클래스는 연결해야 입장할 수 있어요" 안내문, 접촉 불량 시 기본 버튼 비활성 + "전극이 모두 닿으면 자동으로 이어져요", 미지원 시 `required` 는 "링크 복사하기"(`member-b.html:431-433`).
  5. `linkband_mode='none'` 에서 밴드 UI 전체 숨김: 단계, FM06e 요약의 "LINK BAND" 행(시안은 `사용 안 해요`로 행을 남김 `member-b.html:~492`), FM07 칩("LINK BAND 사용 안 함")은 시안에 정의돼 있으므로 숨김이 아니라 **문구 표시**임에 유의. 상담사 `readiness` 에서도 `bandDone` 셀 제외(호스트는 `session.linkband_mode` 로 판단, 백엔드 변경 불필요).
- **required 일 때 입장 게이트·시작 판정**: 프론트 게이트로 막는 것이 시안(필수 모드 FM06c·FM07 `on-group-req-member`)의 의도다. 서버 측 강제(참가자 `band_connected` 검사, 시작 판정 포함)는 현재 없다. 확정 결정 5(상담사는 준비 안 된 회원이 있어도 시작 가능, 시작 후 입장해 준비를 이어서)와의 정합 문제: 필수 모드에서 밴드 미연결 회원이 시작 후에도 입장 가능한가는 **정책 결정 후보**(§5).

### 2.6 사전 흐름의 밴드 상태 판정 — `deriveBandUi` 재사용성

`lib/class/player-case.ts:29-47` `deriveBandUi(input, nowMs)` 우선순위: `unsupported` > `pending`(연결 중, 연결 이력 있으면 `lost`) > `leadoff`(`deviceStatus==='lead_off'`) > `lost`(stale 10초 / 미연결+이력) > `off`(미연결+이력 없음) > `weak`(SQI degraded|invalid) > `low`(배터리 ≤25%) > `on`. 입력 `BandInput` 은 `useBand` 출력 + `everConnected`(컨테이너가 보관 `MemberClassContainer.tsx:184-187`) 뿐이므로 **같은 함수를 사전 흐름에서도 그대로 쓸 수 있다.** 단 시안 FM06c 상태와 대응시키면 빈틈이 있다.

| FM06c 상태(시안 케이스) | `useBand` 값 조합 | `deriveBandUi` 결과 | 빈틈 |
|---|---|---|---|
| idle(연결 안 됨) | `connectionState==='disconnected'`, `everConnected=false` | `off` | 없음 |
| connecting | `connecting`, `everConnected=false` | `pending` | 이력 있으면 `lost`(재연결 중) → 마법사 문구 분기 필요 |
| connected | `connected`, `deviceStatus==='ok'` | `on`(또는 `weak`/`low`) | `deviceStatus==='unknown'`(첫 패킷 전)도 `on` 이 됨 → "접촉 양호" 타일은 `ok` 일 때만, `unknown` 은 "확인 중" |
| leadoffl / leadoffr / leadoff | `deviceStatus==='lead_off'` + `leadOff` | `leadoff` | **L/R 구분 없음** → `ch1&&!ch2`=왼쪽, `ch2&&!ch1`=오른쪽, 둘 다=양쪽 도우미 필요 |
| unsupported | `connectionState==='unsupported'`(= `!isSupported`) | `unsupported` | `WaitingRoomBandCheck.tsx:47-48` 은 `isBluetoothSupported()` 도 직접 확인(초기 렌더 일치용) |
| 연결 실패 | `connectionState==='error'` + `error` 문자열 | **`off`**(`link==='disconnected'` 분기, `player-case.ts:41`) | 실패와 미연결이 같아 보임. 시안 FM06c 에는 별도 실패 케이스가 없고 `WaitingRoomBandCheck` 는 `band.error` 를 `role="alert"` 로 보여 준다(`:123-127`). 사용자 취소도 `error` 이므로 문구 구분 필요 |
| 약한 신호/저배터리 | `weak`/`low` | `weak`/`low` | 시안 FM06c 에 해당 케이스 없음(타일 "배터리 넉넉해요" 4칸 `member-b.html:418`만). 화면에 어떻게 보일지 미정 |

권고: `deriveBandUi` 는 SDD-208 회귀 테스트(`tests/class-player-case.test.ts`, `class-player-member-container.test.tsx:388`)가 걸려 있으므로 수정하지 말고, 사전 흐름용 `lib/class/band-step.ts`(신규)의 `deriveBandStep(input, nowMs)` 가 `deriveBandUi` 를 호출한 뒤 (1) `leadoff` → `leadoffl|leadoffr|leadoff`, (2) `connectionState==='error'` → `failed`, (3) `connected` + `deviceStatus==='unknown'` → `checking` 으로 세분화한다. `nowMs` 는 마법사 쪽에서 1초 틱을 직접 제공해야 한다(진행 화면은 `MemberClassContainer` 의 1Hz 타이머 `:198-212` 가 제공).

Capacitor 앱: `isBleSupported()` 는 네이티브면 무조건 true(`lib/ble/index.ts:5`)이므로 앱에서는 `unsupported` 분기에 들어가지 않는다. `WaitingRoomBandCheck.tsx:76-78` 의 미지원 문구("Web Bluetooth를 지원하지 않습니다")는 앱에선 해당 없음. 앱 BLE 어댑터(`lib/ble/capacitor-ble-adapter.ts`) 실기기 연결·접촉 콜백 동작은 이 조사에서 **미확인**.

## 3. 변경 목록

### 프론트

| 파일 | 변경 | 규모 |
|---|---|---|
| `lib/class/band-step.ts`(신규) | `deriveBandStep`(위 래퍼), `leadOffSide(leadOff)`, 필수/선택/사용 안 함 판정 순수함수 | S |
| `components/class/SensorTracker.tsx` | 3상태(미확인 회색 추가), `max-width:288px;width:100%`, 전극별 `aria-label`, LED 아래 "왼쪽/기준/오른쪽 양호·실패" 글자 줄(시안 `lb`), 범례 유지, 색은 기존 토큰 | S~M |
| `components/class/WaitingRoomBandCheck.tsx` | FM06c 카드(상태 칩·배터리 타일·전극 타일·접촉 불량 시 SensorTracker+3단계 안내)로 재작성, `linkbandMode` props, 단계 이동은 부모가 소유 | M~L |
| `components/class/ClassWaitingRoom.tsx`(마법사 전환은 타 조사와 공유) | `useBand` 를 마법사 컨테이너에서 1회 호출 후 단계에 props 로 전달, 밴드 건너뜀(skip)·연결 상태를 state 로 보관, `linkbandMode`/`place` props | L |
| `lib/class/class-waiting-room.ts` | `resolveWaitingRoomGate` 에 `linkbandMode`(+`place`) 반영, 단계 목록 함수 | S~M |
| `pages/class-join-page.tsx:547`, `components/player/MemberWaitingScene.tsx` | `linkbandMode`(·`locationType` 이미 있음) 전달 | S |
| `lib/socket.ts` | `WaitingRoomBandPresence` 타입, `WaitingRoomPresenceEmit.band`, `WaitingRoomChangedEvent.band`, `SessionLiveMetric.lead_off?` | S |
| `hooks/useWaitingRoomPresence.ts`, `hooks/useWaitingRoomCount.ts` | `band` 를 emit/보관(디바운스 ~1초, readinessKey 패턴에 합침) | S~M |
| `components/class/waiting-room-readiness-panel.tsx` + FH06 로비 행(타 조사 I4 와 공유) | 셀 4상태(완료/준비 중/건너뜀/접촉 불량), 접촉 불량 시 L/기준/R 소형 LED(색만), `linkband_mode='none'`·오프라인에서 셀 제외 | M |
| `lib/session-live/apply-eeg-feature.ts`, `pages/sessions/ClassPlayerPage.tsx:935-936` | `lead_off` 행 보관 + 폴링 교체 시 마지막 `lead_off` 재합성 | S~M |
| `components/class/player/host/HostLiveContainer.tsx:58-67,226-238` + `HostSelfBand` 시트 | `ContainerBand.leadOff` 추가, 시트에 `SensorTracker`(FH06a band-bad-*) | S~M |
| `components/class/LeadOffModal.tsx`, `GuestMeditationPanel.tsx` | 죽은 코드 삭제(게스트 제거 A7 와 같이) | S |
| 테스트 | `tests/class-waiting-room-band-check.test.ts`(6케이스 재작성), `class-waiting-room-presence.test.ts`, `class-waiting-room.test.ts`/`-flow.test.ts`, 신규 `band-step` 단위 테스트, `SensorTracker` 3상태 렌더, 하니스 fixtures(FM06c 케이스 `lib/class/fixtures`, SDD-208 방식 `lib/class/player-harness.ts`) | M |

### 백엔드

| 엔드포인트/모델/마이그레이션 | 변경 | 분류 | 기존 데이터 호환 | 필요 테스트 |
|---|---|---|---|---|
| WS `waiting_room` / `waiting_room_changed` (`ws/session_live_namespace.py:752-788`, `:1078-1091`) | 선택 키 `band{state, lead_off, battery}` 수용·정리(`_sanitize_band_presence`)·호스트 룸 중계. 휘발, DB 없음 | **필수**(시안 FH06 로비 `skip/bad` 셀·`-contact` 를 구현할 때) | 키 없음 → `band: null`, 기존 클라이언트·`readiness` 계약 불변 | `tests/test_class_waiting_room_presence.py`에 추가: band 정상 전달, 상태 값 화이트리스트, `lead_off` 비 bool 거부, 키 누락 시 None, 호스트 룸 전용 |
| WS `feature` / `eeg_feature` (`:587-690`, `:991-1002`) | top-level `lead_off` 검증 후 중계 payload 에 `lead_off` 추가. 휘발 | **권장** | 필드 없음 → null. 영속 데이터 변경 없음 | `tests/test_sdd026_live_session_p0.py`(`:366-388` 부근): lead_off 중계, 비 bool 무시, 게스트/비참가자 경로 불변 |
| `get_live_metrics` 행·join snapshot 에 서버 메모리의 `lead_off` 포함 (`services/session_service.py:2051-2150`, `schemas/session.py:342-375`) | 폴링 덮어쓰기 해소 대안(프론트 재합성 대신) | **보류**(프론트 재합성을 권장) | 신규 선택 필드, 기본 null | live-metrics 응답 스키마 테스트 |
| `EEGFeatureWindow` 컬럼 `lead_off_ch1/ch2` + Alembic | 영속 | **보류** | 기존 행 null = 읽기 호환 | 마이그레이션 수동 리뷰(자동 생성 금지, `.claude/rules/architecture.md`) |
| `_device_status_live` 를 하드웨어 `lead_off` 우선으로 교정 | 의미 정합 | **보류**(정책 §5) | — | 기존 SQI 테스트 유지 필요 |
| consent_eeg 세팅 경로 | 코드 참여 제거 후에도 동의 시 `consent_eeg=True` 가 서버에 저장돼야 함 | (I1/A1 소관, 의존성만 기재) | 과거 세션 값 유지 | 동의 후 업로드 허용 테스트 |

마이그레이션 필요 여부: **필수·권장 항목은 모두 불필요**(메모리·WS 중계). DB 영속(보류)만 마이그레이션이 필요하다.

필수/권장/보류 개수: 필수 1, 권장 1, 보류 3(+의존성 1).

## 4. 위험·주의

- **죽은 코드 제거 시점**: `SensorTracker`/`LeadOffModal`/`GuestMeditationPanel` 은 현재 미사용이므로 새 카드를 만들기 전에 `SensorTracker` 를 `LeadOffModal` 과 분리해야 한다(모달 삭제 시 함께 지우지 말 것).
- **거짓 접촉 불량**: `leadOff===null` 이면 SensorTracker 가 전부 빨강(`SensorTracker.tsx:17-19`). 연결 직후 첫 패킷 전에 그리면 오표시.
- **로비 "수신 끊김" 오표시**: 밴드를 연결하고 다음 단계로 넘기면 업로드가 멈춰 상담사 `device_status` 가 10초 뒤 `disconnected`(`session_service.py:2414-2421, 2433`)가 된다. `useBand` 를 마법사 컨테이너로 올리면(2.1) 해소되지만 그때는 로비 중 EEG feature 가 계속 저장되므로 **세션 시작 전 EEG 윈도우가 쌓이는 점**(데이터 프라이버시 규칙·리포트 평균에 섞임 여부)을 별도로 결정해야 한다. 현재도 밴드 탭이 마운트된 동안은 저장된다(`_store_feature` 에 세션 상태 검사 없음, `session_live_namespace.py:958-988`). 리포트 계산이 `second_offset`(시작 기준 경과) 전제와 맞는지는 미확인.
- **동의 의존**: 초대 회원은 `consent_eeg=False` 라 feature 저장이 거부되고 WS 는 `saved=0` ACK 를 돌려준다(`ws/...:620-672`, 프론트는 REST 로 재시도 `useBand.ts:608-609`). 새 동의 경로 없이 코드 참여를 제거하면 A8 진행 중 경로(B)도 막힌다.
- **필드 호환 순서**: 서버 배포가 먼저(필드 수용·중계), 클라이언트가 나중. 구 서버는 새 키를 무시하므로 어느 순서든 깨지지 않지만 기능은 서버 배포 후에 켜진다.
- **의미 불일치**: 상담사의 "접촉 불량"은 SQI<0.7 까지 포함(§2.3). 시안 FH06 의 "접촉 불량 3종 L/R"과 같은 문구를 쓰면 SQI 저하 회원이 L/R 불명 상태로 "접촉 불량"에 보일 수 있다.
- **ch↔좌우 매핑 미검증**: 사용자에게 "왼쪽 실패"라고 말하는 근거가 SDK 문서로 확인되지 않았다(현행 코드와 시안 모두 ch1=왼쪽 가정).
- **프로세스 수**: 서버 메모리 보관(보류안)은 다중 uvicorn 워커에서 불일치 가능(`ws/__init__.py:70-85` Redis manager 는 브로드캐스트만 공유).
- **`linkband_mode` 기본값 불일치**: 백엔드 `none` vs 생성 화면 `optional`(§2.5).

## 5. 사용자 결정 필요

1. **필수(`required`) 모드의 입장 정책** (정책)
   - 옵션 A: 시안대로 프론트 게이트 — 준비 단계에서 연결 못 하면 "준비 완료" 불가, 시작 후에도 연결해야 입장(미지원 브라우저는 링크 복사 안내).
   - 옵션 B: 준비 단계에서는 연결 안내만 하고 입장은 항상 허용(필수 모드도 소프트 필수).
   - 옵션 C: A + 서버 강제(밴드 미연결 시 입장 API 거부).
   - 기본값 제안: **A**(시안·확정 결정 5의 "시작 후 입장해 준비 이어서"와 양립: 시작 후에도 연결 단계로 돌려보냄). 영향: A/C 는 iOS 웹·Safari 회원이 필수 클래스에 영영 못 들어가므로 앱 사용 안내 필요, C 는 백엔드 변경 필요.
2. **상담사 로비의 "접촉 불량" 정의** (정책)
   - 옵션 A: 새 `band` presence 로 하드웨어 접촉(L/R)을 표시(§2.4 안 A, 백엔드 필수 1건).
   - 옵션 B: 백엔드 변경 없이 서버 `device_status`(SQI 파생)로 "접촉 불량" 여부만 표시, L/R LED 는 상담사 본인 밴드(FH06a)에서만.
   - 기본값 제안: **A**(시안이 L/R 소형 LED 를 로비 행에 명시). 영향: B 는 시안 FH06 `-contact` 의 L/R LED 를 포기.
3. **로비 중 밴드 EEG 저장 허용 범위** (정책·프라이버시)
   - 옵션 A: 로비(시작 전) 밴드 데이터는 접촉·연결 상태만 중계하고 EEG feature 는 저장하지 않는다.
   - 옵션 B: 현행처럼 연결 중 feature 를 저장(마법사 컨테이너가 `useBand` 를 유지하면 로비 내내 저장).
   - 기본값 제안: **A**(`band` presence 로 접촉 상태만 전달하고, 시작 전에는 업로드를 `enabled: false` 로 둔다 — `useBand` 의 `enabled`/`observationOnly` 옵션 활용 가능). 영향: B 는 시작 전 구간이 리포트에 섞이는지 확인 필요.

## 6. 확인하지 못한 것

1. ch1/ch2 가 실제 기기에서 왼쪽/오른쪽 이마 전극에 대응하는지(SDK 문서 없음).
2. 서버로 가는 feature `signal_quality`(`analysis.getLatestEegFeature().signalQuality`)가 하드웨어 lead-off 와 어떻게 연동되는지(`AnalysisMetricsService` 내부 미확인).
3. Capacitor 앱(iOS/Android)에서 BLE 어댑터 경유 접촉 콜백·연결 흐름의 실기기 동작.
4. 백엔드 API(uvicorn) 프로세스 수(배포 설정 파일이 저장소에 없음) — 메모리 보관안의 일관성 판단에 필요.
5. 세션 시작 전 저장된 EEG 윈도우(로비 업로드분)가 리포트·평균 계산에 섞이는지(리포트 서비스 미조사).
6. 호스트가 초대한 회원이 대기실에 들어올 때 `participant_id` 가 어떻게 확보되는지(코드 제거 후 경로) — I1/I4 소관.
