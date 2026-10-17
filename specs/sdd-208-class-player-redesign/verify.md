# SDD-208 Verify — 구현 전 QA 체크리스트 (Stage ③, 구현 전 게이트)

> 구현 시작 전에 확정하는 문서. 구현 중·후에 항목을 추가·완화하지 않는다(변경은 사용자 승인 후 이 문서에 이력과 함께 반영).
> 근거: `spec.md`, `plan.md`, `designs/class-player-redesign/{케이스.md, 균형.md, 기획.md, member.html, counselor.html}`.
> 문구 단언은 시안 원문 기준이며, `plan.md §5`의 결정(D2·D3·D4·D5·D12·D13)이 확정되면 해당 행의 문구를 갱신한다.

## 0. 검증 층

| 층 | 이름 | 실행 | 대상 |
|---|---|---|---|
| V1 | 단위 | `cd frontend && npx vitest run tests/class-player-*-case.test.ts` | 케이스 파생 순수함수(`deriveBandUi`·`deriveNetUi`·`deriveMemberCase`·`deriveHostCase`) |
| V2 | 컴포넌트 | `npx vitest run tests/class-player-*.test.tsx` (jsdom) | 픽스처 → 뷰 DOM·문구·콜백 |
| V3 | 하니스 측정 | `node e2e/class-player/fit.mjs --role=member\|host` (`/design/class-player?role=&case=&sheet=` 로드, 4 뷰포트) | 레이아웃·대칭·크기·겹침. 서버·BLE 불필요 |
| V4 | dev E2E | `E2E_PASSWORD=… BASE_URL=… node e2e/full-journey.mjs` 및 `e2e/class-player/live.mjs`(신규, 가짜 미디어 플래그) | 실제 LiveKit·소켓·API 연동 |
| V5 | 실기기 | §7 수동 | 기기·브라우저·앱 고유 동작 |

- 뷰포트 4종: `390×844`, `834×1194`, `1194×834`, `1280×720`. 시트 열림 변형(회원 `status/chat/signal/sound/device`, 상담사 `metric/chat/media/checkin/tools/hands/actions/queue/alerts/myband/permcam/permmic/detail`)도 같은 4종.
- 보조 뷰포트: `390×600`, `1280×420` — 도크 항목 전부가 화면 안에서 클릭 가능한지만 확인(기존 `member-class-player.browser.cjs`의 "짧은 화면" 시나리오 계승).
- 판정 코드: **U**=V1, **C**=V2, **H**=V3, **E**=V4, **R**=V5(수동). 각 행의 "자동 검증"에 적용 층을 적는다. 모든 H 행은 공통 합격 기준 P1~P4·P11~P13을 **암묵적으로 포함**한다.

---

## 1. 공통 합격 기준 (모든 케이스·모든 뷰포트)

| ID | 기준 | 측정 정의 | 방법 | 합격 |
|---|---|---|---|---|
| P1 | 페이지 스크롤 0 | `documentElement.scrollHeight ≤ innerHeight` 그리고 `scrollWidth ≤ innerWidth`. 예외: 상담사 타일 영역(`data-pz="gridscroll"`), 채팅 메시지 목록, 시트 본문 **내부** 스크롤만 허용(시트가 열려도 페이지 스크롤 0) | H | 위반 0 |
| P2 | 11px 이하 글자 0 | 텍스트 노드를 가진 가시 요소의 `getComputedStyle().fontSize ≤ 11px` 개수 (`designs/…/tools/member-measure.mjs` 방식) | H | 0건 (최소 12px) |
| P3 | 터치 영역 ≥ 44px | 가시 `button`·`[role=button]`·`a`·`input`·`select`·`summary`의 `min(width,height) ≥ 44` | H | 위반 0 |
| P4 | 좌우 대칭·비율 규칙 위반 0 | `균형.md` S1~S10, CS1~CS5, MS1~MS3. 공차: 위치 ±2px, 링 세로 중앙 ±영역높이 8%, CS3 비율 ±3%p, 간격 ⊂ {8,16,24,32,40,48}(±1) | H (4 뷰포트 전부) | 위반 0 |
| P5 | 호흡 지시 문구·애니메이션 0 | ① 화면 텍스트와 신규 소스(`components/class/player/**`, `lib/class/*-player-case.ts`)에서 정규식 `호흡에 집중\|숨을 (들이\|내쉬)\|들이쉬\|내쉬\|호흡하세요\|천천히 호흡\|심호흡` 0건. 지표 라벨 "호흡"·단위 "회/분"은 허용 ② `StatusRing` 하위 `animation-name ≠ none` 0개(값 변화 시 호 `transition` 1.2s ease-out만 허용, M08 3점 순차 페이드는 예외) ③ `prefers-reduced-motion: reduce`에서 모든 `animation`·`transition` 0 | C·H | 0건 |
| P6 | 회원 화면 비교·점수 미노출 | 회원 뷰 텍스트에 정규식 `그룹\|평균\|순위\|상위\|하위\|종합\|총점\|점수` 0건. 소켓 `class:group_average`가 와도 DOM 변화 없음. 본인 5분 변화 문구("5분간 +8")는 D12 확정에 따름 | C | 0건 |
| P7 | 마이크 꺼짐 = AI 기록 제외 + 뇌파 유지 | **상담사**: 마이크 끄기 시 `recorder.pause()` 호출, 이후 청크 업로드 카운트 증가 0, LiveKit 로컬 마이크 mute, `useBand` 업로드(`pendingCount`/`uploadStatus`)는 계속 진행. 켜면 `resume`. **회원**: 로컬 마이크 mute 후에도 밴드 업로드·조용한 신호 전송 정상 | C(훅 스파이)·E | 위 전부 충족 |
| P8 | 회원 영상 기본 비공개 | 회원 진입 직후 `localParticipant.isCameraEnabled===false`, 카메라 `getUserMedia` 호출 0회, 상담사 1:1 화면의 회원 영상 자리 DOM 0. 회원이 켜면 자리가 생기고 끄면 사라짐. 상담사 화면에 회원 카메라를 켜는 UI 0 | C·E | 충족 |
| P9 | 밴드 미착용·미지원·연결 대기는 경고색 아님 | 해당 케이스(M06·M07·M08·M13, C13)에서 코랄 토큰(`--mb-coral` `#E8B4A0`, `.tone-coral`) 사용 요소 0 | H | 0 |
| P10 | 상태는 색만으로 전달하지 않음(R8) | 상태 표시 요소가 아이콘 + 텍스트 라벨을 함께 가짐(밴드 점/링 외곽 색 단독 금지) | C | 위반 0 |
| P11 | 자리 고정(R1) | 같은 뷰에서 상태만 바꿔(예: 밴드 on → leadoff → lost) 링·도크·미디어 줄의 `getBoundingClientRect` 변위 ≤ 2px | H | 충족 |
| P12 | 빈 영역 0 | 콘텐츠 없는 큰 박스(`member-measure.mjs`의 빈 영역 검사) | H | 0 |
| P13 | 겹침·화면 이탈·텍스트 잘림 0 | 주요 박스 쌍 교차 면적 ≤ 1px²(링은 3% 확장), 박스가 뷰포트 밖 0, `scrollWidth>clientWidth` 등 잘림 0 | H | 0 |
| P14 | 시트 동작 | 동시에 1개, Esc·바깥 영역·닫기 버튼으로 닫힘, 닫으면 포커스가 열었던 도크 버튼으로 복귀, 열린 동안 배경 `inert` | C | 충족 |
| P15 | 정적 검사 | `npx tsc --noEmit`, `npx eslint src/`, `npm run build` | CI | 오류 0 |
| P16 | 터치 키보드 | 채팅 입력 포커스 시 입력창이 키보드에 가려지지 않음(모바일 바텀 시트) | R | 충족 |

---

## 2. 회원 케이스 M01~M21

공통 입력 기본값: 온라인·1:1·카메라 on·마이크 on·손들기 idle·밴드 on·네트워크 ok·view live. 표의 "입력 상태"는 기본값과 다른 키만 적는다. 문구는 `member.html` 원문.

| ID | 입력 상태 | 기대 화면 | 자동 검증 |
|---|---|---|---|
| M01 | (기본값) | 링 중앙에 이완도 값·단위·지표명 / 링 아래 안내 "이완도는 최근 5분간 부드럽게 이어졌어요" / 5분 추이 한 줄 + "5분간 ±N"(D12) / 상담사 PiP·내 PiP **같은 크기 가로 나란히 중앙**(S4) / 미디어 줄(마이크·카메라) / 도크 5개(내 상태·채팅·조용한 신호·소리·기기) | U: `deriveMemberCase`=시안 `CASES.M01`과 동일 키 / C: 링 값·PiP 2개·미디어 줄 버튼 2개·도크 5개 / H: P1~P4, S4·S6·S7 |
| M02 | mode=group, mic=muted | 안내 "이 수업은 기본 뮤트예요 · 말하고 싶을 땐 손들기를 눌러 주세요" / 마이크 버튼 "뮤트 중"(비활성) / 손들기 버튼 "손들기" 활성 / 카메라 켜기 비활성(발언권 전 발행 불가) | U·C: 마이크 `aria-disabled=true`, 손들기 클릭 시 `raiseHand()` 호출 1회 / H |
| M03 | group, mic=muted, hand=waiting | 안내 "손들었어요 · 상담사가 확인 중이에요" / 손들기 자리 상태 표시. **"손들기 취소" 버튼은 B1 승인 시에만**(미승인이면 DOM 0) | U·C / H. 승인 시 C: 취소 클릭 → API 호출·idle 복귀 |
| M04 | group, mic=speaking, hand=speaking | 안내 "말하는 중이에요 · 끝나면 말하기 종료를 눌러 주세요" / 마이크 "말하는 중" 활성 표시 / "말하기 종료" 버튼 / 카메라는 **꺼짐**(결정 #1) | C: 마이크 on·카메라 off 단언 / 말하기 종료 클릭 → B2 미승인: 로컬 마이크 mute 호출, 승인: 해제 API 호출 / H |
| M05 | place=offline | **PiP·내 PiP·미디어 줄 DOM 0**(D2 확정 시), 도크는 마이크/카메라 없는 구성 / 링 + 현장 안내 카드 + 안내 칩 **같은 폭**(MS1) | U: `showHostPip=false, showMediaRow=false` / C / H: MS1·S9 |
| M06 | offline, band=off | 링 자리 "밴드 없이 참여 중이에요 / 측정 없이도 수업은 그대로 진행돼요" / 소리·체크인이 중심(빈 칸 없음) / 밴드 연결 버튼 카드 / 코랄 요소 0 | C / H: P9·P12, MS1 |
| M07 | band=off | 링 자리 동일 문구 / 슬롯 카드 "원하시면 기기에서 LINK BAND를 연결할 수 있어요." + [밴드 연결] → 기기 시트 열림 / 코랄 0 | C: 버튼 클릭 → 기기 시트 / H: P9 |
| M08 | band=pending | 링 코어 "밴드를 연결하는 중이에요" + **3점 순차 페이드**(회전 스피너 없음) / 슬롯 "오래 걸리면 밴드 전원이 켜져 있는지 확인해 주세요." + [취소] / 코랄 0 | C: 회전 애니메이션(`rotate` keyframe) 0, 취소 클릭 → `band.disconnect()` 호출(`connecting` 상태에서 동작하는지 **구현 전 `useBand` 실측**) / H |
| M09 | band=weak | 링 **값 유지** / 칩 "접촉이 약해요 · 밴드를 이마에 살짝 밀착해 주세요"(주의색, 코랄 아님) | U: `deriveBandUi`(degraded/invalid → weak) / C / H |
| M10 | band=leadoff, 기기 시트 열림 | 링 회색 + "접촉을 확인해 주세요" / 칩 "접촉이 확인되면 다시 측정해요"(코랄) / 기기 시트: "접촉이 확인되지 않아요 · 밴드가 피부에 닿지 않았어요" + 3단계(이마 중앙/머리카락 정리/센서 닦기) + [접촉 다시 확인] / 전체 검정 모달 **아님** | U / C: 3단계 `ol li` 3개, 풀스크린 모달 DOM 0 / H(834×1194 포함). 접촉 복구 시 링 복귀 + "AI 분석중" 15초 표시 유지 |
| M11 | band=lost | 링 값 **흐림**(dim) + "다시 연결하는 중이에요" / 칩 "밴드 연결이 끊겼어요 · 자동으로 다시 연결하고 있어요"(코랄) / 슬롯 "다시 연결해도 앞서 측정한 값은 안전하게 보관돼요." + [다시 연결] | U: `everConnected=true`+disconnected → lost(미착용과 구분) / C: [다시 연결] → `band.connect()` / H |
| M12 | band=low | 링 **유지** / 칩 "배터리가 N%예요 · 곧 충전해 주세요"(주의색) / 임계값은 기존 `LOW_BATTERY_PCT=25`(D8) | U: 25%→low, 26%→on(`isLowBattery`: 25% 이하 포함) / C / H |
| M13 | band=unsupported | 링 자리 "밴드 없이 참여 중이에요" / 칩 "이 브라우저에서는 밴드 연결이 안 돼요" / 슬롯 "Chrome 또는 Edge로 열면 밴드를 연결할 수 있어요." + [밴드 없이 계속] / 코랄 0 | U: `connectionState='unsupported'` / C / H: P9 / R: iPhone Safari |
| M14 | mic=off | 마이크 버튼 "마이크 꺼짐"(아이콘+라벨) / 칩: **D4 확정 문구**(기본: 회원 음성이 상담사에게 전달되지 않음 + "뇌파는 계속 기록돼요") / 밴드 값·링 유지 | C: 클릭 토글 → `setMicrophoneEnabled(false)` / P7(회원) / H |
| M15 | mic=denied | 마이크 "마이크 막힘"(비활성) / 칩 "마이크 권한이 꺼져 있어요 · 아래 방법으로 허용해 주세요"(코랄) / 슬롯 "마이크 허용 방법" 3줄: "주소창의 자물쇠 아이콘을 눌러요" · "마이크를 “허용”으로 바꿔요" · "페이지를 새로 고쳐요" | C: `onMediaDeviceFailure(PermissionDenied, audioinput)` 모킹 → 문구 / H / E: 헤드리스 기본 거부로 재현 |
| M16 | cam=off | 카메라 "카메라 꺼짐" / 내 PiP 자리에 **이니셜 아바타** + 칩 "카메라 꺼짐", PiP 자리·크기 불변 | C / H: P11(on↔off 전환 시 PiP 박스 변위 ≤2px) / E: 카메라 토글 |
| M17 | cam=denied | 카메라 "카메라 막힘"(비활성) / 내 PiP "카메라를 쓸 수 없어요" / 칩 "수업은 그대로 계속돼요 · 설정에서 카메라를 허용해 주세요"(코랄) | C: `onMediaDeviceFailure(PermissionDenied/NotFound, videoinput)` / H |
| M18 | net=reconnecting | 상단 코랄 배너 "연결이 불안정해요 · 다시 연결 중이에요" / 연결 점 → "재연결 중" / 상담사 PiP **정지 표시** / 링·도크 유지 | U: `deriveNetUi` / C / H: S2(배너 좌우 여백)·S8 |
| M19 | net=down | 전체 안내 카드 **화면 정중앙**(MS3): 제목 "연결이 끊겼어요" / "인터넷 연결을 확인하고 다시 시도해 주세요." / "밴드로 측정한 데이터는 이 기기에 안전하게 보관 중이에요. 연결되면 이어서 기록돼요."(`pendingCount>0`일 때) / [다시 연결] | U / C: 재시도 클릭 → 재연결 콜백 / H: MS3 |
| M20 | view=waitlist | 전체 화면 카드 정중앙: "대기 중이에요 / 자리가 나면 자동으로 입장해요. 이 화면을 열어 둬 주세요." + 수업·상담사·시작 정보 / 승격되면 live 전환 / **문구 "입장 알림은 푸시로"·"대기열에서 나가기" 동작은 D5 연계로 확정 후 단언** | U: `join` 응답의 `participants[].is_waitlisted`(본인 `participant_id` 매칭) → waitlist / C / H: MS3·S9 / E: 정원 1 세션에 2번째 회원 입장 |
| M21 | view=end | 전체 화면 카드 정중앙: "수고하셨어요" / "리포트는 준비되면 메일로 보내 드려요." / **점수·퍼센트 숫자 0** / 이메일 신청·사후 체크인 진입점(D5) / 이동 버튼(회원 "대시보드로", 게스트 "홈으로") | C: `/\d+\s*%/` 0건 / H: MS3 / E: `full-journey` 리포트 시나리오 |

**회원 케이스 추가 검증(전 케이스 공통)**
- [ ] 상단 바 S3: 나가기와 연결 표시의 바깥 여백·높이 동일, 제목 필 중앙
- [ ] 스피커 음소거·화면 끄기·종료 확인 모달·온보딩 코치마크가 도크/상단 바에서 동작(회귀 §6)
- [ ] `linkband_mode='none'`(D7): 밴드 연결 버튼·기기 시트·밴드 칩 DOM 0, 링 자리 대체 안내 존재
- [ ] 게스트(`isAuthenticated=false`): 채팅 시트에 `GuestChatNotice`, 그 외 동작 동일

---

## 3. 상담사 케이스 C01~C18

공통 입력 기본값: 온라인·그룹 8명(정상 5 + 미착용 2 + 끊김 1)·카메라 on·마이크 on·네트워크 ok·phase live. 문구는 `counselor.html` 원문.

| ID | 입력 상태 | 기대 화면 | 자동 검증 |
|---|---|---|---|
| C01 | (기본값) | 상단 바(닫기·제목·"함께한 시간 / 계획 시간"·접속/전체·종료) / **지표 띠**: "지금 보는 지표" + 지표명 큰 글자 + 지표 고유색 + 그룹 평균(띠 안) / 헤드 행: 띠 : 셀프뷰 = 모바일 62:38, 태블릿·데스크톱 66:34 / 타일 8개 **약칭 라벨**(집중·이완·감정·BPM·호흡·HRV)이 띠 색과 일치 / 도크 5개 | U: 열 수 선택(8명→2·4열) / C: 띠 이름 = 타일 라벨, 페이지 버튼 DOM 0 / H: CS1·CS2·CS3, S1·S2·S3·S6·S10 |
| C02 | hands=[2,5] | 타일에 손들기 배지 / 상단 칩 "손든 회원 2" / 발언권 부여 버튼 → 시트 | C: 칩 개수, 부여 클릭 → `setParticipantSpeaking(…, true)` / H: CS4 |
| C03 | speaking=3 | 말하는 회원 타일 강조 / 칩 "{이름} 말하는 중" + [회수] | C: 회수 클릭 → `(…, false)` / H |
| C04 | loc=offline | **셀프뷰 슬롯 DOM 0**, 그 자리를 지표 요약 패널이 채움(띠 : 요약 = 같은 비율 구조) / 녹음 칩 / 도크 "미디어" 라벨이 "녹음" / 발언권 UI 0 | U: `headSlot='summary'` / C / H: CS3 |
| C05 | solo(온라인 1:1) | 그리드 대신 **큰 회원 카드 1 + 내 셀프뷰** / 6지표 **3×2 균등 격자** / 5분 추이와 체크인 같은 폭 / 회원 영상 자리는 회원이 켠 경우만(P8) / 띠 라벨 "강조해서 보는 지표", 그룹 평균 표시 없음 | C / H: CS5(6셀 크기·간격 편차 ≤2px, 열 정렬), CS3 |
| C06 | solo, offline | 큰 회원 카드 + 6지표 + 녹음 상태, 셀프뷰 없음 | C / H: CS3·CS5 |
| C07 | cam=off | 셀프뷰 자리 **유지** + "카메라 꺼짐" 칩 / 미디어 시트의 카메라 토글 off | C: 토글 → LiveKit 카메라 off, `videoRecorder` 일시정지 / H: P11 |
| C08 | cam=denied | 셀프뷰에 코랄 "카메라를 쓸 수 없어요" / [설정 안내] 시트(`permcam`) | C: `onMediaDeviceFailure` 또는 `videoRecorder.state==='error'` → 표시 / H |
| C09 | mic=off | 배너(info) "마이크 꺼짐 — 이 구간은 AI 기록에서 빠져요. 뇌파는 계속 기록돼요." + [마이크 켜기] | C·E: P7(상담사) / H: S1·S2 |
| C10 | mic=denied | 코랄 배너 "마이크를 쓸 수 없어요 — 허용하면 AI 기록이 시작돼요. 허용하지 않아도 수업은 계속돼요." + [허용 방법](`permmic` 시트) | C: `recorder.state==='error'` → 표시 / H |
| C11 | rec=rec(또는 paused) | 칩 "녹음 중 mm:ss"(붉은 점, 코랄 아님) / 일시정지 시 "기록 일시정지" 칩 | C: `recorder.state` 매핑, 경과 시간 / H: CS4 |
| C12 | 리드오프 3, 배터리 부족 2 | 칩 "접촉 확인 3 · 배터리 2" → 시트에서 접촉 불량·배터리 낮음 참가자 목록 확인. "모두에게 안내 보내기" 버튼은 B6 승인 시에만(미승인이면 DOM 0, D13) | U: `summarizeMetrics` 재사용 값 일치 / C / H |
| C13 | 전원 밴드 미착용 | 지표 띠 자리 "이번 수업은 밴드 없이 진행 중이에요 / 측정 없이도 수업은 그대로 진행돼요"(띠 비활성) / 접속·체크인 중심 요약 칩 "체크인 n/N" / 코랄 0 | U: `allOff` / C / H: P9 |
| C14 | 대기 3명 | 상단 칩 "대기 3" → 시트: 대기자 목록(읽기 전용, B4 미승인) + "자리가 나면 자동으로 입장해요" | U: `session.waitlist_count`·`participants[].is_waitlisted` / C / H. 승인 API는 B4 승인 시 별도 행 추가 |
| C15 | 내 밴드 연결/미착용 | 칩 "내 밴드 연결됨 · 이완 N" 또는 "내 밴드 미착용 · 선택" → `myband` 시트(연결·해제·배터리·접촉·신호) | C: 호스트 `useBand` 상태 반영 / H |
| C16 | net=reconnecting / down | 코랄 배너 "연결이 불안정해요 — 데이터 수신이 잠시 중단됐어요. 복구되면 이어서 기록돼요." / down: "연결이 끊겼어요 — 밴드 데이터는 기기에 보관 중이에요…" + [다시 연결] / 타일 값 **흐림** | U: `deriveNetUi`(소켓 끊김 + 4초 폴링 실패) / C: 복구 시 배너 해제 / H: S1·S2·S8 |
| C17 | phase=confirm → ending | 종료 확인 모달(경고 톤): "클래스를 종료할까요? 접속 중인 참가자 N명의 화면이 종료되고, 기록·리포트 생성이 시작돼요." [계속 진행]/[종료하기] / 종료 후 3단계(기록 정리·AI 요약·리포트 생성) 진행 표시 + "화면을 닫아도 계속 만들어요. 준비되면 알려 드려요." | C: 모달 버튼 → `finishSession`, 실패 시 "종료 재시도" / H: 모달 가로 중앙(S1) / E: `full-journey` 종료·리포트 시나리오. 이동 방식은 D6 |
| C18 | 20명, hands=[10,13,18], handsFirst | 타일 영역만 세로 스크롤(상단 바·띠·도크 고정) / "손든 회원 먼저" 옵션 on → 손든 3명이 앞 / 마지막 행 가운데 정렬 | U: 정렬 순수함수 / C / H: P1(타일 영역 내부 스크롤만), CS1·CS2 |

**상담사 케이스 추가 검증(전 케이스 공통)**
- [ ] 페이지 버튼(‹ n/m ›) DOM 0, 타일 영역 `overflow-y:auto`
- [ ] 지표 10초 순환 시 띠 이름과 모든 타일 라벨이 같은 프레임에 변경(`HOST_METRICS` 순서 유지), 상세 시트 열림 중에는 순환 정지(기존 동작 계승)
- [ ] 타일 탭 → 참가자 상세 시트(6지표 + 추이 + 체크인 응답). 추이 구간은 D10 확정값
- [ ] 시트: 가로형(폭 ≥1000 & 가로)만 사이드, 태블릿 세로(834×1194)는 바텀(S5)
- [ ] 회원 평균·순위·정렬은 상담사 화면에만 존재(회원 번들에 `group-aggregate` 사용 0)

---

## 4. 균형 규칙 ↔ 대상 케이스 매트릭스 (H, 4 뷰포트 전부)

| 규칙 | 회원 대상 | 상담사 대상 |
|---|---|---|
| S1 단독 요소 중심축 | M01~M21(링·칩·도크·미디어 줄·배너·시간 필) + 시트 열림 변형 | C01~C18(배너·헤드·칩 줄·그리드 영역·도크, 모달 C17) |
| S2 좌우 여백 동일 | 도크·미디어 줄·배너·바텀 시트 | 상단 바·모든 블록·바텀 시트 |
| S3 상단 바 대칭 | M01~M18 | C01~C18 |
| S4 PiP 짝 | M01·M02~M04·M16·M17·M18 | — (CS3로 대체) |
| S5 시트 분기 | 시트 열림 변형 5종 × 4뷰포트 | 시트 열림 변형 13종 × 4뷰포트 |
| S6 도크·미디어 줄 균등 | M01~M18 | C01~C18(도크) |
| S7 링 세로 중앙 | M01~M18(링 있는 케이스) | — |
| S8 박스 최대폭 | 배너·칩·카드 | 배너·헤드·칩 줄 |
| S9 중앙 컬럼 max-width | 834 이상 뷰포트: 폭 ≤ 640 | 본문 컬럼 ≤ 1040(측정 스크립트 기준값) |
| S10 8배수 간격 | 링·칩·카드 스택, PiP 사이, 미디어 줄→도크 | 블록 간 수직 간격, 화면 바깥 여백 |
| MS1~MS3 | M05·M06(MS1), 시트 열림 `status`(MS2), M19·M20·M21(MS3) | — |
| CS1~CS5 | — | C01·C02·C03·C07~C18(CS1·CS2), C01·C04·C06(CS3), C02·C12·C14·C15(CS4), C05·C06(CS5) |

- 합격 = `e2e/class-player/` 결과표(`shots/…-symmetry.txt`)에서 **위반 0건**. 위반 건수가 0이 될 때까지 I2에서 반복한다.
- 시안 대비 눈 확인: `designs/class-player-redesign/shots/cases/{member|counselor}-{ID}-{viewport}.png`와 하니스 스크린샷을 나란히 비교(구도·여백·색 일치 여부, 불일치는 사용자 판단).

---

## 5. 금지·존재 요소 단언 (정적·컴포넌트)

| # | 단언 | 방법 |
|---|---|---|
| X1 | 회원 번들 경로(`components/class/player/member/**`)에 `group-average`·`onGroupAverage`·"그룹 평균" 문자열 0 | grep + C |
| X2 | 신규 경로에 이모지 문자 0(아웃라인 아이콘만) | 정규식 `\p{Extended_Pictographic}` grep |
| X3 | 신규 경로에 호흡 지시 문구 0 (P5 ①) | grep |
| X4 | 신규 컴포넌트가 `useBand`를 직접 호출하는 파일은 `MemberClassContainer.tsx`·`HostLiveContainer.tsx`(호스트는 `ClassPlayerPage` 경유)뿐 | grep (인스턴스 중복 방지, `useBand.ts:77` 주석) |
| X5 | 신규 경로에서 `any` 0, `as unknown as` 최소(필요 시 사유 주석) | eslint |
| X6 | 시트·모달이 `role="dialog"` + `aria-modal` + 라벨 보유 | C |
| X7 | 아이콘 전용 버튼에 `aria-label` 보유 | C |

---

## 6. 회귀 위험 영역과 방어 검증

| 영역 | 깨질 수 있는 지점 | 검증 |
|---|---|---|
| **녹음(AI 기록)** | 새 도크로 옮기며 시작/일시정지/종료·동의 모달 연결 누락, 마이크 토글과 `recorder` 충돌, 청크 업로드 중단 | C(훅 스파이: `start→pause→resume→stop` 호출 순서, `ConsentModal` 노출) / E: dev에서 녹음 시작·종료 후 `/audio` 청크 응답 200 / 기존 `useAudioRecorder` 단위 테스트 통과 |
| **영상 녹화** | 조합 C(카메라 on+마이크 off 무음 녹화) 제어 소실, 카메라 전환(전면/후면) 소실, 카메라 토글 시 녹화 정지 | C: 조합 A~D 표 구동 / R: 실기기 후면 카메라 전환 |
| **밴드 연결(회원)** | `useBand` 인스턴스 중복, 연결·해제·재연결 흐름 변화, `pendingCount` 큐 미소진, 링버퍼(300포인트) 유실 | C(컨테이너 테스트: 인스턴스 1개) / V2 시뮬레이션: 1Hz 틱 300개 후 추이 길이 / R: 실제 LINK BAND |
| **밴드 연결(상담사 본인)** | 호스트 밴드 UI가 시트로 이동하며 연결 버튼 소실 | C / R |
| **실시간 소켓** | `useSessionLiveSocket` 콜백 누락(`onEegFeature`·`onSnapshot`·`onParticipantChanged`·`onDeviceStatusChanged`·`onSpeakingChanged`·`onClassSignal`), 회원 측 `onGroupAverage` 제거로 인한 부작용, 재연결 후 구독 해제 | C: 컨테이너가 기존과 같은 콜백 세트를 등록(회원은 `onGroupAverage` 제외) / E: dev 소켓 연결 후 `eeg_feature` 수신 반영 |
| **발언권(손들기·부여·회수)** | `speaking_changed` → 토큰 재발급 → `LiveKitRoom` 재마운트 중 카메라 선호 소실, 부여 후 마이크만 켜짐 확인 | C: 재마운트 시나리오 / E: 그룹 세션에서 손들기→부여→회수 / `SpeakingRightsPanel` 기존 동작 |
| **조용한 신호** | 시트 안에서 `sendSignal` 연결 누락, 상담사 TTL 10초 집계·배지 | 기존 `quiet-signal-ui.test.ts`·`quiet-signal.test.ts` 통과 / C: 회원 시트 클릭 → `sendSignal` / E: 신호 전송 후 상담사 화면 집계 |
| **채팅** | `ClassChatPanel embedded` 변형이 기존 오버레이 동작을 바꿈, 안읽음 배지 소실, 게스트 안내 | 기존 `class-chat-panel.test.ts`·`class-chat-api.test.ts` 통과 / C |
| **BGM·가이드 오디오** | 대기실 BGM(`ClassWaitingRoom`) 영향, 회원 진행 화면 BGM 무재생 정책(D3) 위반 | 기존 `class-audio-sync.test.ts` 통과 / C: 진행 화면에 BGM 컨트롤 DOM 0(D3 기본값) |
| **리포트 생성** | 종료 흐름 변경으로 `transitionSession('end')`·미디어 stop 순서 깨짐 → 리포트 미생성/지연 | 기존 `finishSession` 순서 보존 C(스파이: `handleStop → liveKit.disconnect → end → navigate`) / **E: `full-journey.mjs` 리포트 시나리오(counselor+client 리포트 생성·승인·메일 재발송)** |
| **종료 흐름** | 종료 모달·실패 재시도·이동(D6)·`isEnded` 씬 | C / E |
| **이탈 보호** | `useLeaveGuard`·`LeaveGuardModal`(open/in_progress 호스트) 소실 | C: 블로커 모킹 |
| **세팅·대기 씬** | 호출부 교체 중 `HostClassWorkspace`·`SessionPreJoinPreview`·`WaitingRoomReadinessPanel` 변형 | 기존 `host-class-workspace.test.tsx`(세팅·대기 케이스) 통과 / E: 오픈→대기→시작 |
| **회원 입장 플로우** | `ClassJoinPage` props 추가(대기열)로 대기실→진행 전환 로직 변화 | 기존 `class-join-waiting.test.ts` 통과 / E: `full-journey` 클래스 참여 |
| **화면 꺼짐 방지** | `useWakeLock` 호출 위치 이동 | C(스파이) / R |
| **링크밴드 정책** | `linkband_mode=none` 처리(D7) | C |
| **게스트 경로** | 비로그인 `skipAuth`·`participant_token` | C / E(게스트 참여 시나리오가 있다면, 없으면 R) |
| **e2e 단언** | `full-journey.mjs:199`의 문구 `지금 나를 알려요`가 새 구조에서 사라짐 | I1에서 단언을 새 도크 라벨 기준으로 교체 후 로컬/배포 실행 |

기존 테스트 처리 결정(I1):
- `host-class-workspace.test.tsx`: 진행 중 전용 케이스는 새 뷰 테스트로 이전, `페이지 이동` 케이스(197행)는 삭제(spec 합의 #3), 세팅·대기 케이스 유지.
- `member-class-player.browser.cjs`: 그룹 평균 단언 삭제, 새 컨테이너 기준으로 재작성(1화면·시그널·몰입·오프라인 영상 없음·짧은 화면 도달성 계승).

---

## 7. 실기기 확인 항목 (R)

| 기기·환경 | 확인 내용 | 연결 케이스 |
|---|---|---|
| iPhone Safari (iOS 최신 -1 포함) | 진행 화면 한 화면(주소창 표시/숨김에서 `100dvh`), 하단 안전 영역, 카메라·마이크 권한 허용/거부 흐름, **Web Bluetooth 미지원 안내(M13)**, 채팅 입력 시 키보드, 화면 끄기·Wake Lock | M01·M13·M15·M17·P16 |
| iPad Safari 세로/가로 | 834×1194 바텀 시트(사이드 시트 금지), 1194×834 사이드 시트, PiP 짝 정렬, 상담사 4열/3열 그리드 | S4·S5·C01·C18 |
| iPhone·iPad **Capacitor 앱**(dev 번들) | BLE 어댑터 경유 `isSupported` 값(M13 표시 여부), 상태바·안전 영역, 포그라운드 푸시, 대기열 입장 알림 문구 정확성 | M13·M20·D5 |
| Android Chrome | Web Bluetooth **실제 LINK BAND 연결**: 연결됨·신호 약함·리드오프·끊김→자동 재연결·배터리 부족, 마이크·카메라 권한 | M07~M12 |
| Android Capacitor 앱(dev flavor) | 위 항목 + 뒤로가기(종료 확인), 화면 회전 | M10·M11·C17 |
| 데스크톱 Chrome / Edge | 1280×720·1920×1080, 창 크기 변경 시 사이드↔바텀 시트 전환·레이아웃 유지, 상담사 20명 스크롤, 마이크·카메라 토글, 녹음 시작·종료, 권한 거부 | C01~C18 |
| 데스크톱 Safari / Firefox | Web Bluetooth 미지원 안내만 확인(밴드 없이 진행) | M13 |
| 두 기기 동시(상담사 + 회원) | 손들기→부여→회수, 회원 카메라 켜기→상담사 화면 영상 자리 표시, 회원 마이크 끄기, 네트워크 차단(비행기 모드)→배너→복구 | M02~M04·M14·M16·M18·M19·C02·C03·C16 |
| 실제 LINK BAND 착용 | 값 표시, 접촉 불량 안내 후 복구 시 "AI 분석중" 15초 | M10 |

각 항목은 스크린샷 1장 이상을 `specs/sdd-208-class-player-redesign/evidence/`에 저장하고 summary.md에서 참조한다.

---

## 8. 완료 판정 게이트

구현 완료(summary 작성 가능) = 아래 전부 충족.
- [ ] V1·V2: 신규 테스트 전부 통과, 기존 회귀 대상(`plan.md §7.3`)은 통과 또는 §6의 처리 결정대로 갱신
- [ ] V3: 회원 21 + 상담사 18 케이스 × 4 뷰포트 + 시트 변형 — P1~P4·P9·P11~P13 위반 0, 균형 규칙 위반 0
- [ ] V3: 보조 뷰포트(390×600, 1280×420) 도크 전 항목 도달 가능
- [ ] P5·P6·P8·X1~X3: 정적·컴포넌트 단언 통과
- [ ] P7: 마이크 꺼짐 시 AI 기록 제외·뇌파 유지 계측 통과
- [ ] P15: `tsc --noEmit`·`eslint src/`·`build` 오류 0
- [ ] V4: 배포 후 `e2e-smoke.yml`(스모크·여정·회귀·전수조사) 전부 통과
- [ ] V5: §7 전 항목 확인 및 증빙 저장
- [ ] 사용자 결정 D1~D13이 확정되고 해당 행의 문구·동작이 갱신됨
- [ ] spec + plan + verify + summary 4종 존재

## 9. 구현 전 미확정(검증 기준 확정에 필요한 사실)
- `useBand.disconnect()`가 `connecting` 상태에서 취소로 동작하는지(M08 취소 버튼)
- 진행 중 마이크 끄기 시 영상 녹화(`useVideoRecorder`, `withAudio` 훅 생성 시점 고정)의 오디오 처리 방식(C09, P7)
- 대기열 승격 감지용 `joinSessionByCode` 재호출의 서버 부작용(M20, B3 미승인 시)
- 네트워크 `reconnecting→down` 전환 시간(D9)
- iOS Capacitor 앱에서 `useBand.isSupported` 값(M13)
- 측정 환경의 Pretendard 로딩(폰트 대체로 인한 ±2px 오탐 가능성)
