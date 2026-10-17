# SDD-209 Plan — 클래스 사전·사후 흐름 리디자인 (공개 4자리 입장·사전 확인·대기·로비·종료) — R4·R5 통합본

> Stage ② Plan. **정책 정본 = [policy-revision-r4.md](policy-revision-r4.md)** (2026-10-17, Brian 확정, **`개정 R5` 섹션 = D-1~D-5 확정 반영**). 이 plan은 R4·R5를 본문에 통합한 것이며, 충돌하던 이전 설계(코드 전면 제거·회원 로그인 필수·초대 행 필수·8주 유예·거부 시 수동 기록·필수 밴드 차단·로컬 대기 이탈·30/90일 고정 보관·원본 무기한 보존·표시 이름만 입장·비회원 상담사 전달 리포트·정원 10 고정)는 본문에서 제거했다.
> 근거: 코드 조사(2026-10-17, develop) + `spec.md` + `designs/class-flow-redesign/`(시안·기획 — 시안은 R4 이전 기준선이라 **R4-0에서 정합화 후 구현**) + `investigation/` 10건(당시 코드의 증거로만 사용, 최신 요구사항으로 해석하지 않는다).
> 표기: **있음** / **일부** / **없음**(신규). 확인하지 못한 것은 `미확인`. 줄 번호는 직접 열어 확인한 값이다. **구현 전 verify 승인이 없으면 어떤 Task도 시작하지 않는다**(R4 선언: 기존 verify 승인은 무효).

## R4·R5 정책 → 설계 반영 요약 (본문 전체의 기준)

| # | R4 확정 정책 | 이 plan의 설계 |
|---|---|---|
| P1 (R5 개정) | 원본(EEG·음성·영상)은 **기본 DB 에서 설정 기간 경과 시 삭제**, 연구 동의 건은 **연구 DB 내보내기 ack 후에만** 기본 DB 사본 삭제, 기간 전 삭제·연구 DB 삭제 요청은 **플랫폼 관리자만**(대상·실행자·시각·사유 기록). 최초 활성화는 dry-run 승인 후 | 기존 스위프 2종을 설정값·세션 종료일 기준·연구 게이트로 재사용(상수 0 치환 금지), 일반 삭제·탈퇴는 숨김(보존 전환), 관리자 전용 즉시 삭제+감사 (B1·B12) |
| P2 | 거부 = 원본 수집 중지가 아니라 **리포트 반영 제외**. 고지와 리포트 선택 분리. 기본은 제외, 명시 선택 시에만 포함. 상담사용·회원용·PDF·메일·AI 입력·그룹 집계·캐시 모두 제외 | 별도 필드 `report_included`+고지 증빙+선택 이력, 업로드 게이트에서 `consent_*` 분리, 리포트 전 경로 필터·무효화 (B2·B3) |
| P3 | 전환 유예 없음. 6자리 방식은 새 4자리와 **같은 배포**에서 교체. 구 API 폴백·호환 분기 없음. 기존 테스트 데이터 비삭제 | 단일 배포 교체, 활성 클래스 코드 재발급(이전 값 보존), 구 게스트 차단 단계·폴백 플래그 폐기 (B4·I1) |
| P4 | 밴드 없이 참가 가능(필수 설정이어도). 시작 전/후 `LINK BAND 없이 계속하기`. 미측정은 0점 아님 | 밴드 게이트 제거, 필수 문구는 권장 안내로 (M5·H) |
| P5 | 로그인 없는 클래스별 공통 **4자리 숫자 코드** 입장(선행 0 보존 문자열). 계정·초대 명단 대조 없음. 코드 확인 뒤 **개인정보(이름·성별·생년월일·이메일) 입력 후 입장**(R5, 이메일 OTP 없음). 성공 시 서버가 클래스/참여자 범위의 **만료 가능한 입장 자격** 발급, 이후 REST·WS·LiveKit·EEG·리포트 선택은 이 자격으로 소유권 검증. 코드는 상시 인증 토큰이 아님 | 공개 입장 API+입장 자격+소유권 통합 (B4·B5, M0~M2) |
| P6 | `대기 취소`(서버 대기열에서 실제 제외, 행 삭제 없음, 재대기는 끝 순번) | 취소 API+참가자 상태 필드+잠금 순서 (B6, M8) |
| P7 | 초대 등록 성공과 채널 발송/전달 성공 구분, 기본 문구 `초대했어요`, 푸시 수신 약속 금지 | 초대 응답 분리·재발송 실제 결과 (B7, H) |
| P8 (R5) | **연구 목적 데이터 활용 동의**(입장 전 동의 단계, 별도 체크, 거부해도 참여 가능, 무기한 보관·재식별 위험 고지). 동의 건만 **연구 DB(DGX Spark)** 에 비식별 데이터(EEG/PPG/ACC·지표)+암호화 이름 ID+성별+생년월일을 **덮어쓰지 않고 누적** | 연구 동의 모델·이력(B11), 내보내기 배치·pull 전송·암호화 ID(B13), 삭제 스위프 ack 게이트(B12) |
| P9 (R5) | 비회원은 **상담사 이메일 초대(메일에 4자리 코드) → 코드 입력 → 개인정보 입력 후 입장**, 종료 후 리포트는 **입력 이메일로 자동 발송**(OTP 없음, Celery `email_app`) | 이메일 초대·리포트 자동 발송(B14), FM04·FM04b |
| P10 (R5) | 4자리 코드 노출 위험 수용: 시도 제한 + 종료 즉시 무효화만 (입장 승인·재발급 후속). 그룹 정원은 **스텐퍼**(기본 10, 온라인 그룹 최대 50, 1:1 은 1명 고정) | B4, H1 |

---

## 0. 조사로 확정한 사실 (spec·기획 가정과 다른 점 포함)

## 0. 조사로 확정한 사실 (spec·기획 가정과 다른 점 포함)

| # | 사실 | 근거 |
|---|---|---|
| F1 | **현행은 회원이 참여자가 되고 EEG 를 올릴 수 있게 되는 경로가 `/sessions/by-code/{code}/join`(6자리)뿐**이며 이 경로가 `consent_eeg=True` 를 기록하고, EEG 업로드는 `consent_eeg` 로 판정한다(`_assert_upload_eligible`). 초대 행은 `consent_eeg=False` 라 업로드 403. **R4 에서는 업로드 판정을 리포트 선택과 분리**해야 하므로(P2) 업로드 게이트를 `참여자 소유권`으로 바꾸고, `test_sdd026_live_session_p0.py:298-320` 의 "초대 회원 업로드 403" 기대값은 **의도적으로 변경되는 테스트**다(구현 때 갱신, 완화가 아님). `consent_audio/eeg` 컬럼 의미는 바꾸지 않는다. | `session_service.py:1586-1594,1614,1618`, `:2507-2517`, `:1445-1482`, `tests/test_sdd026_live_session_p0.py:298-320` |
| F2 | 코드로만 호출되는 현행 엔드포인트 4개: `GET /by-code/{code}`(무인증 조회), `POST /by-code/{code}/join`, `GET /by-code/{code}/state`(무인증·`participant_id` 만으로 본인 EEG 지표 반환 — 소유권 검증 없음), `POST /by-code/{code}/livekit-token`. **R4 에서는 이 4개를 4자리 공개 입장 API + 입장 자격 기반 엔드포인트로 교체**하며 구 경로는 폴백으로 남기지 않는다(P3). 손들기·체크인·리포트 신청·WS·EEG 업로드는 로그인 회원(`user_id`)만 지원하므로 **비회원(입장 자격) 소유권 지원이 B5 의 핵심 범위**다. | `api/v1/session.py:74-130`, `session_service.py:2179-2248`(B0 정정: 기존 표기는 오기), `report_email_service.py:66-68`, `session_service.py:2292-2370` |
| F3 | 코드/참여자 토큰에 의존하는 프론트 호출부: `class-join-page.tsx`, 진행 화면 `MemberClassContainer`(`:115` 조회, `:163` 상태 폴링, `:316` `useMemberLiveKit`), `hooks/useMemberLiveKit.ts:60`, 상담사 `ToolsSheet.tsx:64`·`HostLiveView.tsx:155` 의 코드 박스. **R4: 상담사 코드 박스는 제거가 아니라 4자리 코드 표시·공유로 전환**하고, 회원 진행 화면은 입장 자격 기반 어댑터로 전환한다. | `lib/api/session.ts:315-330,401-415,488-493` |
| F4 | 리마인더 메일·인앱 알림이 `/join` 과 6자리 참여코드를 안내한다(`참여코드: {code}`, `{frontend_base_url}/join 에서 참여코드를 입력하고 입장해 주세요`, 알림 extra 의 `access_code`). **R4: 4자리 코드와 `/join` 링크(코드는 URL 에 싣지 않음 — 접근 로그 노출 방지)로 본문 갱신.** 일반 세션 알림(오픈·시작·종료·취소·초대)은 `session_id` 만 싣고 프론트가 로그인 회원을 `/app/sessions/:id` 로 보낸다(변경 불필요). 푸시는 `/join` 을 열 수 없는 화이트리스트(`lib/native/push.ts:8-17`) — 푸시에서 `/join` 직행은 이번 범위 밖. | `reminder_service.py:139-153,170-175,265-268`, `lib/api/notifications.ts:153-155` |
| F5 | 로그인 후 원래 링크로 돌아가는 기능은 회원에게 없다(`RoleGuard.tsx:23-25`, `auth-routing.ts:4-9`, `LoginPage.tsx:36`, `ClientLoginPage.tsx:4`). **R4 에서 입장은 로그인이 필요 없으므로 이 기능은 입장 경로의 전제가 아니다** — 로그인 회원의 상세 딥링크 편의로만 남기며 이번 범위에서 제외(후속). | 좌측 파일들 |
| F6 | Capacitor 앱은 번들된 웹 자산을 쓰고(`capacitor.config.ts:5-6`) 강제 업데이트 장치가 없다. **R4 는 유예·구 API 폴백을 두지 않기로 확정(P3)** → 구 앱 번들의 6자리 입장은 배포 즉시 실패한다(수용된 영향). 구 번들이 받는 실패 응답이 사용자에게 "앱 업데이트" 안내로 읽히는지는 `미확인`(B4 에서 구 경로 응답 문구만 확인, 구 로직 유지는 하지 않음). | `capacitor.config.ts:5-6`, `ClientSessionDetailPage.tsx:137-176` |
| F7 | **서버는 이미 "0명이어도 시작"을 허용한다**(그룹 `start` 의 최소 인원 검사는 로그만 남기고 통과, SDD-101). 막고 있는 것은 프론트 `canStart`(그룹은 `activeCount>=1`)뿐. 예약 시각 이전 오픈도 서버·프론트 제한 없음. → 결정 5 는 프론트 변경만으로 충족. | `session_service.py:867-878`, `ClassPlayerPage.tsx:1323-1332` |
| F8 | **서버는 `in_progress` 에서도 회원 입장을 허용한다**(by-code join 은 종료·오픈 전만 막음, LiveKit 토큰도 종료만 막음). 막고 있는 것은 프론트 대기실 게이트(3단계 통과해야 자동 입장, 미완이면 `입장하기` 비활성·강제 입장 없음). 시작 후 입장 회원이 대기실을 건너뛰는 경로는 없다. | `session_service.py:1552-1562,1700`, `ClassWaitingRoom.tsx:325,338-343,579`, `class-waiting-room.ts:84-93` |
| F9 | **참여자 이름이 UUID 로 나오는 원인(A6)은 서버 DTO**: 프론트 타입은 `user_name`·`user_email` 을 기대하지만(`lib/api/session.ts:43-44`) 서버 `_serialize` 참여자 dict 와 `ParticipantInfo` 스키마에 없다. 이름은 WS `participant_changed` 와 호스트 전용 `live-metrics` 의 `display_name` 에만 있다. `_serialize` 호출부 20곳. | `session_service.py:85-148`, `schemas/session.py` `ParticipantInfo`, 조사 03 §2.5 |
| F10 | **예약 모달이 방식을 서버에 안 보내는 버그(A2)는 프론트만의 문제**: 서버 `SessionCreateRequest` 는 `location_type`·`location_address`·`participant_mode`·`linkband_mode`·`record_audio/video`·`reminder_offsets`·`participant_ids` 를 모두 받는다. 모달 payload 에는 없고 `notes` 에 `[온라인]` 문자열만. 그 결과 예약으로 만든 클래스는 서버 기본값(오프라인·**1:1**·정원 10)으로 저장돼 있다. | `schemas/session.py:20-62`, `SessionListPage.tsx:76-88` |
| F11 | `duration_min` 서버 검증은 `1~600` 뿐이고 5분 배수·`scheduled_at` 분 단위 검증이 없다. 시간 충돌은 409 + 고정 문구뿐(충돌 대상 정보 없음), `force=true` 로 우회. 열기 가능 시점은 `ready`·`scheduled` 둘 다 언제든 가능(`TRANSITIONS["open"]`). | `schemas/session.py:24`, `session_service.py:233-258,279-289` |
| F12 | 현행 동의 컬럼 `session_participants.consent_audio`·`consent_eeg`(기본 False)는 `consent_audio` 쓰는 곳 없음, `consent_eeg` 는 업로드·내보내기 게이트. 사용자 단위 `consents`(가입 시)는 세션 판정이 읽지 않는다. 상담사 녹음 시작(`audio/start` 의 `consent_audio`)은 별개이며 `SessionRecord.status`(`recording`/`manual`)로만 남고, **`audio/start` 는 `open` 에서 400** 이라 `start` 직후에 호출해야 한다. **R4: 이 컬럼들의 의미를 바꿔 재사용하지 않는다** — 리포트 선택은 신규 `report_included` 등 별도 필드, 내보내기 권한을 리포트 선택과 혼용하지 않는다(내보내기 게이트 재정의는 B2 점검 항목). | `models/session.py:118-119`, `models/consent.py`, `audio_service.py:69-99`, 조사 07 §1 |
| F13 | 전극별(L·R) 접촉 상태는 **서버에 도달하지 않는다.** 프론트는 `lead_off` 를 WS `feature` 에 실어 보내지만 서버 핸들러가 읽지 않는다. 서버 `device_status` 는 SQI(≥0.7 ok)·10초 staleness 로 서버가 판정한 단일 값이다. 대기실 presence 의 `readiness` 는 boolean 3개만 허용(`_sanitize_readiness`). `bandDone` 만으로는 연결과 건너뜀이 구분되지 않는다. | `useBand.ts:489-505`, `session_live_namespace.py:587-640,1412-1417`, `session_service.py:2424-2439` |
| F14 | 프론트에서는 전극 상태가 `LeadOffStatus {ch1, ch2}` 로 존재하고(`useBand.ts:342,1097-1099`) `SensorTracker` 가 L·기준·R LED 를 그린다(색만, 체크·엑스 없음). **그러나 `SensorTracker`·`LeadOffModal` 은 지금 어떤 화면에서도 렌더되지 않는 죽은 코드**다(유일한 사용처 `GuestMeditationPanel` 이 SDD-208 로 교체됨). `leadOff===null` 이면 전부 빨강(오표시 위험), 색이 어두운 배경에 하드코딩. ch↔좌우 실제 매핑은 SDK 문서로 미확인(현행·시안 모두 ch1=왼쪽 가정). | `SensorTracker.tsx:13-73`, 조사 05 §0 |
| F15 | 대기실 presence 는 서버에 저장되지 않는 휘발성 이벤트이고 **호스트 룸에만** 방송된다(회원에게는 인원 집계가 가지 않음). 호스트 클라이언트가 15초 heartbeat·45초 TTL 로 정리. 호스트의 대기실 구독이 `isLobby` 에서만 켜져 **시작 직후 준비 중 회원이 호스트에게 안 보인다**. 상담사 "다시 알림"(`waiting_room_remind`)은 대기실 소켓이 연결된 회원에게만 닿고 성공 수를 과장한다. 아직 입장하지 않은 초대 회원에게 다시 알리는 API 는 없다. 설문 응답 전에는 호스트 목록에 안 뜨는 현상의 근본 원인은 미확인(레이스 후보). | `session_live_namespace.py:752-825,1078-1091`, `ClassPlayerPage.tsx:995`, 조사 04 §2-2·§2-3b |
| F16 | 마이크 레벨은 대기실(`ClassWaitingRoom.tsx:169-196`)과 상담사 프리뷰(`SessionPreJoinPreview.tsx:113-133`)에 **같은 RMS 계산이 복제**돼 있다(`AnalyserNode` fftSize 512, `min(1, sqrt(mean)*3)`). 칩 버그의 원인은 **상태 모델**: `getUserMedia` 모든 오류를 `'denied'` 한 값으로 저장하고(`ClassWaitingRoom.tsx:244-248`) 칩이 그 값을 "권한이 거부되었습니다"로 찍는다. 정확한 분류(`NotFound`/`NotReadable`)는 `mediaErrorMessage` 에 이미 있으나 칩에 안 간다. 마이크 권한 요청은 페이지 진입 즉시 자동 발생(`:253-265`). **`SessionPreJoinPreview` 의 마이크 OFF 확인 다이얼로그는 어느 경로로도 열 수 없고**(오픈 버튼이 헤더에서 `openClass` 직접 호출, 프리뷰 내부 버튼은 compact 라 숨김), 프리뷰가 마운트 직후 `{cameraOn:false, micOn:false}` 를 보고해 권한 확인 전 오픈하면 수동 기록이 확인 없이 선언될 수 있다. 회원이 대기실에서 고른 카메라·마이크는 진행 화면에 승계되지 않는다. | `class-waiting-room.ts:92-124`, 조사 06 §0 |
| F17 | CI/배포: `deploy-dev.yml` 은 **한 SSH 스크립트 안에서** 프론트 `dist` 교체 → 백엔드 소스 교체 → `alembic upgrade head` → 재시작 순서(프론트·백엔드를 따로 배포하는 구조가 아님). 롤백 트랩은 `dist`·`app`·`alembic` **디렉터리만** 복원하고 **DB 는 되돌리지 않는다**. 현재 alembic head = `e036a0000041`(파일 74개). `e2e-smoke.yml` 이 배포 직후 `smoke → journeys → regressions → full-journey`. `ci-feature.yml` 은 `tsc --noEmit`·`eslint src/`·`npm run build`·백엔드 `pytest` 차단, `npm test` 비차단. 운영(main) 배포 파이프라인은 저장소에 없다(미확인). | `.github/workflows/deploy-dev.yml:118-144,150-227`, `e2e-smoke.yml`, `ci-feature.yml` |
| F18 | E2E 가 바뀌는 화면에 문구·구조 단언을 걸고 있다: `full-journey.mjs:190` 이 `/join?code=` 진입 후 `건너뛰기`·`밴드 없이 진행하기`·`기기 테스트 건너뛰기` 를 누르고, `journeys.mjs` 가 `세션`(`:9`), 홈 히어로 `다음 세션`+`section[class*="from-[#6E1A8C]"]`(`:13-24`), `예약 만들기`·`즉시 클래스`·`전체 목록`(`:59`), `새 세션 생성`·`세션 생성 닫기`(`:63-64`)를 단언. `e2e/class-player/live.mjs` 도 by-code 스텁·`/join` 화면 단언(약 10곳), `scripts/verify-landing.cjs:35,73` 이 `['클래스 바로 참여','/join']` 검증. | 조사 01 §2.5, 조사 03 §4 |
| F19 | 백엔드 테스트 중 by-code/게스트 경로를 **참가자 생성 헬퍼로 쓰는 파일 24개**(`by-code`), `guest`/`participant_token` 언급 42개(`test_sdd021` 13, `test_sdd015` 11, `test_sdd088` 8, `test_sdd026` 8, `test_sdd023` 6). R4 는 6자리→4자리·입장 자격 교체를 같은 배포에서 하므로 **헬퍼를 전부 새 입장 경로로 갱신**해야 한다(구 경로 호환 테스트 없음). | 조사 01 §4-3 |
| F20 | 알림 이벤트 제목·본문은 "세션" 어휘를 쓴다(예약·즉시·시작·종료·취소·초대: `session_service.py:365,810,823,960-965,1318,1363`). 푸시와 인앱이 같은 문자열을 공유. 백엔드 `detail="…세션…"` 42곳, `or "세션"` 8곳(테스트 단언 0건). 용어 통일(결정 7) 대상이지만 spec 비범위(푸시 콘텐츠)와 겹침(D15). | 조사 08 부록 E |
| F21 | 시안 4종 케이스 **기준선 205개**(회원 86 · 상담사 119: member-a 23, member-b 63, host-a 43, host-b 76). 하니스 URL 규약은 시안과 같게 `?screen=<ID>&case=<키>`. **R4-0 에서 시안·기획을 정합화하며 케이스 수를 다시 산출**한다(증감은 verify §6'). 목록: `investigation/_mock-index.md`(기준선). | 시안 `?index=1` |
| F22 | 진행 화면(SDD-208) 자산: `PlayerSheet`(바텀/사이드 판정 `sheet-mode.ts`)·`PlayerBackdrop`·`NoticeBanner/NoticeOverlay`·`IconCircleButton`·`player-tokens.css`(`.pz-root` 스코프, 값이 시안 `tokens.css` 와 같음), 하니스 `pages/design/ClassPlayerCasesPage.tsx` + 측정 `e2e/class-player/{lib,fit,symmetry-*}.mjs`(`data-pz` 계약). `PlayerDock`·`StatusRing` 은 사전 흐름에 쓰지 않는다. **`PlayerSheet` 는 플레이어 그리드(`.pz-shell`) 안에서만 자리를 잡는 다크 전용이라 셸형(라이트)에는 재사용 불가** — 셸형은 별도 시트가 필요. `flow-base.css` 의 `.fl-*`/`.sh-*` 는 `.pz-*` 와 이름이 겹치지 않는다. | `components/class/player/shared/*`, `player-shared.css:182-192`, `flow-base.css`, 조사 08 §0-3 |
| F23 | 현행 정원 = 참여자 행 수(초대 행도 좌석 점유), 승격은 호스트가 회원을 제거할 때만(`max_participants` 증가는 승격 안 됨), 회원 "나가기"는 서버 호출 없음(좌석 유지), 승격 감지(5초 `joinSessionByCode`)는 호스트에 `participant_changed` 를 매번 발행, 대기열 회원도 대기실 presence 를 보냄. **R4: 코드 입장자도 정원 점유 대상이라 대기열이 드문 화면이 아니며, 대기 취소가 서버 대기열에서 실제 제외돼야 한다(P6).** 취소자가 자동 승격 대상에서 빠지고 토큰이 거부되도록 승격 로직을 같이 고친다. 현행 `"입장 알림은 이 기기와 푸시로"` 문구의 실제 채널은 인앱·WS(푸시 outbox 없음). | `session_service.py:1211-1231,1258-1263,1345-1353,1367-1373`, 조사 09 §2.1-2.2 |
| F24 | 종료 화면: 회원 종료 카드는 시안과 구조가 거의 같으나 시트가 `.mp-legacy-panel`(라이트) + 레거시 두 패널을 감싸 **2중 스크롤**, 사후 체크인 완료 시 패널이 `null` 이라 빈 시트, "함께한 시간"은 클라이언트 `now − startedAt` 계산(서버 `ended_at` 와 불일치 가능). 상담사 종료는 `finishSession` 이 응답을 버리고 `/record` 로 즉시 이동, `HostEndingCard`(3단계)는 미연결. **시안 FH09 의 4단계는 서버 `steps[]` 4키(`save/stt/summary/ready`)와 1:1** 이고, 수동 기록은 `generation_status=partial` 이면서 `ready: active` 라 현행 폴링 훅이 멈춘다 → 판정은 `steps[ready].state` 로. | `report_progress_service.py:44-196`, `hooks/useReportProgress.ts:126-132`, 조사 09 §2.4-2.5 |
| F25 | 취소 시각을 저장하는 컬럼이 없다(`cancel` 은 `ended_at` 도 안 채움). 시안 FH10 `닫은 시각`·`대기 중이던 회원 N명`(재진입)은 서버에 없는 값. 알림 전달 상태(`오후 2:30에 알렸어요`/`전달되지 않았어요`) 조회 API 도 없다(초대 응답에는 알림 결과가 없고 알림 실패는 서버가 삼킴). 참여자 상태 `참여함`/`접속 중` 을 알 필드가 없다(`joined_at` 은 행 생성 시각). | 조사 03 §2.6, 조사 09 §2.6, 조사 08 |
| F26 | 초대 회원이 상담사와 미연결이면 `/app/*` 가 상담사 코드 입력 화면에 막힌다(`ClientAppPage.tsx:267-291`). **R4 의 공개 입장(`/join`)은 `/app/*` 밖이라 영향이 없다.** 로그인 회원이 홈에서 들어가는 경로만 관련 — 이번 범위에서는 현행 유지(후속). | `ClientAppPage.tsx:267-291`, `session_service.py:1267-1322` |
| F27 | 상담사 목록 카드의 `시작하기` 직결(시안 FH01)은 결정 8(시작 전 녹음 동의 확인 = FH07)을 우회할 수 있다. `delete_session` 은 상태 가드가 없어 진행 중·완료 클래스도 API 로 삭제된다. 목록 필터 `SessionListPage.tsx:692-696` 이 open 클래스를 즉시 표에서 누락(실증 S-H21). | 조사 08 §4, `session_service.py:817-832` |
| F28 | `list_sessions`·by-code join 응답이 `_serialize` 를 PII 기본값(참)으로 호출해 **참여자(회원)가 타인의 성별·생년월일을 받을 수 있다**(코드 정독, 실행 미재현). 참여자 DTO 의 `consent_audio/eeg` 도 비호스트에게 타인 값이 노출된다. 이름 필드를 추가할 때 같이 고쳐야 한다. | `session_service.py:128-138,621,653,1567,1627,1681`, 조사 03 §2.5-4, 조사 07 §1 |
| F29 | **`sessions.access_code` 는 `String(6)`·전역 `unique=True`·index.** 4자리(0000~9999, 10,000개) 코드는 종료 클래스 값까지 포함하는 전역 unique 로는 곧 고갈된다. 코드 생성은 `generate_access_code`(`session_service.py:215`). → **활성/입장 가능 클래스 사이에서만 unique**(부분 유니크 인덱스)하도록 제약을 바꾸고, 종료·취소 클래스는 조회에서 무효화(값은 보존)한다. 제약 변경이 있는 마이그레이션이므로 §9.3 안전 절차 적용. | `models/session.py:45`, `session_service.py:215` |
| F30 | **원본 삭제 경로(코드 확인)**: ① `MEDIA_RETENTION_DAYS = 90`·`sweep_stale_media`(`media_cleanup_service.py:26,61~`, 행·실제 객체 삭제, 상수를 0 으로 바꾸면 현재 이전 데이터가 전부 삭제될 수 있음 — **R5: 폐기가 아니라 설정값·세션 종료일 기준·연구 게이트로 재사용**, 자세한 조사 표는 policy R5-C2) ② `delete_session` → `delete_session_media`(`session_service.py:817-830`) ③ `delete_user_media`·`admin_service.delete_user`(`admin_service.py:711`) ④ 청크 모델 FK 가 `sessions` 에 `ondelete="CASCADE"`(`AudioChunk`/`VideoChunk` `record.py:56,77`, `EEGRawChunk` `:144,148`, `Report` `:213`, `EEGRecord` `:103`, `eeg_feature.py:58,66`) ⑤ **B0 확정(조사 11 §2)**: 삭제 경로는 위 ①~④ 외에 **`remove_participant`(`session_service.py:1325-1341`, 참가자 제거 시 EEG 행 CASCADE 삭제 + S3 객체 고아)**, 영상 병합 후 원본 청크 즉시 삭제(`video_service.py:82-102`), EEG raw 고아 정리(`eeg_raw_service.py:352-410`)가 더 있다. **`sweep_stale_media`·`sweep_stale_eeg_raw` 는 dev crontab 에 이미 등록돼 매일 실행 중**(`deploy-dev.yml:275-276`, 04:45/04:30 UTC, 2026-10-06 `24f52f25`) — 음성·영상 청크 90일 삭제가 **현재도 동작**, EEG 는 무기한(설정 0). 병합 영상·STT 원문·리포트 스냅샷은 어떤 스위프에도 없다. FK `ondelete` 는 삭제의 원인이 아니라(앱 코드 `db.delete`/명시 DELETE) 변경 불필요. | 좌측 파일들 |
| F31 | **리포트 반영 제외가 걸려야 하는 경로는 B0 에서 전수 확정(조사 11 §3, R1~R16).** 핵심: ① 리포트는 `reports.content`(JSONB)에 **스냅샷으로 저장**되므로 선택 변경 시 재생성/방어 필터가 필요 ② `narrative_cache` 는 6자 지표방향 시그니처 키의 **전역 패턴 문장 캐시**(세션·참가자 정보 없음)라 무효화 대상이 아님 ③ PDF 는 저장하지 않고(`pdf_url` 쓰는 코드 없음) 내용 해시 키 메모리 LRU 뿐 ④ 이메일 링크(`report_view` 7일 JWT)·공개 `GET /reports/view` 는 선택 상태를 확인하지 않음 ⑤ 상담사 리포트는 전 참가자 발화(`transcript_segments`)·영상 가용 여부를 담고 EEG 는 **첫 참가자 1명만** 집계 ⑥ 그룹 집계(`group_aggregate`)는 WS 실시간 전용으로 리포트에 쓰이지 않음. 그룹 공통 녹음은 참여자별 기여분 분리가 불가능하므로 R4 에 따라 비동의(제외) 참여자가 1명이라도 있으면 해당 원본에서 파생한 공통 요약을 리포트에 넣지 않는다. | 조사 11 §3 |
| F32 | 비회원 입장 자격이 사용할 수 있는 기존 기반(B0 확정: 조사 11 §4): 게스트 참가자 행(`user_id` NULL·`guest_name`)과 `participant_token` 경로(`resolve_live_join`·`resolve_signal_sender`·`resolve_upload_participant`·`get_current_user_optional`·WS 무토큰 연결·`_authorize_participant_access` 게스트 분기). 이 경로는 무토큰/약한 검증이 섞여 있어 **그대로 재사용하지 않고 입장 자격 검증으로 통일**한다(공개 경로의 권한 검증은 완화하지 않는다 — R4-6). **B0 확정**: 토큰(`report_participant` JWT, 7일 고정, 폐기 버전 없음) 검증이 있는 곳은 LiveKit 토큰·손들기·체크인·메일 신청뿐이고, **상태 조회·WS join/feature·무음 신호·EEG 업로드는 `participant_id` 단독 신뢰**다. 게스트 채팅은 현재 미지원(채팅 REST·WS 가 로그인 JWT 필수)이라 BE-5b 의 채팅 항목은 통일이 아니라 **신규 기능**이다. | `session_service.py:2292-2370`, 조사 01 §2 |
| F33 | 배포(F17)는 한 SSH 스크립트에서 프론트 `dist` 교체 → 백엔드 소스 교체 → `alembic upgrade head` → 재시작이며, 롤백 트랩은 **DB 를 되돌리지 못한다.** R4 는 유예 없이 한 배포에서 6자리→4자리를 교체하므로(P3) **마이그레이션은 추가형+제약 교체만, 데이터 변경은 별도 멱등 스크립트(dry-run 필수)**, 롤백은 코드만 되돌려도 구 코드가 동작하도록 설계한다(§9.3). | `deploy-dev.yml:118-144,150-227` |
| F34 | **R5 비회원 개인정보·메일 기반(코드 확인)**: `session_participants` 에 `guest_name`·`gender`·`birth_date`·`report_email`(+`report_email_status`·`report_email_sent_at`)가 **이미 있다**(`models/session.py:105-111`). 현행 게스트는 이메일을 OTP 로 인증한 뒤에만 `report_email` 이 채워진다(`report_email_service.py:75-85`). R5 는 이메일을 입장 시 입력받고 OTP 를 하지 않으므로 **기존 컬럼 재사용(추가 컬럼 불필요)**, 인증 분기(`email_verified`)만 `입장 시 입력값` 으로 바뀐다. 메일 발송은 Celery `email_app`(큐 `email`, 별도 워커 `mindbreeze-email-worker` / compose `-Q email`)이며 워커가 없으면 큐에 쌓인다. | `models/session.py:105-111`, `tasks/report_email_task.py:9-11`, `docker/docker-compose.dev.yml:44-52` |
| F35 | **R5 기본 DB 삭제 스위프(코드 확인)**: 음성·영상 청크 스위프 `sweep_stale_media`(상수 90일, 청크 `created_at` 기준, cron 스크립트 `backend/sweep_stale_media_cron.py`), EEG raw 스위프 `sweep_stale_eeg_raw`(`settings.eeg_raw_retention_days` 기본 0=무기한). 비회원 개인정보 스크럽·연구 게이트·dry-run 은 **없음**. 두 스위프는 서로 다른 설정 체계(상수 vs 설정값)이고 기준일이 청크 시각이라 클래스 단위 종료일 기준 통일이 필요하다. **B0 정정**: 두 cron 은 **이미 dev 에서 활성**(조사 11 §S1)이라 "스위프 비활성 배포 = 변동 0" 이 현행 90일 음성·영상 삭제의 중단을 뜻한다. 병합 영상·STT 원문 컬럼 비움은 기존 스위프에 없다(신규). | `services/media_cleanup_service.py:26,100-155`, `services/eeg_raw_service.py:326-400`, `config.py:78-79` |
| F36 | **R5 연구 DB(DGX Spark) 네트워크**: Spark 는 `kccs@192.168.45.149`(사설 LAN) — 운영 EC2(AWS)에서 직접 접속 불가, 일반 ssh 만 허용(tailscale ssh 금지). 따라서 운영→Spark push 가 아니라 **Spark 가 아웃바운드로 당겨가는 pull**(S3 스테이징 prefix + ack API)을 권장한다(policy R5-C6). 이 SDD 는 실제 접속·전송을 하지 않는다. | policy R5-C6 |

---

## 1. 목적·범위 + 시안/케이스 → 구현 컴포넌트 매핑

**목적**: 클래스 생성 → **로그인 없는 4자리 코드 입장(코드 → 개인정보 입력)** → 사전 확인(고지·리포트 반영 선택·연구 동의·설문·밴드·기기) → 시작 대기 → (진행: SDD-208) → 종료를 진행 화면과 같은 디자인 언어로 통일한다. 범위: 회원·비회원 참가자 FM01~FM03·FM04(코드 입장, **R4 로 부활·신규**)·FM05~FM10, 상담사 FH01~FH10, 4뷰포트(390×844·834×1194·1194×834·1280×720). **시안·기획은 R4 이전 기준선이므로 R4-0(시안 정합화)이 모든 구현 Task 의 선행이다.**

### 1.1 신규 코드 위치와 접두어
```text
frontend/src/
├─ lib/class/flow/                   # [T1] 케이스 키 파서·레지스트리·파생 순수함수·픽스처
├─ lib/class/{class-media,band-step,class-labels,enter-action,pick-hero-class,class-when}.ts   # 순수 로직(조사 05·06·08 제안)
├─ lib/api/class-flow.ts             # [M1] 공개 입장·입장 자격 API 어댑터(enter-by-code · entry-state · report-choice · waitlist-cancel · livekit-token) — session.ts 무수정, 폴백 없음
├─ hooks/{useMediaCheck,useEnterClass,useClassList}.ts
├─ components/class/flow/
│  ├─ shared/   (소유 S)             # FlowRoot·FlowTopBar·FlowCard·FlowButton·FlowChip·FlowSteps·FlowStateScreen·ElectrodeLeds·MyAvCheck·PermissionHelpSheet + flow-tokens.css·flow-shared.css
│  ├─ member/   (소유 M)             # 입장 확인·마법사 5단계·시작 대기·대기열·종료
│  ├─ host/     (소유 H)             # 만들기 마법사·생성 완료·세팅·로비·시작 확인·닫기·종료·상태
│  └─ shell/    (소유 SH)            # 셸형 라이트 키트 + 회원 홈·목록·상세, 상담사 목록·상세 뷰
└─ pages/design/ClassFlowCasesPage.tsx   # [T3] 하니스 /design/class-flow
```
CSS 접두어(조사 10 §4-3 하이브리드): 시안과 같은 `fl-*`(몰입형)·`sh-*`(셸형)를 **그대로 유지**하고 트랙 전용은 `fm-*`(회원)·`fh-*`(상담사)로 분리한다 → 시안 ↔ 코드 1:1 대조가 쉽고 `pz-*`·Tailwind 와 충돌하지 않는다. **`pz-*` 로 통합하지 않는다.** 시안 `flow-base.css` 이식 시 앱 전역 h1/h2/p 색 규칙(`mb-tokens.css:187-228`)이 `.fl-h1`·`.fl-h2` 를 어둡게 만드는 SDD-208 과 같은 결함이 재발하므로 `.fl-h1,.fl-h2{color:var(--tx-hi)}` 를 명시하고 글자 대비(PC 3:1) 검사를 사전 흐름 fit 에 넣는다. 셸형은 `.sh-scope` 라이트 토큰 선언이 필수(빠뜨리면 버튼·칩이 투명/기본색). `.fl-root` 의 `100vw` 는 세로 스크롤바가 있는 환경에서 가로 넘침을 만들 수 있어 `100%` 를 쓴다(시안 측정은 `--hide-scrollbars` 로 돌려 미검증).
- **SDD-208 공용 파일 재사용**: `IconCircleButton`·`NoticeBanner`·`NoticeOverlay`·`PlayerBackdrop`·`sheet-mode.ts`·`player-tokens.css` 는 그대로, `PlayerShell`(CTA 푸터·시트 아래 비활성)·`PlayerSheet`(스크림·높이 상한·닫기 불가·불투명도)·`PlayerTopBar`(`variant="flow"`) 는 **기본값 = 현행 동작인 추가 props** 로만 확장(소유 S, `class-player-shared.test.tsx`·`selftest.mjs` 가 계속 통과해야 함). 확장이 부담이면 사전 흐름 전용 `FlowSheet` 를 만들고 `useSheetMode`·`IconCircleButton` 만 재사용(포커스 복귀·Esc·바깥 클릭 로직 복제 → 확장 권장). `PlayerDock`·`StatusRing` 은 쓰지 않는다(호스트 로비 도구 행만 가능성). 몰입형 루트는 `className="pz-root fl-root"` 로 `player-tokens.css` 를 상속한다(시안 `tokens.css` 와 값 동일 — 대조 확인). `flow-tokens.css` 는 시안 `flow-base.css` 의 추가 변수(`--sp-*`·`--col-w`·`--ok`·`--warn`·`--ink*`·`--shell-*`)만 `.fl-root`/`.sh-root` 스코프로 이식. 셸형은 라이트 토큰 블록을 따로 두고 **다크 면(히어로·시트)에만 `.pz-root` 를 씌운다**(`.pz-root` 는 글자색을 밝게 지정하므로 라이트 본문 전체에 씌우면 안 됨 — 조사 08 §0-4). 디자인 토큰은 새로 만들지 않는다.

### 1.2 화면 × 케이스 × 현재 코드 × 담당 파일

| 화면 ID | 케이스 수 | 판정 | 현재 코드에 있는 것 | 없는 것 / 변경 | 담당(신규 → 교체 대상) |
|---|---|---|---|---|---|
| FM01 홈 히어로 | 5 | 일부 | `ClientHomePage.tsx` 히어로, `pickUpcomingClass`(`reminder.ts:86,89` 시작 시각이 지난 scheduled 를 버림) | 상태별 CTA 정합(`isLive`에 ready 포함 `:78,263` 수정), 참여코드 칩·복사 타일은 회원 화면에서 제거(코드는 상담사가 전달 — 회원 화면에 코드를 노출하지 않음), 4상태+빈 상태, 카운트다운, 홈 보조 섹션(D13), **홈에서 코드 입장 진입점(`코드로 입장하기`) 추가** | SH: `flow/shell/ClassHero` → `ClientHomePage.tsx` |
| FM02 목록 + 신청 시트 | 3 | 일부 | `ClientSessionListPage.tsx` 이중 렌더(`:347,363`), `SessionCard`, 신청 모달(`z-50` 탭바 충돌) | 입장 가능 최상단, 카드 정보 축소, 이중 렌더 제거, 캘린더·타임라인 제거(D-5② 확정), 신청 바텀 시트(셸 전용 `ShellSheet`, 포털 `z-[60]`) | SH: `ClassCard`·`ApplySheet` |
| FM03 상세 4상태 | 7 | 일부 | `ClientSessionDetailPage.tsx`(방식·장소·시각 DTO 이미 있음) | 방식 칩·시작까지 남은 시간·준비물 3줄·입장 CTA 1개, 오프라인 장소 | SH: `ClassDetailView` |
| FM04 코드 입장(**R4·R5**) | 시안 필요(예상 4~6: 기본·입력 중·오류·시도 제한·종료 코드·로그인 회원) | **없음** | `class-join-page.tsx` 코드 입력 단계(6자리) | 4자리 숫자 입력만(선행 0 보존 문자열, **이 화면에서 개인정보는 받지 않음**)·`POST /sessions/enter/verify` 로 코드 확인, 오류 문구는 없는/틀린/종료 코드 **구분 없이 동일**(정보 노출 방지), 시도 제한 안내 | M: `CodeEntry` (교체 대상 `class-join-page.tsx`) |
| FM04b 개인정보 입력(**R5 신규**) | 시안 필요(예상 5~7: 기본·입력 중·검증 오류·이메일 확인 불일치·로그인 회원 자동 채움) | **일부** | `class-join-page.tsx` 게스트 이름·성별·생년월일 입력(이메일은 OTP 패널) | 코드 확인 성공 후 클래스 요약(제목·시각·진행자) 위에서 **이름·성별·생년월일·이메일 입력**(이메일 확인용 재입력 1회, **OTP 없음**), 로그인 회원은 계정 값으로 채워 확인만, 입력값은 `POST /sessions/enter` 본문으로만 전송(저장소·URL·로그 금지), 제출 = 입장 자격 발급 | M: `ProfileEntry` |
| FM05 입장 확인 | 3 | 일부 | `class-join-page.tsx` details 단계 | 코드 검증 성공 후 클래스 확인 카드(제목·시작 시각·진행자 `host_name` 권장 BE-4), 열림 전 "열리면 자동으로 입장해요" 대기 카드, **개인정보 입력(FM04b) 직후 입력한 이름을 확인** | M: `EntryConfirm` |
| FM06a 안내·리포트 반영 선택·**연구 동의(R5)** | 8 | **없음** | — (고지·선택 UI 없음, `consent_*` 컬럼만) | **고지**(방식·녹음·AI 기록·뇌파·**기록 원본은 설정 기간(N일) 후 삭제**) 확인, **리포트 반영 선택**(기본 `반영하지 않아요`, 명시 선택 시에만 포함, 영상 포함), **연구 목적 데이터 활용 동의**(별도 블록·별도 체크, 기본 미동의, `동의하면 비식별 데이터가 삭제 기한 없이 보관돼요`·보관 항목·철회 방법·재식별 위험 고지)를 서로 분리. 어느 선택이든 **입장·녹음·영상·EEG 업로드를 막지 않음** → `PUT report-choice`(B2)·`PUT research-consent`(B11) | M: `NoticeStep` |
| FM06b 오늘의 상태 | 8 | 일부 | `PreCheckinPanel.tsx`(`POST /sessions/{id}/checkin` phase=before, `in_progress` 에서도 허용) | 한 번에 한 축·전할 말 단계, 건너뛰기, `-started` 시트 | M: `SurveyStep`(API 재사용) |
| FM06c LINK BAND | 14 | 일부 | `WaitingRoomBandCheck.tsx`, `useBand`, `SensorTracker`(죽은 코드) | `linkband_mode` 반영, 접촉 불량일 때만 전극 카드, **필수/선택/사용 안 함 모두 `LINK BAND 없이 계속하기` 제공**(필수 문구 `LINK BAND 사용을 권장해요. 없어도 참가할 수 있어요`), 미지원 브라우저도 차단 안 함, 이마만, 단계 이동은 컨테이너가 소유 | M: `BandStep` + S: `ElectrodeLeds` |
| FM06d 기기 점검 | 13 | 일부 | `ClassWaitingRoom.tsx` 기기 구간(레벨 막대·카메라·스피커 복제 로직) | "내 영상·소리" 합친 컴포넌트, 5단계 링, NotFound/NotAllowed/NotReadable 구분, 허용 방법 시트, 오프라인 단계 제거, 마이크 요청 시점 이동(D10) | M: `DeviceStep` + S: `MyAvCheck` |
| FM06e 준비 완료 | 6 | 일부 | 준비 현황+게이트 카드(중복) | 설정 요약 4줄(동의·상태·밴드·기기/참여 방식)·행 탭 재편집 | M: `ReadyStep` |
| FM07 시작 대기 | 6 | 일부 | `WaitingForStart.tsx`(영문 아이브로우·8초 명상 한마디·이모지 BGM 바), `LobbyBgmBar`, 자동 입장 | 시작 예정 시각·준비 인원(BE-12 권장, AD2)·오프라인 BGM 제거·`준비 다시 확인하기`, **시작 후 시트(`지금 입장하기`/`준비 이어서 하기`)** — 현행은 `recheckingPrep` 중에도 자동 입장하고 미완 회원에게 안내 없음 | M: `WaitForStart`·`StartedSheet` |
| FM08 대기열 | 3 | 일부 | `waitlist.ts`, 진행 씬에서만 대기 화면(`MemberClassContainer.tsx:85`) | **사전 흐름에서** 대기 화면, 승격 감지는 `GET entry-state`(읽기 전용) 폴링 또는 이벤트, 순번 표시 금지, **`대기 취소`(서버 제외·확인 시트·재대기는 끝 순번)** | M: `WaitlistScreen` |
| FM09 종료 + 시트 2종 | 7 | 일부 | `MemberEndScene`→`MemberEndView`, `ReportEmailRequestPanel`(OTP 분기), `SelfCheckinPanel` | 회원: 리포트 **1탭 신청**(계정 이메일 마스킹). **비회원(D-1): 입장 시 입력한 이메일로 자동 발송**(`리포트를 {마스킹된 이메일}로 보내 드려요`, OTP·이메일 입력 DOM 없음, 승인 정책은 현행 유지). 리포트 반영 제외 참가자에게 `리포트에 반영되지 않아요` 안내, 라이트 래핑 제거, 중첩 스크롤 제거, 완료 시 버튼 비활성, `수업`→`클래스` | M: `EndScreen`·`ReportSheet`·`CheckinSheet` |
| FM10 취소·종료·미오픈·오류·끊김·코드 오류 | 5(+시안 외 2) | 일부(분산) | `class-join-page`·상세·`MemberNetDownCard` 에 흩어짐 | 단일 풀스크린 상태 템플릿 + `deriveFlowStateKind`, **코드 오류(없는/틀린/종료 구분 없이 동일 문구)·시도 제한 상태 추가** | S: `FlowStateScreen` + M 문구 |
| FH01 목록 | 7 | 일부 | `SessionListPage.tsx`(필터 `:692-696` 가 open 누락), `SessionListTable`, 캘린더 3종(`open` 색 누락) | 열린 클래스 상단 고정 카드, 캘린더·타임라인 제거(D-5② 확정), 표→카드, `net`, 목록 `시작하기` → 로비(FH07 경유) | SH: `HostClassList` |
| FH02a~e 만들기 마법사 | 5+4+4+4+2 | 일부 | `SessionCreatePage.tsx`(즉시)·`CreateSessionModal`(예약) 두 벌 | 5단계 통합, 방식 서버 저장(F10), **정원 스텐퍼(D-5③: 그룹 기본 10, 온라인 그룹 최대 50·오프라인 그룹 최대 100 — 서버 검증 그대로, 1:1 은 1명 고정)**, 5분 스텝퍼, 충돌 안내(프론트 계산), 초대(**회원 + 비회원 이메일 입력(R5)**), 확인, 이탈 시트(`useBlocker`) | H: `CreateWizard`(`useReducer` 훅) → `/sessions/new`·예약 모달 삭제 |
| FH03 생성 완료 | 5 | 일부 | `SessionCreatePage.tsx:200-264` | **4자리 코드 표시·복사(큰 글자)**·QR 없음, 초대 결과 구조화(회원 `초대했어요` = 등록 성공, 비회원 이메일 `메일 발송을 요청했어요`/`발송하지 못했어요`, 전달 여부 단정 금지 — P7), 부분 실패 재시도, `코드는 참가자에게만 전달하세요` 안내(D-4), 주 CTA 직행 | H: `CreatedScreen` |
| FH04 상세 | 12 | 일부 | `SessionDetailPage.tsx`(`취소` 확인 없음·진행 중에도 노출 `:34-41,175-187`, `window.confirm`, 모바일에서 복제·삭제 숨김, 코드 박스) | **4자리 코드 표시·공유**(열림 전/중), 준비 현황·다음 할 일, 이름(BE-4), **비회원 이메일 초대 현황·재발송(R5)**, 취소/닫기/삭제 확인 시트, 더보기 시트 | SH: `HostClassDetail` |
| FH05 세팅 | 10 | 일부 | `SessionPreJoinPreview.tsx`(compact·이모지·영문 아이브로우·경고 다이얼로그 도달 불가) | "내 영상·소리" 큰 컴포넌트 + 하단 `클래스 열기`, 마이크 끔 경고 시트 도달 가능, 오프라인 장비 생략(+ `liveKit.connect()` 온라인만) | H: `SetupScreen` + S: `MyAvCheck` |
| FH06 로비 | 25 | 일부 | `HostClassWorkspace`(open), `WaitingRoomReadinessPanel`, `ClassAudioPanel`, 발언권·호스트 밴드(접힘 영역) | 초대 N·대기실 M·준비 현황(초대 명단 기준 행 ⊕ presence), 시작하기 항상 활성(F7), 전극 LED(BE-9), 다시 알림(BE-10) | H: `LobbyScreen`·`host-lobby-model.ts` |
| FH06a 로비 시트 | 11 | 일부 | `ClassAudioPanel`·`SpeakingRightsPanel`·`handleToggleChatEnabled` | 초대(추가·다시 알림)·내 밴드(전극 UI; 호스트 밴드 연결 가능 여부 `hostParticipantId` null 추정 — 확인) 시트 신규, 라이트 카드 제거 | H: `LobbySheets` |
| FH07 시작 확인 시트 | 12 | **없음** | `ConsentModal`(시작 직후) | 시작 전 마이크 상태·준비 인원·준비 중 목록·**녹음 시작 확인(상담사 선택)**, 0명 변형, 기록 보관 기간(N일) 고지, 취소 경로의 `manual` 미선언 버그 해소. **참가자 리포트 제외 인원 수·연구 동의 인원 수(익명 집계)를 표시하되 녹음 시작을 막지 않음** | H: `StartConfirmSheet` |
| FH08 나가기·닫기 | 3 | 일부 | `LeaveGuardModal`, `closeClass`(확인 없음 `:1085`) | 닫기 확인(회원 N명 안내), 코랄 | H: `LeaveCloseSheet` |
| FH09 종료·리포트 진행 | 8 | 일부 | `HostEndingCard`(미연결·3단계), `ReportProgressStepper`(글자 기호), `/record` 점프 | 같은 몰입 화면 4단계(D-5① 확정), 다크 시트 스텝퍼(신규 컴포넌트 — 기존 스텝퍼는 `/record` light 톤이 사용하므로 무수정), `steps[ready]` 판정 | H: `EndingScreen` |
| FH10 닫힘·오류 | 7 | 일부 | `ClassPlayerPage` cancelled·오류 씬(서버 문구 원문 노출 `:1419`) | HTTP 404/403/네트워크 분기(`ApiError.status`, `TypeError`→network), 복제·목록 CTA | S: `FlowStateScreen` + H 문구 |

**집계**: 기준선 케이스 205개(회원 86·상담사 119) + R4 신규·변경 케이스(FM04·FM05·FM06a·FM06c 필수·FM08·FM09·FH03·FH04·FH07·FH06a — verify §6')를 R4-0 에서 확정. 판정: 없음 3(FM04·FM06a·FH07), 일부 나머지 → 전부 "추가 후 교체".

---

## 2. 변경되는 현행 동작 (참가자가 체감하는 변경 · 제거되는 기능)

**참가자(회원·비회원 공통)**
1. 입장 코드가 **6자리 → 클래스별 공통 4자리 숫자**로 바뀐다. 로그인·가입·초대 명단·이메일 OTP 없이 **코드 확인 → 개인정보(이름·성별·생년월일·이메일) 입력 → 입장**한다(선행 0 보존, `0000` 유효). 비회원은 상담사가 보낸 **초대 메일의 4자리 코드**로 들어온다. 로그인 회원도 같은 코드로 입장할 수 있고(계정 정보로 채움), 초대받은 로그인 회원은 코드 없이 홈/상세 `입장하기`로도 들어간다(편의 경로 — 입장 조건이 아님). 6자리 방식은 같은 배포에서 사라지며 유예·폴백이 없다.
2. 게스트 이메일 **OTP 인증은 사라진다**(성별·생년월일·이메일은 입력 항목으로 유지, 이메일은 확인용 재입력 1회). 코드 검증 성공 후 서버가 입장 자격(만료 가능, 클래스/참여자 범위)을 발급하고, 새로고침·재접속은 그 자격으로 **본인 참여자에게만** 복귀한다(같은 이름을 다시 적었다고 기존 참여자를 인계하지 않음).
3. 입장 전 **고지 + 리포트 반영 선택 + 연구 목적 데이터 활용 동의(FM06a)**. 리포트: 기본은 `리포트에 반영하지 않아요`, 명시 선택해야 반영. 연구 동의: 별도 체크·기본 미동의·**동의하면 비식별 데이터가 삭제 기한 없이 보관**된다고 고지, 거부해도 참여 가능. **어느 쪽이든 입장·녹음·영상·밴드 EEG 업로드는 막히지 않는다.** 제외한 참가자의 텍스트·지표·영상·집계 기여분은 상담사용/회원용 리포트·PDF·메일·AI 입력에서 빠진다. 이미 발송·다운로드된 사본은 회수할 수 없다는 한계를 안내한다.
4. **LINK BAND 없이도 항상 참가 가능**: 필수 클래스에서도 연결·착용·브라우저 지원 여부로 입장/준비 완료를 차단하지 않는다(시작 전·후 `LINK BAND 없이 계속하기`). 미측정은 점수 0이 아니라 `미측정`.
5. 대기실은 단계별 한 화면 마법사(탭·준비 현황·게이트 카드 제거). 오프라인은 기기 단계 없음. 마이크 권한은 사용자 동작 후 요청(D10).
6. 상담사가 준비 중에 시작하면 `지금 입장하기`/`준비 이어서 하기` 시트(현행은 안내 없음).
7. 정원이 차면 `대기 취소` 버튼으로 **서버 대기열에서 실제 빠진다**(화면만 닫기와 구분, 취소 후 자동 승격·토큰 발급 없음, 재대기는 새 순번 끝).
8. 종료 후 리포트: 회원 1탭 신청(마스킹 이메일). 비회원은 **입장 시 입력한 이메일로 자동 발송**(D-1). 체크인·리포트 시트는 소프트 시트, 사후 체크인 완료 시 버튼 비활성.
9. 홈·목록·상세: 입장 가능 클래스 최상단, 신청 바텀 시트, 용어 `세션`→`클래스`. 회원 화면에 코드 표시는 없다(코드는 상담사가 전달, 홈에는 `코드로 입장하기` 진입점).

**상담사**
10. 만들기가 즉시·예약 통합 5단계 마법사. 예약 모달·`예약 만들기` 삭제. 예약에서도 방식·인원·LINK BAND·녹음·참여자 지정. 소요 시간·시작 시각 5분 단위.
11. **4자리 코드를 생성 완료·상세·로비/도구 시트에 크게 표시·복사**(QR 없음, 열린 클래스만 유효). 종료·취소 클래스 코드는 무효.
12. 초대 결과는 `초대했어요`(등록 성공)와 `전달 실패/재발송 결과`를 구분하고 푸시 수신을 약속하지 않는다.
13. 로비 `시작하기` 항상 활성(초대 0명·대기실 0명·준비 중 회원 있어도). 준비 중이면 시작 확인 시트에서 이름·미완 단계 표시. **녹음 시작은 상담사 선택(마이크·체크)이며 참가자 리포트 제외와 무관**(제외 인원은 익명 수만 표시).
14. 열린 클래스 목록 고정, `클래스 닫기`·`취소` 확인 시트, 진행 중 `취소` 숨김, `window.confirm` 제거, 삭제 서버 가드(BE-13).
15. 종료 후 같은 몰입 화면에서 리포트 진행(D-5① **확정** — 독립 커밋).
16. 캘린더·타임라인 제거(D-5② **확정** — 독립 커밋).
17. 그룹 정원은 마법사의 **정원 스텐퍼**(그룹 기본 10, 온라인 그룹 최대 50·오프라인 그룹 최대 100 — 서버 검증 그대로, 1:1 은 1명 고정). 정원 10 고정은 철회됐다(D-5③).
18. 상담사가 **비회원 이메일로 초대**하면 메일에 4자리 코드가 들어가고, 로비·상세에서 메일 발송 요청 결과(`메일 발송을 요청했어요`/`발송하지 못했어요`)를 보며 재발송할 수 있다. 코드 노출 위험은 수용하되 시도 제한·종료 즉시 무효화가 걸린다(D-4).

**관리자·운영(신규 계약)**: ① 원본(EEG·음성·영상)과 비회원 개인정보는 **기본 DB 에서 설정 기간 경과 시 스위프가 삭제**한다(연구 동의 건은 연구 DB ack 후). ② 일반 클래스 삭제·탈퇴는 숨김(보존 전환)이며 기간 전 실제 삭제는 **플랫폼 관리자만** 할 수 있다(대상·실행자·시각·사유 기록). ③ 연구 동의 철회는 운영 문의 → 플랫폼 관리자가 처리한다. ④ 연구 DB(Spark) 적재는 동의 건의 비식별 데이터만 pull 방식으로 누적한다.

**제거되는 기능(코드는 삭제, 데이터는 보존)**: 6자리 코드 입력·게스트 성별/생년월일/OTP 입력, by-code 4개 엔드포인트와 `participant_token` 무토큰 경로, `ReportEmailRequestPanel` OTP 경로, 예약 모달, `GuestMeditationPanel`·`GuestCompletePanel`·`GuestChatNotice`(import 0 확인 후), `LeadOffModal`(`SensorTracker` 는 보존). **`SessionCodeBanner` 는 4자리 표시 컴포넌트로 재작성하거나 새 컴포넌트로 교체**한다(삭제하지 않고 용도 전환 여부는 H3 에서 확정).

---

## 3. 백엔드 변경 목록 (필요 최소 · 기존 데이터 보존)

> 원칙: **추가형(additive) 우선**, 제약 변경은 §3.4 안전 절차를 따른다. 기존 `access_code`·게스트 참가자 행·원본 파일은 삭제·수정하지 않는다. 신규 테스트: `backend/tests/test_sdd209_*.py`. **구 API 폴백은 만들지 않는다**(P3). 분류: 필수 = 없으면 R4 정책을 이행할 수 없음 / 권장 = 대체안으로 진행 가능하나 정합·시안·보안 향상 / 보류 = 범위 밖. 컬럼·마이그레이션 개수는 **B0 확정: 마이그레이션 6개(M-A~M-F, 조사 11 §5), FK `ondelete` 변경 없음**(기존의 `nullable 3컬럼만` 제한은 폐기).

### 3.1 필수 (R4 직접 요구)

| ID | 변경 | 근거 | 호환·마이그레이션 | 테스트(verify §10) |
|---|---|---|---|---|
| **BE-1 기본 DB 삭제 정책·삭제 경로(P1 R5)** | ① `sweep_stale_media`·`sweep_stale_eeg_raw` 의 보관 값을 **설정값**(`RETENTION_RAW_DAYS`, 코드 상수 `MEDIA_RETENTION_DAYS` 제거)으로 통일하고 기준일을 청크 시각이 아닌 **세션 종료일**로 맞춘다(BE-R2 스위프가 두 경로를 하나의 실행 단위로 호출). ② 고아 파일 정리·처리 후 청크 제거는 **원본과 재생성 가능한 임시파일을 구분**해 임시파일만 즉시 정리하고 원본은 스위프 기간 정책을 따른다. ③ 일반 클래스 삭제·탈퇴(`delete_session`·`delete_user_media`·`admin_service.delete_user`)는 하드 삭제가 아니라 **숨김(보존 전환, 원본 참조가 사라지지 않게 — **B0 결정: FK 변경 불필요**, `db.delete(Session)` 호출처(`delete_session`·`remove_participant`·`admin_service.delete_user`)를 숨김/관리자 서비스로 교체. `remove_participant` 의 EEG 행 CASCADE·객체 고아 포함)**, 실제 삭제는 스위프 또는 플랫폼 관리자 지시로만. ④ **기간 전 삭제는 플랫폼 관리자 전용**(D-2): 서비스 + 권한(상담사·기관 관리자 403) + 대상·실행자·시각·사유 감사 기록 + 실제 파일·DB 정합. ⑤ 스토리지 lifecycle 설정을 읽기 전용으로 확인(변경 필요 시 별도 승인) | F30·F35·R5 | 감사 테이블 추가(추가형). 하드 삭제 코드는 스위프·관리자 서비스로만 도달. 배포 전 **현재 보유 원본 개수·바이트 스냅샷**을 기록 | BT1~BT5 |
| **BE-2 리포트 선택(P2)** | `session_participants` 에 **`report_included`(기본 제외)·고지 확인 시각/버전·선택 변경 이력**을 별도 필드/테이블로 추가, `PUT /sessions/{id}/report-choice`(입장 자격 소유권, 종료·취소 409, 멱등). 영상 포함. **`_assert_upload_eligible` 에서 `consent_eeg` 의존을 제거**하고 소유권·세션 상태만으로 판정(`consent_audio/eeg` 컬럼 의미 불변). 내보내기 게이트(`export_service.py:78`)는 리포트 선택·연구 동의(BE-R1)와 **혼용하지 않도록** 별도 판단(B0 에서 현행 의미 확인 후 확정) | F1·F12 | 추가형. 기존 행은 `report_included=false`(기본 제외) — 과거 리포트의 재생성 시 영향은 §9 R4·BT 에 명시. 이력 테이블 신설 | BT6~BT9 |
| **BE-3 리포트 전 경로 필터·무효화(P2)** | 상담사용/회원용 리포트·화면·PDF·메일·AI 생성 입력·그룹 집계·리소스 캐시에서 **제외 참가자의 텍스트·지표·영상·집계 기여분 제거**(`narrative_cache` 는 개인 데이터가 없는 전역 패턴 캐시라 대상 아님 — B0). 식별 불가능한 그룹 공통 녹음은 비동의 참가자 기여분을 분리할 수 있을 때까지 **해당 원본에서 파생한 공통 요약을 리포트에 넣지 않음**(원본은 보존). 선택 변경 시 기존 생성물·집계·캐시 무효화 후 재생성. 외부 발송·다운로드 사본 회수 불가 안내 | F31 | 경로 전수 목록 = 조사 11 §3 R1~R16 확정. `Report.content` 스냅샷 재생성+조회 방어 필터, 메일 링크 열람 게이트 추가, 제외 전환 시 `completed` 보존 규칙 예외 필요 | BT10~BT14 |
| **BE-4 4자리 코드(P5)** | 코드 생성: **활성/입장 가능 클래스 사이 중복 없음**(부분 유니크 인덱스, 전역 `unique` 제거), 코드 공간 소진은 명시적 오류, 종료·취소 시 조회 무효화(값 보존), 활성 클래스 **재발급 스크립트**(이전 6자리 값은 보존 컬럼에 저장, dry-run·로그, 멱등). 입장 시도 제한(코드 단위·IP 단위·전체 유입). 없는/틀린/종료 코드 **공개 응답은 동일 형태**(회원 목록·클래스 상세·동의/이메일 상태 비노출). **코드 원문을 로그에 기록하지 않음**(요청 로그 마스킹) | F29 | **제약 교체 마이그레이션**(§3.4) — 구 6자리 값은 DB 에 남고 입장에는 쓰이지 않음 | BT15~BT20 |
| **BE-5 입장 자격·소유권(P5)** | (5a) `POST /sessions/enter/verify`(코드 확인만 — 클래스 요약 반환, 시도 제한 대상)·`POST /sessions/enter`(코드+**개인정보 이름·성별·생년월일·이메일**, 인증 선택, 이메일 OTP 없음): 성공 시 **클래스/참여자 범위·만료 가능·서버 서명 입장 자격** 발급, 비회원 참여자 행 생성(`user_id` NULL·`guest_name`·`gender`·`birth_date`·`report_email` 저장 — F34), 로그인 회원이면 `user_id` 연결, 초대받은 로그인 회원 편의 경로 `POST /sessions/{id}/enter`(초대 행 있을 때만 코드 생략, 같은 자격 발급 — **입장 조건이 아님**), 복귀는 자격으로 본인 참여자만(이름 일치로 인계 금지), 로그아웃·만료·재발급 처리. (5b) 이후 **상태·미디어·WS·LiveKit·EEG 업로드·리포트 선택·체크인·손들기**(채팅은 현재 비회원 미지원 — 신설 여부 별도 결정)의 소유권 검증을 자격으로 통일, 호스트 권한과 분리, 타 클래스/타 참여자 접근 차단. 코드는 이후 요청의 인증 수단이 아님. **기존 무토큰/약한 검증 경로(F32)는 이 검증으로 교체** | F2·F32 | 추가형 엔드포인트 + 기존 by-code 4개 제거(같은 배포). 자격 서명키·만료·버전(폐기용)은 B0 에서 설계 확정, 비밀값은 `.env`(값 출력 금지) | BT21~BT30 |
| **BE-6 대기 취소·승격(P6)** | `POST /sessions/{id}/waitlist/cancel`(본인만, 멱등, **행 삭제 없음**), 참가자 상태 필드(대기/취소/활성 구분, 취소 시각), **취소·승격이 같은 잠금 순서**(세션 잠금 후 순번 순)로 경합 처리, 취소 후 자동 승격 대상에서 제외·`livekit-token`/상태 접근 거부, 재대기는 새 순번 끝, 활성 참가자의 취소 요청은 대기 취소로 처리하지 않음, 순번 재정렬·이벤트·집계 갱신, 승격 이벤트 `participant_promoted` 를 대상에게만, `max_participants` 증가 시 순번 순 승격, 재입장 새치기 수정 | F23·P6 | 상태 필드 추가형(기본 = 현행 동작) | BT31~BT37 |
| **BE-7 초대·재발송 정합(P7)** | 초대 응답에서 **등록 성공**과 **채널 발송 결과**를 분리(알림 실패는 삼키되 결과 필드로 노출), `POST /sessions/{id}/invite/remind`(호스트 전용, 쿨다운, 실제 요청 결과를 대상별 반환, 채널은 인앱+WS(+이메일 선호) — 푸시 수신 약속 없음), 전달 상태 조회는 확인 가능한 범위만 | F15·F25 | 추가형 | BT38~BT40 |
| **BE-8 참여자 DTO·PII(위임)** | 참여자 DTO 에 `user_name`(비회원은 표시 이름), `user_email` 은 호스트 뷰만, **타인 성별·생년월일·이메일·리포트 선택·연구 동의 상태·고지 증빙 비호스트 비노출**, `SessionResponse.host_name`, `list_sessions`·입장 응답의 PII 기본값 정리, N+1 방지 | F9·F28 | 응답 필드 추가(추가형)·비호스트 필드 제거(구 클라이언트 영향 없음 — 구 프론트 폴백 없음) | BT41~BT43 |
| **BE-9 참가자 상태(위임)** | `GET /sessions/{id}/entry-state`(입장 자격): 상태·본인 밴드·본인 지표·`chat_enabled`·`is_waitlisted`·본인 리포트 선택. 무인증 by-code state(IDOR 성격) 제거 | F2 | 추가형 | BT44~BT45 |
| **BE-14 리마인더 본문(P3)** | 리마인더 메일·인앱: `참여코드` 줄을 **4자리 코드 + `/join` 링크(코드는 URL 에 싣지 않음)** 로 갱신, extra 의 `access_code` 는 4자리 값, `세션`→`클래스` 치환은 이 파일에 한해(D15) | F4 | 예약된 리마인더는 발송 시점에 본문 생성 → 재배포로 적용. 과거 알림 행은 무해 | BT46 |
| **BE-R1 연구 동의(P8, R5)** | `research_consents`(참여자별 현재 상태: 동의 여부·문구 버전·동의/철회 시각·**가명 ID `research_subject_id`·`key_version`**·`export_state`)+`research_consent_events`(불변 이력), `PUT /sessions/{id}/research-consent`(입장 자격 소유권, 종료·취소 409, 멱등, 종료 전 변경 가능), **기본 미동의, 동의 여부가 입장·업로드·리포트 생성의 게이트가 되지 않음**, 가명 ID 는 동의 시점에 이름+생년월일로 계산(원문 비저장, 키는 서버 `.env`), 상담사에게는 익명 집계만, 플랫폼 관리자 철회 API(사유 필수·감사) | policy R5-C3·C5·C8 | 신규 테이블 추가형 | BT50~BT55 |
| **BE-R2 기본 DB 삭제 스위프(P1 R5)** | 하나의 `retention_sweep` 로 ① 원본(EEG raw·음성·영상·STT 원문) 기간 삭제 ② 비회원 개인정보 스크럽(`guest_name`·`gender`·`birth_date`·`report_email`·이메일 초대 행의 이메일 값 비움, 행·세션 참조 유지) 실행. **연구 게이트**: 연구 동의(미철회) 참여자의 데이터는 `export_state=acked` 가 아니면 삭제 보류 + 내보내기 큐 등록 + 보류 임계(제안 14일) 초과 시 운영 알림. 거부·철회 건은 게이트 없이 삭제. 기본 `RETENTION_SWEEP_ENABLED=false`, **dry-run 모드(후보 건수·바이트·보류 건수 출력)**, 실행 이력 `retention_sweep_runs`. 리포트 본문·지표 요약·회원 계정은 대상 아님(결정 N-2 기본값) | F35·policy R5-C2 | 설정+이력 테이블 추가형. 기존 두 cron 은 이 실행 단위로 대체(중복 실행 금지)(**B0: 두 cron 은 dev 에서 이미 활성 — 대체 시 현행 90일 음성·영상 삭제를 유지/중단할지 이행 방식 결정 필요, 조사 11 §2-3**) | BT56~BT62 |
| **BE-R3 연구 DB 내보내기 배치(P8, R5)** | 세션 `completed` 후 및 삭제 전 배치로 연구 동의 건의 **비식별 데이터만**(EEG raw·PPG/ACC **파생 지표**(PPG/ACC raw 는 서버 미저장 — B0)·지표·가명 ID·성별·생년월(N-4)·최소 세션 메타, 상대 시각; 허용표 초안 = 조사 11 §7-2) 번들(Parquet+`manifest.json` sha256·`key_version`) 생성 → **허용 필드 목록 검증 통과 시에만** S3 스테이징 prefix 업로드 → Spark 가 pull → ack(`batch_id`·sha256 일치) 수신 시 `export_state=acked`. 이메일·전화·이름 원문·녹취/STT·음성·영상 원본 제외, append-only(재내보내기는 새 revision), 실패 재시도·알림. 이 SDD 에서 Spark 실접속·실전송은 하지 않음(스테이징 포맷·ack API·계약 테스트까지) | F36·policy R5-C4~C7 | `research_export_batches`·`research_export_items`·`research_withdrawal_requests` 추가형 | BT63~BT72 |
| **BE-R4 비회원 이메일 초대·리포트 자동 발송(P9, R5)** | `POST /sessions/{id}/invite/email`(호스트 전용, 이메일 목록, 형식 검증): Celery `email_app`(큐 `email`)으로 초대 메일(제목·시각·**4자리 코드**·`/join` 안내, 코드 URL 미포함) 발송 요청, 등록 결과와 발송 요청 결과 분리, 재발송·쿨다운, `session_email_invites` 저장(스위프 스크럽 대상). 종료 후 비회원 리포트: 입장 시 입력한 `report_email` 로 **자동 발송**(OTP 없음, 리포트 반영 제외자는 대상 아님, 승인 정책 현행 유지), 발송 실패는 상담사 화면 표시. 워커 미기동 감지 점검 항목 | F34 | 초대 테이블 추가형, `report_email_service.py` 의 인증 분기만 변경 | BT73~BT79 |

### 3.2 권장 (R4 위임 포함 · 대체안 병기)

| ID | 변경 | 근거 | 대체안(백엔드 무변경) |
|---|---|---|---|
| **BE-10 전극·준비 상태 중계** | WS 대기실 presence `readiness` 에 `surveySkipped/bandSkipped/deviceSkipped`·`band{state, lead_off{ch1,ch2}, battery}` 허용(구 3-boolean 페이로드도 통과, 서버 저장 없음). 시작 전 EEG feature 는 저장하지 않음(D11) | F13·F15 | 전극별 접촉 LED 대신 `접촉 확인 필요` 텍스트(AD9) |
| **BE-11 입장 시각** | `session_participants.entered_at`(최초 입장 기록, 선택 증빙) — FH04 `참여함`·`입장 N명`·FH09 인원 근거 | F25 | `초대 N명` 표기로 한정(AD3·AD5) |
| **BE-12 익명 집계** | 회원 대기실용 `{ready,total}` 방송(`waiting_room_summary`, 개인 식별 정보 없음). 시작 확인 시트의 **리포트 제외 인원 수(익명)** 집계 포함 | F15 | FM07 그룹 카드를 `내 준비를 마쳤어요`로 축소(AD2) |
| **BE-13 삭제 상태 가드** | `delete_session` 은 `ready`/`scheduled`/`cancelled` 만 허용, 진행 중·완료는 거부. **허용되는 삭제도 BE-1 의 보존 전환을 따른다**(원본 즉시 삭제 금지) | F27·F30 | FE 숨김만(API 직접 호출은 못 막음) |

### 3.3 보류·폐기

| ID | 항목 | 처리 |
|---|---|---|
| (구) BE-5 게스트 차단 2단계·유예 | **폐기** — 비회원 입장이 정책이며 유예가 없다(P3). 대신 BE-5 소유권 통합이 공개 경로 보안을 담당 |
| (구) BE-17 레거시 예약 백필 | **R4 제외**(신규 서비스). 과거 `[온라인]` 예약은 프론트 표시 파생만 |
| (구) BE-1 비초대 403·`enter` 초대 필수 | **폐기** — 초대 행 필수 아님. 초대된 로그인 회원 편의 경로만 BE-5 에 유지 |
| (구) BE-6 `PUT consent` 로 업로드 허용 | **폐기** — BE-2 가 업로드 게이트를 분리 |
| (구) BE-22 대기열 이탈 API 보류 | **BE-6 으로 승격(필수)** |
| (구) BE-21 로그인 by-code 3종 최종 제거 | **BE-4/BE-5 의 같은 배포 교체로 흡수** |
| BE-8(구) 충돌 409 구조화·BE-18 5분 서버 검증·BE-19 `cancelled_at`·BE-20 알림 문구 전체·BE-23 `ai_analysis`·BE-24 동의 철회 API(리포트 선택 변경 API 가 대체)·BE-25 `partial` 정정 | 보류 유지(프론트 대체안 — 이전 plan 과 동일) |

**집계**: 필수 14(BE-1~9·14·R1~R4) / 권장 4(BE-10~13) / 폐기·흡수 6 / 보류 7. 신규 엔드포인트: `POST /sessions/enter/verify`·`POST /sessions/enter`·`POST /sessions/{id}/enter`(초대된 회원 편의)·`PUT /sessions/{id}/report-choice`·`PUT /sessions/{id}/research-consent`·`POST /sessions/{id}/waitlist/cancel`·`GET /sessions/{id}/entry-state`·`POST /sessions/{id}/invite/remind`·`POST /sessions/{id}/invite/email`·관리자 원본 삭제·관리자 연구 동의 철회·내보내기 ack(서비스 토큰). WS 이벤트·필드: BE-6·10·12.

### 3.4 마이그레이션 안전 절차 (롤백이 DB 를 되돌리지 못함 — F33)

모델 검토(B0) 후 확정하되 아래 순서·규칙을 지킨다. 현재 alembic head = `e036a0000041`(단일 head 유지, 자동 생성 금지·수동 리뷰).

| 단계 | 내용 | 안전 규칙 |
|---|---|---|
| MG-1 코드 제약 | `sessions.access_code` 전역 unique **인덱스 `ix_sessions_access_code`(제약이 아님, B0 확인)** 제거 → **활성 상태 한정 부분 유니크 인덱스**(종료/취소 제외), 이전 값 보존용 nullable 컬럼 | 인덱스 교체는 짧은 락 구간에서, 교체 전 중복 사전검사. 다운그레이드가 전역 unique 를 복원하지 못할 수 있음 → **롤백은 코드 revert 만(스키마 유지)** 로 설계(구 코드는 6자리 생성·부분 인덱스와 호환) |
| MG-2 참여자 필드 | `report_included`(기본 제외, NOT NULL+서버 기본값), 고지 시각/버전, `entered_at`, 대기 취소 시각·상태, 자격 폐기용 버전, `pii_scrubbed_at`(비회원 개인정보 스크럽 시각). 비회원 `gender`·`birth_date`·`report_email` 은 **기존 컬럼 재사용(F34)** | 모두 nullable 또는 상수 기본값(메타데이터 전용 add column). 기존 행 불변 |
| MG-3 신규 테이블 | 리포트 선택 이력, 원본 삭제 감사 | 추가형. 다운그레이드 = drop(데이터 손실이므로 운영 롤백에는 사용하지 않음) |
| MG-4 보존 | 원본 보존 전환 상태(필요 시) / FK `ondelete` 변경 여부 | **B0 결론: FK 변경하지 않는다**(삭제는 앱 코드 경로가 원인). 하드 삭제 호출처 교체로 충족. `users` 행은 `sessions.host_id` FK 때문에 숨김 전환 시 삭제할 수 없어 `status` 비활성으로 대체(회원 자진 탈퇴 기능은 코드에 없고 계정 삭제는 플랫폼 관리자 API 뿐) |
| MG-5 연구 동의 | `research_consents`(참여자별 현재 상태)·`research_consent_events`(불변 이력) 신규. **`participant`/`session` FK 에 CASCADE 를 걸지 않음**(가명 ID 해시는 개인정보 스크럽·세션 숨김 뒤에도 철회 대조에 필요) | 추가형. 다운그레이드 = drop(데이터 손실이므로 운영 롤백에는 사용하지 않음) |
| MG-6 삭제 스위프 | `retention_sweep_runs`(실행 이력·후보·보류·삭제 건수), 세션 숨김(보존 전환) 플래그, 설정값 `RETENTION_RAW_DAYS`·`RETENTION_GUEST_PII_DAYS`·`RETENTION_SWEEP_ENABLED`(코드/`.env`) | 추가형. **`RETENTION_SWEEP_ENABLED=false` 로 배포**, 활성화는 dry-run 승인 후 설정만 변경(마이그레이션 불필요) |
| MG-7 연구 내보내기 | `research_export_batches`·`research_export_items`·`research_withdrawal_requests`, 이메일 초대 `session_email_invites` | 추가형. 스테이징 prefix·IAM·ack 토큰은 인프라 작업(별도 승인), 비밀값은 `.env` |
| DS-1 데이터 스크립트 | 활성 클래스 4자리 재발급 | **마이그레이션과 분리된 멱등 스크립트**, dry-run 출력 승인 후 실행, 이전 값 보존, 기존 테스트 데이터 삭제 0 |
| 배포 | `alembic upgrade head` 는 서비스 재시작 전에 실행(`deploy-dev.yml:197-201`), 새 코드·구 코드 모두 새 스키마에서 동작 | 배포 전 원본 개수·바이트·활성 클래스 수 스냅샷 → 배포 후 동일 확인(스위프 비활성이므로 배포 직후 원본 변동 0 = RV1·RV7). **이메일 워커(`mindbreeze-email-worker`) 기동 확인** 포함 |

---

## 4. 이전 결정 D1~D16 처리표 (R4 반영 후 상태)

> R4: D6/D8/D10/D13/D15/D16 은 일괄 승인되지 않았다(기존 제안 상태). **R5(2026-10-17): D6·D13③ 확정, D8① 정원 10 고정은 철회되어 정원 스텐퍼로 대체**(독립 커밋). D9 는 4자리 표시로 전환, D12 의 AD1~14 묶음 승인은 폐기하고 verify §6' 로 재작성했다. 비즈니스 결정만 문서 끝 `Brian 결정 필요 항목`에 모은다.

| ID | 상태 | 처리 |
|---|---|---|
| D1 유예·게스트 차단 시점 | **폐기** | R4 P3: 유예 없음·같은 배포 교체 |
| D2 동의 저장·거부·철회 | **R4·R5 로 대체** | 저장=별도 필드(BE-2), 거부=리포트 제외(수집 중지 아님), 철회=리포트 선택 변경 API. 연구 동의는 별도 저장·이력(BE-R1), 철회는 플랫폼 관리자 경로 |
| D3 동의 문구 사실관계·보관 기간 | **R5 로 확정** | 기본 DB=설정 기간 후 삭제(기본값은 결정 N-1), 연구 동의 건=연구 DB 무기한 누적. 고지 문구는 FM06a 에 `기록은 N일 후 삭제`·연구 동의 블록으로 반영 |
| D4 시작 후 입장 | **단순화** | 고지·리포트 선택도 시작 후 이어서 가능(차단 요소 없음), 설문·밴드·기기 건너뛰기 가능 |
| D5 필수 밴드 | **폐기** | R4 P4: 어느 모드든 참가 가능 |
| D6 종료 후 이동 | **확정(R5, D-5①)** | 같은 화면에서 리포트 진행, 독립 커밋 |
| D7 초대 필수·상담사 미연결 | **폐기** | 초대 행 필수 아님, 공개 입장은 `/app/*` 밖 |
| D8 마법사 정책 묶음 | **기술 하위값은 기본값 적용, ① 정원은 R5 에서 스텐퍼로 확정(10 고정 철회)** | 그룹 기본 10, 온라인 그룹 최대 50(서버 검증 그대로)·오프라인 그룹 최대 100, 1:1 은 1명 고정. ②~⑪ 은 기술·표현 기본값으로 진행하되 verify §6' 에 기록 |
| D9 코드 박스 | **전환** | 제거가 아니라 4자리 표시·공유(상담사 전 구간) |
| D10 기기 정책 | **미승인(기술 기본값 적용)** | 마이크 요청 시점·카메라 승계 등 표현 기본값, 승인 필요 시 사후 변경 이력 |
| D11 로비 밴드 | **기본값 적용** | 시작 전 EEG feature 저장하지 않음(접촉·연결 중계만) |
| D12 AD1~14 일괄 | **폐기** | verify §6' 개별 재작성 |
| D13 셸형 정책 묶음 | **③ 캘린더 제거 확정(R5, D-5②)** | 독립 커밋. 나머지(보조 섹션·`곧 열림` 60분·신청 문구·배지 키 상수화)는 기술·표현 기본값 |
| D14 대기열·N명 정의 | **R4 로 부분 확정** | 대기 취소 서버 반영(P6), N명=초대+입장 참가자 수 표기 규칙은 기본값 |
| D15 알림 문구 | **미승인(기본값 적용)** | 리마인더 파일만 치환 |
| D16 하니스 노출 | **미승인(기본 ① 선례 유지)** | 정적 픽스처만 노출 |

---

## 5. 아키텍처

### 5.1 설계 원칙 (SDD-208 과 동일)
1. **뷰·컨테이너 분리**: 뷰는 props 만, 컨테이너가 훅·API·소켓 조립 → 뷰를 픽스처로 직접 렌더해 전 케이스(R4-0 확정 수)를 서버·BLE 없이 결정적으로 검증.
2. **케이스 = 입력에서 파생**: 시안 케이스 키(`on-group-opt-member-leadoffl` = 방식-인원-밴드모드-회원-상태)를 파싱하는 순수함수(`lib/class/flow/case-key.ts`)와 상태 파생(`deriveReadiness`·`buildSteps(place,band)`·`deriveLobbyStats`·`deriveStartSheet`·`deriveElectrodes`·`deriveFlowStateKind`·`deriveEnterState`). 밴드·네트워크·마이크·카메라는 SDD-208 `lib/class/player-case.ts` 의 `deriveBandUi`·`NetUi`·`MicUi`·`CamUi` 를 **재사용**(새 임계값 금지). `deriveBandUi` 는 L/R 분할·연결 실패·접촉 미확인을 구분하지 못하므로 얇은 래퍼 `deriveBandStep`(`lib/class/band-step.ts`)을 둔다.
3. **추가 후 교체**: 새 컴포넌트는 새 경로에 추가만. 호출부 교체(`App.tsx` 라우트·페이지 내부)는 통합 Task. 구 컴포넌트는 마지막에 삭제. 롤백 = 통합 커밋 revert.
4. **셸형은 기존 페이지를 직접 수정**(회원 홈·목록·상세, 상담사 목록·상세는 같은 라우트의 본문 교체 — 소유 트랙 SH 단독 수정).
5. **데이터 훅**: TanStack Query 는 코드에 없다(CLAUDE.md 가정과 다름) → 공용 로딩은 `useClassList`(30초 폴링·포커스·알림 트리거)를 직접 구현(조사 08 §4-10). 마법사 드래프트는 `useReducer` 훅 1개(zustand 불사용, 단계·점프가 라우트를 바꾸지 않아 이탈 가드가 단계 이동에 걸리지 않음).

### 5.2 라우트
| 용도 | 경로 | 비고 |
|---|---|---|
| **공개 코드 입장(몰입형, 셸 없음, 로그인 불필요)** | `/join` (신규 `CodeEntryPage`) | 6자리 입력 화면을 **교체**(리다이렉트가 아님). 2단계: ① 4자리 숫자 입력(문자열, FM04) → `enter/verify` ② **개인정보(이름·성별·생년월일·이메일) 입력(FM04b)** → `enter`. 코드를 URL 쿼리로 받지 않음(접근 로그·히스토리 노출 방지), 입력값은 메모리에만. 로그인 회원은 계정 값으로 채움 |
| 참가자 입장 흐름(몰입형) | `/class/:sessionId/enter` (입장 자격 가드, 로그인 불필요) | 오케스트레이터 1개 페이지(`EntryPage`)가 FM05→FM06a~e→FM07→(진행 `MemberClassContainer`)→FM09, FM08, FM10 을 상태 머신으로 처리. `useBand` 는 이 컨테이너에서 **1회만 호출**(`useBand.ts:77`) |
| 로그인 회원 편의 진입 | `/app/sessions/:id` → `입장하기` | 초대된 회원은 `POST /sessions/{id}/enter` 로 같은 자격을 받아 위 입장 흐름으로 이동. `/app/*` 상담사 연결 게이트(F26)는 현행 유지 |
| 상담사 만들기 | `/sessions/new` (기존) | 마법사로 교체, 목록 `클래스 만들기` 1개 진입점 |
| 상담사 세팅·로비·종료 | `/sessions/:id/player` (기존) | `HostPrepContainer` 로 교체(SDD-208 `HostLiveContainer` 선례) |
| 하니스 | `/design/class-flow` | 픽스처만 렌더, 인증 없음 |

**입장 자격 저장**: 메모리+`sessionStorage`(탭 단위, `mb_entry_<sessionId>`), 장기 저장소(localStorage) 사용 안 함. 만료·폐기 응답(401/403)을 받으면 FM10(입장 정보가 만료됐어요)으로 이동해 코드 재입력. 로그아웃은 자격과 무관(회원 로그인 세션과 분리).

### 5.3 참가자 입장 상태 머신 (입장 자격)
```text
 [FM04 코드] ─POST /sessions/enter/verify─▶ 클래스 요약 ─▶ [FM04b 이름·성별·생년월일·이메일] ─POST /sessions/enter─▶ 입장 자격 + 참여자
   ├ 실패(없는/틀린/종료 구분 없음) ─▶ 동일 오류 문구 · 시도 제한 시 안내
   ├ ready·scheduled ─▶ FM05 wait(열리면 자동 진행; WS session_state_changed + 폴링)
   └ open·in_progress ─▶ FM05 확인 ─▶ FM06a 고지+리포트 반영 선택+연구 동의(PUT report-choice·PUT research-consent, 건너뛰어도 기본 제외·미동의로 진행)
        ─▶ FM06b 설문(건너뛰기) ─▶ FM06c 밴드(어느 모드든 `LINK BAND 없이 계속하기`) ─▶ FM06d 기기(온라인만)
        ─▶ FM06e 요약 ─[입장 대기]─▶ FM07
        FM07: open ─ 대기 / in_progress ─ 자동 입장 ─▶ 진행 화면(MemberClassContainer, 자격 기반)
        FM06*/FM07 중 in_progress 수신 ─▶ started 시트: [지금 입장하기] / [준비 이어서 하기]
        정원 초과(is_waitlisted) ─▶ FM08(준비 마법사 건너뜀) ─ [대기 취소] ─▶ 확인 시트 ─▶ POST waitlist/cancel ─▶ FM04
              └ 승격 감지 ─▶ FM06a/FM06e
   진행 화면 중 completed ─▶ FM09, cancelled ─▶ FM10 cancelled
```
- **고지·선택 → 입장 순서**: 참여자 행은 코드 입장 시점에 생기고 `report_included=false`·연구 동의 미동의로 시작한다(연구 동의 변경도 종료 전까지 FM06e 행 탭에서 가능). FM06a 의 선택은 이후 언제든 FM06e 행 탭·진행 화면 도구에서 바꿀 수 있고(종료 전), 바꾸면 B3 의 무효화가 동작한다. **선택·동의 단계의 성공 여부가 입장·업로드를 막지 않는다.** 연구 동의 시점에 서버가 이름+생년월일로 가명 ID 를 계산해 저장한다(원문 비저장).
- 감지는 `GET entry-state` + WS `session_state_changed`(대기실 게이트 우회 방지 규칙 유지). 대기열 승격은 읽기 전용 폴링(현행 5초 `join` 재호출은 호스트에 알림을 쏘므로 폐기).
- 새로고침 복원: `sessionStorage` `mb_entry_<sessionId>`(자격·단계·설문 초안·`prepSkipped`), 참여자 id 는 서버가 정본. 구 키(`mb_join_participant`·`mb_waiting_room_nickname`·게스트 토큰)는 폐기.
- 시작 후 건너뛴 준비는 `prepSkipped` 로 진행 화면에 전달(첫 진입 안내 한 줄+기기 시트 진입점, 설문 시트 신설).
- 대기실에서 고른 카메라·마이크는 진행 화면 `micWanted/camWanted` 초기값으로 승계(D10).

### 5.4 공용 컴포넌트(S) — 핵심 3개
- **`MyAvCheck`("내 영상·소리")**: 회원 FM06d·상담사 FH05 공용(F16 의 RMS 복제 2벌 제거). `lib/class/class-media.ts`(`MediaDeviceUi`·`classifyMediaError`·`levelFromRms`·`ringSteps`·`classifyMicQuality`·`needsMicOffWarning`)·`hooks/useMediaCheck.ts`(스트림·메터·오류 분류·재확인·스피커 테스트, **사용자 탭 안에서 `AudioContext.resume()`**)와 표시 컴포넌트. 레벨: 현행 `level = min(1, RMS×3)`(`ClassWaitingRoom.tsx:186`) 재사용, **5단계 링 = `ceil(level×5)`**, 칩 `조용해요` = 최근 3초 피크가 임계 미만(상수 `MIC_QUIET_LEVEL`, 실기기 실측 후 확정 — verify §16-2). 카메라 켜짐: 영상 + 마이크 토글 둘레 링(아이콘 미터), 카메라 없음: 가로 막대(결정 3), 세로 미터 없음(R3-1). 상태 모델: `WaitingRoomDeviceState` 의 `denied` 를 `denied`·`nodevice`·`inuse` 로 분리(칩과 상세 메시지 일치). 회원은 진입 즉시가 아니라 `마이크 켜기` 후 권한 요청(D10).
- **`ElectrodeLeds`**: 같은 매핑(`ch1→L`, `ch2→R`, 기준 = 둘 다 양호)을 순수함수 `deriveElectrodes(leadOff)` 로 분리, 큰 카드(FM06c·내 밴드 시트)와 소형(FH06 행)이 공유. 큰 카드는 기존 `SensorTracker` 를 재사용하되 **`leadOff===null` 이면 회색(미확인) 3상태** 추가(현행은 전부 빨강=거짓 접촉 불량), 색을 prop 으로, `max-width:288px;width:100%`, 전극별 `aria-label`, LED 아래 라벨 줄(`왼쪽 양호/실패`·`기준 …`·`오른쪽 …`)·범례. 체크·엑스 아이콘 금지(R2-1). **`LeadOffModal` 과 분리**(둘 다 미렌더 죽은 코드이므로 모달 삭제 시 `SensorTracker` 를 지우지 말 것).
- **`FlowStateScreen`**: `MemberFullView.tsx` 의 비공개 `FullScene`/`FullCard`(로고·아이콘·제목·리드·정보 행·메모·버튼)를 공용화해 FM10·FH10 이 같은 컴포넌트를 쓰게 한다(`tone:'neutral'|'warn'` 추가, 정보 행 0~2, 버튼 주/보조 고정, 상단 바 선택). 입력은 `deriveFlowStateKind({error, sessionStatus, scheduledAt, online})` 가 `cancelled|closed|notyet|error|notfound|forbidden|network` 로 모은다(`ApiError.status` 404/403, 408·503·`TypeError`·`navigator.onLine===false` → network, 그 외 `ApiError` → error; 폴백에 서버 `message` 사용 금지).

### 5.5 상담사 컨테이너(H)
`HostPrepContainer` 는 `ClassPlayerPage` 의 시작 전 구간 상태·핸들러(`openClass`·`startClass`·`closeClass`·`liveKit`·`mediaPrefs`·`recorder`·`liveSocket`·presence 집계)를 props 로 받는다(이 Task 까지 `ClassPlayerPage.tsx` 수정 0).
- 로비 행 모델 `lib/class/flow/host-lobby-model.ts`: **초대 명단(`live-metrics.display_name`) 기준 행 ⊕ presence(`waiting_room_changed`) 덮어쓰기**(presence 유실 시 행이 사라지지 않고 `아직 입장 안 함` 으로 강등) → `초대 N`·`대기실 M`·`준비 완료/준비 중`·`미입장 = N−M`. 대기실 구독은 `isLobby` 뿐 아니라 시작 직후에도 유지(`ClassPlayerPage.tsx:995`).
- `canStart` 는 **항상 활성**(F7) — 그룹 조건 제거. 시작 확인 시트는 항상 거침(목록 카드 `시작하기` → 로비로 이동, 결정 8 우회 방지).
- `startClass` 흐름 재편(순서 보존, `ClassPlayerPage.tsx:1049-1086`): 시트 확인 → `transition start` → `liveKit.connect()`(**온라인일 때만**) → 체크&마이크 on 이면 `startAudio(id,true)` + `recorder.start()`, 해제·마이크 off 이면 `startAudio(id,false)`(**취소 경로의 `manual` 미선언 버그 해소**) → 영상은 `record_video`·카메라 on 이면 `startVideo`. `audio/start` 는 `open` 에서 400 이므로 시작 전 호출 금지. 시작 직후 `ConsentModal` 0.
- `openClass` 는 `requestOpen(prefs)` 로: 마이크 끔이면 확인 시트(3지선다) 경유, 오프라인은 `mediaPrefs={cameraOn:false}` 명시(기본 `{camera:true, mic:true}` 가 남아 오프라인에서 영상 녹화를 시도할 위험), 프리뷰가 settled 되기 전 `false/false` 보고 금지.
- 종료: `finishSession` 이 `transitionSession('end')` 응답을 `setSession` 에 반영해 `isEnded` 씬 렌더 + `useReportProgress` 구독 시작, `/record` navigate 제거(D-5①). 단계 판정은 `steps[ready].state`.

---

## 6. 하니스·측정 (시안 `?case=` → 코드)

- **하니스** `pages/design/ClassFlowCasesPage.tsx`: URL 규약을 시안과 같게 `?screen=FM06c&case=on-group-opt-member-leadoffl`(+선택 `&sheet=`·`&n=`·`&level=`·`&ch1=&ch2=`). 레지스트리 `lib/class/flow/registry.ts` 가 화면 ID → `{ cases: {key: description}, render(spec) }` 를 `import.meta.glob('./fixtures/*.ts')` 로 수집(트랙이 하니스 파일을 같이 수정하지 않음). `?index=1` 은 시안과 같은 인덱스 표를 출력(`_mock-index.md` 와 대조해 확정 케이스 수 일치 자동 검증, verify G1).
- **케이스 키 파서**: 회원 `{on|off}-{group|solo}-{opt|req|none}-member[-상태][-started|-sheet]`, 상담사 FH06 `{g|o}-{on|off}-{N}[-r][-req|-none|-wait|-contact|-inv0|-many]`, FH02/FH04 등은 화면별 키(레지스트리의 화면별 파서).
- **측정**(조사 10 §3-3·3-4): `e2e/class-flow/lib.mjs` 를 새로 만들고 `e2e/class-player/lib.mjs` 에서 **`launchBrowser`·`parseArgs`·`DEFAULT_BASE`·`VIEWPORTS`·`SHORT_VIEWPORTS`·`formatReport`·`summarize`·`writeReport`·`RULE_NAMES`·`measureFit`(셀렉터 주입형)만 import**한다. `caseUrl`·`openCase`·`readRegistry`·`measureFlowSymmetry`·`runCli` 는 신규(기존 `measureOne/runMeasure/runCli/buildJobs`·`measureMemberSymmetry/HostSymmetry` 는 회원 진행 화면에 고정돼 재사용 불가, 도크 도달 `measureDockReach` 는 해당 없음 — 단 `390×600`·`1280×420` 에서 하단 CTA 가 눌리는지로 재정의). `data-pz` 훅 계약을 확장(`flow-top`·`flow-col`·`flow-card`·`flow-foot`·`flow-cta`·`flow-steps`·`flow-sheet`·`flow-list`). 균형.md 적용성: S1·S2·S3·S5·S6·S8·S9·S10·MS3 **그대로**, S7 **변형**("본문 컬럼이 상단 바와 푸터 사이 세로 중앙, 시안 측정 `본문 위 126.2/아래 126.2 (허용 ±52.5)` 형식"), S4·MS1·MS2·CS* **해당 없음**(결과표에 명기). **새 규칙 6개**(시안 `tools/member-b-measure.mjs` 에 구현된 검사 포팅, verify §2 `FR1~FR6`): 하단 CTA 위치 고정(단계 전환 Δ ≤ 2px) · 진행 점(개수=단계 수 온라인 5·오프라인 4·밴드 없음 −1, 가운데 정렬) · 시트 내 중첩 스크롤 0 · 카피·글리프·영문 대문자 아이브로우 소스 정적 검사 · 상태 의존 요소(접촉 불량일 때만 전극 트래커 288×64·내 영상·소리 합친 컴포넌트) · 오버레이가 CTA 를 가리지 않음. `NO_CORAL_IDS` 는 사전 흐름용으로 새로 정의(접촉 불량·권한 거부는 코랄이 정상). 자가검증 `selftest` 는 위반 주입 더미 픽스처(사전 흐름판)를 둔다. 시안(회원) 사이드 시트 기준 1100px 와 코드 `sheet-mode.ts` 1000px 불일치는 시안 정정 또는 코드 분기 확인(`미확인`, verify §16).
- **기존 결과 재사용**: 시안 단계 측정 결과 `designs/class-flow-redesign/fit/*.txt` 는 코드 측정의 비교 기준(수치 차이 허용 ±2px)으로 쓴다. 시안 `tools/*-measure.mjs` 는 하니스 URL 로만 경로를 바꿔 포팅.
- **폰트**: Pretendard 로딩 고정, 측정 전 `document.fonts.ready` 대기.
- **dev 배포본에서 재현 불가**(F15 SDD-208 동일): 밴드 상태·권한 거부·네트워크 끊김 → 하니스로만 검증. dev 실화면은 가짜 미디어 플래그로 대표 케이스(FM05·FM06a·FM06b·FM06d·FM07·FH02·FH05·FH06·FH07)만.

---

## 7. Task 분해 — 순서·의존성·파일 단위

**순서 원칙**: ① verify 승인 → ② R0(시안·기획 R4 정합화) → ③ B0(코드 조사 확정) → ④ 백엔드·공용 기반 병렬 → ⑤ 회원/상담사/셸형 트랙 → ⑥ 통합. 각 Task 30~60분(L 은 90분), 모두 **테스트 먼저**(RED→GREEN), 커밋 `feat(sdd-209): …`, 푸시 금지(I4 에서만). 마이그레이션이 있는 Task 는 §3.4 규칙·롤백 설계를 PR 설명에 첨부한다. 트랙: **S 공용 · B 백엔드 · M 참가자 · H 상담사 · SH 셸형 · I 통합.**

### 7.1 선행 게이트

| Task | 이름 | 산출 | 선행 | 규모 |
|---|---|---|---|---|
| T0 | worktree(저장소 밖)·기준선(tsc `-p tsconfig.app.json`·eslint·vitest·pytest 실패 목록, 현 케이스 문구 정규식 기준선, 타인 미커밋 변경 확인, **원본 보유 스냅샷(개수·바이트)**) | 기준선 파일 — **완료**: `baseline.md`, `baseline-snapshot.sql/.py` | verify 승인 | S |
| R0 | **R4-0 시안·기획 정합화**: `기획.md`·시안 4종·gallery 에서 회원 전용·코드 제거·수동 기록·기간 고지·필수 밴드 게이트·로컬 대기 이탈 문구 정리, FM04 코드 입장·FM06a 리포트 선택·FM08 `대기 취소`·FM09 비회원·FH03/FH04 코드 표시·FH07 개정 케이스 추가, 케이스 수 재산출, verify §6' 표 확정 | 시안 HTML·`_mock-index` 갱신(design-planner), Brian 시각 확인 | verify 승인 | L |
| B0 | **코드 조사 확정(문서)**: ① 모델·기존 unique/FK(`session_participants`·`sessions`·청크·`Report`) ② 원본 삭제·정리 경로 전수(F30) ③ 리포트 생성·조회·발송·캐시 경로 전수(F31) ④ 비회원 자격 재사용 범위·WS 연결(F32) ⑤ 마이그레이션 수·FK 변경 필요성 확정 ⑥ 스토리지 lifecycle 읽기 확인 | `investigation/11-r4-code-survey.md`, §3 표 갱신 — **완료(2026-10-17)** | verify 승인 | M |

### 7.2 백엔드 트랙 (B) — 순서가 곧 의존성

| Task | 내용 | 선행 | 마이그레이션 | 규모 |
|---|---|---|---|---|
| B1 | **삭제 경로 정리·관리자 삭제**(BE-1): 일반 삭제·탈퇴 숨김 전환, 플랫폼 관리자 전용 삭제 서비스+감사, 스위프 설정값화 준비·BT1~BT5 먼저(RED) | B0 | MG-3(감사), MG-4(필요 시) | L |
| B2 | **리포트 선택 모델·API·업로드 게이트 분리**(BE-2) | B0 | MG-2·MG-3 | L |
| B4 | **4자리 코드**(BE-4): 제약 교체·생성·무효화·시도 제한·공개 응답·로그 마스킹·재발급 스크립트(DS-1) | B0 | MG-1 | L |
| B5a | **입장 자격 발급·복귀·초대 회원 편의 경로**(BE-5a) | B2·B4 | MG-2 일부(자격 버전) | L |
| B5b | **소유권 통합**(BE-5b): REST·WS·LiveKit·EEG 업로드·체크인·손들기·채팅·리포트 선택·`entry-state`(BE-9), 기존 by-code 4개·무토큰 경로 제거, 호스트 권한 분리 | B5a | — | L |
| B3 | **리포트 전 경로 필터·무효화**(BE-3, 혼합 녹음 공통 요약 제외) | B2·B5b | 캐시 키/무효화 필드 | L |
| B6 | **대기 취소·승격 정합**(BE-6) | B5b | MG-2(대기 상태) | L |
| B11 | **연구 동의 모델·API**(BE-R1): `research_consents`·이력·가명 ID 계산(키 `.env`)·`PUT research-consent`·관리자 철회 | B2·B5b | MG-5 | L |
| B12 | **기본 DB 삭제 스위프**(BE-R2): `retention_sweep`(원본 기간 삭제·비회원 개인정보 스크럽·연구 ack 게이트·dry-run·이력), 기존 두 cron 대체. **비활성 배포** | B1·B11 | MG-6 | L |
| B13 | **연구 DB 내보내기 배치**(BE-R3): 비식별 번들·허용 필드 검증·S3 스테이징·ack API·재시도(Spark 실접속·실전송 없음) | B11·B12 | MG-7 | L |
| B14 | **비회원 이메일 초대·리포트 자동 발송**(BE-R4) | B5a·B3 | MG-7(초대 테이블) | M |
| B7 | **초대·재발송 정합**(BE-7)·리마인더 본문(BE-14) | B5a | — | M |
| B8 | **DTO·PII·`host_name`**(BE-8)·삭제 가드(BE-13) | B5b | — | M |
| B9 | 권장: 전극·준비 중계(BE-10)·입장 시각(BE-11)·익명 집계(BE-12) | B6 | MG-2(`entered_at`) | L |
| B10 | 24개 테스트 헬퍼를 새 입장 경로로 갱신(F19)·기존 테스트 정합 | B5b | — | L |

백엔드 완료 조건: `pytest -q`(CI 제외 항목 동일) 통과, RV1·RV2·RV3·RV5·RV6·RV8·RV9 의 백엔드 시나리오 통과, 배포 전·후 원본 스냅샷 동일(삭제 스위프는 비활성 배포).

### 7.3 공용 기반 (S) — 백엔드와 독립 병렬 (R0 완료 후 케이스 키 확정)

| Task | 이름 | 선행 | 규모 |
|---|---|---|---|
| T1 | 케이스 키 파서·레지스트리·공용 타입(`lib/class/flow/`, 확정 키 전부 파싱 테스트) | R0 | M |
| T2a | 몰입형 프리미티브+CSS+`PlayerShell`/`PlayerSheet`/`PlayerTopBar` 추가 props | T1 | M |
| T2b | `class-media.ts`·`useMediaCheck`·`MyAvCheck`·`PermissionHelpSheet`·`ElectrodeLeds`(+`SensorTracker` 3상태) | T1 | L |
| T3 | 하니스·`e2e/class-flow/{lib,fit}.mjs`(신규 규칙 FR1~FR6)·위반 주입 자가검증 | T1 | M |

### 7.4 참가자 트랙 (M) — 백엔드 계약(§3) 고정 후 병렬, 실호출 검증은 B5b 배포 후

| Task | 내용 | 선행 |
|---|---|---|
| M0 | `lib/api/class-flow.ts` 어댑터(폴백 없음)·입장 자격 저장(`sessionStorage`)·**FM04 코드 입장·FM04b 개인정보 입력**(`CodeEntryPage`, 4자리 문자열·선행 0·오류 동일 문구·시도 제한, 이름·성별·생년월일·이메일(재입력 1회)·로그인 회원 자동 채움) | T1·B4/B5a 계약 |
| M1 | `EntryPage` 상태 머신·`deriveEnterState`·FM05 입장 확인·FM10 상태(코드 오류·만료 포함) | M0·T2a |
| M2 | FM06a 고지·리포트 반영 선택(기본 제외)·**연구 동의 블록(별도 체크·기본 미동의·무기한 보관/재식별 위험 고지, 실패해도 진행)**·FM06e 요약(행 탭 재편집, 연구 동의 변경 포함) | M1·B11 계약 |
| M3 | FM06b 설문(비회원 체크인 소유권은 B5b 확인) | M1 |
| M4 | FM06c 밴드(`deriveBandStep`·**차단 없음**·권장 문구·미지원도 계속 가능·미측정) | T2b·M1 |
| M5 | FM06d 기기(`MyAvCheck`·허용 방법 시트·오프라인 생략·승계) | T2b·M1 |
| M6 | FM07 시작 대기(+BE-12)·`StartedSheet`·`prepSkipped`·진행 화면 설문 시트 | M2~M5 |
| M7 | FM08 대기열·**`대기 취소`**(확인 시트·서버 제외·재대기) | M1·B6 계약 |
| M8 | FM09 종료(서버 `ended_at`·리포트 1탭·비회원 이메일 자동 발송 안내(D-1)·제외 안내·체크인 시트) | T2a·M1 |
| M9 | 진행 화면 연결(`useMemberLiveKit`·`MemberClassContainer`·EEG 업로드 자격 기반 전환)·SDD-208 M01~M21 회귀 | M2~M8·B5b |

### 7.5 상담사 트랙 (H)

| Task | 내용 | 선행 |
|---|---|---|
| H1 | 만들기 마법사 골격·FH02a·b(필수 밴드 문구 `LINK BAND 사용을 권장해요`)·**정원 스텐퍼**(그룹 기본 10, 온라인 그룹 최대 50·오프라인 그룹 최대 100, 1:1 고정 1명, 서버 검증 무변경, 정원 부분은 D-5③ 독립 커밋) | T2a |
| H2 | FH02c 일정·FH02d 초대(**회원 + 비회원 이메일 입력**, 형식 검증)·FH02e 확인 | H1 |
| H3 | FH03 생성 완료(**4자리 코드 표시·복사**·`코드는 참가자에게만 전달하세요`·회원 `초대했어요`/비회원 `메일 발송을 요청했어요` 실패 구분·재시도·템플릿 저장) | H2·B7·B14 계약 |
| H4 | FH05 세팅(`MyAvCheck`·`requestOpen`·마이크 끔 경고·오프라인) | T2b |
| H5 | FH06 로비 본문(`host-lobby-model`·시작 항상 활성·전극 LED(BE-10)·코드 표시) | T2b |
| H6 | FH06a 시트(초대·**재발송 실제 결과**·BGM·내 밴드·발언권·채팅) | H5·B7 |
| H7 | FH07 시작 확인(녹음 시작 확인·준비 중 목록·0명 변형·제외 인원 익명 수·`audio/start` 순서)·FH08 | H5 |
| H8 | FH09 종료(같은 화면 리포트 진행, D-5① 독립 커밋)·FH10 닫힘·오류 | T2a |
| H9 | `HostPrepContainer` 연결 + D9 상담사측(`ToolsSheet`·`HostLiveView` 코드 박스 → 4자리 표시·공유) | H4~H8 |

### 7.6 셸형 트랙 (SH)

SH1 라이트 키트(`ClassCard`·`StatusChip`·`ShellSheet` 등) → SH2 FM01 홈(`코드로 입장하기` 진입점) → SH3 FM02 목록+신청 시트 → SH4 FM03 상세+입장 CTA(`useEnterClass`: 초대된 회원은 `POST /sessions/{id}/enter`) → SH5 FH01 상담사 목록 → SH6 FH04 상담사 상세(**코드 표시·공유**·취소/닫기/삭제 시트, BE-8 선행) → SH7 용어 치환 스윕+배지 키 상수화. (캘린더·타임라인 제거(D-5② **확정**)는 **독립 커밋**으로 분리.)

### 7.7 통합 (I)

| Task | 내용 | 선행 |
|---|---|---|
| I1 | 참가자 호출부 교체: `/join` 입장 화면 교체·입장 라우트 추가·CTA 4곳·알림 직행·랜딩 `/join` 링크 정리·기존 테스트·`full-journey.mjs`(별도 커밋). **6자리 입력·구 API 호출 코드 제거(폴백 없음)** | M9·SH4 |
| I2 | 상담사 호출부 교체: `/sessions/new`·`ClassPlayerPage` 구간·`journeys.mjs`·`class-player/live.mjs`(별도 커밋) | H9·SH5·SH6 |
| I3 | 전 케이스 측정·보정(확정 케이스×4 + 시트 변형 + SDD-208 회귀 M01~M21·C01~C18) | I1·I2 |
| I4 | 구 컴포넌트 삭제·**단일 배포**(백엔드 마이그레이션 포함, **삭제 스위프 비활성 상태로**)·배포 전후 스냅샷 대조·DS-1 dry-run→실행·삭제 스위프 dry-run 보고(활성화는 Brian 승인 후 별도)·이메일 워커 기동 확인·스모크·실기기·summary | I3 |

**Task 수**: 선행 3 · 백엔드 15 · 공용 4 · 참가자 10 · 상담사 9 · 셸형 7 · 통합 4 = **52**(트랙 6). 마이그레이션 포함 Task: B1·B2·B4·B5a·B6·B9·B11·B12·B13·B14. 최장 직렬 경로: R0 → B0 → B2·B4 → B5a → B5b → B6/B3 → M9 → I1 → I3 → I4 (연구 경로 B2 → B11 → B12 → B13 은 병렬 가지). **D-5 독립 커밋 3건**: ① 종료 후 같은 화면 리포트(H8·H9 의 종료 구간만), ② 캘린더·타임라인 제거(SH5·SH6 의 해당 파일만), ③ 정원 스텐퍼(H1 정원 부분만) — 각각 따로 커밋해 되돌릴 수 있게 한다.

---

## 8. 파일 소유권 · 병렬 계획

### 8.1 소유권 표 (한 파일은 한 소유자만 수정)
| 소유자 | 파일 | 규칙 |
|---|---|---|
| **S** | `components/class/player/shared/{PlayerShell,PlayerSheet,PlayerTopBar}.tsx`·`player-shared.css`(**기본값 = 현행 동작인 추가 props 만**), `lib/class/flow/{case-key,registry,types}.ts`, `lib/class/{class-media,band-step}.ts`, `hooks/useMediaCheck.ts`, `components/class/flow/shared/**`, `components/class/SensorTracker.tsx`, `lib/class/class-waiting-room.ts`, `pages/design/ClassFlowCasesPage.tsx`, `e2e/class-flow/{lib,fit}.mjs`, `App.tsx` 의 `/design/class-flow` 1줄 | T1~T3 병합 후 동결 |
| **B** | `backend/app/**`, `backend/alembic/versions/*`(마이그레이션 PR 별도 리뷰), `backend/tests/test_sdd209_*.py`, 기존 백엔드 테스트(B10) | 프론트 파일 수정 금지 |
| **M** | `lib/class/flow/member-*.ts`, `lib/class/flow/fixtures/member-*.ts`, `lib/api/class-flow.ts`, `components/class/flow/member/**`, `pages/class/{CodeEntryPage,EntryPage}.tsx`(신규), `hooks/useMemberLiveKit.ts`·`components/class/player/member/{MemberClassContainer,MemberSheets}.tsx`(M6·M9 에서만), `components/class/{PreCheckinPanel,ReportEmailRequestPanel,SelfCheckinPanel}.tsx`(재작성 시), `tests/class-flow-member-*.test.tsx` | 상담사·셸형 파일 수정 금지 |
| **H** | `lib/class/flow/host-*.ts`, `lib/class/flow/fixtures/host-*.ts`, `lib/class/class-wizard.ts`, `hooks/useClassWizard.ts`·`useWizardLeaveGuard.ts`, `components/class/flow/host/**`, `components/session/{SessionPreJoinPreview,ConsentModal,SessionCodeBanner}.tsx`(대체·삭제는 I4), `components/class/player/host/sheets/ToolsSheet.tsx`·`HostLiveView.tsx`·`lib/class/host-player-case.ts`·`fixtures/host-cases.ts`(H9 에서만), `tests/class-flow-host-*.test.tsx` | 회원·셸형 파일 수정 금지 |
| **SH** | `components/class/flow/shell/**`, `lib/class/{class-labels,enter-action,pick-hero-class,class-when,reminder}.ts`, `hooks/{useEnterClass,useClassList}.ts`, `pages/client/{ClientHomePage,ClientSessionListPage,ClientSessionDetailPage,ClientAppPage}.tsx`, `components/client/**`, `components/session/{SessionCard,StatusBadge,SessionListTable,MonthCalendar,CalendarView,MobileTimetable,DaySchedule}.tsx`, `pages/sessions/{SessionListPage,SessionDetailPage}.tsx`, `components/layout/{SidebarNav,BottomTabBar,AppShell,MobileDrawer}.tsx`, `tests/class-flow-shell-*.test.tsx` | 셸형 페이지는 이 트랙만 |
| **통합** | `App.tsx`(라우트), `pages/class-join-page.tsx`(→ `CodeEntryPage` 교체·삭제), `pages/sessions/ClassPlayerPage.tsx`, `pages/sessions/SessionCreatePage.tsx`, 랜딩 `/join` 링크 파일·`scripts/verify-landing.cjs`, `lib/api/notifications.ts`, 기존 테스트·`e2e/*.mjs`, 구 컴포넌트 삭제, 문서 | 병합 후 단일 담당 |

### 8.2 충돌 지점
- `SessionListPage.tsx`: SH5 단독(예약 모달 삭제 포함). `SessionCreatePage.tsx`: H 가 새 경로, I2 에서 래퍼화. `ClassPlayerPage.tsx`: H9 까지 수정 0, I2 에서 시작 전 구간·`canStart`·`ConsentModal` 만 교체.
- **백엔드 단일 소유(B)**: `session_service.py`(수천 줄)·`session_live_namespace.py` 는 B 트랙 내에서도 한 Task 씩 순차(B2→B4→B5a→B5b→B6) 병합 — 병렬 브랜치 금지(충돌·리뷰 부담).
- `lib/api/session.ts` 무수정(신규 함수는 `class-flow.ts`). `App.tsx`: S(하니스 1줄)·통합(라우트) 줄이 달라 충돌 없음.
- 타인 미커밋 변경 확인: T0 에서 `git status` 로 확인하고 승인 없이 되돌리지 않는다(SH7 `SidebarNav.tsx` 등).

### 8.3 병합 순서
1. R0·B0 → (T1→T2a∥T2b∥T3) → `sdd/209-flow`. B 는 `sdd/209-backend`(순차 병합), M·H·SH 는 `sdd/209-flow` 에서 분기.
2. 세 프론트 트랙 병합 직후 tsc·eslint·전체 vitest, `git diff --name-status <base>..HEAD | grep -v '^A'` 로 소유권 확인 → I1~I3.
3. **배포는 단일 푸시**(§9.3): 백엔드+프론트+마이그레이션이 한 배포. 사전에 백엔드만 `develop` 에 병합해 두는 선행 푸시는 **구 프론트가 깨지므로 하지 않는다**(구 API 제거와 신 입장이 같은 배포여야 함).
- worktree 는 저장소 밖(`git worktree add ../mindbreeze-sdd209 -b sdd/209-flow origin/develop`). 미추적 문서(`designs/class-flow-redesign/`·`specs/sdd-209*/`)는 워커 지시에 원본 절대경로를 적는다.

---

## 9. 위험·롤백·CI·배포

### 9.1 위험
| # | 위험 | 영향 | 완화 |
|---|---|---|---|
| R1 | **삭제 우발·보류 누락**: 스위프 기준일/게이트 오류로 (a) 미경과 원본이 삭제되거나 (b) 연구 동의 건이 ack 전에 삭제됨, 기존 테스트 데이터 일괄 삭제 | 원본·연구 데이터 영구 손실 | 스위프 **비활성 배포**+dry-run 승인, 연구 게이트 테스트(BT58~BT60), 배포 전·후 스냅샷, 일반 삭제는 숨김 전환 |
| R2 | **4자리 코드 무차별 대입**(10,000 조합): 타인 클래스 입장 | 상담 내용·개인정보 노출 | 시도 제한(코드·IP·전체), 동일 응답, 종료 즉시 무효화, 코드 로그 금지. 잔여 위험은 D-4 에서 Brian 이 수용 확정(입장 승인·재발급은 후속) |
| R3 | 입장 자격 우회·IDOR(타 참여자/타 클래스 REST·WS·EEG·토큰) | 개인정보·위조 업로드 | BE-5b 통합 검증, RV3 교차 접근 테스트, 호스트 권한 분리 |
| R4 | **리포트 제외 누락 경로**(PDF·메일·AI 입력·집계·캐시) | 제외 참가자 정보 유출 | B0 전수 목록, BE-3, RV2 전 경로 단언, 변경 시 캐시 무효화 |
| R5 | 그룹 공통 녹음 기여분 분리 불가 | 제외 참가자 1명으로 공통 요약이 리포트에서 빠짐(상담사 체감) | R4 정책대로 제외, 상담사 안내 문구(FH07·FH09), 분리 기술 확보 시 완화(후속) |
| R6 | 마이그레이션(전역 unique 제거·부분 인덱스) | DB 롤백 불가 | §3.4: 사전 중복 검사, 코드만 revert 로 롤백, 구 코드 호환 확인 |
| R7 | 구 앱 번들·이미 발송된 메일·구 `participant_token` 이 배포 즉시 무효 | 일부 사용자 입장 실패 | **유예 없음이 정책**. 배포는 진행 중 클래스 없는 시간대, 구 경로 실패 응답 문구 확인(`미확인`) |
| R8 | 진행 화면(SDD-208) 코드 의존 전환(F3) | 진행 화면 회귀 | M9 에서 M01~M21·C01~C18 재측정, 어댑터 한 곳 |
| R9 | 비회원 표시 이름 스푸핑·중복 이름 | 다른 사람으로 오인 | 이름은 표시용일 뿐 식별은 자격, 복귀는 자격 기반, 중복 이름 허용+구분 표시 |
| R10 | 배포 스크립트 순서(F33): `dist` 교체가 백엔드보다 먼저 | 수 초~수십 초 신 프론트↔구 백엔드 | 단일 배포 수용, 점검 시간대, 스모크로 즉시 확인 |
| R11 | 백엔드 테스트 24개 헬퍼(F19) | 대량 수정 | B10 에서 일괄 갱신, 신규 헬퍼 1곳 |
| R12 | 대기 취소·승격 경합(두 요청 동시) | 취소자 재승격·이중 좌석 | 같은 잠금 순서, RV5 동시 실행 테스트 |
| R13 | 시작 전 밴드 EEG 저장(D11)·`조용해요` 임계·205+ 케이스×4뷰포트·전극 매핑 미검증·presence 레이스·내비 배지·삭제 가드·`PlayerShell` 확장 회귀·`flow-base.css` 전역 색·짧은 뷰포트 | 이전 plan R5·R7~R9·R13~R16·R18~R24 와 동일 | 이전 plan 완화책 유지(기본값=현행 props, `.fl-h1/.fl-h2` 색 명시, 보조 뷰포트 측정 등) |
| R14 | 외부 발송·다운로드된 리포트 사본은 제외 변경 후에도 회수 불가 | 정책 한계 | 선택 화면·종료 화면에 고지(BE-3) |
| R15 | **연구 DB 재식별**: 성별·생년월일·상대 시각 조합, 가명 키 유출 | 연구 참가자 식별 | 허용 필드 목록 검증, 키 분리(Spark 미전송)·백업, 동의 화면 고지, 방침 갱신(출시 전), 생년월 단위 보관(N-4 확정) |
| R16 | **내보내기 정체**: Spark 가 pull 하지 않거나 ack 가 오지 않아 삭제가 무한 보류 | 기본 DB 보관 기간 초과(개인정보 보관) | 보류 임계(14일) 운영 알림, S3 스테이징 보관, 재시도·수동 ack 절차 문서 |
| R17 | **비회원 이메일 오발송**(OTP 없음) | 타인에게 리포트 도달 | 이메일 재입력 확인, 발송 실패 표시, 입장 화면 고지, 승인 정책 유지로 상담사 확인 단계 확보 |
| R18 | 이메일 워커(`mindbreeze-email-worker`) 미기동 | 초대·리포트 메일 미발송 | 배포 후 워커 상태 확인 항목(I4·verify), 큐 적체 점검 |
| R19 | 가명 ID 키 분실/교체 | 이후 동일인 누적 매핑 단절 | 키 오프라인 백업, `key_version` 기록, 정기 교체 안 함 |

### 9.2 CI 영향
- `ci-feature.yml`: 프론트 `tsc --noEmit`·`eslint src/`(`react-refresh/only-export-components` 포함)·`npm run build` **차단**, 백엔드 `pytest -q`(`test_sprint4_integration.py` 제외, PDF 1건 deselect) **차단**, `npm test` 비차단(그래도 신규 테스트 전부 통과를 완료 조건). **루트 `tsconfig.json` 이 `files: []` 이면 CI 의 `npx tsc --noEmit` 은 아무것도 검사하지 않는다** — 로컬은 `npx tsc -p tsconfig.app.json --noEmit` 필수, 루트 tsconfig 는 T0 에서 확인: `files: []`+`references` 뿐이라 CI 의 `npx tsc --noEmit` 은 실제로 아무것도 검사하지 않는다(`baseline.md` §2).
- `e2e-smoke.yml`(배포 직후 자동, 실패 시 텔레그램): 갱신 필요 — `full-journey.mjs:186-203`(4자리 코드 입장+고지·리포트 선택 통과+시작 후 입장+EEG 업로드(리포트 제외 상태 포함)), `journeys.mjs:9,13-24,59-64`, `class-player/live.mjs`, `scripts/verify-landing.cjs`. 실제 CI 파일 확인 결과 `/join` 을 쓰는 곳은 `full-journey.mjs` 뿐(`explore.mjs` 는 `/join` 을 SKIP 정규식에 포함).
- 기존 프론트 테스트 갱신·삭제 대상(I1·I2 에서 처리 확정, 로직 이전 확인 후에만 삭제): `class-join-waiting`·`class-join-waitlist`·`member-session-scene`·`class-waiting-room`·`-flow`·`-presence`·`-band-check`(5)·`report-email-request-panel`·`member-end-scene`·`session-prejoin-theme`·`host-class-workspace`·`waiting-room-readiness-panel`·`pre-checkin-panel`·`self-checkin`·`class-player-member-container`·`class-player-page-live`·`class-player-host-container`·`session-reminder`·`waiting-room-checkin.browser.cjs`(CI 제외).

### 9.3 배포 순서·롤백
- **순서(단일 배포)**: ① 사전 스냅샷(원본 개수·바이트, 활성 클래스·코드 목록, **삭제 스위프 설정이 비활성인지 확인**) ② `develop` 푸시 → `Deploy Dev` → `alembic upgrade head`(재시작 전) → 재시작 ③ DS-1 dry-run 승인 후 활성 클래스 4자리 재발급 실행 ④ `health/ready`·4자리 입장 `curl` 확인 ⑤ `e2e-smoke` → 실패 시 단언 갱신 루프 ⑥ 사후 스냅샷 대조(원본 동일 = RV1·RV7 필수 조건) ⑦ 이메일 워커 기동·큐 확인 ⑧ 삭제 스위프 dry-run 보고서 제출(활성화는 Brian 승인 후 별도 작업, 이 배포에 포함하지 않음).
- **롤백**: 코드 `git revert`(I1·I2 교체 커밋 각 1개 + 백엔드 커밋) → 푸시 → 자동 재배포. **스키마는 되돌리지 않는다**: 구 코드가 새 컬럼을 무시하고 부분 인덱스에서도 6자리 생성이 가능해야 한다(B4 테스트에서 구 코드 호환 검증 — 구 코드 체크아웃 상태로 `generate_access_code` 실행). 재발급된 4자리 코드는 구 코드에서도 문자열 코드로 동작한다. 원본 파일·행은 어떤 롤백에서도 삭제하지 않는다.
- **마이그레이션 위험**: §3.4. 자동 생성 금지·수동 리뷰(`.claude/rules/architecture.md`), `alembic heads` 단일 head 확인.

---

## 10. 구현 전 미확정 (확인하지 못한 것)
- ~~기존 DB unique 제약 외 추가 제약, 비회원 자격·WS 경로의 재사용 가능 범위, 리포트의 참여자별 기여분 분리 가능성, 원본 삭제·외부 스토리지 lifecycle 실제 경로~~ — **B0 에서 확정**(조사 11). 남은 결정: 현행 활성 스위프의 이행 방식(S1), 1:1 유일 참가자 제외 시 상담사 리포트 범위(A3), 첫 참가자 제외 시 상담사 리포트 EEG 기준(S5), STT 원문 삭제와 리포트 스냅샷 `transcript_segments` 복제의 관계(N-2).
- 내보내기(`export_service.py:78`)가 `consent_eeg` 를 게이트로 쓰는 의미 — 리포트 선택·연구 동의와 분리 후 새 권한 모델.
- **R5 확인**: 저장 위치·허용표 초안·전달 확인 수단(웹훅 없음, Resend 접수만 확인 가능)·`email_app` 워커 경로는 **B0 에서 확정**(조사 11 §7). 남은 것: 스테이징 prefix·IAM·ack 토큰의 인프라 작업 범위, Spark 쪽 적재 스키마(연구팀과 협의 — 이 SDD 는 번들 계약까지), 허용표 ❓ 항목 확정.
- 구 앱(Capacitor) 번들 사용 비율·구 경로 실패 응답이 사용자에게 읽히는 방식(유예 근거로는 쓰지 않음, 영향 파악용).
- 마이크 `조용해요` 임계·5단계 링 경계 — 실기기 실측 전. ch1/ch2 와 좌우 전극 대응(SDK 문서 없음).
- `MemberEndScene` 의 `relaxationIndex`(점수 비노출 정책 정합), SDD-208 진행 화면의 본인 지표 수신 경로, 호스트 본인 밴드 연결 가능 여부(`hostParticipantId` null 추정), 설문 응답 전 호스트 목록 미표시 원인, python-socketio `async_handlers`.
- iOS Capacitor `useBand.isSupported`, iOS `Info.plist` 마이크·카메라 키, 시작 전 EEG 윈도우가 리포트 평균에 섞이는지, 알림 이메일 기본값, 루트 `tsconfig.json` 내용, `org_admin` 이 남의 클래스를 열 때의 화면.
- 시안 케이스 DOM 이 금지 용어 정규식에 0건인지(R0 이후 T0 기준선), 시안 `flow-base.css` 의 `.fl-codebox` 6칸 스타일 폐기 여부(R0), 현재 dev 배포물의 하니스 청크, `PlayerBackdrop` 대비.

---

## 11. 조사 문서 색인
(표의 BE 번호는 조사 당시 번호를 현재 §3 번호로 치환한 것이다.)
`investigation/` 문서는 **R4 이전 코드 상태의 증거**이며 R4 요구사항으로 해석하지 않는다(충돌 시 R4 우선). B0 산출 `11-r4-code-survey.md`(R4·R5 코드 조사, 2026-10-17)가 추가됐다.

| 번호 | 주제 | 파일 | plan 반영 위치 |
|---|---|---|---|
| I1 | 입장 모델 제거 | `01-join-model-removal.md` | F1~F6·F26, §2, §3 BE-4·5, §4 D1·D7(폐기), §5.2~5.3, §9 |
| I2 | 리포트 신청 OTP | `02-report-otp.md` | F12(OTP 생략), §1.2 FM09, §3(필수 아님 — 서버가 이미 회원 OTP 생략), BT7 |
| I3 | 생성·예약 | `03-create-schedule.md` | F9~F11, BE-8, §4 D8, §7 H1~H3 |
| I4 | 열림·시작·준비 | `04-open-start-ready.md` | F7·F8·F15, §5.5, BE-7·10, §4 D4·D10, §7 H5~H9·M7 |
| I5 | 밴드·전극 | `05-band-electrode.md` | F13·F14, BE-10, §5.4, §4 D5·D11 |
| I6 | 기기·미디어 | `06-device-media.md` | F16, §5.4, §4 D10 |
| I7 | 동의 | `07-consent.md` | F1·F12, BE-2·11, §4 D2·D3·D4 |
| I8 | 셸형 화면 | `08-shell-screens.md` | F20·F26·F27, §1.2, §4 D13, SH 트랙, verify G9 기준선(부록 C·D) |
| I9 | 대기열·종료 | `09-waitlist-end.md` | F23~F25, BE-12·6, §4 D6·D14, M2·M8·H8 |

---

## Brian 결정 필요 항목 (비즈니스 결정만 · 기술 상세 제외 · 기본값 제안)

> 기술 결정(자격 방식·잠금 순서·FK·캐시·가명 ID 방식·전송 방식·측정 기준 등)은 plan·policy R5 가 기본값으로 진행한다. 미응답 시 아래 기본값으로 진행하되 N-1·N-2·N-5 는 삭제 스위프 **활성화 전** 승인 게이트로 둔다(스위프는 비활성으로 배포).

### 확정됨 (2026-10-17, Brian)
| ID | 확정 내용 | 반영 위치 |
|---|---|---|
| **D-1** | 비회원 리포트는 **메일 자동 발송**. 상담사 이메일 초대(메일에 4자리 코드) → 코드 입력 → **개인정보(이름·성별·생년월일·이메일) 입력 후 입장** → 종료 후 입력 이메일로 발송. 이메일 OTP 없음, `email_app` 워커 경로 | P5·P9, FM04·FM04b·FM09, BE-5·BE-R4, policy R5-A |
| **D-2** | 원본 삭제 권한은 **플랫폼 관리자만** | BE-1, policy R5-B |
| **D-3** | **연구 목적 데이터 활용 동의**(입장 전, 무기한 보관 고지, 거부해도 참여 가능). 기본 DB 는 **기간 삭제**, 연구 DB(Spark)는 동의 건만 **누적**(비식별 EEG/PPG/ACC·지표 + 암호화 이름 ID + 성별 + 생년월일; 이메일·전화·이름 원문·녹취/STT 제외) | P1·P8, BE-R1~R3, policy R5-C |
| **D-4** | 4자리 코드 노출 위험 수용. 시도 제한 + 종료 즉시 무효화만, 입장 승인·재발급은 후속 | P10, BE-4 |
| **D-5** | ① 종료 후 같은 화면 리포트 ② 캘린더 제거 — 시안대로(독립 커밋). ③ **정원 10 고정 철회 → 정원 스텐퍼**(기본 10, 온라인 그룹 최대 50, 1:1 고정) | FH02a, FH09, FH01, D6·D8·D13 |

### 남은 비즈니스 결정 (신규)
| ID | 결정 | 선택지 | 기본값(제안) | 영향 |
|---|---|---|---|---|
| **N-1** | **기본 DB 삭제 기간** (설정값 2개) | 원본(EEG raw·음성·영상·STT 원문) 기간 / 비회원 개인정보 기간: 30·90·180·365일 등 | **원본 90일**(현행 음성·영상 90일 스윕과 동일, 세션 종료일 기준), **비회원 개인정보 90일**(리포트 발송 완료 이후). 값은 환경 설정이라 코드 수정 없이 변경 가능 | 스위프 설정, FM06a 고지 문구 `기록은 N일 후 삭제돼요`, 개인정보처리방침 |
| **N-2** | **삭제 대상 범위** | (a) 원본+비회원 개인정보만 (b) 지표·리포트 본문까지 (c) 회원 계정 데이터 포함 | **(a)** — 리포트 본문·지표 요약·회원 계정은 삭제하지 않음(상담 기록 열람 유지). 근거: 현행 스위프도 원본 청크만 대상 | 스위프 대상 테이블, 리포트 보관 |
| **N-3** | **비회원 리포트 발송 승인 정책** (자동 발송과 상담사 승인의 관계) | (a) 현행대로 상담사 승인 후 자동 발송 (b) 승인 없이 생성 즉시 발송 | **(a)** — 오발송 위험(OTP 없음) 때문에 상담사 확인 단계를 유지. 승인되면 사람 개입 없이 자동 발송 | 발송 시점·지연, R17 |
| **N-4 (확정)** | **생년월일 보관 형태** | **연·월만 보관, 일 삭제**(Brian 확정) | 연구 번들에는 `birth_year_month`(YYYY-MM)만 담고 일(日)은 번들·연구 DB에 없다. 가명 ID 계산·철회 대조에는 입력받은 전체 생년월일을 쓰되 저장하지 않는다(계산 직후 폐기). 재식별 위험 고지는 유지 | 연구 DB 필드, R15 |
| **N-5** | **기존(과거) 데이터와 스위프 최초 활성화** | (a) 배포일 이후 종료된 클래스부터 적용(과거 테스트 데이터 보호) (b) dry-run 보고 후 과거 기간 경과분도 일괄 삭제 | **(a)** — 스위프는 비활성 배포, dry-run 보고서를 보고 Brian 이 활성화·과거분 처리를 별도 승인 | 기존 테스트 데이터 |
| **N-6** | **개인정보처리방침 갱신 시점** (기록 N일 삭제·연구 동의·무기한 보관·재식별 위험) | 출시 전 완료 vs 출시 후 | **출시(운영 배포) 전 완료 조건**(법적 판단은 별도 검토) | 출시 게이트 |

---

## 구현 변경 기록 — 백엔드 3차 (Stage 4: B3 → B14 → B12 → B13 → B9)

> plan 대비 구현 중 확정·변경된 사항(Brian 확정 결정 반영). 각 Task 커밋 시 갱신한다.

### B3 리포트 전 경로 필터·무효화 (확정 A3)
- **상담사 리포트 EEG 집계 규칙 변경(숫자가 바뀔 수 있음)**: 첫 참가자 1명 → **리포트 반영에 동의한 대기열 밖 참가자 전원**의 합산(1:1 은 그 1명, 그룹은 동의자 전원 평균·분포). `_build_eeg_content(session_wide=True, participant_ids=[동의자])` 경로 사용. **배포 후 새로 생성·재생성되는 그룹 상담사 리포트의 EEG 숫자는 기존(첫 참가자 기준)과 달라질 수 있다.** 이미 저장된 스냅샷은 건드리지 않으며(조회 시 방어 필터만 적용), 재생성 시에만 새 규칙이 적용된다.
- 전원 제외: EEG 구간을 비우고 `{"status":"not_measured","excluded":true,"notice":"참가자가 제외를 선택했어요"}`. 제외 참가자의 저장(원본·지표)은 그대로.
- 제외자가 1명이라도 있으면 상담사 리포트의 `transcript_segments`·`video.available`·AI 공통 요약(`ai_record`)을 제거(원본 보존). 내담자 리포트: 제외자는 행을 만들지 않고, 수동 생성·기존 행은 `리포트에 반영되지 않아요` 안내(stub)만. 상담사 코멘트 파생 표시·AI 코멘트 초안·AI 비서 입력·메일 발송/신청/재발송/이메일 링크 열람(403)에서 제외자 배제.
- `content.report_scope = {version, included_participants, excluded_participants}` 표식. 조회(`get_report`/`list_reports`/메일 열람 직렬화)는 구 스냅샷도 방어 필터로 한 번 더 거른다.
- 선택 변경 시 `refresh_reports_after_choice_change`: 상담사 리포트·해당 참가자 내담자 리포트 재생성(실패해도 제외 기여분은 즉시 걷어냄). 승인(`completed`) 상태는 보존(내용만 교체).
- `narrative_cache`(전역 패턴 캐시)·PDF(저장물 없음, 내용 해시 키)는 무효화 대상 아님(B0 확정 그대로). `/video/url`(호스트 원본 재생)과 데이터 내보내기 번들은 원본 열람이므로 변경 없음(리포트 content 의 영상 가용 표시만 제거).
- 기본 제외이므로 기존 테스트 17건 중 직접 `SessionParticipant` 를 만드는 보조코드는 `report_included=True` 로 명시(테스트 정합).
- 미해결: 초대만 받고 입장하지 않은 대기열 밖 참가자도 기본 `제외`로 세어져 그룹 상담사 리포트의 공통 기록이 빠질 수 있다 → B9 `entered_at` 도입 후 미입장자 제외 여부를 후속 판단.

### B14 비회원 이메일 초대·리포트 자동 발송 (마이그레이션 `e036a0000048`)
- 신규 테이블 `session_email_invites`(추가형, 세션 FK CASCADE, `(session_id,email_norm)` 유니크). `POST /sessions/{id}/invite/email`(호스트 전용·최대 50개·형식 검증·요청 내 중복 제거) / `GET /sessions/{id}/invite/email`(현황). 응답은 주소별 `registered`(등록)와 `request`(발송 요청: `queued`/`skipped_pending`/`skipped_cooldown`/`enqueue_failed`/`invalid_email`/`duplicate_in_request`/`limit_exceeded`)를 분리하고 delivered/received 계열 필드는 없다.
- 상태 `queued → requested(Resend 2xx 접수) | failed`. 전달 확인은 접수 수준(N 확정). 큐에 300초 넘게 머문 건은 `stale=true`("아직 보내지 못했어요" 근거, 워커 미기동 감지) — 이 건은 쿨다운과 무관하게 재요청 가능. 재요청 쿨다운 60초, 같은 행 갱신.
- 발송은 `report_email_task.py` 의 `@email_app.task("tasks.session_invite_email")`(큐 `email`, 재시도 3회) — 다른 모듈에 두면 unregistered 로 버려지는 기존 함정 회피. 본문: 클래스·시각·**4자리 코드**·`/join` 안내, 코드는 URL 에 싣지 않음.
- 비회원 개인정보 스크럽용 `scrub_invite_emails()` 를 제공(B12 스위프가 호출). 
- 리포트 자동 발송(N-3): 기존 "승인 후 자동 발송" 경로가 입장 시 입력한 `report_email` 만으로 이미 동작함을 테스트로 고정(중복 0, 제외자 대상 아님). 발송 실패는 호스트 뷰 참여자 DTO `report_email_status` 로 표시(비호스트 null). OTP 분기는 건드리지 않았다(회원 1탭·구 게스트 신청 경로 유지).
- 정원 서버 검증(BT79)은 `schemas/session.py` 의 기존 검증을 그대로 두고 테스트로 고정.

### B12 기본 DB 삭제 스위프 `retention_sweep` (마이그레이션 `e036a0000049`, 비활성 배포)
- **A1 확정 반영**: 기존 cron 2개(`sweep_stale_media_cron.py`·`sweep_stale_eeg_raw_cron.py`)는 **그대로 둔다**(현행 dev 90일 음성·영상 삭제 유지). 새 `retention_sweep` 는 `RETENTION_SWEEP_ENABLED=false`(기본)로 배포되어 실행해도 **dry-run(삭제 0)** 이며 후보 건수·바이트·보류 건수를 보고하고 `retention_sweep_runs` 에 이력을 남긴다(`backend/retention_sweep_cron.py` 로 보고서 출력). 활성화는 별도 승인 — 활성이 되면 기존 두 스위프 태스크가 `{"skipped": "replaced_by_retention_sweep"}` 로 스스로 건너뛰어 이중 실행을 막는다. **crontab 등록(deploy-dev.yml)은 이번 범위에서 변경하지 않았다.**
- 설정값: `RETENTION_RAW_DAYS=90`·`RETENTION_GUEST_PII_DAYS=90`(세션 종료일 기준, `ended_at` 없으면 `created_at`), `RETENTION_HOLD_ALERT_DAYS=14`, **`RETENTION_APPLY_FROM`(N-5)** — 이 날짜 이후 종료된 클래스부터만 삭제하며, 비어 있으면 활성이어도 삭제를 거부하고 dry-run 으로만 동작(과거 테스트 데이터 보호). **활성화 전 `.env` 에 설정해야 한다.**
- 삭제 범위: EEG raw 청크·음성/영상 청크·병합 영상/음성 키·STT 원문(`transcript`·`ai_summary.segments`). 지표(`eeg_feature_windows`)·리포트 본문·회원 계정은 대상 아님(N-2). 종료·취소 클래스만, 숨김(보존 전환) 클래스 포함. 파일/객체는 DB 커밋 뒤 best-effort.
- 비회원 개인정보 스크럽: 이름·성별·생년월일·리포트 이메일·이메일 초대 주소를 비움, `session_participants.pii_scrubbed_at` 신설.
- 연구 게이트: 연구 동의(미철회)이고 `export_state` 가 `acked/withdrawn/blocked_withdrawn/not_applicable` 이 아닌 참여자의 **EEG raw 만** 보류(음성·영상·STT 는 연구 번들 대상이 아니라 게이트 없음). `pending/exported` = 내보내기 큐 유지, `blocked_*` 는 별도 집계. 보류가 `RETENTION_RAW_DAYS + RETENTION_HOLD_ALERT_DAYS` 를 넘으면 플랫폼 관리자에게 인앱 알림 1회(`research_consents.hold_alerted_at` 로 중복 방지).
- 임시·고아 정리(재생성 가능한 임시 데이터)는 실행 시 함께 수행: pending/failed EEG 청크, 부모 없는 미디어 청크.
- 미해결(정책 확인 필요): 리포트 스냅샷 `reports.content.transcript_segments` 에 STT 원문이 복제돼 있어 원문 삭제가 이 사본까지 지우지 못한다(N-2 "리포트 본문은 삭제 대상 아님" 과 충돌, B0 A6). 이번에는 N-2 를 따라 건드리지 않았다.

### B13 연구 DB 내보내기 배치 (마이그레이션 `e036a0000050`, 비활성)
- **S3 스테이징 pull 방식 확정**: 운영→Spark push 없음. 번들 `research-export/<batch_id>/{sessions,subjects,eeg_raw,features}.parquet + manifest.json` 을 스테이징 prefix 에만 쓰고(manifest 가 마지막), Spark 가 `GET /research-export/batches`(서비스 토큰)로 목록을 보고 pull 한 뒤 `POST /research-export/ack`(batch_id + manifest sha256)로 회신하면 해당 동의 건 `export_state: pending → exported(업로드) → acked`. 서비스 토큰은 `RESEARCH_EXPORT_ACK_TOKEN`(.env 전용, 비면 503). **Spark 실접속·실전송 없음**, `RESEARCH_EXPORT_ENABLED=false` 기본.
- `research_withdrawal_requests` 는 B11 에서 만든 것을 재사용(이번 마이그레이션은 `research_export_batches`·`research_export_items` 2개만). FK/CASCADE 없음.
- **허용 필드 화이트리스트**(번들 컬럼이 목록과 정확히 같지 않으면 업로드 0) + 문자열 셀 스캔(이메일·전화 패턴, 이 배치 참가자의 이름·이메일·세션 제목/메모 원문). 원본 session/participant/user UUID·이름·이메일·전화·STT·음성·영상·호스트/기관 식별자·**절대 시각 없음**: 세션/참여자는 연구 키 HMAC 가명(`session_pseudo`·`participant_pseudo`), 시각은 참여자 기준 상대 ms(`t_rel_ms`/`start_rel_ms`), 생년월은 `YYYY-MM`(N-4).
- **PPG/ACC**: raw 저장이 없으므로(B0 S6) 번들은 EEG raw(payload 바이트 그대로 + 해석 메타) + EEG 지표 + PPG/ACC **파생 지표**(sdnn·rmssd·lf/hf·heart_rate·respiratory_rate·motion)만 담는다. 계약 문구 "EEG/PPG/ACC raw" 는 이에 맞춰 정정.
- 누적: 동의 건·내용 해시 단위 항목(append-only). 같은 해시면 건너뛰고(중복 제거), 내용이 늘면 새 revision. 종료 훅(`on_session_completed`)이 큐(`pending`)에 올리고, B12 삭제 보류가 삭제 전 미적재분을 같은 큐에 유지한다. 철회: 미ack 배치 취소+스테이징 객체 삭제, ack 직전 철회도 취소, 남은 유효 건은 다시 `pending`. 실패: 부분 업로드 정리·배치 failed·연속 실패 `RESEARCH_EXPORT_MAX_ATTEMPTS`(5)에 닿으면 관리자 알림 1회.
- 의존성 추가: `pyarrow==26.0.0`(requirements.txt) — Parquet 번들용. **dev 배포 시 requirements 설치가 필요**하다.
- 미해결: ① 장비 시계(`device_timestamp_ms`)의 절대 시각 의미는 계속 미확인이라 상대화로 회피 ② 배치 크기 상한(256MB) 초과 시 분할 정책 없음(실패 처리) ③ cron 등록(`research_export_cron.py`)·스테이징 prefix IAM·Spark 쪽 pull 계정은 별도 인프라 승인 사항.
