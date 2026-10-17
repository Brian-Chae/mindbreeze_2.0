# I7 동의(A1) — 입장 전 동의 단계(FM06a) + 상담사 시작 전 확인 시트(FH07) — 코드 조사

> 기준: develop `32fa5533`, 조사일 2026-10-17. 경로는 프론트 `frontend/src/`, 백엔드 `backend/app/` 기준(테스트는 `frontend/tests/`, `backend/tests/`). 코드·시안 수정 없음, 법적 판단 없음(규칙 문서·코드 사실만 기록).
> 대조 규칙: `.claude/rules/data-privacy.md:11-13`(동의 플로우 3개). 시안: `designs/class-flow-redesign/member-b.html`(FM06a `:358-368`), `host-b.html`(FH07 `:580-608`), `기획.md` §9 A1·FM06a·FH07 행.

## 0. 한 줄 결론

- **회원 쪽에는 녹음·AI 기록·뇌파 동의 UI 도 동의 저장 쓰기 경로도 없다.** 서버에는 참가자 단위 `consent_audio`·`consent_eeg` 컬럼이 이미 있으나(`models/session.py:118-119`), `consent_audio` 는 **어디에서도 쓰이지 않고**, `consent_eeg` 는 **코드 입장(`/sessions/by-code/{code}/join`)이 사용자 조작 없이 `True` 로 올린다**(`services/session_service.py:1586-1594`, `:1618`, `:1657`, `:1669`).
- **초대 입장(결정 1)으로 바뀌면 `consent_eeg` 를 올리는 경로가 사라져** 초대 회원의 뇌파 업로드가 403 으로 막힌다(`session_service.py:2507-2517`, 테스트 `tests/test_sdd026_live_session_p0.py:298-320` 가 그 상태를 못 박음). → **FM06a 동의를 서버에 쓰는 API 가 사실상 필수**(백엔드 필수 1건). UI 만(옵션 A)으로는 EEG 가 동작하지 않는다.
- 현행 상담사 녹음 동의는 **시작 후** 모달(`pages/sessions/ClassPlayerPage.tsx:1072`)이고, 동의 주체는 호스트이며, 서버는 동의를 컬럼으로 남기지 않고 `SessionRecord.status`(`recording`/`manual`)로만 남긴다(`services/audio_service.py:76-99`). FH07 로 시작 전 확인을 옮기는 것은 **프론트만으로 가능**하다(`audio/start` 는 시작 전 `open` 상태에서는 400 이므로 호출 시점은 `start` 전이 직후로 유지).
- 시안과 규칙의 충돌 지점: 보관 기간 문구 `30일`(`ConsentModal.tsx:31`, FH07)이 코드의 음성·영상 90일/뇌파 원본 무기한과 다름, FM06a 의 `녹음과 AI 기록`이 `필수`라 회원 거부 경로가 없음(규칙은 거부 시 수동 기록 모드), `required` LINK BAND 에서 EEG 동의 필수(규칙은 미동의 시에도 진행 가능), FM06a 에 보관 기간·삭제 권한 고지 없음, FM06a 에는 시작 후 상황(`started`) 케이스가 없음.

## 1. 현재 코드 상태

| 항목 | 판정 | 근거 |
|---|---|---|
| 상담사 녹음 동의 모달 | 있음(시작 후) | `components/session/ConsentModal.tsx:1-54`, 사용처 `pages/sessions/ClassPlayerPage.tsx:54`(import), `:1449-1457`(정의), `:1529`·`:2007`(렌더). `startClass` 에서 `setConsentOpen(true)` `:1072` (전이 `:1055` 이후) |
| 회원(참가자) 동의 UI | 없음 | `frontend/src/components/class`, `pages/class-join-page.tsx` 에 `동의` 문자열 0건. 조사서 `survey/회원-화면조사.md:21` 와 일치 |
| 참가자 동의 컬럼 | 있음(쓰기 불완전) | `models/session.py:118-119` `consent_audio`, `consent_eeg`(Boolean, 기본 False). 최초 마이그레이션부터 존재(`alembic/versions/77cff497fbe0_initial_8_core_tables.py:109-110`, NOT NULL) |
| `consent_audio` 쓰기 | 없음 | `backend/app` grep: 읽기만(`session_service.py:137`, 스키마 `schemas/session.py:135`) |
| `consent_eeg` 쓰기 | 코드 입장 한정 | `session_service.py:1586-1594`(신규 회원 `consent_eeg=True`), `:1614`·`:1618`(재입장), `:1657`(신규 게스트), `:1669`(게스트 재사용). 초대는 `consent_eeg=False`(`:1293-1300` `SessionParticipant(session_id, user_id)`) |
| `consent_eeg` 사용처(게이트) | 있음 | 업로드 `session_service.py:2507-2517` `_assert_upload_eligible`(403 `EEG 수집 동의 후 업로드할 수 있습니다`), 내보내기 `services/export_service.py:78`, `:137`, `:201`, `:219` |
| 동의 요청 API(`POST /sessions/{id}/consent` 등) | 없음 | `api/v1/*.py` 에서 `consent` 는 `audio.py:26`, `video.py:33`, `agent.py`(AI 비서 동의), `signup_applications.py`, `auth.py`(가입)뿐 |
| `audio/start` 동의 필드 | 있음(저장 안 함) | `api/v1/audio.py:19-26`, `schemas/record.py:8-11` `consent_audio: bool = True`, `services/audio_service.py:69-99`. 컬럼 저장 없음 — `False` 면 `SessionRecord.status='manual'`(`:78-88`), `True` 면 `recording`+`recording_started_at`(`:90-99`) |
| 감사 로그(동의/녹음 시작) | 없음 | `audio_service.py`·`api/v1/audio.py` 에 감사 호출 없음(grep). 흔적은 `SessionRecord.status`·`recording_started_at` 뿐 |
| 영상 동의 필드 | 있음(거부 불가) | `schemas/record.py:34-35` `consent_video`, `services/video_service.py:136-138` `False` → 400 `영상 녹화 동의가 필요합니다` |
| 세션 설정 컬럼 | 있음 | `models/session.py:55` `location_type`, `:61` `linkband_mode`(none/required/optional), `:66-67` `record_audio`·`record_video`(기본 True). **`ai_analysis` 컬럼은 없음**(`backend/app` grep 0건) — AI 분석 여부는 `record_audio`/`record_video` 로 갈음 |
| 회원이 보는 응답에 설정 노출 | 있음 | `session_service.py:105`(location_type), `:109`(linkband_mode), `:112-113`(record_audio/record_video) — `_serialize` 는 호스트/참가자 공용(`:694-695`). 코드 입장 전 응답(`SessionByCodeResponse`, `schemas/session.py:228-245`)에는 `record_*` 없음 |
| 참가자 목록에 동의 플래그 노출 | 있음(타인 것도) | `session_service.py:137-138` `consent_audio`·`consent_eeg` 가 `include_participant_pii` 와 무관하게 포함 — 성별·생년월일만 호스트 한정(`:131-132`). 비호스트 회원이 다른 참가자 동의 값을 본다 |
| 가입 시 약관 동의 | 있음(범위 일반) | 아래 §2-3 |
| 시작 전 회원 동의 게이트 | 없음 | 입장 경로 어디에도 동의 확인 없음(§2-3) |
| 호스트 오프라인 녹음 | 가능(코드상) | `hooks/useAudioRecorder.ts:48` `getUserMedia({audio:true})`, `audio_service`·`video_service` 에 `location_type` 조건 없음(grep 0건). 프론트 `location_type` 사용은 BGM 패널뿐(`ClassPlayerPage.tsx:976`, `:987`, `:1887`) |

## 2. 상세 조사

### 2-1. 상담사 쪽 현행 흐름 (시작 → 동의 → 녹음)
1. 로비 헤더 `시작하기`(`ClassPlayerPage.tsx:1566-1567`)가 곧바로 `startClass()`(`:1050`)를 호출한다. **시작 확인 시트는 없다**(`canStart` `:1328-1331` 만 있음).
2. `startClass`: `transitionSession(id,'start')`(`:1055`) → `liveKit.connect()`(`:1058`) → **마이크 OFF 면** `startAudio(id, false)` 로 수동 기록 선언(`:1060-1066`, 모달 없음) → `record_audio !== false && micOn` 이면 `setConsentOpen(true)`(`:1068-1072`), 아니고 영상만이면 `handleVideoOnlyStart()`(`:1073-1075`).
3. 모달 `확인`(`handleConsentConfirm` `:1114-1137`): `startAudio(id,true)`(`:1121`) → `recorder.start()` → 영상 `startVideo`(`:1130`) 순. **`취소`는 `setConsentOpen(false)` 만**(`:1453-1455`) — `startAudio(id,false)` 를 보내지 않아 `SessionRecord.status` 는 `idle` 로 남고(수동 기록 선언 없음), 영상 녹화도 시작되지 않는다. 모달 문구는 "동의하지 않으시면 수동 기록 모드로 진행됩니다"(`ConsentModal.tsx:28`)이나 서버에는 `manual` 이 기록되지 않는다(실측 조사서 `survey/상담사-화면조사.md:295` 가 `partial` 보고).
4. 중도 재시작: 미디어 컨트롤 `녹음 시작`이 `handleStartClick`(`:1104-1111`, 호출 `:1903`)로 같은 모달을 연다.
5. 모달 내용: 제목 `음성 녹음 동의가 필요합니다`(`ConsentModal.tsx:25`), 불릿 `30일간 보관`·`본인 세션과 담당 상담사만 접근`·`언제든지 녹음을 중지`(`:31-33`), 확인 `동의하고 녹음 시작`(`:48`). 확인 버튼이 `bg-indigo-600`(`:46`)이고 `dark:` 클래스 잔재(`:23-30`)가 있어 브랜드 톤과 다르다.
6. **녹음 입력은 호스트 기기 하나**: 오디오는 호스트 브라우저 마이크(`useAudioRecorder.ts:48`), 영상은 호스트 카메라(`hooks/useVideoRecorder.ts:95`, 호스트 페이지에서만 사용 `ClassPlayerPage.tsx:617`). 업로드는 `/audio/chunk`·`/video/chunk`(호스트 권한: `audio_service.py:40-47` `_get_host_session`). 서버에 LiveKit egress 등 회원 음성 별도 녹음 코드는 없다(`egress` grep 0건 — 서비스 파일 기준). **회원 음성이 녹음에 포함되는지는 오프라인 현장에서 호스트 마이크가 잡는 경우 외에는 코드로 확인되지 않는다** → 시안 FM06a 의 `음성을 녹음`·`현장 대화를 녹음` 문구의 사실 근거는 제품 확인 필요(§5-D2).
7. 녹음 상태는 세션당 1건(`SessionRecord`, `services/audio_service.py:50-56`)이라 **회원 개별 거부를 녹음에서 빼는 단위가 없다**.

### 2-2. `audio/start` 시점 변경의 영향 (FH07)
- `audio_service.start_recording` 은 세션 상태가 `scheduled`/`in_progress` 일 때만 허용한다(`services/audio_service.py:71`, 영상도 `video_service.py:141`). **로비 상태 `open` 과 `ready` 는 400** `종료된 세션은 녹음할 수 없습니다`. 상태 전이표: `open` 은 `ready/scheduled` 에서(`session_service.py:36`), `start` 는 `open` 에서(`:37`).
- 따라서 FH07 에서 동의를 받더라도 **`audio/start` 는 `start` 전이 직후에 호출**해야 한다(현행과 같은 위치, 모달만 시트로 선행). 백엔드를 고치지 않는 기본안.
- 동의 거부(`consent_audio=false`)는 `manual` 선언이며, 이미 `recording|processing|completed` 이면 400(`audio_service.py:79-80`, 테스트 `tests/test_sdd085_manual_mode.py` `test_06`). FH07 이 시작 전 결정을 받으면 이 충돌 창이 없다.
- 시작 전이와 `audio/start` 사이 간격은 현행도 존재(전이 → `liveKit.connect` → 모달). FH07 은 모달 대기 시간이 사라져 간격이 줄어든다. 마이크 권한 프롬프트는 `recorder.start()` 시점(`useAudioRecorder.ts:48`)이라 FH05 에서 이미 허용했다면 추가 프롬프트가 없다(브라우저별 — 미확인).
- 현행 `취소` 경로의 `manual` 미선언은 FH07 `no-consent` 케이스(`host-b.html:584-585`, `:603`)가 `startAudio(false)` 를 보내야 시안(`녹음 없이 수동 기록으로 진행해요`)과 일치한다.
- 오프라인(S4): 위 표대로 `location_type` 조건이 프론트·백엔드 녹음 경로에 없다. 단, 오프라인은 회원이 송신하지 않는다(`session_service.py:1758-1765` `_compute_can_publish`)는 점만 다르다. 호스트 마이크 녹음 자체는 가능.

### 2-3. 회원 쪽 동의 저장 여부와 가입 동의의 범위
- **참가자 단위**: 위 표 — `consent_eeg` 는 코드 입장 시 자동 `True`(`session_service.py:1586-1594` 주석 "코드로 자발 참여 = EEG 수집 opt-in 으로 기록"). 이는 **UI 상의 명시적 선택이 아닌 입장 행위의 부산물**이다(규칙 1 "명시적 opt-in" 대조 §2-4).
- **초대 참가자**: `invite_participant`(`:1267-1330`)는 `consent_eeg=False` 로 만들고, 주석이 "본인이 참여 동의를 거치기 전에는 업로드가 차단된다"(`:1588-1590`)고 예정한 **동의 단계가 코드에 구현돼 있지 않다**. 테스트가 이 상태를 고정: `tests/test_sdd026_live_session_p0.py:298-320`(초대 회원 업로드 403).
- **사용자 단위 `consents` 테이블**: `models/consent.py:13-24` — `type`(String(20): tos/privacy/sensitive), `version`, `agreed`, `agreed_at`, `UNIQUE(user_id,type,version)`. 가입 시 3종 기록(`api/v1/auth.py:303-313` 필수 검증, `:316-370` 생성, Google 가입 `:896`). 다른 타입 사례: AI 비서 `ai_agent`/`1.0`(`services/agent_service.py:40-41`, `:185`). **세션·녹음·업로드 판정 코드는 이 테이블을 읽지 않는다**(`Consent` import 는 `auth.py`·`agent_service.py` 뿐).
- **가입 동의 문구**(프론트 `components/auth/ConsentCheckList.tsx:20-22`): `서비스 이용약관 동의`, `개인정보 처리방침 동의`, `민감정보(뇌파·상담내용) 수집·이용 동의`, 모두 `[필수]`(`:60`), `전체 동의 (모두 필수)`(`:46`). 가입 화면 `pages/register/RegisterClientPage.tsx:92`, `:150-151`(전부 필수), `:358-361`. 문구에 **음성 녹음·AI 기록·보관 기간·삭제 권한·클래스 단위 고지가 없다**. 규칙 2 는 "세션 시작 전 **별도** 동의"로 쓰여 있어 가입 동의가 녹음 동의를 갈음하는지는 규칙 문서의 문구상 `별도`다(해석·법적 판단은 하지 않음 → §5-D8).
- 프론트 DTO: `lib/api/session.ts:35-36` 가 `consent_audio`·`consent_eeg` 를 가지고 있으나 화면에서 쓰는 곳은 호스트 모니터링 모델(`consent_eeg` 필터 등)뿐이며 회원 동의 화면은 없다.

### 2-4. `data-privacy.md` 규칙 3개 대 현행·시안
| 규칙 | 현행 코드 | 시안 | 사실 판정 |
|---|---|---|---|
| **1. LINK BAND 착용 동의** — 세션 시작 전 명시적 opt-in, 미동의에도 세션 진행 가능 | 회원 UI 없음. 코드 입장이 `consent_eeg=True` 로 자동 기록(`session_service.py:1594`). 초대 입장은 False(업로드 403) | FM06a: `뇌파 측정 데이터 사용` 체크, `LINK BAND 선택`=선택·기본 미체크(`member-b.html:364`, `on = ... C.band==='req'`), `필수`(req) 모드=필수·기본 체크·CTA 비활성 해제 조건(`:358-368`), `사용 안 함`=항목 없음 | 현행: 명시적 opt-in **아님**(입장=동의). 시안: 시작 **전** 명시적 선택은 충족, 단 `required` 모드에서 거부 시 CTA 가 비활성이라 **"미동의 시에도 진행 가능"과 어긋날 수 있음**(`linkband_mode` 는 클래스 설정 `models/session.py:61`) |
| **2. 음성 녹음 동의** — 세션 시작 전 **별도** 동의, 거부 시 **수동 기록 모드** | 동의가 **시작 후** 호스트 모달(`ClassPlayerPage.tsx:1072`), 회원 동의 없음, `취소` 시 `manual` 미선언(`:1453-1455`) | FH07: 시작 **전** 시트에 `녹음하고 AI 기록지를 만들어요` 체크 + `30일 보관`·`나와 담당 상담사만 열람` 배지, 미체크(`no-consent`)·마이크 꺼짐(`mic-off`) 이면 `수동 기록으로 진행`(`host-b.html:584-603`). FM06a: `녹음과 AI 기록`(`필수`, 기본 체크) 1항목(`member-b.html:363`) | 현행: 순서가 규칙과 어긋남(시작 후), 주체는 호스트. FH07: 순서·거부 시 수동 기록 **충족**. FM06a: 항목이 **녹음+AI 기록 묶음**이고 **회원이 거부할 길이 없음**(필수·CTA 비활성) — 규칙의 "거부 시 수동 기록 모드"가 회원 단위로 구현되지 않음(규칙 문서는 동의 주체를 명시하지 않음). 영상 녹화(`record_video` 기본 True)는 FM06a·FH07 어디에도 없음 |
| **3. 데이터 보관 동의** — 보관 기간·목적·삭제 권한 고지 | `ConsentModal.tsx:31` `30일간 보관`. 코드: 음성·영상 청크 90일(`services/media_cleanup_service.py:26` `MEDIA_RETENTION_DAYS = 90`), 뇌파 원본 기본 무기한(`config.py:77-79` `eeg_raw_retention_days: int = 0`). 삭제 권한 고지 없음 | FH07 `30일 보관`·`열람 범위`(`host-b.html:601`). FM06a: 목적은 `AI가 기록지를 만들어요`·`리포트를 만들어요`, **보관 기간·삭제 권한 문구 없음**, `동의는 클래스가 끝난 뒤에도 상담사에게 요청해 바꿀 수 있어요`(`member-b.html:367`)만 | 보관 기간 문구(30일)가 코드(90일/무기한)와 **불일치**. FM06a 는 규칙 3 의 보관 기간·삭제 권한 고지가 **없음**. `상담사에게 요청`에 대응하는 철회 API·UI 코드는 없음 |
| (참고) 감사: 모든 데이터 접근 로깅 6개월(`:20`) | 동의·녹음 시작 감사 없음 | - | 동의 변경 이력(시각·버전) 저장 위치 없음 |

### 2-5. 시안의 동의 항목과 케이스 의미
- **FM06a**(`member-b.html:358-368`, `기획.md` FM06a 행): 정보 카드(`온라인/대면 · 1:1/그룹`, 시각, LINK BAND 모드) + 체크 항목
  - `녹음과 AI 기록` [`필수`] — 문구 `{음성을|현장 대화를} 녹음하고 AI가 기록지를 만들어요. 기록은 나와 상담사만 볼 수 있어요.`, 기본 체크 상태 `!empty`.
  - `뇌파 측정 데이터 사용` [`필수`|`선택`] — LINK BAND `사용 안 함`이면 항목 없음, `req` 이면 필수·기본 체크, `opt` 이면 선택·기본 미체크. 문구에 `진단이나 치료를 위한 것이 아니에요`(규칙 `의료기기 아님` 고지에 대응).
  - CTA `동의하고 계속하기`, `empty` 케이스는 미체크·비활성(`member-b.html:239`의 `on-group-opt-member-empty`). 하단 `동의는 클래스가 끝난 뒤에도 상담사에게 요청해 바꿀 수 있어요.`
  - 이름 입력 없음(R1-1). **동의를 서버에 저장할지는 `구현 단계 결정`**(`기획.md` FM06a 행·§9 A1).
- **FM06e**(`member-b.html:475`): 요약 `동의` 행(`녹음·AI 기록에 동의했어요` / `...과 뇌파 사용에 동의했어요`) — 탭하면 바꿀 수 있다(`항목을 눌러 다시 바꿀 수 있어요`). 즉 동의 상태는 마법사 안에서 재편집 가능해야 한다.
- **시작 후 입장(`started` 시트)**: `startedSheet` 의 `names = {b,c,d}` 만 정의(`member-b.html:337-339`), FM06a 케이스에는 `started` 가 없다(`:239`). **동의 단계에서 상담사가 시작한 경우의 화면이 시안에 없다**(결정 5 `지금 입장하기`/`준비 이어서 하기`와의 공백).
- **FH07**(`host-b.html:580-608`): `ok`(마이크 켜짐·체크됨), `pending`(준비 중 회원 목록 `설문/LINK BAND/기기` 칩만 — **`동의` 칩 없음** `:592`), `no-consent`(마이크 켜짐이나 체크 해제 → 수동 기록 문구 `:603`), `mic-off`(마이크 꺼짐, 체크박스 비활성+미체크, `켜기` 버튼), `offline`(장소 행), `one*`(1:1), `empty-wait*`(대기실 0명). 체크박스 주체는 **상담사**(`녹음하고 AI 기록지를 만들어요`). 시안은 FM06a 에서 받은 **회원 동의 현황을 FH07 에 보여 주지 않는다**.
- FM06a 의 `필수` 와 FH07 의 상담사 체크는 서로 독립이다(시안 어디에도 회원 미동의 시 FH07 이 어떻게 달라지는지 정의 없음).

### 2-6. 구현하려면 필요한 저장 필드·API — 옵션별

**공통 사실**: ① `consent_eeg` 를 True 로 올리는 쓰기 경로가 코드 입장뿐이라 초대 입장에서는 EEG 업로드가 막힌다(§0). ② 대기실 준비 현황은 서버 저장이 아니라 WS presence 이며 `readiness` 는 `surveyDone/bandDone/deviceDone` 3개 boolean 화이트리스트만 통과한다(`ws/session_live_namespace.py:1412-1416` `_sanitize_readiness`, 수신 `:786`; 프론트 타입 `lib/socket.ts:236-240`, `hooks/useWaitingRoomCount.ts:29-34`) — FH07 에 `동의` 칩을 보이려면 이 화이트리스트 확장이 필요(프론트만으로 불가). ③ 호스트는 참가자 행이 없다(`session_service.py:1564` "host 상담사는 참여자로 중복 등록하지 않는다") — 호스트 동의 확인은 참가자 컬럼에 담을 수 없고 `audio/start` 결과(`SessionRecord.status`)가 유일한 서버 기록이다.

#### 옵션 A — UI 만, 서버 저장 없음(클라이언트 `sessionStorage`)
- 변경 범위: 프론트 FM06a 단계 + FM06e 요약 + 세션별 키(예: `mb_class_consent:{sessionId}`) 저장. 백엔드 변경 0(기존 `sessionStorage` 선례: `pages/class-join-page.tsx:39`, `:81-105`, `lib/class/class-waiting-room.ts:9-55`).
- 한계: 서버가 동의를 모르므로 ① 초대 회원 `consent_eeg=False` 유지 → **밴드 사용 시 업로드 403**(`session_service.py:2516`). 이를 피하려면 백엔드가 입장 시 `consent_eeg=True` 를 자동 부여해야 하는데 이는 현행 "입장=동의" 와 같아 UI 동의가 형식적이 된다. ② 상담사·감사 확인 불가, 탭 닫으면 소실, 기기 간 불일치 ③ 철회 반영 불가.
- 임시 우회(비권장): 세션 DTO 에 `access_code` 가 아직 노출되므로(`session_service.py:97`) 프론트가 `/sessions/by-code/{code}/join` 을 호출해 `consent_eeg=True` 를 올리는 방법이 **기술적으로는** 가능. 입장 코드 제거(결정 1·A7)와 충돌하므로 근거로 삼을 수 없음.
- 마이그레이션 위험: 없음. 프라이버시 규칙 충족도: **낮음**(규칙 1 UI 형식만, 증빙·철회·감사 불가, 규칙 3 고지는 UI 문구만).

#### 옵션 B — participant 단위 동의 컬럼 추가 + 쓰기 API (권장 기본안)
- 모델/마이그레이션: `session_participants` 에 `consent_at`(DateTime tz, nullable), `consent_version`(String(20), nullable) 추가(+ 기존 `consent_audio`·`consent_eeg` 재사용). Alembic: `op.add_column` nullable 2개 — **기본값/백필 불필요**, 기존 행은 `NULL`=기록 없음(구 방식 입장). 다운그레이드 `drop_column`. 선례: `d4e5f6029001_sdd_029_report_email.py`(nullable add_column). **현재 Alembic head 는 확인하지 못함**(74개 파일, `alembic heads` 미실행).
- API: `PUT /sessions/{id}/consent`(회원 본인 JWT, 본문 `{audio: bool, eeg: bool, version: str}`), 본인 참가자 행만(`resolve_upload_participant` 와 같은 소유 검증 패턴 `session_service.py:2520-2560`), 종료·취소 세션은 409, 멱등(같은 값 재전송 OK), 값 변경 허용(FM06e 재편집·철회)과 `consent_at` 갱신. 응답은 본인 동의 상태. `linkband_mode='none'` 이면 `eeg` 무시/False 고정.
- 연동: ① `consent_eeg` 게이트(`:2507-2517`, 내보내기 `export_service.py:78` 등)는 그대로 동작 — 초대 회원은 동의 전 False 라 업로드 403 은 의도된 동작. ② 코드 입장(구 경로)의 자동 `True` 는 읽기 호환으로 유지(기존 행·구 클라이언트 영향 없음). ③ `ParticipantInfo`(`schemas/session.py:121-141`)에 `consent_at` 노출 여부 결정, **비호스트에게 타인 `consent_*` 를 숨기는 처리 권장**(§1). ④ FH07 에 회원 동의 현황을 보이려면 `readiness` 화이트리스트에 `consentDone` 추가 또는 REST 로 `consent_audio/eeg` 조회(호스트는 `GET /sessions/{id}` 참가자 목록으로 이미 받는다 `session_service.py:137-138`).
- 마이그레이션 위험: 낮음(nullable add, 락 짧음). 기존 데이터: 과거 세션·행 영향 없음. 테스트: `tests/test_sdd026_live_session_p0.py` 의 초대 회원 403/동의 후 200 케이스 추가, 신규 `tests/test_session_consent.py`(소유 검증·상태·멱등·철회·타인 마스킹), 마이그레이션 up/down.
- 프라이버시 규칙 충족도: **높음**(규칙 1·2 증빙 가능, 시각·버전 기록, 철회 가능). 규칙 3 은 문구 정합(§5-D6) 별도.

#### 옵션 C — 기존 필드 재활용(컬럼 추가 없음)
- C-1 **참가자 `consent_audio`/`consent_eeg` 만 재사용 + 쓰기 API 추가**(B 에서 `consent_at`·`consent_version` 제외): 마이그레이션 0, 변경은 API·서비스·스키마·프론트. 시각·버전 증빙이 없어 규칙 감사 항목(`:20`) 대응 약함. 필수 최소안.
- C-2 사용자 `consents` 테이블에 새 타입(`recording`, `eeg` 등, `String(20)`) 추가: 마이그레이션 없음(문자열 타입), `UNIQUE(user,type,version)` 때문에 **회원 1인당 버전당 1회** — 클래스마다 달라지는 방식·LINK BAND 모드 고지(FM06a 정보 카드)·종료 후 변경과 맞지 않고, 읽는 쪽(업로드 게이트)도 따로 만들어야 함. 선례: `ai_agent`(`agent_service.py:185`). 비권장.
- C-3 가입 `sensitive` 동의로 갈음: 코드는 이미 존재하나 문구에 녹음·AI 기록·보관이 없고 규칙 2 가 `별도`(§2-3) → 갈음 불가 판단은 사용자 결정(§5-D8). 변경 0 이지만 규칙 충족도 낮음.
- C-4 `POST /sessions/{id}/checkin`(`api/v1/records.py:49`)에 동의 실어 보내기: 저장 대상이 `SessionRecord.subjective_state`(리포트에 쓰이는 주관 상태 JSON, `record_service.py:320-331`)라 의미가 맞지 않아 **비권장**.

| 옵션 | 변경 범위 | 마이그레이션 | EEG 업로드(초대 입장) | 규칙 충족도 |
|---|---|---|---|---|
| A | 프론트만 | 없음 | **막힘**(별도 백엔드 조치 필요) | 낮음 |
| B | 프론트 + API + 컬럼 2개 | nullable add 1건(위험 낮음) | 동의 후 통과 | 높음 |
| C-1 | 프론트 + API | 없음 | 동의 후 통과 | 중간(증빙 약함) |
| C-2/C-3/C-4 | - | - | - | 낮음 / 낮음 / 비권장 |

### 2-7. 상담사 측: FH07 이 현행 `ConsentModal` 을 대체/통합하는 방식
- **시작 전 시트(신규)** = FH07: 준비 인원 + 마이크 상태 + `녹음하고 AI 기록지를 만들어요` 체크 + 보관·열람 배지 → `지금 시작하기`/`시작하기`. 확인 시 `startClass` 를 `confirmStart({recordAudio: boolean})` 로 분리: `transitionSession('start')`(`:1055`) → `liveKit.connect()`(`:1058`) → **체크&마이크 ON 이면 `startAudio(id,true)` + `recorder.start()`**, **체크 해제 또는 마이크 OFF 이면 `startAudio(id,false)`**(현행 `:1060-1066` 을 재사용; 취소 경로의 `manual` 미선언 해소) → 영상은 `record_video`·카메라 ON 이면 `startVideo`(현행 `handleConsentConfirm` `:1128-1131` 로직을 시트 확인 쪽으로 이동).
- `ConsentModal`(시작 직후) 은 로비→시작 경로에서는 불필요해지나, **중도 `녹음 시작`**(`handleStartClick` `:1104`, 호출 `:1903`)이 같은 모달을 쓰므로 ① 모달을 유지하되 시안 언어로 정리하거나 ② 시트로 교체한다(plan 결정). `ClassPlayerPage.tsx:1449-1457`, `:1529`, `:2007` 의 렌더 위치 정리 필요.
- 마이크 OFF 흐름(FH05 `mic-off-warn` → `꺼진 채로 열기`)은 이미 `startAudio(false)` 로 연결돼 있어 FH07 `mic-off` 와 정합(`ClassPlayerPage.tsx:1060-1066`).
- 시작 버튼 활성 조건(`canStart` `:1328-1331`, 그룹은 참가자 ≥1)은 결정 5 로 바뀔 대상이며 다른 조사(I5 계열) 소관 — 이 파일에서는 변경하지 않는다.
- `audio/start` 시점: **시작 직후 유지**(§2-2). 백엔드에서 `open` 허용(`audio_service.py:71`, `video_service.py:141`)하면 시작 전 선언이 가능하나 **기본안에는 불필요**.

## 3. 변경 목록

### 프론트
| 파일 | 변경 | 규모 |
|---|---|---|
| 신규 FM06a 동의 단계 컴포넌트(마법사 내) | 안내 카드 + `녹음과 AI 기록`·`뇌파 측정 데이터 사용`(모드별 표시/필수) 체크, 기본 **미체크**(시안 `empty` 상태를 초기값으로), 보관 기간·삭제 권한 고지 문구 추가(§5-D6), CTA `동의하고 계속하기` | M |
| 마법사 FM06e 요약 | `동의` 행(탭 시 FM06a 로 이동·재편집) | S |
| `lib/api/session.ts` | `putSessionConsent()`(옵션 B/C-1) + 응답 타입, 옵션 A 면 `lib/class/` 에 세션 키 스토어 | S~M |
| 마법사 `started` 처리 | FM06a(동의 단계)에서 시작된 경우의 시트/게이트(시안 공백, §5-D5) | S~M |
| 신규 FH07 시작 확인 시트(상담사) | 준비 인원·마이크·동의 체크·배지, `지금 시작하기`/`조금 더 기다리기`, 케이스 `ok/pending/no-consent/mic-off/offline/empty-wait` | L |
| `pages/sessions/ClassPlayerPage.tsx` | `startClass`(`:1050`)를 시트 확인 후 실행으로 분리, 동의 결과로 `startAudio(true|false)` 분기, 모달 의존(`:576`, `:1072`, `:1449-1457`, `:1529`, `:2007`) 정리, 중도 `녹음 시작`(`:1104`, `:1903`) 처리 | M |
| `components/session/ConsentModal.tsx` | 유지 시 시안 톤(indigo 제거, `dark:` 제거, 문구 해요체·보관 기간 정합), 폐기 시 삭제 | S |
| 호스트 `pending` 목록 | `설문/LINK BAND/기기` 칩에 `동의` 추가는 `readiness` 확장(백엔드)과 함께만 가능 | S |
| 테스트 | 신규: FM06a 단계(필수/선택/기본값/CTA), FH07 케이스 6종, `startClass` 분기(동의 시 `startAudio(true)`, 해제/마이크 OFF 시 `(false)`, 취소 시 시작 안 함). 기존 `tests/class-player-host-model.test.ts`·`class-waitlist.test.ts` 는 `consent_*` 필드 값만 사용(영향 작음), E2E `e2e/class-player/live.mjs` 시작 흐름에 시트 단계 추가 | M |

### 백엔드
| 엔드포인트/모델/마이그레이션 | 변경 | 분류 | 기존 데이터 호환 | 필요 테스트 |
|---|---|---|---|---|
| N1 `PUT /sessions/{id}/consent`(회원 본인, 참가자 행에 `consent_audio`·`consent_eeg` 기록) | 서비스 `session_service.py`(소유 검증 패턴 `:2520-2560`), 라우터 `api/v1/session.py`, 스키마 `schemas/session.py` | **필수**(초대 입장에서 `consent_eeg` 를 올릴 유일한 정식 경로) | 기존 행 불변, 코드 입장 경로 그대로 | 동의 전 업로드 403 → 동의 후 통과, 타인 행 403, 종료 세션 409, 멱등 |
| N2 `session_participants.consent_at`·`consent_version` + Alembic | nullable add 2컬럼 | 권장 | NULL 허용·백필 없음, 다운그레이드 drop | 마이그레이션 up/down, N1 이 시각·버전 기록 |
| N3 `_serialize` 에서 비호스트에게 타인 `consent_*` 마스킹 | `session_service.py:137-138` | 권장 | 호스트 응답 불변 | 비호스트 응답에서 타인 값 `false`/제외 |
| N4 `readiness` 에 `consentDone` 추가 | `ws/session_live_namespace.py:1412-1416`(+`:786`), 프론트 `lib/socket.ts:236-240` | 권장(FH07 에 동의 현황을 보일 때만) | 화이트리스트 확장, 구 클라이언트는 3필드만 보내므로 `type(...) is bool` 전부 필요 조건을 함께 완화해야 함(`:1415`) | 구 페이로드(3필드)도 수용하는 테스트 |
| N5 `audio/start`·`video/start` 에 `open` 상태 허용 | `audio_service.py:71`, `video_service.py:141` | 보류(시작 전 선언이 필요할 때만) | - | 기존 `tests/test_audio_record.py`, `test_sdd085_manual_mode.py` 회귀 |
| N6 동의 철회 API(종료 후 상담사 요청 대응) | 시안 `상담사에게 요청`에 대응하는 처리 | 보류(§5-D7) | - | - |
| N7 동의 변경 이력(감사 로그) | `data-privacy.md:20` 의 접근 로깅과 별개 | 보류 | - | - |

### 프론트만으로 가능한 대체안
- FH07(시작 전 확인 + `startAudio` 분기)은 **백엔드 변경 없이** 가능(§2-2, §2-7).
- FM06a 단계 UI·검증·FM06e 재편집은 백엔드 없이 가능하나 **서버 저장이 없으면 옵션 A 의 한계**(초대 회원 EEG 403, 증빙 없음)가 따른다.
- FH07 의 회원 동의 현황 표시는 N4 없이 `GET /sessions/{id}` 참가자 `consent_*`(`session_service.py:137-138`) 폴링으로 대체 가능(N1 적용 후). 실시간성은 낮다.

## 4. 위험·주의
- **초대 입장 EEG 차단**(최우선): A7 로 코드 입장이 제거되면 `consent_eeg` 가 영원히 False → 밴드 사용 회원의 `POST /sessions/{id}/features` 가 403(`session_service.py:2516`). 입장 경로 조사(다른 I번호)와 **같은 배포 단위**로 N1 이 필요하다. 관련 테스트(`test_sdd026_live_session_p0.py:298-320`)가 현재 상태를 기대값으로 고정하고 있어 기대값 재정의가 필요.
- **`consent_eeg` 의미 변화**: 현재 "코드로 입장함". 새 의미 "FM06a 에서 명시 동의함". 과거 행(True)은 구 의미 그대로 유지(재동의 요구 없음). 내보내기 게이트(`export_service.py:78`, `:137`, `:201`, `:219`)가 같은 컬럼을 읽으므로 새 의미 도입 시 내보내기 가능 범위가 달라진다.
- **보관 기간 문구 불일치**: UI·시안 `30일` vs 코드 음성·영상 90일(`media_cleanup_service.py:26`)·뇌파 원본 무기한(`config.py:79`). 문구만 시안대로 두면 사실과 다른 고지가 된다.
- **회원 단위 거부의 기술적 한계**: 녹음은 세션당 1건·호스트 기기 1대(§2-1-6, 7). 회원 1명이 거부해도 그 사람 음성만 빼는 단위가 없다 → 거부 처리 방식은 정책(§5-D2).
- **타인 동의 플래그 노출**(§1): 동의 UI 도입 시 비호스트가 타인의 거부 여부를 볼 수 있다.
- **취소 경로의 `manual` 미선언**(현행 버그 성격): FH07 도입 시 `startAudio(false)` 를 반드시 보낼 것(리포트 진행 상태 `partial` 오표시 방지 — `survey/상담사-화면조사.md:295`).
- `consent_video` 는 `False` 를 400 으로 거부(`video_service.py:137-138`) — 영상 거부 선언 경로가 없다(영상은 호스트 카메라 녹화).
- 배포 순서: 백엔드 N1(+N2) 선배포 → 프론트. 구 프론트는 새 필드를 보내지 않으므로 호환. 프론트 선배포 시 N1 부재로 FM06a 저장 실패 → 옵션 A 폴백이 없으면 입장 불가.

## 5. 사용자 결정 필요

| # | 결정 | 옵션 | 기본값(보수적 제안) | 영향 |
|---|---|---|---|---|
| D1 | 회원 동의 저장 방식 | A 클라이언트만 / B 컬럼 추가+API / C-1 기존 컬럼+API | **B** | A 는 초대 회원 EEG 403 해소 불가·증빙 없음. B 는 규칙 충족도 최고, 마이그레이션 위험 낮음 |
| D2 | 회원의 `녹음과 AI 기록` 동의 거부 시 | (a) 입장 불가(시안 `필수`) (b) 입장 허용 + 상담사에게 알림, 시작 확인(FH07)에서 수동 기록 전환 (c) 입장 허용, 녹음은 그대로 | **(b)** | 규칙 2 "거부 시 수동 기록 모드"와 합치. (a) 는 규칙과 충돌 가능, (c) 는 동의 없는 녹음. 또한 FM06a 문구(`음성을 녹음`)의 사실 근거(회원 음성이 녹음에 포함되는지)를 제품이 확정해야 함 |
| D3 | LINK BAND `required` 모드에서 뇌파 동의 거부 시 | (a) 입장 불가(시안 `필수`) (b) 입장 허용·뇌파 미측정 | **(b)** | 규칙 1 "미동의 시에도 세션 진행 가능". (a) 는 클래스 요구 조건으로 해석할 여지 → 상담사가 `required` 를 고른 의미와 충돌 정리 필요 |
| D4 | FH07 에 회원 동의 현황 표시 | (a) 표시(`동의 대기`/`미동의` 칩) (b) 미표시(시안 그대로) | **(a)** | (a) 는 N4 또는 폴링 필요. (b) 면 상담사가 미동의 회원 존재를 모른 채 녹음 시작 |
| D5 | 동의 전 단계에서 상담사가 클래스를 시작한 경우 | (a) 입장 시 FM06a 부터 이어서(동의 전엔 입장 불가) (b) 동의 없이 입장 후 진행 화면에서 동의 | **(a)** | 시안에 `started` 케이스 없음(공백). (b) 는 규칙 1·2 "시작 전" 위반 가능 |
| D6 | 보관 기간·삭제 권한 고지 값과 문구 | 코드 사실(음성·영상 90일, 뇌파 원본 무기한)에 문구를 맞춤 / 코드를 30일로 변경 / 다른 기간 확정 | 팀 확정 필요(임시 기본: **문구를 코드 사실에 맞춰 정정**) | 시안·`ConsentModal` `30일` 현 표기는 사실과 다름. FM06a 에 보관 기간·삭제 권한 행 추가 필요 |
| D7 | 동의 철회 경로 | 클래스 종료 전: FM06e 에서 직접 변경 / 종료 후: 상담사 요청(시안) / 회원 직접 철회 API | 종료 전 회원 직접 변경 + 종료 후 상담사 요청(수동) | 철회 API 는 N6(보류). 시안 문구 `상담사에게 요청`의 실제 처리 담당 미정 |
| D8 | 가입 시 `sensitive` 동의가 클래스 단위 동의를 갈음하는지 | 갈음 안 함 / 갈음 | **갈음 안 함**(규칙 2 `별도 동의`) | 갈음하면 FM06a 불필요해지나 문구 범위(녹음·AI 기록·보관 미포함)가 부족 |
| D9 | 영상 녹화(`record_video` 기본 True, 호스트 카메라) 고지 항목 | FM06a/FH07 에 항목 추가 / 호스트 설정으로만 둠 | FH07 에 영상 녹화 한 줄 추가 | 현행·시안 모두 영상 동의 항목 없음. 회원 영상은 녹화되지 않음(호스트 카메라만, `ClassPlayerPage.tsx:617`) |
| D10 | FM06a 기본 체크 상태 | 시안의 `녹음과 AI 기록` 기본 체크 / 전부 기본 미체크 | **전부 기본 미체크**(시안 `empty` 케이스) | 규칙 1 "명시적 opt-in" 대응 |

## 6. 확인하지 못한 것
1. **Alembic head**: `backend/alembic/versions` 74개 파일 중 현재 단일 head 리비전 id 를 확인하지 않음(`alembic heads` 미실행) — N2 마이그레이션의 `down_revision` 결정에 필요.
2. **회원 음성의 녹음 포함 여부**: 녹음 입력이 호스트 마이크/카메라 하나라는 것까지만 코드로 확인. 온라인 클래스에서 회원 음성이 호스트 마이크를 통해(스피커→마이크) 들어가는지는 제품 구성(헤드셋 등)에 따라 달라 코드로 판정 불가.
3. **STT/화자 분리·요약 파이프라인의 동의 반영**(`tasks/stt_task.py`, `summary_task.py`): `manual` 상태에서 건너뛰는 것은 테스트(`tests/test_sdd085_manual_mode.py`)로 확인했으나 코드는 직접 읽지 않음.
4. **회원 홈/목록 DTO**(`GET /sessions` 목록)의 `record_*` 노출: `_serialize` 공용으로 추정하나 목록 전용 직렬화 경로는 읽지 않음.
5. **약관/개인정보 처리방침 본문 페이지**(법적 고지 문구)의 보관 기간·삭제 권한 기재 여부: 해당 페이지를 찾지 못함(`frontend/src` 의 `보관` grep 에서 법적 문서 없음).
6. **브라우저별 마이크 권한 프롬프트 재발생**(FH05 허용 후 `recorder.start()` 시 추가 프롬프트): 실행 확인 안 함.
7. **`UserResponse`/`/users/me` 가 `consents` 를 노출하는지**: 가입 동의 조회 API 를 읽지 않음.
8. 이 조사에서 백엔드·프론트 테스트는 **실행하지 않음**(읽기 전용).
