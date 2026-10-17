# SDD-209 Plan — 클래스 사전·사후 흐름 리디자인 (생성·입장·사전 확인·대기·로비·종료)

> **2026-10-17 R4 개정:** 최신 정책·추가 작업·검증 계약은 [policy-revision-r4.md](policy-revision-r4.md)가 정본이다. 아래의 코드 전면 제거/회원 로그인 필수/초대 행 필수/8주 유예/거부 시 수동 기록/필수 밴드 차단/로컬 대기 이탈/30·90일 보관 및 이와 충돌하는 Task·단언은 폐기한다. 아래 본문은 R4 통합 전의 설계 기준선이며 단독으로 구현하지 않는다.

> Stage ② Plan. 근거: 코드 조사(2026-10-17, 기준 커밋 `32fa5533`, develop) + `spec.md` 확정 결정 8건 + `designs/class-flow-redesign/`(기획.md · 시안 4종 · survey 2종 · flow-base.css) + `investigation/` 조사 문서 10건(§11).
> 표기: **있음**(기능·데이터 존재, 표현만 교체) / **일부**(보강 필요) / **없음**(신규). 확인하지 못한 사항은 `미확인`. 줄 번호는 직접 열어 확인한 값이다(세부 근거는 `investigation/NN-*.md`).
> 시안과 코드가 어긋나면 시안이 정본이다. 확정 결정 1~8은 뒤집지 않았다. 시안대로 구현할 수 없는 곳은 `verify.md §6`(허용 차이 AD1~AD14)에 분리했다.

---

## 0. 조사로 확정한 사실 (spec·기획 가정과 다른 점 포함)

| # | 사실 | 근거 |
|---|---|---|
| F1 | **회원이 클래스 참여자로 등록되고 EEG 를 올릴 수 있게 되는 유일한 경로가 `/sessions/by-code/{code}/join` 이다.** 코드 참여가 `consent_eeg=True` 를 기록하고, EEG 업로드는 `consent_eeg` 가 True 여야 허용된다(미동의 403). 초대(`invite_participant`)로 만든 행은 `consent_eeg=False`(주석이 예고한 "본인 동의 단계"는 구현돼 있지 않다). 로그인용 `POST /sessions/{id}/join` 은 호스트 상태 전이용이라 비호스트는 `in_progress` 일 때만 통과하고(`open` 이면 400), 동의·정원·알림을 처리하지 않는다. → **by-code 를 걷어 내려면 by-id 입장·동의 엔드포인트가 반드시 필요**하고, 없으면 새 흐름의 회원은 밴드를 써도 뇌파가 저장되지 않는다(무음 실패). | `session_service.py:1586-1594,1614,1618`, `:2507-2517`(`_assert_upload_eligible`), `:1445-1482`(`join_session`), `tests/test_sdd026_live_session_p0.py:298-320`(초대 회원 업로드 403 을 기대값으로 고정) |
| F2 | 회원 쪽에서 **코드로만 호출되는 엔드포인트는 4개**: `GET /by-code/{code}`(무인증 조회), `POST /by-code/{code}/join`, `GET /by-code/{code}/state`(무인증·`participant_id` 만으로 본인 EEG 지표 반환), `POST /by-code/{code}/livekit-token`. 손들기·체크인·리포트 신청·WS·EEG 업로드는 이미 로그인 회원(`user_id`)을 지원한다. | `api/v1/session.py:74-130`, `session_service.py:1818-1840`, `report_email_service.py:66-68`, `session_service.py:2292-2370` |
| F3 | 코드에 의존하는 프론트 호출부는 `class-join-page.tsx` 외에 **진행 화면(SDD-208)에도 있다**: `MemberClassContainer`(`:115` 조회, `:163` 상태 폴링, `:316` `useMemberLiveKit`), `hooks/useMemberLiveKit.ts:60`, 상담사 `ToolsSheet.tsx:64`·`HostLiveView.tsx:155` 의 코드 박스. 결정 1(코드 전면 제거)을 지키려면 진행 화면도 건드려야 한다. | `lib/api/session.ts:315-330,401-415,488-493` |
| F4 | **리마인더 메일·인앱 알림이 `/join` 과 참여코드를 안내한다.** 본문 `참여코드: {code}`, `{frontend_base_url}/join 에서 참여코드를 입력하고 입장해 주세요`(링크에는 `?code=` 없음), 알림 extra 에 `access_code`. → 백엔드 수정 필수. 일반 세션 알림(오픈·시작·종료·취소·초대)은 `target_type=session` + `session_id` 만 싣고 프론트가 회원은 `/app/sessions/:id` 로 보낸다(코드 없음, 변경 불필요). 푸시는 `/join` 을 열 수 없는 화이트리스트(`lib/native/push.ts:8-17`). | `reminder_service.py:139-153,170-175,265-268`, `lib/api/notifications.ts:153-155` |
| F5 | **로그인 후 원래 링크로 돌아가는 기능이 회원에게는 없다.** `RoleGuard` 는 미로그인 시 `/login?role=client` 로만 보내고 `next` 는 `platform_admin` 에만 적용된다. `ClientLoginPage` 는 `search` 를 버린다. 결정 1의 "로그인 필요한 상세 딥링크"가 동작하려면 프론트 신규 작업. | `RoleGuard.tsx:23-25`, `auth-routing.ts:4-9`, `LoginPage.tsx:36`, `ClientLoginPage.tsx:4` |
| F6 | Capacitor 앱은 **번들된 웹 자산**을 쓴다(`webDir:'dist'`, `server.url` 없음)이고 **강제 업데이트 장치가 없다**(`min_version|force.?update` grep 0건). 구 앱 번들은 계속 by-code API 를 호출하고, 구 앱 상세 화면은 `access_code` 가 없으면 "참여 코드가 아직 발급되지 않아 입장할 수 없습니다"를 띄운다. → 유예 동안 `access_code` 응답·by-code 로그인 경로를 유지해야 한다. | `capacitor.config.ts:5-6`, `ClientSessionDetailPage.tsx:137-176` |
| F7 | **서버는 이미 "0명이어도 시작"을 허용한다**(그룹 `start` 의 최소 인원 검사는 로그만 남기고 통과, SDD-101). 막고 있는 것은 프론트 `canStart`(그룹은 `activeCount>=1`)뿐. 예약 시각 이전 오픈도 서버·프론트 제한 없음. → 결정 5 는 프론트 변경만으로 충족. | `session_service.py:867-878`, `ClassPlayerPage.tsx:1323-1332` |
| F8 | **서버는 `in_progress` 에서도 회원 입장을 허용한다**(by-code join 은 종료·오픈 전만 막음, LiveKit 토큰도 종료만 막음). 막고 있는 것은 프론트 대기실 게이트(3단계 통과해야 자동 입장, 미완이면 `입장하기` 비활성·강제 입장 없음). 시작 후 입장 회원이 대기실을 건너뛰는 경로는 없다. | `session_service.py:1552-1562,1700`, `ClassWaitingRoom.tsx:325,338-343,579`, `class-waiting-room.ts:84-93` |
| F9 | **참여자 이름이 UUID 로 나오는 원인(A6)은 서버 DTO**: 프론트 타입은 `user_name`·`user_email` 을 기대하지만(`lib/api/session.ts:43-44`) 서버 `_serialize` 참여자 dict 와 `ParticipantInfo` 스키마에 없다. 이름은 WS `participant_changed` 와 호스트 전용 `live-metrics` 의 `display_name` 에만 있다. `_serialize` 호출부 20곳. | `session_service.py:85-148`, `schemas/session.py` `ParticipantInfo`, 조사 03 §2.5 |
| F10 | **예약 모달이 방식을 서버에 안 보내는 버그(A2)는 프론트만의 문제**: 서버 `SessionCreateRequest` 는 `location_type`·`location_address`·`participant_mode`·`linkband_mode`·`record_audio/video`·`reminder_offsets`·`participant_ids` 를 모두 받는다. 모달 payload 에는 없고 `notes` 에 `[온라인]` 문자열만. 그 결과 예약으로 만든 클래스는 서버 기본값(오프라인·**1:1**·정원 10)으로 저장돼 있다. | `schemas/session.py:20-62`, `SessionListPage.tsx:76-88` |
| F11 | `duration_min` 서버 검증은 `1~600` 뿐이고 5분 배수·`scheduled_at` 분 단위 검증이 없다. 시간 충돌은 409 + 고정 문구뿐(충돌 대상 정보 없음), `force=true` 로 우회. 열기 가능 시점은 `ready`·`scheduled` 둘 다 언제든 가능(`TRANSITIONS["open"]`). | `schemas/session.py:24`, `session_service.py:233-258,279-289` |
| F12 | **회원 동의 컬럼은 이미 있다**: `session_participants.consent_audio`·`consent_eeg`(기본 False). `consent_audio` 는 쓰는 곳이 없고 `consent_eeg` 는 업로드·내보내기 게이트다. 사용자 단위 `consents` 테이블(`tos/privacy/sensitive`, 가입 시)은 세션·업로드 판정이 읽지 않는다. 상담사 녹음 동의(`audio/start` 의 `consent_audio`)는 별개이며 컬럼에 저장되지 않고 `SessionRecord.status`(`recording`/`manual`)로만 남는다. **`audio/start` 는 `open` 상태에서 400** 이라 호출은 `start` 전이 직후여야 한다. 동의 쓰기 API 는 없다. | `models/session.py:118-119`, `models/consent.py`, `audio_service.py:69-99`, 조사 07 §1 |
| F13 | 전극별(L·R) 접촉 상태는 **서버에 도달하지 않는다.** 프론트는 `lead_off` 를 WS `feature` 에 실어 보내지만 서버 핸들러가 읽지 않는다. 서버 `device_status` 는 SQI(≥0.7 ok)·10초 staleness 로 서버가 판정한 단일 값이다. 대기실 presence 의 `readiness` 는 boolean 3개만 허용(`_sanitize_readiness`). `bandDone` 만으로는 연결과 건너뜀이 구분되지 않는다. | `useBand.ts:489-505`, `session_live_namespace.py:587-640,1412-1417`, `session_service.py:2424-2439` |
| F14 | 프론트에서는 전극 상태가 `LeadOffStatus {ch1, ch2}` 로 존재하고(`useBand.ts:342,1097-1099`) `SensorTracker` 가 L·기준·R LED 를 그린다(색만, 체크·엑스 없음). **그러나 `SensorTracker`·`LeadOffModal` 은 지금 어떤 화면에서도 렌더되지 않는 죽은 코드**다(유일한 사용처 `GuestMeditationPanel` 이 SDD-208 로 교체됨). `leadOff===null` 이면 전부 빨강(오표시 위험), 색이 어두운 배경에 하드코딩. ch↔좌우 실제 매핑은 SDK 문서로 미확인(현행·시안 모두 ch1=왼쪽 가정). | `SensorTracker.tsx:13-73`, 조사 05 §0 |
| F15 | 대기실 presence 는 서버에 저장되지 않는 휘발성 이벤트이고 **호스트 룸에만** 방송된다(회원에게는 인원 집계가 가지 않음). 호스트 클라이언트가 15초 heartbeat·45초 TTL 로 정리. 호스트의 대기실 구독이 `isLobby` 에서만 켜져 **시작 직후 준비 중 회원이 호스트에게 안 보인다**. 상담사 "다시 알림"(`waiting_room_remind`)은 대기실 소켓이 연결된 회원에게만 닿고 성공 수를 과장한다. 아직 입장하지 않은 초대 회원에게 다시 알리는 API 는 없다. 설문 응답 전에는 호스트 목록에 안 뜨는 현상의 근본 원인은 미확인(레이스 후보). | `session_live_namespace.py:752-825,1078-1091`, `ClassPlayerPage.tsx:995`, 조사 04 §2-2·§2-3b |
| F16 | 마이크 레벨은 대기실(`ClassWaitingRoom.tsx:169-196`)과 상담사 프리뷰(`SessionPreJoinPreview.tsx:113-133`)에 **같은 RMS 계산이 복제**돼 있다(`AnalyserNode` fftSize 512, `min(1, sqrt(mean)*3)`). 칩 버그의 원인은 **상태 모델**: `getUserMedia` 모든 오류를 `'denied'` 한 값으로 저장하고(`ClassWaitingRoom.tsx:244-248`) 칩이 그 값을 "권한이 거부되었습니다"로 찍는다. 정확한 분류(`NotFound`/`NotReadable`)는 `mediaErrorMessage` 에 이미 있으나 칩에 안 간다. 마이크 권한 요청은 페이지 진입 즉시 자동 발생(`:253-265`). **`SessionPreJoinPreview` 의 마이크 OFF 확인 다이얼로그는 어느 경로로도 열 수 없고**(오픈 버튼이 헤더에서 `openClass` 직접 호출, 프리뷰 내부 버튼은 compact 라 숨김), 프리뷰가 마운트 직후 `{cameraOn:false, micOn:false}` 를 보고해 권한 확인 전 오픈하면 수동 기록이 확인 없이 선언될 수 있다. 회원이 대기실에서 고른 카메라·마이크는 진행 화면에 승계되지 않는다. | `class-waiting-room.ts:92-124`, 조사 06 §0 |
| F17 | CI/배포: `deploy-dev.yml` 은 **한 SSH 스크립트 안에서** 프론트 `dist` 교체 → 백엔드 소스 교체 → `alembic upgrade head` → 재시작 순서(프론트·백엔드를 따로 배포하는 구조가 아님). 롤백 트랩은 `dist`·`app`·`alembic` **디렉터리만** 복원하고 **DB 는 되돌리지 않는다**. 현재 alembic head = `e036a0000041`(파일 74개). `e2e-smoke.yml` 이 배포 직후 `smoke → journeys → regressions → full-journey`. `ci-feature.yml` 은 `tsc --noEmit`·`eslint src/`·`npm run build`·백엔드 `pytest` 차단, `npm test` 비차단. 운영(main) 배포 파이프라인은 저장소에 없다(미확인). | `.github/workflows/deploy-dev.yml:118-144,150-227`, `e2e-smoke.yml`, `ci-feature.yml` |
| F18 | E2E 가 바뀌는 화면에 문구·구조 단언을 걸고 있다: `full-journey.mjs:190` 이 `/join?code=` 진입 후 `건너뛰기`·`밴드 없이 진행하기`·`기기 테스트 건너뛰기` 를 누르고, `journeys.mjs` 가 `세션`(`:9`), 홈 히어로 `다음 세션`+`section[class*="from-[#6E1A8C]"]`(`:13-24`), `예약 만들기`·`즉시 클래스`·`전체 목록`(`:59`), `새 세션 생성`·`세션 생성 닫기`(`:63-64`)를 단언. `e2e/class-player/live.mjs` 도 by-code 스텁·`/join` 화면 단언(약 10곳), `scripts/verify-landing.cjs:35,73` 이 `['클래스 바로 참여','/join']` 검증. | 조사 01 §2.5, 조사 03 §4 |
| F19 | 백엔드 테스트 중 by-code/게스트 경로를 **참가자 생성 헬퍼로 쓰는 파일이 24개**(`by-code` 포함), `guest`/`participant_token` 언급 42개(예: `test_sdd021` 13곳, `test_sdd015` 11곳, `test_sdd088` 8곳, `test_sdd026` 8곳, `test_sdd023` 6곳). 게스트 차단(2단계)을 하면 헬퍼를 전부 옮겨야 한다. | 조사 01 §4-3 |
| F20 | 알림 이벤트 제목·본문은 "세션" 어휘를 쓴다(예약·즉시·시작·종료·취소·초대: `session_service.py:365,810,823,960-965,1318,1363`). 푸시와 인앱이 같은 문자열을 공유. 백엔드 `detail="…세션…"` 42곳, `or "세션"` 8곳(테스트 단언 0건). 용어 통일(결정 7) 대상이지만 spec 비범위(푸시 콘텐츠)와 겹침(D15). | 조사 08 부록 E |
| F21 | 시안 4종 케이스 **총 205개**(회원 86 · 상담사 119: member-a 23, member-b 63, host-a 43, host-b 76). 하니스 URL 규약은 시안과 같게 `?screen=<ID>&case=<키>`(시트가 필요한 케이스는 키에 포함). 목록: `investigation/_mock-index.md`. | 시안 `?index=1` |
| F22 | 진행 화면(SDD-208) 자산: `PlayerSheet`(바텀/사이드 판정 `sheet-mode.ts`)·`PlayerBackdrop`·`NoticeBanner/NoticeOverlay`·`IconCircleButton`·`player-tokens.css`(`.pz-root` 스코프, 값이 시안 `tokens.css` 와 같음), 하니스 `pages/design/ClassPlayerCasesPage.tsx` + 측정 `e2e/class-player/{lib,fit,symmetry-*}.mjs`(`data-pz` 계약). `PlayerDock`·`StatusRing` 은 사전 흐름에 쓰지 않는다. **`PlayerSheet` 는 플레이어 그리드(`.pz-shell`) 안에서만 자리를 잡는 다크 전용이라 셸형(라이트)에는 재사용 불가** — 셸형은 별도 시트가 필요. `flow-base.css` 의 `.fl-*`/`.sh-*` 는 `.pz-*` 와 이름이 겹치지 않는다. | `components/class/player/shared/*`, `player-shared.css:182-192`, `flow-base.css`, 조사 08 §0-3 |
| F23 | **정원 = 초대된 인원 수**(행이 있으면 좌석 점유, 입장 여부와 무관). 초대 기반에서 대기열은 호스트가 정원보다 많이 초대했을 때만 생기고, 자리는 **호스트가 회원을 제거할 때만** 승격된다(`max_participants` 를 올려도 승격 안 됨, 회원의 "나가기"는 서버에 아무 호출도 없어 좌석 유지). 현행 승격 감지(진행 화면에서 5초마다 `joinSessionByCode`)는 호스트에게 `participant_changed` 를 매번 쏜다. 대기열 회원도 대기실 presence 를 보내 호스트 "대기실 인원"이 부풀려진다. `"입장 알림은 이 기기와 푸시로"` 현행 문구의 실제 채널은 인앱·WS(푸시 outbox 없음). | `session_service.py:1211-1231,1258-1263,1345-1353,1367-1373`, 조사 09 §2.1-2.2 |
| F24 | 종료 화면: 회원 종료 카드는 시안과 구조가 거의 같으나 시트가 `.mp-legacy-panel`(라이트) + 레거시 두 패널을 감싸 **2중 스크롤**, 사후 체크인 완료 시 패널이 `null` 이라 빈 시트, "함께한 시간"은 클라이언트 `now − startedAt` 계산(서버 `ended_at` 와 불일치 가능). 상담사 종료는 `finishSession` 이 응답을 버리고 `/record` 로 즉시 이동, `HostEndingCard`(3단계)는 미연결. **시안 FH09 의 4단계는 서버 `steps[]` 4키(`save/stt/summary/ready`)와 1:1** 이고, 수동 기록은 `generation_status=partial` 이면서 `ready: active` 라 현행 폴링 훅이 멈춘다 → 판정은 `steps[ready].state` 로. | `report_progress_service.py:44-196`, `hooks/useReportProgress.ts:126-132`, 조사 09 §2.4-2.5 |
| F25 | 취소 시각을 저장하는 컬럼이 없다(`cancel` 은 `ended_at` 도 안 채움). 시안 FH10 `닫은 시각`·`대기 중이던 회원 N명`(재진입)은 서버에 없는 값. 알림 전달 상태(`오후 2:30에 알렸어요`/`전달되지 않았어요`) 조회 API 도 없다(초대 응답에는 알림 결과가 없고 알림 실패는 서버가 삼킴). 참여자 상태 `참여함`/`접속 중` 을 알 필드가 없다(`joined_at` 은 행 생성 시각). | 조사 03 §2.6, 조사 09 §2.6, 조사 08 |
| F26 | **초대 회원이 상담사와 미연결이면 `/app/*` 가 상담사 코드 입력 화면에 막힌다**(`ClientAppPage.tsx:267-291`, `/app/notifications` 외 전부). 초대 서비스는 연결 여부를 검사하지 않는다(`session_service.py:1267-1322`). 결정 1(초대 방식·상세 딥링크)과 충돌 가능 → D7. | 조사 01 §2.4·§5.4 |
| F27 | 상담사 목록 카드의 `시작하기` 직결(시안 FH01)은 결정 8(시작 전 녹음 동의 확인 = FH07)을 우회할 수 있다. `delete_session` 은 상태 가드가 없어 진행 중·완료 클래스도 API 로 삭제된다. 목록 필터 `SessionListPage.tsx:692-696` 이 open 클래스를 즉시 표에서 누락(실증 S-H21). | 조사 08 §4, `session_service.py:817-832` |
| F28 | `list_sessions`·by-code join 응답이 `_serialize` 를 PII 기본값(참)으로 호출해 **참여자(회원)가 타인의 성별·생년월일을 받을 수 있다**(코드 정독, 실행 미재현). 참여자 DTO 의 `consent_audio/eeg` 도 비호스트에게 타인 값이 노출된다. 이름 필드를 추가할 때 같이 고쳐야 한다. | `session_service.py:128-138,621,653,1567,1627,1681`, 조사 03 §2.5-4, 조사 07 §1 |

---

## 1. 목적·범위 한 줄 + 시안/케이스 → 구현 컴포넌트 매핑

**목적**: 클래스 생성 → 입장 → 사전 확인(동의·설문·밴드·기기) → 시작 대기 → (진행: SDD-208) → 종료를 **초대 기반 가입 회원 모델**로 단순화하고 진행 화면과 같은 디자인 언어로 통일한다. 범위: 회원 FM01~FM03·FM05~FM10, 상담사 FH01~FH10, 4뷰포트(390×844·834×1194·1194×834·1280×720).

### 1.1 신규 코드 위치와 접두어
```text
frontend/src/
├─ lib/class/flow/                   # [T1] 케이스 키 파서·레지스트리·파생 순수함수·픽스처
├─ lib/class/{class-media,band-step,class-labels,enter-action,pick-hero-class,class-when}.ts   # 순수 로직(조사 05·06·08 제안)
├─ lib/api/class-flow.ts             # [M1] by-id 회원 API(enter · consent · member-livekit-token · member-state) — session.ts 무수정
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
| FM01 홈 히어로 | 5 | 일부 | `ClientHomePage.tsx` 히어로, `pickUpcomingClass`(`reminder.ts:86,89` 시작 시각이 지난 scheduled 를 버림) | 상태별 CTA 정합(`isLive`에 ready 포함 `:78,263` 수정), 참여코드 칩·복사 타일 제거, 4상태+빈 상태, 카운트다운, 홈 보조 섹션(D13) | SH: `flow/shell/ClassHero` → `ClientHomePage.tsx` |
| FM02 목록 + 신청 시트 | 3 | 일부 | `ClientSessionListPage.tsx` 이중 렌더(`:347,363`), `SessionCard`, 신청 모달(`z-50` 탭바 충돌) | 입장 가능 최상단, 카드 정보 축소, 이중 렌더 제거, 달력 존폐(D13), 신청 바텀 시트(셸 전용 `ShellSheet`, 포털 `z-[60]`) | SH: `ClassCard`·`ApplySheet` |
| FM03 상세 4상태 | 7 | 일부 | `ClientSessionDetailPage.tsx`(방식·장소·시각 DTO 이미 있음) | 방식 칩·시작까지 남은 시간·준비물 3줄·입장 CTA 1개, 오프라인 장소 | SH: `ClassDetailView` |
| FM05 입장 확인 | 3 | 일부 | `class-join-page.tsx` details 단계(회원 자동 참여) | 회원 전용 확인 카드, 열림 전 "열리면 자동으로 입장해요" 대기 카드, 시작 시각·진행자(`host_name` 권장 BE-4) | M: `EntryConfirm` |
| FM06a 안내·동의 | 6 | **없음** | — (동의 UI 없음, `consent_*` 컬럼만) | 방식·녹음·AI 기록·뇌파 고지 + 동의 → `PUT consent`(BE-6) | M: `ConsentStep` |
| FM06b 오늘의 상태 | 8 | 일부 | `PreCheckinPanel.tsx`(`POST /sessions/{id}/checkin` phase=before, `in_progress` 에서도 허용) | 한 번에 한 축·전할 말 단계, 건너뛰기, `-started` 시트 | M: `SurveyStep`(API 재사용) |
| FM06c LINK BAND | 14 | 일부 | `WaitingRoomBandCheck.tsx`, `useBand`, `SensorTracker`(죽은 코드) | `linkband_mode` 반영(현재 props 에 없음), 접촉 불량일 때만 전극 카드, 필수/선택/사용 안 함 분기, 이마만, 단계 이동은 컨테이너가 소유 | M: `BandStep` + S: `ElectrodeLeds` |
| FM06d 기기 점검 | 13 | 일부 | `ClassWaitingRoom.tsx` 기기 구간(레벨 막대·카메라·스피커 복제 로직) | "내 영상·소리" 합친 컴포넌트, 5단계 링, NotFound/NotAllowed/NotReadable 구분, 허용 방법 시트, 오프라인 단계 제거, 마이크 요청 시점 이동(D10) | M: `DeviceStep` + S: `MyAvCheck` |
| FM06e 준비 완료 | 6 | 일부 | 준비 현황+게이트 카드(중복) | 설정 요약 4줄(동의·상태·밴드·기기/참여 방식)·행 탭 재편집 | M: `ReadyStep` |
| FM07 시작 대기 | 6 | 일부 | `WaitingForStart.tsx`(영문 아이브로우·8초 명상 한마디·이모지 BGM 바), `LobbyBgmBar`, 자동 입장 | 시작 예정 시각·준비 인원(BE-13 권장, AD2)·오프라인 BGM 제거·`준비 다시 확인하기`, **시작 후 시트(`지금 입장하기`/`준비 이어서 하기`)** — 현행은 `recheckingPrep` 중에도 자동 입장하고 미완 회원에게 안내 없음 | M: `WaitForStart`·`StartedSheet` |
| FM08 대기열 | 3 | 일부 | `waitlist.ts`, 진행 씬에서만 대기 화면(`MemberClassContainer.tsx:85`) | **사전 흐름에서** 대기 화면, 승격 감지는 `GET /sessions/{id}`(읽기 전용) 폴링, 순번 표시 금지 | M: `WaitlistScreen` |
| FM09 종료 + 시트 2종 | 7 | 일부 | `MemberEndScene`→`MemberEndView`, `ReportEmailRequestPanel`(OTP 분기 절반), `SelfCheckinPanel` | 리포트 **1탭 신청**(서버 OTP 생략 이미 있음), 이메일 마스킹(유틸 없음), 라이트 래핑 제거, 중첩 스크롤 제거(카드 `overflow-y:auto`·시트 `max-height`), 완료 시 버튼 비활성, `수업`→`클래스` | M: `EndScreen`·`ReportSheet`·`CheckinSheet` |
| FM10 취소·종료·미오픈·오류·끊김 | 5(+시안 외 1) | 일부(분산) | `class-join-page`·상세·`MemberNetDownCard` 에 흩어짐(진행 중 취소가 "수고하셨어요" 카드가 되는 결함 포함) | 단일 풀스크린 상태 템플릿 + `deriveFlowStateKind`(순수함수) | S: `FlowStateScreen` + M 문구 |
| FH01 목록 | 7 | 일부 | `SessionListPage.tsx`(필터 `:692-696` 가 open 누락), `SessionListTable`, 캘린더 3종(`open` 색 누락) | 열린 클래스 상단 고정 카드, 달력 존폐(D13), 표→카드, `net`, 목록 `시작하기` → 로비(FH07 경유) | SH: `HostClassList` |
| FH02a~e 만들기 마법사 | 5+4+4+4+2 | 일부 | `SessionCreatePage.tsx`(즉시)·`CreateSessionModal`(예약) 두 벌 | 5단계 통합, 방식 서버 저장(F10), 5분 스텝퍼, 충돌 안내(프론트 계산), 초대, 확인, 이탈 시트(`useBlocker`) | H: `CreateWizard`(`useReducer` 훅) → `/sessions/new`·예약 모달 삭제 |
| FH03 생성 완료 | 5 | 일부 | `SessionCreatePage.tsx:200-264` | 코드·QR 제거, 초대 결과 구조화(`allSettled` → 상태 4종), 부분 실패 재시도, 주 CTA 직행 | H: `CreatedScreen` |
| FH04 상세 | 12 | 일부 | `SessionDetailPage.tsx`(`취소` 확인 없음·진행 중에도 노출 `:34-41,175-187`, `window.confirm`, 모바일에서 복제·삭제 숨김, 코드 박스) | 코드 박스 제거, 준비 현황·다음 할 일, 이름(BE-4), 취소/닫기/삭제 확인 시트, 더보기 시트 | SH: `HostClassDetail` |
| FH05 세팅 | 10 | 일부 | `SessionPreJoinPreview.tsx`(compact·이모지·영문 아이브로우·경고 다이얼로그 도달 불가) | "내 영상·소리" 큰 컴포넌트 + 하단 `클래스 열기`, 마이크 끔 경고 시트 도달 가능, 오프라인 장비 생략(+ `liveKit.connect()` 온라인만) | H: `SetupScreen` + S: `MyAvCheck` |
| FH06 로비 | 25 | 일부 | `HostClassWorkspace`(open), `WaitingRoomReadinessPanel`, `ClassAudioPanel`, 발언권·호스트 밴드(접힘 영역) | 초대 N·대기실 M·준비 현황(초대 명단 기준 행 ⊕ presence), 시작하기 항상 활성(F7), 전극 LED(BE-9), 다시 알림(BE-10) | H: `LobbyScreen`·`host-lobby-model.ts` |
| FH06a 로비 시트 | 11 | 일부 | `ClassAudioPanel`·`SpeakingRightsPanel`·`handleToggleChatEnabled` | 초대(추가·다시 알림)·내 밴드(전극 UI; 호스트 밴드 연결 가능 여부 `hostParticipantId` null 추정 — 확인) 시트 신규, 라이트 카드 제거 | H: `LobbySheets` |
| FH07 시작 확인 시트 | 12 | **없음** | `ConsentModal`(시작 직후) | 시작 전 녹음 동의·마이크 상태·준비 인원·준비 중 목록, 0명 변형, **취소 경로의 `manual` 미선언 버그 해소** | H: `StartConfirmSheet` |
| FH08 나가기·닫기 | 3 | 일부 | `LeaveGuardModal`, `closeClass`(확인 없음 `:1085`) | 닫기 확인(회원 N명 안내), 코랄 | H: `LeaveCloseSheet` |
| FH09 종료·리포트 진행 | 8 | 일부 | `HostEndingCard`(미연결·3단계), `ReportProgressStepper`(글자 기호), `/record` 점프 | 같은 몰입 화면 4단계(D6), 다크 시트 스텝퍼(신규 컴포넌트 — 기존 스텝퍼는 `/record` light 톤이 사용하므로 무수정), `steps[ready]` 판정 | H: `EndingScreen` |
| FH10 닫힘·오류 | 7 | 일부 | `ClassPlayerPage` cancelled·오류 씬(서버 문구 원문 노출 `:1419`) | HTTP 404/403/네트워크 분기(`ApiError.status`, `TypeError`→network), 복제·목록 CTA | S: `FlowStateScreen` + H 문구 |

**집계**: 86(회원)+119(상담사)=205 케이스 / 화면 ID 31개(a~e 포함). 판정: 없음 2(FM06a·FH07), 일부 29, 있음 0 → 전부 표현 교체 이상이므로 "추가 후 교체".

---

## 2. 변경되는 현행 동작 (사용자가 체감하는 변경 · 제거되는 기능)

**회원**
1. 클래스 **입장 코드(6자리) 입력 화면과 `/join`** 이 사라진다. 입장은 홈/목록/상세/알림의 `입장하기` 한 번 → 입장 확인 → 준비 마법사(클릭 3~4 → 2회).
2. **게스트(비로그인) 참여가 사라진다**: 이름·성별·생년월일, 게스트 이메일 인증 코드, 게스트 리포트 신청. 클래스 링크는 로그인이 필요한 상세 딥링크가 된다(로그인 후 원래 링크로 복귀 — F5 신규 구현).
3. **초대받지 않은 회원은 입장할 수 없다.** 현행은 코드를 알면 로그인 회원도 자발 참여 가능했다(`session_service.py:1585-1597`). 새 `enter` 는 기존 참여자(초대) 행이 있어야 통과(없으면 403). 상담사는 **초대를 먼저** 해야 한다(링크만 공유하면 입장 불가). 상담사 미연결 초대 회원 처리는 D7.
4. 입장 전 **동의 단계(FM06a)**: 동의 결과가 뇌파 업로드 가능 여부를 결정한다(F1).
5. 대기실이 **단계별 한 화면 마법사**(탭·준비 현황·게이트 카드 제거). 오프라인은 기기 단계가 없고, LINK BAND 모드(사용 안 함/선택/필수)가 단계에 반영(현행은 항상 "선택"). 마이크 권한 요청이 진입 즉시가 아니라 사용자 동작 후(D10).
6. 상담사가 **준비 중에 시작**하면 `지금 입장하기`/`준비 이어서 하기` 시트(현행은 미완이면 아무 안내 없이 입장 불가).
7. 종료 후 `리포트 받기` 는 **1탭**(계정 이메일 고정, 마스킹 표시). 체크인·리포트 시트가 소프트 시트, 사후 체크인 완료 시 버튼이 비활성(`오늘 상태를 남겼어요`).
8. 홈·목록·상세: 참여코드 노출·복사 제거, 입장 가능 클래스가 목록 맨 위(+ 홈 보조 섹션·달력 정책 D13), 신청이 바텀 시트(탭바 가림 해소), 용어 `세션`→`클래스`. 진행 중 취소 시 "수고하셨어요" 카드가 아니라 취소 화면.

**상담사**
9. 만들기가 **즉시·예약 통합 5단계 마법사**. 예약 모달 삭제, `예약 만들기` 버튼 삭제(목록 진입점 1개). 예약에서도 방식·인원·LINK BAND·녹음·참여자 지정(현행 예약은 고정 기본값이었음). 소요 시간·시작 시각 5분 단위(현행 10분 휠).
10. 생성 완료에서 **클래스 코드·복사가 사라지고** `초대한 회원 N명에게 알림을 보냈어요` + 주 버튼 `클래스 열러 가기`(플레이어 직행 — D8).
11. 클래스 상세·진행 화면 도구 시트의 **코드 박스 제거**(`링크 복사`는 상세 딥링크로 유지). 진행 화면 도구 시트 변경은 D9.
12. 로비에서 **`시작하기` 가 항상 활성**(초대 0명·대기실 0명·준비 중 회원 있어도). 준비 중이면 시작 확인 시트에서 이름·미완 단계를 보고 `지금 시작하기`/`조금 더 기다리기`.
13. **녹음 동의가 시작 후 모달에서 시작 전 확인 시트로 이동**(`ConsentModal` 폐기, 중도 `녹음 시작` 경로는 시트/모달 정리 필요 — 조사 07 §2-7).
14. 열린 클래스가 목록에서 사라지지 않고(상단 고정), `클래스 닫기`·상세 `취소` 에 확인, 진행 중에는 상세 `취소` 숨김, `window.confirm` 제거, 삭제는 서버 상태 가드(BE-16 권장).
15. 종료 후 `/record` 점프 대신 같은 몰입 화면에서 리포트 진행(D6). 목록의 `시작하기` 는 로비(FH07 경유)로.
16. **캘린더·타임라인(월·주·일 보기) 제거**(시안 FH01·FM02 에 없음, D13 기본값) — 상담사 일정 한눈 보기 상실, 충돌은 서버 409 + 마법사 안내로 대체.

**제거되는 기능(코드는 삭제하되 데이터는 보존)**: by-code 로그인/게스트 참여 UI, `ReportEmailRequestPanel` OTP 경로, 예약 모달, `SessionCodeBanner`·`DaySchedule`·`WaitingRoomCheckinList`(미사용 확인), `GuestMeditationPanel`·`GuestCompletePanel`·`GuestChatNotice`(import 0 확인 — I4 에서 재확인 후 삭제), `LeadOffModal`(미렌더, `SensorTracker` 는 새 카드가 재사용하므로 모달과 분리해 보존).

---

## 3. 백엔드 변경 목록 (필요 최소 · 기존 데이터 보존)

> 원칙: **추가형(additive) 우선**. 기존 `access_code`·게스트 참가자 행은 삭제·수정하지 않는다. 롤백 트랩이 DB 를 되돌리지 못하므로(F17) 스키마 변경은 **nullable 컬럼 추가 1건(BE-11, D2 에서 선택)** 로 제한한다. 신규 테스트: `backend/tests/test_sdd209_*.py`. **분류 정의**: 필수 = 없으면 새 흐름이 동작하지 않거나 확정 결정 이행 불가 / 권장 = 대체안으로 진행 가능하나 정합·시안 충족·보안 향상 / 보류 = 이번 범위 밖.

### 3.1 필수 (5)

| ID | 변경 | 근거 | 호환·마이그레이션 | 필요 테스트(= verify §10) | 프론트만의 대체안 |
|---|---|---|---|---|---|
| **BE-1** | `POST /sessions/{id}/enter` — 로그인 회원 입장(참여 확정). `join_session_by_code`(`:1536-1627`) 회원 분기를 공용 함수로 추출해 by-id 로 노출. **기존 참여자 행 필수(없으면 403)**, 호스트면 no-op(`participant_id:null`), 종료 400·오픈 전 400, `open`/`in_progress` 허용(A9), 정원 초과면 대기열 유지·여유 시 해제(`:1619-1623` — 순번 무시 새치기 문제는 BE-14 에서 순번 순 승격), 커밋 후 `participant_changed`. 응답 = `JoinByCodeResponse` 와 같은 형태 + `chat_room_id`. **동의는 쓰지 않는다**(BE-6 가 담당). 멱등 | F1·F8 | 추가형. by-code 로직은 공용 함수 위임으로 동작 동일(구 앱 호환) | BT1·BT10 | 없음(세션 상세의 `access_code` 를 내부 토큰으로 써서 by-code join 호출 — 비초대 자발 참여·코드 노출·게스트가 서버에 남아 결정 1 미이행 → 비채택, 어댑터 폴백 플래그로만 보유) |
| **BE-6** | `PUT /sessions/{id}/consent` — 회원 본인 참여자 행의 `consent_audio`·`consent_eeg` 저장. 본인 행만(소유 검증 패턴 `:2520-2560`), 종료·취소 409, 멱등·재편집 가능, `linkband_mode='none'` 이면 `eeg` 무시. **초대 회원의 뇌파 업로드를 가능하게 하는 유일한 정식 경로** | F1·F12, 조사 07 N1 | 기존 컬럼 재사용. 코드 입장 경로의 자동 `True` 는 읽기 호환 유지. 과거 행 불변 | BT2·BT3 | 없음(UI 만으로는 초대 회원 EEG 403 해소 불가) |
| **BE-2** | `POST /sessions/{id}/member-livekit-token` — `member_livekit_token`(`:1685-1752`)의 by-id 래퍼. 참여자 = 요청 사용자 행, 대기열 403, `_compute_can_publish` 동일. **호스트 전용 `POST /{id}/livekit-token`·`POST /{id}/join` 은 건드리지 않고 재사용 금지**(후자는 참가자에게 송출 가능 토큰을 줄 수 있는 기존 결함 — 별도 Fix 카드) | F2·F3, 조사 01 §2.4 | 추가형 | BT4 | 같은 대체(비채택) |
| **BE-3** | 리마인더 메일·인앱 본문에서 코드·`/join` 제거: `참여코드` 줄 삭제, 링크 → `{frontend_base_url}/app/sessions/{session_id}`, 문구 `참여코드를 입력하고 입장` → `로그인 후 입장하기를 눌러 주세요`, extra 의 `access_code` 제거. 이 파일에 한해 `세션`→`클래스` 치환(D15) | F4 | 예약된 리마인더는 발송 시점에 본문을 새로 만들므로 재배포로 적용. 과거 알림 행의 `extra.params.access_code` 는 무해(프론트는 `target_id` 만 사용) | BT6 | 없음 |
| **BE-5** | **2단계(별도 배포, D1 유예 후)**: 게스트 경로 차단 — by-code join 게스트 분기 400/403(구 번들은 410 문구가 "이미 종료"로 오표시되므로 비-410 + 명확한 detail), `report-email` 게스트 분기 거부, by-code `state`/`livekit-token` 게스트 거부, 비초대 회원 by-code join 거부, 비호스트 직렬화에서 `access_code` 제거(과거 값 DB 보존), 게스트 무토큰 경로(`resolve_live_join`·`resolve_signal_sender`·`resolve_upload_participant`·`features`/`eeg-raw` 의 `get_current_user_optional`·WS 무토큰 연결·`_authorize_participant_access` 게스트 분기) 정리. 로그인 by-code 3종은 구 앱 호환으로 유지(제거는 BE-21 보류) | 결정 1 · F6 · F19 | 응답 필드 제거는 구 앱 영향 → 프론트 전환 배포 + 유예 후. 과거 게스트 행은 읽기 보존(쓰기 불가). **테스트 헬퍼 전환 필요(24개 파일)** | BT12 | 없음(결정 1 의 서버측 이행. 시점은 D1) |

### 3.2 권장 (9, R4 채택 범위는 개정 문서 참조)

| ID | 변경 | 근거 | 대체안(백엔드 무변경) |
|---|---|---|---|
| **BE-4** | 참여자 DTO 에 `user_name` 추가, `user_email` 은 호스트 뷰만(`include_participant_pii` 재사용), 목록·by-code 호출의 PII 기본값 정리(F28: 타인 성별·생년월일·`consent_*` 비호스트 제외). `SessionResponse.host_name` 추가(FM05 진행자 줄, 연결 안 된 호스트도 표시). N+1 방지(`User.id IN (...)` 일괄) | F9·F28 | 이름: `live-metrics` `display_name`(호스트 전용, 대기열 제외)·`GET /clients` 매핑(연결 종료 회원은 폴백). `host_name`: `user.counselors` + 폴백 `진행자` |
| **BE-7** | `GET /sessions/{id}/member-state` — `get_guest_session_state`(`:2179-2248`) 인증 래퍼(상태·본인 밴드·지표·`chat_enabled`). 무인증 by-code state(IDOR 성격)는 BE-5 에서 폐쇄 방향 | F2 | `GET /sessions/{id}`(상태·`chat_enabled`·본인 행 `is_waitlisted`) + WS `session_state_changed`. 본인 지표는 SDD-208 이 WS 스냅샷으로 받는지 `미확인` |
| **BE-9** | WS 대기실 presence 확장: `readiness` 에 선택 필드 `surveySkipped/bandSkipped/deviceSkipped`(boolean) 및 `band{state, lead_off{ch1,ch2}, battery}`(조사 05 안) 허용(`_sanitize_readiness`·`on_waiting_room` 확장, 서버 저장 없음). 구 클라이언트(3 boolean)도 통과해야 함(`type(...) is bool` 전부 조건 완화). 필요 시 `on_feature` 가 `lead_off` 를 읽어 `eeg_feature` 중계에 추가(진행 중 호스트 화면은 비범위) | F13·F15(A8) | `skip` 은 `완료`로, 접촉 불량 L/R 은 `접촉 확인 필요` 텍스트만(데이터가 없으므로 사실상 표시 불가) — AD9 |
| **BE-10** | `POST /sessions/{id}/invite/remind` — 아직 입장하지 않은 초대 회원 대상 알림 재발송(호스트 전용, 쿨다운 60초, `notify_event` 재사용, 대상별 결과 반환). 채널은 인앱+WS(+이메일 선호) — 푸시 아님. 선택: 초대 알림 전달 상태·시각 조회(시안 FH06a `오후 2:30에 알렸어요`) | F15(S6), 조사 04 §2-5 | `다시 알림` 버튼 제외(대기실 안 회원 리마인더는 기존 WS 유지) — AD4 |
| **BE-11** | **마이그레이션 1건(nullable 3컬럼, D2 에서 선택)**: `session_participants.consent_at`·`consent_version`(동의 증빙, BE-6 이 기록) + `entered_at`(BE-1 이 최초 입장 시 기록: FH04 `참여함`·목록 `입장 N명`·FH09 인원의 정의 근거). 기존 행 NULL=기록 없음, 다운그레이드 `drop_column`, down_revision = `e036a0000041` | F12·F25, 조사 07 §2-6 옵션 B | D2 에서 C-1(컬럼 없음) 선택 시 동의 시각·버전·입장 이력 없음, AD3·AD5 는 `초대 N명` 표기로 한정 |
| **BE-13** | 회원 대기실용 집계 방송: `on_waiting_room` 수신 시 세션별 휘발성 집계를 갖고 `{ready,total}` 만 `_room_all` 로 `waiting_room_summary` 방송(개인 식별 정보 없음, TTL 은 호스트와 일치) | F15, 조사 09 BE-1 | FM07 그룹 카드를 `내 준비를 마쳤어요`로 축소 — AD2 |
| **BE-14** | 대기열: 승격 시 대상 `_room_self` 로 `participant_promoted` 발행, 초대·제거·승격에서 `_notify_participant_changed`, `max_participants` 증가 시 가능한 만큼 순번 순 승격, 재입장 시 순번 무시 새치기 수정 | F23, 조사 09 BE-2·3 | `GET /sessions/{id}` 5초 폴링(읽기 전용, 부작용 없음). 정원 증가 승격은 대체 불가(호스트가 제거와 함께 써야 함을 안내) |
| **BE-16** | `delete_session` 상태 가드(`ready`/`scheduled`/`cancelled` 만 허용, 진행 중·완료 거부) | F27 | FE 숨김만(API 직접 호출은 못 막음) |
| **BE-17** | 레거시 예약 데이터 보정(선택): `notes` 가 `[온라인]` 으로 시작하고 `location_type='offline'` 인 행을 `online`·주소 null 로(dry-run·로그 필수, 삭제 금지, 접두사는 지우지 않음) | F10, 조사 03 §2.2·08 | 프론트 표시 시 `notes` 접두 태그로 파생(복제·회원 입장 경로는 못 덮음) |
> 번호 BE-12·BE-15 는 결번이다(조사 중 BE-2·BE-4 에 흡수됨). verify §10 의 BT 번호는 아래 BE 번호와 `BT1·BT10→BE-1`, `BT2·BT3→BE-6`, `BT4→BE-2`, `BT5·BT14→BE-4`, `BT6→BE-3`, `BT7→(리포트 1탭, 변경 없음 — 테스트 공백 보강)`, `BT8→BE-9`, `BT9→BE-10`, `BT12→BE-5`, `BT13→BE-11` 로 대응한다.

### 3.3 보류 (9)

| ID | 항목 | 이유 |
|---|---|---|
| BE-8 | 시간 충돌 409 응답 구조화(`detail:{code, conflict}`)·`GET /sessions/conflicts` | 프론트 `GET /sessions` 로 겹침 계산 가능(조사 03 §2.4), 기존 문자열 detail 호환 |
| BE-18 | `duration_min % 5`·`scheduled_at` 분 %5 서버 검증 | 프론트 스텝퍼로 충족, 서버 검증은 기존 테스트 다수 수정(조사 03) |
| BE-19 | `cancelled_at` 컬럼(FH10 `닫은 시각`) | 방금 닫은 경우만 클라이언트 시계로 표시(AD4). `ended_at` 재사용은 통계가 완료로 해석하므로 위험 |
| BE-20 | 알림 이벤트 제목·본문 "세션"→"클래스", 승격·닫힘 푸시 채널 | 푸시 콘텐츠 비범위(D15, D14) |
| BE-21 | 로그인 by-code 3종 최종 제거 | 구 앱 번들 사용률 확인 후(F6, `미확인`) |
| BE-22 | 대기열 입장 승인·회원 대기열 이탈 API | SDD-208 B4 보류 유지, FM08 `대기 그만하기`는 로컬 이탈(AD10) |
| BE-23 | `ai_analysis` 컬럼·오프라인 `record_video` 서버 차단 | 마법사가 `음성 녹음`=AI 분석으로 고정·오프라인이면 `record_video=false` 전송(D8) |
| BE-24 | 동의 철회 API·동의 이력 조회·`audio/start` 의 `open` 허용 | 시안 `상담사에게 요청`은 수동 처리(D2), 시작 전 선언 불필요 |
| BE-25 | 리포트 진행 `partial`+`ready:active` 상태 정정 | 프론트가 `steps[ready].state` 로 판정(F24) |

**집계**: **필수 5**(BE-1·2·3·6 + 2단계 배포 BE-5) / **권장 9**(BE-4·7·9·10·11·13·14·16·17) / **보류 9**(BE-8·18~25). 마이그레이션 **0~1건**(BE-11 만, D2 에서 선택, nullable 3컬럼). 신규 엔드포인트: 필수 3(BE-1 `enter`·BE-6 `PUT consent`·BE-2 `member-livekit-token`) + 권장 2(BE-7·BE-10). WS 이벤트·필드: BE-9·BE-13·BE-14.

**프론트 단독 최소안(백엔드 무변경) 비교**: 세션 상세의 `access_code` 를 내부 토큰처럼 써서 by-code 호출을 유지하면 UI 에서는 코드·게스트가 사라진다. 그러나 ① 게스트·코드 참여가 서버에서 계속 가능(결정 1 미이행), ② 비초대 회원 자발 참여 지속, ③ 동의가 서버에 남지 않음(`consent_eeg` 가 코드 입장으로 자동 True — 명시적 동의 아님), ④ 리마인더 메일이 `/join`+코드를 계속 안내(F4)하므로 **채택하지 않는다**. 단 BE-1·2·6 일정이 늦어질 때 임시 대체로 쓸 수 있도록 `lib/api/class-flow.ts` 가 어댑터 한 곳에서 분기한다(M1, 환경 플래그 `VITE_FLOW_API_FALLBACK` 기본 off, verify G7 에서 개수 고정).

---

## 4. 사용자 결정 필요 항목 (비즈니스·정책만. 기술 선택은 plan 이 기본값 제안)

> 기본값은 보수적(프라이버시·데이터 보존·결정 8건 준수)으로 잡았다. 조사 문서의 하위 결정은 묶음 항목(D8·D10·D11·D13)의 표에 모두 넣었다. 총 **16개**(D1~D16, 하위 항목 포함 약 45개).

| ID | 질문 | 옵션 | 기본값 | 영향 |
|---|---|---|---|---|
| **D1** | 기존 `/join?code=` 링크·구 앱·게스트 차단 시점(F6) | (a) 프론트 전환과 동시 서버 차단 (b) 프론트 먼저, **유예 후 별도 배포로 차단(BE-5)** (c) 서버 차단 안 함 | **(b), 유예 8주**(조사 01 기본값) + 유예 중 서버 로그로 게스트 join 건수 추이 확인. `/join` 은 삭제하지 않고 **리다이렉트 전용**: 로그인 회원 → `?code=` 가 있으면 내 클래스 목록(`GET /sessions`)에서 `access_code` 일치 항목을 찾아 `/app/sessions/{id}`(서버 조회 엔드포인트 불필요), 없으면 `/app`+안내, 비로그인 → 로그인 후 복귀. 입력 화면 없음 | (a) 이미 보낸 메일·구 앱·진행 중 게스트 즉시 깨짐 (c) 결정 1 미이행·코드 열거 면 영구 |
| **D2** | **동의 저장·거부·철회 정책**(조사 07) | 저장: (A) UI 만 (B) 기존 컬럼 + 증빙 컬럼(BE-11) (C-1) 기존 컬럼만. 거부: (a) 입장 불가 (b) 입장 허용+수동 기록 (c) 동의 없이 녹음. 철회: 종료 전 회원 직접 변경 / 종료 후 상담사 요청 | **저장 (B)**(마이그레이션 1건 nullable) — 불가하면 (C-1). **거부 (b)**: `녹음과 AI 기록` 거부해도 입장 허용, 상담사 FH07 에서 수동 기록 안내. **FM06a 기본 체크 상태 = 전부 미체크**(시안 `!empty` 기본 체크와 다름 — AD8). 철회: 종료 전 FM06e 행 탭 재편집, 종료 후 상담사 요청(수동). 뇌파 동의 `required` 모드 거부는 D5 | (A)는 초대 회원 EEG 403 미해결·증빙 없음. (a)는 `data-privacy.md` "거부 시 수동 기록" 과 충돌. FH07 동의 현황 칩은 BE-9 확장(`consentDone`) 또는 폴링 필요 |
| **D3** | **동의 문구의 사실 관계**(조사 07 §2-4) | (a) 코드 사실에 맞춤 (b) 시안 문구 그대로 | **(a)**: ① 보관 기간: 시안·`ConsentModal` `30일` ≠ 코드(음성·영상 90일 `media_cleanup_service.py:26`, 뇌파 원본 기본 무기한 `config.py:77-79`) → 실제 값으로 정정 또는 코드 변경을 팀이 확정(**값 자체는 사용자 확정 필요**) ② 회원 음성 포함 여부: AI 기록은 **상담사 기기 마이크만** 녹음(회원 음성은 서버 녹화 없음; 온라인에서 스피커→마이크 유입은 환경 의존, 미확인)이라 `음성을 녹음하고`(온라인)/`현장 대화를 녹음하고`(오프라인) 문구는 사실에 맞게 조정 ③ 삭제 권한·보관 고지 행 추가(시안엔 없음) ④ 영상 녹화(호스트 카메라) 고지 한 줄(FH07) | 문구 단언(verify §3·§4) 갱신. 법적 판단은 하지 않음 |
| **D4** | **시작 후 입장 허용 범위** | (a) 초대 회원만, 동의는 건너뛸 수 없음, 설문·밴드·기기는 건너뛰기 가능 (b) 동의도 시작 후 이어서 | **(a)** — 서버는 이미 허용(F8). FM06a 는 시안에 `started` 케이스가 없음(공백) → 동의 단계에서 시작되면 시트 없이 동의를 먼저 마치게 함. 건너뛴 항목은 진행 화면 도구에서 이어서(설문 시트는 신설 — `PreCheckinPanel` 재사용, API 는 `in_progress` 에서도 허용) | (b)는 규칙 1·2 "시작 전 동의" 위반 소지 |
| **D5** | **LINK BAND 필수 모드의 회원 정책**(조사 05 §5-1) | (A) 시안대로: 사전 마법사에서 연결 못 하면 준비 완료 불가, 미지원 브라우저는 링크 복사 안내, **시작 후에는 `지금 입장하기` 로 우회 가능** (B) 연결 안내만, 입장 항상 허용 (C) A+서버 강제 | **(A)** — 결정 5(시작 후에도 준비 이어서)와 양립. 시안 `req` 케이스는 "연결해야 입장" 인데 `started` 시트의 필수 케이스는 없어 이 우회는 시안 공백을 메우는 해석 | iOS 웹·Safari 회원은 필수 클래스에 사전 입장 불가(앱 안내 필요). (C)는 백엔드 변경 |
| **D6** | **종료 후 이동**(SDD-208 D6 번복) | (a) 시안 FH09: 같은 몰입 화면에서 4단계 진행, `기록 보기` 수동 (b) 현행 `/record` 점프 | **(a)** — spec "시안이 정본". 규모 M, 테스트 4파일 갱신(`class-player-page-live.test.tsx:195-216`·`class-player-host-container.test.tsx:248-260,386-410` 등). SDD-208 결정을 되돌리므로 확인 요청 | (b)면 FH09 `end-*` 4케이스는 종료된 세션을 직접 열 때만 사용 |
| **D7** | **초대 필수·상담사 미연결 회원**(F26) | 초대: (a) 초대 필수 (b) 링크 가진 회원 자동 초대. 게이트: (A) `/app/sessions/:id`·`/enter` 를 연결 게이트에서 제외 (B) 현행(연결 필수) | **(a)+(A)** — 결정 1("초대 방식")과 일치, 연결 게이트(`ClientAppPage.tsx:289`)는 결정 1과 충돌 가능이라 예외 처리. 상담사 안내 문구 "초대한 회원만 입장해요". 시안에 없는 비초대(403) 상태는 FM10 템플릿 재사용(verify AD1, 시각 승인 필요) | (b)는 정원·보안 정책 신설 |
| **D8** | **만들기 마법사 정책 묶음**(조사 03 §5) | — | 하위 기본값: ① 그룹 정원 10 고정(시안; 현행 1~100/온라인 ≤50 — 템플릿·복제는 원본 보존) ② `AI 분석` 토글 제거·`음성 녹음`=AI 분석(`ai_analysis` 컬럼 없음) ③ 오프라인이면 `record_video=false` 전송 ④ 예약 알림 단일 선택(끄기/하루 전/1시간 전, 기본 1시간 전; 기존 다중값은 가장 이른 시점만 유지) ⑤ `기타` 유형은 이름 입력 노출(서버 필수) ⑥ 제목 비우면 `유형 + 날짜` 자동(`제목 없음` 노출 방지) ⑦ `내 템플릿에서 시작` 진입은 ① 단계 상단(시안에 없음) ⑧ **`클래스 열러 가기` → 플레이어 직행**(기획 §6 정본; 시안 `data-go=FH04` 와 불일치 — 시안 보정 대상, AD12) ⑨ 초대 `발송 완료` = 초대 등록 성공(알림 전달 여부는 BE-10 후) ⑩ 과거 `[온라인]` 예약은 프론트 표시 파생(DB 백필은 BE-17 선택) ⑪ 예약 범위 시안대로(오늘~13일 뒤·07~22시·최대 8시간) | 시안 문구·동작 일부 변경(AD6) |
| **D9** | **진행 화면(SDD-208) 도구 시트의 클래스 코드 박스 제거**(spec 비범위 "진행 중 화면"과 결정 1 "상담사 화면의 클래스 코드 전부 제거"의 경계, F3) | (a) 포함(소규모) (b) 유지 | **(a)** — `ToolsSheet.tsx:64`·`HostLiveView.tsx:155`·하니스 픽스처의 `accessCode` 제거, SDD-208 verify 해당 행 갱신. 회원 진행 화면의 by-id 전환(M9)도 같은 사유로 포함 | (b)면 코드가 상담사 화면에 남음 |
| **D10** | **기기 정책 묶음**(조사 06 §5·04 §5) | — | ① 마이크 권한 요청 시점: 기기 단계에서 사용자가 `마이크 켜기`를 누를 때(AD14) ② 대기실에서 켠 카메라 선택을 입장 후 **승계**(시안 문구와 일치; SDD-208 "기본 비공개"는 사용자가 명시적으로 켠 경우 예외) ③ 오프라인 상담사 마이크는 **FH05 점검 없음**(시안 그대로) + 거부 시 수동 기록 안내(시안 FH05/FH07 내부 불일치) ④ `NotReadable` 칩 문구 `다른 앱에서 쓰는 중이에요` + 재확인 버튼 ⑤ 마이크 꺼짐·거부·장치 없음일 때 `클래스 열기` 경고 범위: 꺼 둔 경우만 3지선다 시트, 거부·없음은 인라인 | 시안 일부 문구 추가 |
| **D11** | **로비 밴드 정책 묶음**(조사 05 §5-2·3) | — | ① 상담사 로비 `접촉 불량`을 **하드웨어 L/R 접촉**으로 표시(BE-9) ② 로비(시작 전) 밴드 데이터는 **접촉·연결 상태만 중계하고 EEG feature 는 저장하지 않음**(마법사 컨테이너가 `useBand` 를 1회 호출·유지하되 시작 전 업로드 `enabled:false`) — 시작 전 구간이 리포트에 섞이는지 미확인이므로 보수적 | ②가 B(저장 허용)면 `_store_feature` 에 세션 상태 검사 없음 → 리포트 평균 오염 가능 |
| **D12** | **시안 가정 불성립 처리 승인**(verify §6 AD1~AD14: 입장·준비 인원, 알림 전달 상태, 닫은 시각, 참여 상태, 보관 기간, 동의 필수 표기, 전극 LED, 대기 그만하기, 푸시 약속, 시간 계산 등) | 각 항목 기본 구현안 승인 / 시안 보정 요청 | verify §6 의 기본 구현안 | 승인이 verify 승인의 일부 |
| **D13** | **셸형 화면 정책 묶음**(조사 08 §5) | — | ① 홈 보조 섹션: 히어로·이번 주 클래스를 시안으로 바꾸고 리포트·대화·알림 카드는 `sh-card` 로 재스타일해 **유지**, 요약 타일·하드코딩 담당 상담사 소개("임상·최면심리상담 전문")만 삭제 ② `곧 열림` 임계 60분, 상세도 같은 판정(시안 FM03 에 `soon` 상태 없음 → 목업 추가 가능) ③ **캘린더·타임라인 제거**(상담사 일정 한눈 보기 상실) ④ 클래스 신청 문구를 현 동작에 맞춤(`상담사가 클래스를 만들면 알림으로 알려드려요`; 신청 상태 엔티티는 보류) ⑤ 셸 위 시트 톤 다크 소프트(상담사 시안과 일치; 회원 신청 시트 시안 수정 필요) ⑥ 열린 클래스 N개: 카드 1장+나머지는 목록 최상단 행 ⑦ 삭제 정책: `ready/scheduled/cancelled` 만(BE-16) ⑧ 알림 탭 → `session_opened·started·waitlist_promoted` 만 입장 직행, 나머지 상세 ⑨ 내비 라벨 `세션`→`클래스` 시 **배지 키 상수화**(`SidebarNav.tsx:218`, 두 `BottomTabBar` — 라벨만 바꾸면 초대 배지 소실) | ①은 시안과 다른 홈, ③은 기능 제거 |
| **D14** | **대기열·"N명" 정의·푸시 약속**(조사 09 §5) | 대기열: ① 현행(정원=초대 수) ② 동시 입장 기준 ③ 폐지. N명: ① 초대 전체 ② 실제 입장(`entered_at`) | 대기열 **①**(FM08 은 드문 화면, BE-14 로 정합 보강), N명 **① 초대 전체(대기열 제외)** + 문구 `초대한 회원 N명`(BE-11 채택 시 `입장 N명` 병기 가능), 푸시: 문구를 `알림으로 알려 드려요` 로(푸시 채널 없음) | ②는 별도 SDD 권장 |
| **D15** | **알림 문구 "세션"→"클래스" 치환 범위** + org_admin | 알림: (a) 리마인더(BE-3)만 (b) 전부 / org_admin: 유지·변경 | 알림 **(a)** — 나머지(`session_service.py` 이벤트 제목·본문, `detail=` 42곳)는 푸시 콘텐츠 비범위로 후속(사용자가 일부 "세션"을 계속 봄). org_admin **유지**(본인 호스트 클래스만 — 서버 동작, 시안 없음, `미확인` 의도 여부) | (b)는 알림·테스트 다수 |
| **D16** | **사전 흐름 하니스 라우트(`/design/class-flow`)를 dev 배포 번들에 포함할지**(SDD-208 R12 미해결: `App.tsx:61,203` 이 무가드·무조건 등록, `import.meta.env` 분기 없음, dev 는 `npm run build` 프로덕션 모드) | ① 현행 선례 유지(무가드, 정적 한글 샘플 픽스처만 노출·개인정보 없음) ② `import.meta.env.DEV` 에서만 등록 ③ 무가드 + 별도 환경변수 제어 | **①** | ②는 dev 서버에서 시안 대조·Design QA 불가(로컬 vite 로만). 하니스가 dev 에 2개가 됨 |

> **결정 충돌(확정 8결정과 직접 충돌)**: 없음. 경계 해석이 필요한 것은 D6(SDD-208 결정 번복)·D9(spec 비범위 문구)·D7(F26 연결 게이트)이며 각각 위 표에서 분리했다.
> **사실 확인으로 종결(결정 불필요)**: 시작 최소 인원(서버 이미 0명 허용 F7), 닫기 시 회원 안내(서버 cancel 이 대기열 포함 전원에 `session_cancelled` 알림 + 상태 이벤트 `session_service.py:950-973`), 리포트 신청 OTP(서버 이미 회원 OTP 생략 `report_email_service.py:75-85`, 다른 이메일은 `email_verify_token` 필요), 예약 시각 이전 오픈(제한 없음 유지·FH05 에 예정 시각만 표시), 24시간 열린 채 방치 자동 닫힘(FH08 안내 문구에 반영: `열린 채로 두어요` 는 24시간 한도, `session_service.py:979`).

---

## 5. 아키텍처

### 5.1 설계 원칙 (SDD-208 과 동일)
1. **뷰·컨테이너 분리**: 뷰는 props 만, 컨테이너가 훅·API·소켓 조립 → 뷰를 픽스처로 직접 렌더해 205 케이스를 서버·BLE 없이 결정적으로 검증.
2. **케이스 = 입력에서 파생**: 시안 케이스 키(`on-group-opt-member-leadoffl` = 방식-인원-밴드모드-회원-상태)를 파싱하는 순수함수(`lib/class/flow/case-key.ts`)와 상태 파생(`deriveReadiness`·`buildSteps(place,band)`·`deriveLobbyStats`·`deriveStartSheet`·`deriveElectrodes`·`deriveFlowStateKind`·`deriveEnterState`). 밴드·네트워크·마이크·카메라는 SDD-208 `lib/class/player-case.ts` 의 `deriveBandUi`·`NetUi`·`MicUi`·`CamUi` 를 **재사용**(새 임계값 금지). `deriveBandUi` 는 L/R 분할·연결 실패·접촉 미확인을 구분하지 못하므로 얇은 래퍼 `deriveBandStep`(`lib/class/band-step.ts`)을 둔다.
3. **추가 후 교체**: 새 컴포넌트는 새 경로에 추가만. 호출부 교체(`App.tsx` 라우트·페이지 내부)는 통합 Task. 구 컴포넌트는 마지막에 삭제. 롤백 = 통합 커밋 revert.
4. **셸형은 기존 페이지를 직접 수정**(회원 홈·목록·상세, 상담사 목록·상세는 같은 라우트의 본문 교체 — 소유 트랙 SH 단독 수정).
5. **데이터 훅**: TanStack Query 는 코드에 없다(CLAUDE.md 가정과 다름) → 공용 로딩은 `useClassList`(30초 폴링·포커스·알림 트리거)를 직접 구현(조사 08 §4-10). 마법사 드래프트는 `useReducer` 훅 1개(zustand 불사용, 단계·점프가 라우트를 바꾸지 않아 이탈 가드가 단계 이동에 걸리지 않음).

### 5.2 라우트
| 용도 | 경로 | 비고 |
|---|---|---|
| 회원 입장 흐름(몰입형, 셸 없음) | `/app/sessions/:id/enter` (`RoleGuard role="client"`) | `/app/*` 보다 구체적인 별도 `<Route>` 로 `App.tsx` 에 추가. 오케스트레이터 **1개 페이지**(`MemberEntryPage`)가 FM05→FM06a~e→FM07→(진행 `MemberClassContainer`)→FM09, FM08, FM10 을 상태 머신으로 처리 — 준비~대기 사이 BLE·미리보기 상태를 보존해야 해서 단계별 라우트 분리는 비권장. `useBand` 는 이 컨테이너에서 **1회만 호출**(`useBand.ts:77` 인스턴스 1개 규칙)해 단계에 props 로 전달 |
| 회원 상세 딥링크 | `/app/sessions/:id` (기존) | 알림·메일·공유 링크 목적지. 로그인 복귀(F5) 추가, 상담사 연결 게이트 예외(D7) |
| 레거시 `/join` | `/join` → `JoinLegacyRedirect` | D1: 입력 화면 제거, 서버 조회 엔드포인트 불필요(목록에서 `access_code` 일치) |
| 상담사 만들기 | `/sessions/new` (기존) | 마법사로 교체. 목록의 `클래스 만들기` 1개 진입점(`예약 만들기` 삭제) |
| 상담사 세팅·로비·종료 | `/sessions/:id/player` (기존) | `isSetup`/`isLobby`/종료·닫힘·오류 구간을 `HostPrepContainer` 로 교체(SDD-208 `HostLiveContainer` 선례) — `HostClassWorkspace`·`host-class-player.css` 는 I4 에서 삭제 |
| 하니스 | `/design/class-flow` | 픽스처만 렌더, 인증 없음(`/design/*` 선례 `App.tsx:197-203`) |

**로그인 복귀(F5)**: `RoleGuard` 가 미로그인 시 `/login?role=client&next=<현재 경로>`, `ClientLoginPage` 가 `search` 전달, `resolvePostLoginPath` 가 회원 `next` 를 허용 목록(`^/app/sessions/[0-9a-f-]+(/enter)?$`)으로만 수용(오픈 리다이렉트 방지, 공백·역슬래시 거부 — platform_admin 검사 `auth-routing.ts:4-9` 와 같은 형식). 온보딩 미완료 회원은 온보딩 우선 후 복귀는 `미확인`(M1 에서 확인). 세션 만료 시 `terminateSession`(`lib/api/client.ts:91-108`)도 복귀 경로를 붙이지 않음 — 범위 확인.

### 5.3 회원 입장 상태 머신 (by-id)
```text
 (홈/목록/상세/알림 입장하기) ─▶ GET /sessions/{id}(참여자만 조회 가능)
   ├ 403 ─▶ FM10 not-invited(시안 외 · AD1)   ├ completed/cancelled ─▶ FM10 closed/cancelled
   ├ ready·scheduled ─▶ FM05 member-wait(열리면 자동 진행; WS session_state_changed + 5초 폴링)
   └ open·in_progress ─▶ FM05 member ─[입장하기]─▶ FM06a 동의 ─▶ PUT consent ─▶ POST enter
        ─▶ FM06b 설문(건너뛰기) ─▶ FM06c 밴드(모드별) ─▶ FM06d 기기(온라인만) ─▶ FM06e 요약 ─[입장 대기]─▶ FM07
        FM07: open ─ 대기 / in_progress ─ 자동 입장 ─▶ 진행 화면(MemberClassContainer)
        FM06*/FM07 중 in_progress 수신 ─▶ started 시트: [지금 입장하기]→게이트 우회 입장 / [준비 이어서 하기]→시트만 닫음
        정원 초과(is_waitlisted) ─▶ FM08(준비 마법사 건너뜀) ─ 승격 감지 시 FM06a/FM06e
   진행 화면 중 completed ─▶ FM09, cancelled ─▶ FM10 cancelled(현행의 "수고하셨어요" 카드 아님)
```
- **동의 → enter 순서**: FM06a 에서 `PUT consent`(성공해야 다음) → `POST enter`. 참여자 행은 초대 시점에 이미 있어 consent 가 먼저 가능. FM05 는 조회만 하므로 동의 없이 참여자 상태가 바뀌지 않는다. 대기실 presence 는 `enter` 성공 후에만 시작. 중복 호출은 멱등.
- 감지는 `GET /sessions/{id}` + WS `session_state_changed`(대기실 게이트 우회 방지 규칙 유지: 소켓은 status 만 갱신, 단계는 건드리지 않음 — 현행 `class-join-page.tsx:144-163`). 대기열 승격은 읽기 전용 폴링(현행 5초 `join` 재호출은 호스트에 알림을 쏘므로 폐기).
- 새로고침 복원: 세션 스토리지 `mb_flow_<sessionId>`(단계 인덱스·설문 초안·동의 여부·`prepSkipped`)에 보관, 참여자 id 는 서버(`GET /sessions/{id}` 본인 행 `user_id`)가 정본. `mb_join_participant`·`mb_waiting_room_nickname`·게스트 토큰 키 폐기.
- 시작 후 건너뛴 준비는 `prepSkipped:{survey,band,device}` 를 진행 화면에 전달 → 첫 진입에 안내 한 줄 + 기기 시트 진입점, **설문 시트 신설**(진행 화면에는 사전 설문 진입점이 없음 — `PreCheckinPanel` 재사용·`phase:'before'`).
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
- 종료: `finishSession` 이 `transitionSession('end')` 응답을 `setSession` 에 반영해 `isEnded` 씬 렌더 + `useReportProgress` 구독 시작, `/record` navigate 제거(D6). 단계 판정은 `steps[ready].state`.

---

## 6. 하니스·측정 (시안 `?case=` → 코드)

- **하니스** `pages/design/ClassFlowCasesPage.tsx`: URL 규약을 시안과 같게 `?screen=FM06c&case=on-group-opt-member-leadoffl`(+선택 `&sheet=`·`&n=`·`&level=`·`&ch1=&ch2=`). 레지스트리 `lib/class/flow/registry.ts` 가 화면 ID → `{ cases: {key: description}, render(spec) }` 를 `import.meta.glob('./fixtures/*.ts')` 로 수집(트랙이 하니스 파일을 같이 수정하지 않음). `?index=1` 은 시안과 같은 인덱스 표를 출력(`_mock-index.md` 와 대조해 205개 일치 자동 검증, verify G1).
- **케이스 키 파서**: 회원 `{on|off}-{group|solo}-{opt|req|none}-member[-상태][-started|-sheet]`, 상담사 FH06 `{g|o}-{on|off}-{N}[-r][-req|-none|-wait|-contact|-inv0|-many]`, FH02/FH04 등은 화면별 키(레지스트리의 화면별 파서).
- **측정**(조사 10 §3-3·3-4): `e2e/class-flow/lib.mjs` 를 새로 만들고 `e2e/class-player/lib.mjs` 에서 **`launchBrowser`·`parseArgs`·`DEFAULT_BASE`·`VIEWPORTS`·`SHORT_VIEWPORTS`·`formatReport`·`summarize`·`writeReport`·`RULE_NAMES`·`measureFit`(셀렉터 주입형)만 import**한다. `caseUrl`·`openCase`·`readRegistry`·`measureFlowSymmetry`·`runCli` 는 신규(기존 `measureOne/runMeasure/runCli/buildJobs`·`measureMemberSymmetry/HostSymmetry` 는 회원 진행 화면에 고정돼 재사용 불가, 도크 도달 `measureDockReach` 는 해당 없음 — 단 `390×600`·`1280×420` 에서 하단 CTA 가 눌리는지로 재정의). `data-pz` 훅 계약을 확장(`flow-top`·`flow-col`·`flow-card`·`flow-foot`·`flow-cta`·`flow-steps`·`flow-sheet`·`flow-list`). 균형.md 적용성: S1·S2·S3·S5·S6·S8·S9·S10·MS3 **그대로**, S7 **변형**("본문 컬럼이 상단 바와 푸터 사이 세로 중앙, 시안 측정 `본문 위 126.2/아래 126.2 (허용 ±52.5)` 형식"), S4·MS1·MS2·CS* **해당 없음**(결과표에 명기). **새 규칙 6개**(시안 `tools/member-b-measure.mjs` 에 구현된 검사 포팅, verify §2 `FR1~FR6`): 하단 CTA 위치 고정(단계 전환 Δ ≤ 2px) · 진행 점(개수=단계 수 온라인 5·오프라인 4·밴드 없음 −1, 가운데 정렬) · 시트 내 중첩 스크롤 0 · 카피·글리프·영문 대문자 아이브로우 소스 정적 검사 · 상태 의존 요소(접촉 불량일 때만 전극 트래커 288×64·내 영상·소리 합친 컴포넌트) · 오버레이가 CTA 를 가리지 않음. `NO_CORAL_IDS` 는 사전 흐름용으로 새로 정의(접촉 불량·권한 거부는 코랄이 정상). 자가검증 `selftest` 는 위반 주입 더미 픽스처(사전 흐름판)를 둔다. 시안(회원) 사이드 시트 기준 1100px 와 코드 `sheet-mode.ts` 1000px 불일치는 시안 정정 또는 코드 분기 확인(`미확인`, verify §16).
- **기존 결과 재사용**: 시안 단계 측정 결과 `designs/class-flow-redesign/fit/*.txt` 는 코드 측정의 비교 기준(수치 차이 허용 ±2px)으로 쓴다. 시안 `tools/*-measure.mjs` 는 하니스 URL 로만 경로를 바꿔 포팅.
- **폰트**: Pretendard 로딩 고정, 측정 전 `document.fonts.ready` 대기.
- **dev 배포본에서 재현 불가**(F15 SDD-208 동일): 밴드 상태·권한 거부·네트워크 끊김 → 하니스로만 검증. dev 실화면은 가짜 미디어 플래그로 대표 케이스(FM05·FM06a·FM06b·FM06d·FM07·FH02·FH05·FH06·FH07)만.

---

## 7. Task 분해 — 트랙 5개 병렬

**트랙**: S(공용 기반) · B(백엔드) · M(회원 몰입형) · H(상담사 몰입형) · SH(셸형, 회원·상담사). 선행: T0 → T1 → (T2a ∥ T2b ∥ T3). B 는 T0 직후부터 S 와 독립 병렬(API 계약은 §3 로 고정). M·H·SH 는 T2·T3 병합 후 병렬. 각 Task 30~60분(L 은 90분), 모두 **테스트 먼저**(RED→GREEN), 커밋 `feat(sdd-209): …`, 푸시 금지(I4 에서만).

| Task | 이름 | 트랙 | 선행 | 규모 |
|---|---|---|---|---|
| T0 | worktree(저장소 밖)·기준선(tsc `-p tsconfig.app.json`·eslint·vitest·pytest 실패 목록 저장, 205 케이스 문구 정규식 기준선, 타인 미커밋 변경 확인) | S | — | S |
| T1 | 케이스 키 파서·레지스트리·공용 타입(`lib/class/flow/`, 205 키 전부 파싱 테스트) | S | T0 | M |
| T2a | 몰입형 프리미티브(`FlowRoot`·`TopBar`·`Card`·`Button`·`Chip`·`Steps`·`StateScreen`)+ CSS(`flow-tokens`·`flow-shared`, `.fl-h1/.fl-h2` 색 명시)+ `PlayerShell`/`PlayerSheet`/`PlayerTopBar` 추가 props(CTA 푸터·스크림·높이 상한·닫기 불가) | S | T1 | M |
| T2b | `class-media.ts`·`useMediaCheck`·`MyAvCheck`·`PermissionHelpSheet`·`ElectrodeLeds`(+`SensorTracker` 3상태) | S | T1 | L |
| T3 | 하니스·`e2e/class-flow/{lib,fit}.mjs`(import 는 `launchBrowser`·`parseArgs`·`measureFit` 등 지정 함수만, 신규 규칙 FR1~FR6)·위반 주입 자가검증 픽스처(의도적 비대칭이 FAIL 로 잡히는지) | S | T1 | M |
| B1 | BE-1 `enter` + 공용 함수 추출(기존 by-code 테스트 무변경 통과) + BE-6 `PUT consent` + BT1~BT3·BT10 | B | T0 | L |
| B2 | BE-2 `member-livekit-token` + BE-7 `member-state` + BT4 | B | B1 | M |
| B3 | BE-3 리마인더 본문 + BE-4 `user_name`·`host_name`·PII 정리 + BT5·BT6·BT14 | B | T0 | M |
| B4 | 권장: BE-9 presence 확장·BE-10 재알림·BE-11 마이그레이션(D2 B 시)·BE-13 집계 방송·BE-14 승격·BE-16 삭제 가드·BE-17 보정 스크립트 + BT8·BT9·BT13 | B | B1 | L |
| B5 | BE-5 게스트 차단·`access_code` 비호스트 제거·테스트 헬퍼 24개 전환(**2단계, 별도 배포, D1 유예 후**) + BT12 | B | I4 + 유예 | L |
| M1 | `lib/api/class-flow.ts`(by-id 어댑터+폴백 플래그)·`MemberEntryPage` 상태 머신·`deriveEnterState`·로그인 복귀(F5, `RoleGuard`/`LoginPage`/`ClientLoginPage` 는 통합 소유 → M1 은 훅·유틸만)·세션 스토리지 복원 | M | T1·B1 계약 | L |
| M2 | FM05 입장 확인·FM10 상태 문구·FM08 대기열(승격 폴링) | M | T2a·M1 | M |
| M3 | FM06a 동의(`PUT consent`→`enter`)·FM06e 요약(행 탭 재편집) | M | M1·T2a | M |
| M4 | FM06b 설문(`PreCheckinPanel` API 재사용, 4단계) | M | M1·T2a | M |
| M5 | FM06c 밴드(`deriveBandStep`·모드 분기·전극 카드·`useBand` 단일 인스턴스) | M | T2b·M1 | L |
| M6 | FM06d 기기(`MyAvCheck`·허용 방법 시트·오프라인 생략·카메라/마이크 승계) | M | T2b·M1 | M |
| M7 | FM07 시작 대기(+BE-13 수신)·`StartedSheet`(`지금 입장하기`/`준비 이어서 하기`)·`prepSkipped` 이어받기·진행 화면 설문 시트 신설 | M | M3~M6 | L |
| M8 | FM09 종료(서버 `ended_at`·이메일 마스킹·1탭 리포트·체크인 시트·완료 시 버튼 비활성) | M | T2a·M1 | M |
| M9 | 컨테이너 연결·진행 화면 코드 의존 제거(`useMemberLiveKit`·`MemberClassContainer` by-id, 폴백 플래그) + D9 회원측 | M | M2~M8·B2 | L |
| H1 | 만들기 마법사 골격(`useClassWizard` reducer·`class-wizard.ts` 검증·payload·5분 보정·이탈 시트)·FH02a·b | H | T2a | M |
| H2 | FH02c 일정(스텝퍼·프론트 충돌 계산)·FH02d 초대(`ParticipantPicker` 로직 재사용)·FH02e 확인 | H | H1 | L |
| H3 | FH03 생성 완료(초대 결과 구조화·재시도·템플릿 저장·`클래스 열러 가기` 직행) | H | H2 | M |
| H4 | FH05 세팅(`MyAvCheck`·`requestOpen`·마이크 끔 경고·오프라인) | H | T2b | M |
| H5 | FH06 로비 본문(`host-lobby-model`·초대 명단 ⊕ presence·시작 항상 활성·전극 LED) | H | T2b | L |
| H6 | FH06a 시트(초대·BGM·내 밴드·발언권·채팅) | H | H5 | L |
| H7 | FH07 시작 확인(동의·준비 중 목록·0명 변형·`audio/start` 순서)·FH08 닫기·나가기 | H | H5 | L |
| H8 | FH09 종료(4단계·`steps[ready]` 판정)·FH10 닫힘·오류(`deriveFlowStateKind`) | H | T2a | M |
| H9 | `HostPrepContainer` 연결(`ClassPlayerPage` 호출부 제외) + D9 상담사측(`ToolsSheet`·`HostLiveView` 코드 박스 제거) | H | H4~H8 | L |
| SH1 | 셸형 라이트 키트(`ClassCard`·`StatusChip`·`MethodChips`·`ActionButton`·`ShellSheet`(포털 `z-[60]`)·`class-labels.ts`·`enter-action.ts`·`useEnterClass`·`useClassList`) | SH | T1 | L |
| SH2 | FM01 홈 히어로(4상태+빈, `isLive` 수정, 코드 제거, 보조 섹션 재스타일) | SH | SH1 | M |
| SH3 | FM02 목록(단일 트리·4섹션·달력 제거)+신청 시트 | SH | SH1 | L |
| SH4 | FM03 상세 4상태+입장 CTA 단일 진입(`useEnterClass`) | SH | SH1 | M |
| SH5 | FH01 상담사 목록(열린 클래스 고정·표→카드·모달 삭제·`net`·`시작하기`→로비) | SH | SH1 | L |
| SH6 | FH04 상담사 상세(취소/닫기/삭제 시트·`window.confirm` 제거·더보기·이름(BE-4)·진행 중 취소 숨김) | SH | SH1·B3 | L |
| SH7 | 용어 치환 스윕 + 내비 배지 키 상수화(`세션`→`클래스`, 금지 용어·이모지 grep 0, 기준선 조사 08 부록 C) | SH | SH2~SH6 | M |
| I1 | 회원 호출부 교체: 라우트 추가·`JoinLegacyRedirect`·로그인 복귀·연결 게이트 예외·CTA 4곳·알림 직행·랜딩 `/join` 링크 정리·기존 테스트·`full-journey.mjs`(별도 커밋) | 통합 | M9·SH4 | L |
| I2 | 상담사 호출부 교체: `/sessions/new`·`ClassPlayerPage` 구간·`journeys.mjs`·`class-player/live.mjs`·테스트 갱신(별도 커밋) | 통합 | H9·SH5·SH6 | L |
| I3 | 전 케이스 측정·보정(205×4 + 시트 변형 + SDD-208 회귀 M01~M21·C01~C18) | 통합 | I1·I2 | L |
| I4 | 구 컴포넌트 삭제·dev 배포(백엔드 먼저)·스모크·실기기·summary | 통합 | I3 | L |

**총 39 Task**(공용 5 · 백엔드 5 · 회원 9 · 상담사 9 · 셸형 7 · 통합 4). 규모: S 1 / M 17 / L 21(합계 약 40~50시간, 5트랙 병렬 시 가장 긴 직렬 트랙 M·H 약 9 Task 에 지배). **트랙 5개**(공용·백엔드·회원·상담사·셸형).

### 핵심 Task 상세
- **T1**: `case-key.ts`(`_mock-index.md` 를 픽스처로 205 키 전부 파싱), `registry.ts`, 공용 타입. `deriveBandUi` 재사용 단언.
- **T2b**: `useMediaCheck` 레벨 수식 회귀(사인파 입력 → 현행 `ClassWaitingRoom` 과 같은 level), 5단계 링 매핑 표, `classifyMediaError` 표(NotAllowed/Security→denied, NotFound/Overconstrained→nodevice, NotReadable→inuse), `deriveElectrodes` 4조합×기준 표, `SensorTracker` 기존 사용처 없음 확인(죽은 코드 — 회귀 위험 없음).
- **B1**: 추출 리팩터 후 **by-code 기존 테스트가 한 줄도 바뀌지 않고 통과**(`test_sdd015`·`test_sdd021`·`test_sdd088`·`test_sdd026`·`test_sdd023`·`test_member_livekit_token`·`test_sdd062`). `consent` 와 `enter` 순서·멱등.
- **M1**: 어댑터 `classFlowApi`: `consent(id)`·`enter(id)`·`getMemberToken(id)`·`getState(id)`. BE 미배포 시 폴백(코드 내부 사용)은 환경 플래그로만.
- **M7**: `StartedSheet` 는 `sessionLive` false→true 순간 `readiness` 미완이면 1회 표시, 닫기 버튼 없음, 미완 항목은 오프라인이면 기기 제외·밴드 사용 안 함이면 밴드 제외(시안 `steps()`), `지금 입장하기` 는 `handleEnter({force})` 게이트 우회. **`recheckingPrep` 중 시작돼도 자동 입장하는 현행 동작 수정**(시트로).
- **H5/H7**: `canStart` 그룹 조건 제거는 H9 컨테이너 안에서만 — `ClassPlayerPage.tsx` 수정은 I2.
- **I1·I2**: 회원/상담사 호출부 교체를 **별도 커밋 2개**로(롤백 단위).

---

## 8. 파일 소유권 · 병렬 계획

### 8.1 소유권 표 (한 파일은 한 소유자만 수정)
| 소유자 | 파일 | 규칙 |
|---|---|---|
| **S** | `components/class/player/shared/{PlayerShell,PlayerSheet,PlayerTopBar}.tsx`·`player-shared.css`(**기본값 = 현행 동작인 추가 props 만**), `lib/class/flow/{case-key,registry,types}.ts`, `lib/class/{class-media,band-step}.ts`, `hooks/useMediaCheck.ts`, `components/class/flow/shared/**`, `components/class/SensorTracker.tsx`(3상태·색 prop), `lib/class/class-waiting-room.ts`(장치 상태 타입 확장 — M 은 읽기만), `pages/design/ClassFlowCasesPage.tsx`, `e2e/class-flow/{lib,fit}.mjs`, `App.tsx` 의 `/design/class-flow` 1줄 | T1~T3 병합 후 동결 |
| **B** | `backend/app/**`, `backend/tests/test_sdd209_*.py`, 기존 백엔드 테스트 수정 | 프론트 파일 수정 금지 |
| **M** | `lib/class/flow/member-*.ts`, `lib/class/flow/fixtures/member-*.ts`, `lib/api/class-flow.ts`, `components/class/flow/member/**`, `pages/class/MemberEntryPage.tsx`(신규), `hooks/useMemberLiveKit.ts`·`components/class/player/member/MemberClassContainer.tsx`·`MemberSheets.tsx`(M7·M9 에서만), `components/class/PreCheckinPanel.tsx`·`ReportEmailRequestPanel.tsx`·`SelfCheckinPanel.tsx`(재작성 시), `tests/class-flow-member-*.test.tsx` | 상담사·셸형 파일 수정 금지 |
| **H** | `lib/class/flow/host-*.ts`, `lib/class/flow/fixtures/host-*.ts`, `lib/class/class-wizard.ts`, `hooks/useClassWizard.ts`·`useWizardLeaveGuard.ts`, `components/class/flow/host/**`, `components/session/{SessionPreJoinPreview,ConsentModal}.tsx`(대체·삭제는 I4), `components/class/player/host/sheets/ToolsSheet.tsx`·`HostLiveView.tsx`·`lib/class/host-player-case.ts`·`fixtures/host-cases.ts`(D9 — H9 에서만), `tests/class-flow-host-*.test.tsx` | 회원·셸형 파일 수정 금지 |
| **SH** | `components/class/flow/shell/**`, `lib/class/{class-labels,enter-action,pick-hero-class,class-when,reminder}.ts`, `hooks/{useEnterClass,useClassList}.ts`, `pages/client/{ClientHomePage,ClientSessionListPage,ClientSessionDetailPage,ClientAppPage}.tsx`·`ai-agent-page.tsx`(CTA), `components/client/{ClientShell,BottomTabBar,InvitedSessionCard}.tsx`, `components/session/{SessionCard,StatusBadge,SessionListTable,MonthCalendar,CalendarView,MobileTimetable,DaySchedule}.tsx`, `pages/sessions/{SessionListPage,SessionDetailPage}.tsx`(모달 제거 포함), `components/layout/{SidebarNav,BottomTabBar,AppShell,MobileDrawer}.tsx`, `tests/class-flow-shell-*.test.tsx`, `tests/session-reminder.test.ts` | 셸형 페이지는 이 트랙만 수정 |
| **통합(I1~I4)** | `App.tsx`(라우트), `pages/class-join-page.tsx`(→ 리다이렉트로 축소), `pages/sessions/ClassPlayerPage.tsx`, `pages/sessions/SessionCreatePage.tsx`(마법사 교체), `components/landing/{Hero,Nav,CTASection}.tsx`·`pages/{LandingPage,OrgPublicPage}.tsx`·`scripts/verify-landing.cjs`(`/join` 링크), `components/auth/RoleGuard.tsx`·`lib/auth-routing.ts`·`pages/LoginPage.tsx`·`ClientLoginPage.tsx`(F5), `lib/api/notifications.ts`(알림 직행, SH7 요청 시), 기존 테스트·`e2e/*.mjs`, 구 컴포넌트 삭제, 문서 | 두 트랙 병합 후 단일 담당자 |

### 8.2 충돌 지점(명시)
- **`SessionListPage.tsx`**: SH5(목록 본문)와 H2(예약 모달 삭제)가 같은 파일 → **SH 단독 수정**(모달 삭제 포함), H 는 모달이 사라진다는 전제로 `/sessions/new?mode=later` 만 제공.
- **`SessionCreatePage.tsx`**: H 가 마법사를 새 경로에 만들고 이 파일은 I2 에서 얇은 래퍼로 교체.
- **`ClassPlayerPage.tsx`**: H9 까지 수정 0, I2 에서 시작 전 구간 JSX·`canStart`·`ConsentModal` 만 교체. **작업 트리의 타인 미커밋 변경은 현재 `SidebarNav.tsx`·`keyboard.ts`·`package.json`·`android/*` 뿐**(`ClassPlayerPage.tsx` 에는 없음 — SDD-208 §8.3 충돌 해소). `SidebarNav.tsx` 는 SH7 이 수정하므로 **T0 에서 해당 미커밋 변경의 커밋·정리 여부를 확인**하고, 아니면 SH7 을 병합 후 진행(타인 변경을 되돌리지 않음).
- **`lib/api/session.ts`**: 신규 함수는 `class-flow.ts` 에 두어 무수정(`SessionParticipant.user_name?`·`participant_id` 타입은 이미 있음 — BE-4 로 값만 채워짐).
- **`App.tsx`**: S(T3, 하니스 1줄)와 통합(라우트 2~3줄) — 줄이 달라 충돌 없음, 병합 순서로 처리.
- **`class-waiting-room.ts`**: S 가 상태 타입을 확장, M 은 게이트 함수(`resolveWaitingRoomGate`)의 `linkbandMode`·`place` 입력만 요청(S 경유).
- **`player-tokens.css`**: 무수정(재사용만). **`player-shared.css`·`PlayerShell`·`PlayerSheet`·`PlayerTopBar`**: S 가 추가 props·추가 규칙만 수정(SDD-208 테스트·하니스 selftest 통과 필수, R21).
- 두 트랙이 공유하는 코드는 `shared/`·`lib/class/flow/{case-key,registry,types}`·`MyAvCheck`·`ElectrodeLeds` 뿐. 트랙 간은 서로의 파일을 읽기만.

### 8.3 병합 순서
1. T0→T1→(T2a∥T2b∥T3) → `sdd/209-flow` 병합. B 는 `sdd/209-backend` 로 T0 직후 분기.
2. M·H·SH 는 `sdd/209-flow` 에서 각각 분기(`sdd/209-member`·`sdd/209-host`·`sdd/209-shell`). B1~B4 병합·dev 배포 후 M9 의 by-id 실호출 검증.
3. 세 트랙 병합(`merge --no-ff`) 직후 tsc·eslint·전체 vitest 로 충돌·합산 회귀 확인, 기존 파일 수정이 소유권 허용 목록뿐인지 `git diff --name-status <base>..HEAD | grep -v '^A'` 로 확인 → I1~I3 통합 담당자.
4. `develop` 병합은 I3 통과 후 **두 번 푸시**: ① 백엔드 추가형(B1~B4) 먼저 → 배포·`curl`/pytest 확인 → ② 프론트. B5 는 유예 후 별도.
- worktree 는 저장소 밖(`git worktree add ../mindbreeze-sdd209 -b sdd/209-flow origin/develop`)에서, upstream 해제. 새 worktree 의 `node_modules` 는 원본 심볼릭 링크로 공유 가능. **`designs/class-flow-redesign/`·`designs/class-player-redesign/`·`specs/sdd-208*/{plan,spec,verify}.md`·`specs/sdd-209*/` 가 미추적**이라 worktree 에 없으므로 워커 지시에 원본 절대경로를 적는다.

---

## 9. 위험·롤백·CI·배포

### 9.1 위험
| # | 위험 | 영향 | 완화 |
|---|---|---|---|
| R1 | **동의 컬럼을 안 채워 뇌파 업로드가 막힘**(F1) | 밴드를 써도 저장 0 — 무음 실패 | BE-6 필수 + BT2·E2 "동의 후 업로드 200, 전 403", UI 는 미동의 시 밴드 단계 안내(403 을 오류로 노출 금지) |
| R2 | 구 앱 번들·이미 발송된 메일이 by-code/`/join` 호출(F6) | 유예 중 일부 사용자 불편 | by-code 로그인 경로·`access_code` 응답 유지, `/join` 리다이렉트, BE-5 는 유예 후(D1) |
| R3 | 진행 화면(SDD-208)의 코드 의존(F3) → by-id 전환 중 회귀 | 진행 화면 깨짐 | M9 에서 M01~M21·C01~C18 재측정, 어댑터로 변경 최소화, 폴백 플래그 |
| R4 | 롤백 시 DB 미복원(F17) | 스키마 변경 시 위험 | 스키마 변경은 nullable 3컬럼 1건(BE-11, 선택) — 구 코드가 무시하므로 롤백 안전 |
| R5 | 배포 스크립트가 프론트 `dist` 를 백엔드보다 먼저 교체(F17) → 신 프론트가 없는 엔드포인트 호출(수 초~수십 초) | 일시 404 | 백엔드 추가형을 **먼저 별도 푸시**(§8.3-4), 프론트 폴백 플래그 |
| R6 | 백엔드 테스트 24개가 by-code 헬퍼 사용(F19) | BE-5 시 대량 수정 | BE-1~4 는 by-code 무변경, 헬퍼 전환은 B5 에만 |
| R7 | `조용해요` 임계·5단계 링 경계가 기기마다 다름 | 오판정 | 상수 분리 + 실기기, 칩은 보조(링이 정본) |
| R8 | 205 케이스 × 4뷰포트 측정 시간·폰트 흔들림 | 오탐 | 병렬 실행, 폰트 고정, 최종은 실기기 병행 |
| R9 | 전극별 접촉(BE-9)이 대기실(로비)만 — 진행 중 호스트 전극은 비범위. ch↔좌우 매핑 미검증(`왼쪽 실패` 근거 없음) | 오안내 | 로비·내 밴드 시트로 한정, 문구 `왼쪽/오른쪽` 은 SDK 확인 전까지 시안 가정 — summary 에 한계 기록 |
| R10 | 초대 필수(D7)로 링크만 공유하던 운영이 막힘 | 현장 혼란 | 생성 완료·상세 문구 안내, 비초대 FM10 문구에 상담사 문의 안내 |
| R11 | `/app/sessions/:id/enter` 가 `/app/*` 셸에 감싸임 | 몰입형에 셸 | `tests/class-flow-routes.test.tsx`(입장 라우트에 셸 DOM 0) |
| R12 | 하니스 라우트가 prod 번들 포함(SDD-208 R12) | 픽스처 노출(민감 정보 없음) | `/design/*` 선례, 필요 시 `import.meta.env.MODE` `미확인` |
| R13 | **로비 중 밴드 EEG 저장**(마법사 컨테이너가 `useBand` 를 유지하면 시작 전 윈도우 저장, `_store_feature` 에 세션 상태 검사 없음) → 리포트 평균 오염 가능 | 데이터 품질·프라이버시 | D11 ②: 시작 전 `enabled:false`(접촉·연결만 중계) |
| R14 | 시작 직후 호스트 대기실 구독이 꺼져 준비 중 회원이 안 보임(F15) | 시작 시트·FH06 정보 소실 | 구독 조건을 `isLobby||isRunning` 으로(H9) |
| R15 | `presence` 첫 알림 레이스(조사 04 §2-3b)·휘발성(45초 TTL) | `대기실 0명` 오안내 | 초대 명단 기준 행 ⊕ presence, 문구는 `아직 입장한 회원이 없어요`(단정 금지), 회원 훅에 첫 `waiting_room` 전송을 `join` 응답 이후로 |
| R16 | 내비 라벨 치환 시 초대 배지 소실(`label==='세션'` 키 비교 3곳) | 알림 배지 사라짐 | 배지 키 상수화(SH7), 단위 테스트 |
| R17 | 예약 모달이 만든 과거 클래스가 `one_on_one`+정원 10+`offline` 로 저장됨 → 새 칩 3개가 **틀린 정보** 표시 | 회원이 오프라인으로 오인 | 프론트 `notes` 접두 파생 + 복제 시 이상 설정 복사 주의(BE-17 선택) |
| R18 | 삭제 서버 가드 없음(F27) | 진행 중·완료 클래스 데이터 손실 | BE-16, FE 숨김만으로는 부족 |
| R19 | `GET /sessions` 목록 응답에 타인 성별·생년월일(F28) | 기존 PII 노출 | BE-4 에서 정리(악화 금지) |
| R20 | 타인 미커밋 변경(`SidebarNav.tsx` 등) | 병합 충돌·덮어쓰기 | T0 확인, 승인 없이 되돌리지 않음 |
| R21 | `PlayerShell`·`PlayerSheet` 확장이 SDD-208 진행 화면을 깨뜨림 | 진행 화면 회귀 | 기본값 = 현행 동작인 추가 props 만, `class-player-shared.test.tsx`·`selftest.mjs`·M01~M21·C01~C18 재측정 |
| R22 | 시안 `flow-base.css` 이식 시 전역 h1/h2/p 색 규칙이 `.fl-h1`·`.fl-h2` 를 어둡게(SDD-208 과 같은 결함), `.sh-scope` 라이트 토큰 누락 | 글자 안 보임·버튼 투명 | `.fl-h1,.fl-h2` 색 명시, 사전 흐름 fit 에 글자 대비 3:1 검사 추가 |
| R23 | 사전 흐름 하니스가 dev 번들에 2번째 `/design/*` 하니스로 노출(D16) | 정적 픽스처 노출(개인정보 없음) | D16 ① 기본, 필요 시 `import.meta.env` 가드 |
| R24 | FM06 시트가 짧은 뷰포트(390×600)에서 높이를 넘김(시안 측정에 없음), `.fl-root` `100vw` 가로 넘침 | 하단 CTA 가려짐 | 보조 뷰포트 측정(verify §0), `100%` 사용 |

### 9.2 CI 영향
- `ci-feature.yml`: 프론트 `tsc --noEmit`·`eslint src/`(`react-refresh/only-export-components` 포함)·`npm run build` **차단**, 백엔드 `pytest -q`(`test_sprint4_integration.py` 제외, PDF 1건 deselect) **차단**, `npm test` 비차단(그래도 신규 테스트 전부 통과를 완료 조건). **루트 `tsconfig.json` 이 `files: []` 이면 CI 의 `npx tsc --noEmit` 은 아무것도 검사하지 않는다** — 로컬은 `npx tsc -p tsconfig.app.json --noEmit` 필수, 루트 tsconfig 실제 내용은 T0 에서 확인(`미확인`).
- `e2e-smoke.yml`(배포 직후 자동, 실패 시 텔레그램): 갱신 필요 — `full-journey.mjs:186-203`(신 경로+동의·단계 통과+시작 후 입장+EEG 업로드), `journeys.mjs:9,13-24,59-64`, `class-player/live.mjs`, `scripts/verify-landing.cjs`. 실제 CI 파일 확인 결과 `/join` 을 쓰는 곳은 `full-journey.mjs` 뿐(`explore.mjs` 는 `/join` 을 SKIP 정규식에 포함).
- 기존 프론트 테스트 갱신·삭제 대상(I1·I2 에서 처리 확정, 로직 이전 확인 후에만 삭제): `class-join-waiting`·`class-join-waitlist`·`member-session-scene`·`class-waiting-room`·`-flow`·`-presence`·`-band-check`(5)·`report-email-request-panel`·`member-end-scene`·`session-prejoin-theme`·`host-class-workspace`·`waiting-room-readiness-panel`·`pre-checkin-panel`·`self-checkin`·`class-player-member-container`·`class-player-page-live`·`class-player-host-container`·`session-reminder`·`waiting-room-checkin.browser.cjs`(CI 제외).

### 9.3 배포 순서·롤백
- **순서**: ① 백엔드 추가형(B1~B4) 푸시 → `Deploy Dev`(`concurrency` 직렬화, 10분 이상) 완료·`health/ready`·by-id `curl` 확인 ② 프론트 병합본 푸시 → 배포 → `e2e-smoke` → 실패 시 단언 갱신 루프(`mindbreeze-development` `e2e-smoke-loop.md` 절차) ③ 유예(D1, 기본 8주) 후 B5 를 별도 승인·배포.
- **롤백**: 프론트 = I1·I2 교체 커밋(각 1개) `git revert` → 푸시 → 자동 재배포(구 컴포넌트는 I4 전까지 존재). 백엔드 추가형 = `git revert`(DB 변경은 nullable 컬럼이면 구 코드가 무시). 배포 스크립트 실패 시 트랩이 `app/alembic/dist` 복원(DB 는 안 됨). B5 는 되돌리기 어렵다(응답 필드 제거) → 유예·확인 후.
- **마이그레이션 위험**: BE-11(선택)이 유일 — `alembic upgrade head` 가 배포 스크립트에서 서비스 재시작 **전에** 실행되고(`deploy-dev.yml:197-201`) nullable add 는 락이 짧으며 `alembic heads` 단일 head(`e036a0000041`)에서 분기. 자동 생성 금지·수동 리뷰(`.claude/rules/architecture.md`).

---

## 10. 구현 전 미확정 (확인하지 못한 것)
- 구 앱(Capacitor) 번들 실제 사용 비율·버전 분포, 운영(main) 배포 파이프라인 — D1 유예 기간 근거(저장소에 dev 배포만 있음).
- 마이크 `조용해요` 임계(`MIC_QUIET_LEVEL`)와 5단계 링 경계 — 실기기 실측 전.
- ch1/ch2 가 실제 왼쪽/오른쪽 이마 전극에 대응하는지(SDK 문서 없음), 서버로 가는 `signal_quality` 와 하드웨어 lead-off 연동.
- 온보딩 미완료 회원의 로그인 복귀(`next`) 전달 경로.
- `MemberEndScene` 의 `relaxationIndex` 사용 여부(점수 비노출 정책과의 정합), SDD-208 진행 화면의 본인 지표 수신이 `by-code state` 에 의존하는지(BE-7 필요성).
- 호스트 본인 `내 밴드` 연결 가능 여부(`hostParticipantId` null 추정, 코드 추정) — FH06a `band` 구현 전 확인.
- 설문 응답 전 호스트 목록 미표시의 근본 원인(코드 후보만), python-socketio `async_handlers` 기본 동작(라이브러리 로컬 미설치).
- iOS Capacitor 앱의 `useBand.isSupported`, iOS `Info.plist` 마이크·카메라 사용 설명 키 부재와 Android 권한 선언(미커밋 작업 트리 변경) — 앱 실제 동작 미확인.
- 세션 시작 전 저장된 EEG 윈도우가 리포트·평균에 섞이는지(리포트 서비스 미조사).
- `session_invited`·`session_opened` 알림의 이메일 기본값(`DEFAULT_NOTIFICATION_PREFERENCES` 미열람), `session_waitlist_promoted` 의 앱 푸시 여부.
- 루트 `tsconfig.json` 내용, `org_admin` 이 호스트가 아닌 클래스를 열 때의 화면(SDD-208 D11 승계), 회원 음성이 녹음에 포함되는 정도(환경 의존).
- 시안 205 케이스 DOM 이 금지 용어·코드 정규식에 0건인지(T0 기준선, 시안 `flow-base.css` 에 `.fl-codebox` 6칸 코드 입력 스타일이 남아 있음).
- 조사 10 미확인: 현재 dev 배포물에 하니스 청크가 있는지(코드·워크플로로만 추정), `PlayerBackdrop` 3단 스크림이 글자 대비 3:1 을 통과하는지, 시트·카드 실측값(하니스 미실행), `HostTopBar`·`MemberTopBar` 의 `PlayerTopBar` 래퍼 세부, 시안 `tokens-b.css`(B안) 채택 여부.

---

## 11. 조사 문서 색인
`investigation/` — `_common.md`(조사 지침)·`_mock-index.md`(시안 205 케이스)와 아래 10건. 각 문서에 현재 코드 판정표·상세 근거·변경 목록·결정·미확인이 있다.

| 번호 | 주제 | 파일 | plan 반영 위치 |
|---|---|---|---|
| I1 | 입장 모델 제거 | `01-join-model-removal.md` | F1~F6·F26, §2, §3 BE-1·2·3·5, §4 D1·D7, §5.2~5.3, §9 |
| I2 | 리포트 신청 OTP | `02-report-otp.md` | F12(OTP 생략), §1.2 FM09, §3(필수 아님 — 서버가 이미 회원 OTP 생략), BT7 |
| I3 | 생성·예약 | `03-create-schedule.md` | F9~F11, BE-4, §4 D8, §7 H1~H3 |
| I4 | 열림·시작·준비 | `04-open-start-ready.md` | F7·F8·F15, §5.5, BE-9·10, §4 D4·D10, §7 H5~H9·M7 |
| I5 | 밴드·전극 | `05-band-electrode.md` | F13·F14, BE-9, §5.4, §4 D5·D11 |
| I6 | 기기·미디어 | `06-device-media.md` | F16, §5.4, §4 D10 |
| I7 | 동의 | `07-consent.md` | F1·F12, BE-6·11, §4 D2·D3·D4 |
| I8 | 셸형 화면 | `08-shell-screens.md` | F20·F26·F27, §1.2, §4 D13, SH 트랙, verify G9 기준선(부록 C·D) |
| I9 | 대기열·종료 | `09-waitlist-end.md` | F23~F25, BE-13·14, §4 D6·D14, M2·M8·H8 |
| I10 | SDD-208 자산 | `10-reusable-assets.md` | F22, §1.1(접두어·공용 파일 확장), §6(측정 재사용·신규 규칙 6), §4 D16, R21~R24, 기존 테스트 처리 표(§7 → 조사 10 §7 약 20개 파일) |
