# SDD-286 분석 — 비회원 코드 입장 경로 지도와 차단 방식 비교

> **개정(대표 지시 11/4)**: 채택안이 "서버 스위치"에서 "운영 화면 입구 숨김"으로 바뀌었다. §0~9는 **서버 스위치안 분석으로 보존**(L3 확장 시 재사용). 채택안의 입구 전수 조사는 **§10**.

- 작성일: 2026-11-04 / 브랜치 `sdd/286-close-guest-code-entry` / 구현 없음(분석만)
- 분류: **확정** = 코드·운영 읽기 조회로 직접 확인 / **추정** = 정황 / **미확인** = 확인 못함
- 운영 조회는 읽기 전용(SSM). 개인정보·비밀값은 출력하지 않았고 건수만 기록했다.

## 0. 결론 (먼저)

1. 비회원이 사람 계정 없이 참여 행·입장 자격(entry credential)을 **새로 얻는 경로는 서버에 2개**다.
   - A. `POST /sessions/enter` (4자리 코드 + 이름·성별·생년월일·이메일) — 11/4에 쓰인 경로. `session_service._enter_resolved`의 비회원 분기(`session_service.py:2240~2283`).
   - B. `POST /classes/{id}/guest-memberships` 이하 장기 비회원 자격 계열(`class_guests.py`, `class_guest_service.py`) — 운영에서 `CLASS_SCHEDULING_ENABLED=true`라 라우터는 열려 있고, **운영 `class_guest_credentials` 0행·비회원 class_members 0행**이라 실사용 흔적은 없다. 그래도 코드로는 열려 있으니 같이 닫아야 한다.
2. 추천: **서버 환경 스위치 1개(`GUEST_ENTRY_CLOSED`) + 새 입장만 차단**. DB 마이그레이션 없음, 되돌리기 = 값 변경 + 서비스 재시작.
3. 전역 vs 11/11 회차만 차단은 **현재 운영 데이터에서 실효 차이가 없다**(§4). 회차 속성(마이그레이션) 방식은 비용만 크다. 전역 스위치 추천.
4. **한계**: 앱(vc46·TestFlight 39)은 웹 번들을 앱 안에 내장(`capacitor.config.ts`에 `server.url` 없음, `webDir:'dist'`)한다 → **웹 배포만으로 구버전 앱 화면은 바뀌지 않는다.** 구버전 앱은 서버가 막으면 "잠시 문제가 생겼어요. 다시 시도해 주세요"(일반 오류)만 본다(§6). 멈추지는 않는다.
5. 11/10 밤 이전 배포: **가능**(§8).

## 1. 비회원 입장 경로 지도

### 1-1. 새 참여 행·입장 자격을 만드는 경로(차단 대상)

| # | 경로 | 위치 | 누가·어떻게 | 비회원 생성물 | 운영 실사용 | 차단 지점 |
|---|---|---|---|---|---|---|
| A1 | `POST /sessions/enter` | `api/v1/session.py:220`, `session_service.enter_session`→`_enter_resolved` | 로그인 없이 코드+개인정보. 헤더 `X-Entry-Credential`이 있으면 같은 행 복귀 | `SessionParticipant(user_id=NULL, guest_name…)` + 입장 자격 JWT(`type=class_entry`, TTL 24h) | **확정**: 11/4 비회원 39행, 누적 비회원 참여 행 52(7개 회차, 전부 `completed`) | `_enter_resolved`의 회원 분기 뒤·비회원 분기 앞 (아래 §3) |
| A2 | `POST /sessions/enter/verify` | `session.py:196`, `verify_entry_code` | 코드가 맞는지만 확인(행 생성 없음). **`skipAuth`로 호출되어 회원 여부를 모름** | 없음(제목·시각·진행자명) | 확정 | 막지 않는다. 응답에 `guest_entry_closed` 필드 추가(클라가 안내를 앞당김) |
| B1 | `POST /classes/{id}/guest-memberships` | `class_guests.py:22`, `join_guest` | 클래스 코드로 장기 비회원 멤버 생성, 장기 자격(90일) 발급 | `ClassMember(kind=guest)` + `ClassGuestCredential` | **확정**: 0행 | `join_guest` 진입부 |
| B2 | `POST /classes/{id}/sessions/{sid}/guest-entry` | `class_guests.py:39`, `guest_entry` | B1 자격으로 회차 입장 → **입장 자격(entry_credential) 재발급** | 입장 자격 | 0행이라 호출 불가(미사용) | `guest_entry` 진입부 |
| B3 | `POST /classes/{id}/guest-credentials/rejoin` | `class_guests.py:35` | left 상태 비회원 복귀 | 상태 변경 | 미사용 | `rejoin_guest` 진입부 |
| B4 | `POST /classes/{id}/guest-credentials/exchange` | `class_guests.py:56` | 복구 토큰 교환 → 새 자격 | 자격 | 미사용 | `exchange_recovery` 진입부 |
| B5 | `POST /classes/{id}/guest-credentials/refresh` | `class_guests.py:26` | 기존 장기 자격 갱신 | 자격 | 미사용 | 기존 자격 유지 정책에 따라 §5 |

> B 계열은 라우터 전체가 `Depends(scheduling_enabled)` 아래라 운영 스위치 `CLASS_SCHEDULING_ENABLED`를 끄면 막히지만, **그 값을 끄면 회원 클래스 편성 기능 전체가 죽으므로 쓸 수 없다.**

### 1-2. 이미 받은 입장 자격으로 계속 쓰는 경로(신규 입장 아님)

| # | 경로 | 위치 | 비고 |
|---|---|---|---|
| C1 | `resolve_participant_actor`(입장 자격 → 참여자) | `session_service.py:2608` | 아래 REST·WS 모두 여기를 지난다. 자격 TTL 24h(`entry_credential_ttl_hours`, `config.py:128`) |
| C2 | REST: `entry-state`, `features/batch`, `ingest-expected`, `eeg-raw/presign·ack`, `biosignal-*`, `report-choice`, `entry/consents`, `entry/livekit-token`, `waitlist/cancel`, raise/lower hand | `session.py` 전반, `resolve_upload_participant`(`session_service.py:3460`) | 헤더 `X-Entry-Credential` |
| C3 | WS: `session-live` join·feature·live-v2 | `ws/session_live_namespace.py:497,724,833,2011,2095` | `entry_credential`을 페이로드로 받음 |
| C4 | 안드로이드 네이티브 업로더 | `FeatureUploader.kt:86`, `ArchiveUploader.kt`, `FeatureReconciler.kt` | 같은 헤더 |
| C5 | `POST /sessions/entry/revoke` | `session.py:261` | 폐기만(차단 무관) |
| C6 | 리포트 이메일 열람 `report-email/view` | `session.py:1182` | 별도 `report_participant` 토큰, 입장과 무관 |

### 1-3. 회원 경로(차단하면 안 됨 — 회귀 확인 대상)

| # | 경로 | 비고 |
|---|---|---|
| M1 | `POST /sessions/enter` + 로그인 토큰(`get_current_user_optional`로 구분) | `_enter_resolved` 회원 분기(`session_service.py:2185~2227`). 클라이언트는 로그인 상태에서 `/join` → `resolve-code` 성공이면 클래스 가입→`/class/{sid}/enter`, 실패(코드가 단일 세션 코드 등)하면 `enter`로 간다 → **`enter`를 통째로 막으면 안 된다** |
| M2 | `POST /sessions/{id}/enter` (초대받은 로그인 회원) | `session.py:599`, 로그인 필수 |
| M3 | `POST /classes/{id}/join`, `resolve-code` | 회원 가입·공개 일정 조회 |

### 1-4. 초대 링크·메일

- 세션 초대 메일(`session_email_invite_service.build_invite_mail`)은 **코드(4자리) 본문 + `/join` 주소**만 싣고, 링크 안에 자격을 담지 않는다(확정). 즉 "초대 링크로 비회원이 바로 입장"하는 별도 경로는 없다 — 결국 A1로 합류한다.
- 메일 본문이 "이름·성별·생년월일·이메일을 적으면 입장해요"(`session_email_invite_service.py:220`)라고 안내하므로 **차단 후 문구가 사실과 어긋난다 → 문구 수정 필요**(발송은 하지 않는다, 코드 수정만).
- 회원 초대 `/{id}/invite`·`invite/email`은 호스트 전용, 비회원 입장과 무관.

### 1-5. 클라이언트 입구

| 위치 | 역할 | 영향 |
|---|---|---|
| `/join` = `pages/class/CodeEntryPage.tsx` | 4자리 코드 → (로그인 클라이언트면 `resolve-code`) → `verifyEntryCode` → 프로필 입력 → `enterByCode` → `/class/{sid}/enter` | 비회원 입구. 안내 화면을 여기에 넣는다 |
| `components/class/flow/member/CodeEntryView.tsx` | 오류 힌트(`error`/`throttled`/`unavailable`) | 새 상태 없음(전용 화면으로 분기) |
| `lib/api/class-flow.ts` (`verifyEntryCode`, `enterByCode`, `entryRequestOptions`) | API 호출. `ENTRY_HEADER='X-Entry-Credential'` | 타입에 필드 추가 |
| `pages/class/EntryPage.tsx` (`/class/:sid/enter`) | 입장 흐름 본체. `GuestSignupPrompt`(비회원 입장 후 가입 권유, "건너뛰고 계속 참여하기") | 차단 후 비회원은 여기 도달하지 않음 |
| `pages/client/guest-class-membership-page.tsx` (`/class-members/:classId`) | B 계열 비회원 가입·복구 화면 | B 차단 시 오류 문구 필요(또는 안내) |
| 안드로이드/iOS 앱 | 같은 SPA 번들을 앱 안에 **내장**(Capacitor, `server.url` 없음). 네이티브 코드는 `X-Entry-Credential` 헤더로 업로드만 함 | 앱 쪽 코드 입구는 따로 없음. 입구 화면=내장 번들 `/join` |

## 2. 운영 현황(읽기 전용, 건수만)

| 항목 | 값 |
|---|---|
| `CLASS_SCHEDULING_ENABLED` | true (B 라우터 열림) |
| 활성 클래스 | 1개(`a0a56e`, 정기형·fixed 일정·코드 있음). 완료 40·취소 8 |
| 예정 회차 | 3개(11/11·11/18·11/25, 전부 위 활성 클래스, 정원 50, group) |
| 비회원 참여 행 | 52행·7개 회차, **전부 `completed` 회차 소속** |
| 비회원 `class_members` / `class_guest_credentials` | 0 / 0 |
| 비회원 `entry_ver>0`(폐기 이력) | 0 |
| 활성 클래스 소속 회원 | 25명 |
| 마이그레이션 헤드(alembic) | `c264e0ec7ed1` |

→ 11/11 회차에 비회원이 들어올 수 있는 건 **활성 클래스 코드 하나**뿐이고, 닫을 대상은 사실상 11/11~11/25 회차다.

## 3. 차단 설계

### 3-1. 스위치

`backend/app/config.py`에 `guest_entry_closed: bool = False`(env `GUEST_ENTRY_CLOSED`). 기본값 false → 코드 배포만으로는 동작이 바뀌지 않는다(안전 배포 후 값만 켠다).

선택 확장(필요할 때만): `guest_entry_closed_mode: str = "entry"`. `entry`=새 입장·재입장만 차단 / `hard`=이미 받은 입장 자격도 거부(§5 비상용).

### 3-2. 서버 거부 응답

- 상태 **403**, `detail={"code":"GUEST_ENTRY_CLOSED","message":"회원가입 후 입장할 수 있어요","msg":…}` — `signup_policy_service.api_error`(`signup_policy_service.py:38`, `RECORDING_CONSENT_REQUIRED`와 같은 형식)를 재사용. 404 아님(코드 시도 제한 `record_failure`가 404에만 건다 → 정상 코드 입력이 실패 횟수로 쌓이지 않음).
- A1: `_enter_resolved`에서 `member_uid is None`이고(호스트·회원 아님) **`_precheck_recording_consent` 호출보다 먼저** 검사. 순서가 바뀌면 녹음 동의 없는 비회원이 `RECORDING_CONSENT_REQUIRED`를 먼저 받아 안내가 가려진다.
- B1~B4: 각 서비스 함수 진입부에서 같은 코드로 거부. B5(refresh)는 기존 자격 유지 정책(§5).
- A2 `verify`: 차단하지 않고 응답에 **`guest_entry_closed: bool`** 필드만 추가(additive). 이유: verify는 `skipAuth`라 회원 여부를 모르고, 로그인 회원이 `resolve-code` 실패 후 verify를 거쳐 입장하는 흐름(M1)이 있어 막으면 회원이 깨진다.
- 한계 주의: `current_user`는 `get_current_user_optional`이 만든다. 유효하지 않은/만료 토큰은 `None`(=비회원 취급)이 되므로, 만료 토큰으로 `/enter`에 온 회원은 비회원 분기에 들어 거부된다 → 클라이언트가 기존 흐름대로 토큰 갱신을 거치므로 영향은 작다(**추정**, verify.md V-회원-3에서 확인).

### 3-3. 전역 vs 11/11 회차만

| 구분 | 안 1: 전역 스위치(환경값) | 안 2: 컷오버 날짜(환경값, 예 `GUEST_ENTRY_CLOSED_FROM_KST=2026-11-11`) | 안 3: 회차 속성(DB 컬럼 `guest_entry_closed`) |
|---|---|---|---|
| 방법 | env 불리언 | env 날짜. 회차 `scheduled_at` ≥ 날짜면 차단 | `sessions`(또는 `classes`) 컬럼 + 마이그레이션 + 호스트 UI/운영 SQL |
| DB 변경 | 없음 | 없음 | **마이그레이션 필요**(prod 스냅샷·헤드 1개 확인) |
| 되돌리기 | 값 변경+재시작(수 초~1분) | 동일 | 컬럼 값 UPDATE(운영 쓰기 승인 건별) |
| 과거 회차 영향 | 없음(과거 회차는 `completed`라 입장 자체가 안 열림, 읽기 경로 미접촉) | 없음 | 없음 |
| 11/11 이후 정책 | 값을 끌 때까지 모든 클래스 차단. **단, 현재 운영의 활성 클래스가 1개뿐**이라 실제 차이 없음 | 11/11 미만 회차는 열림(현재 대상 없음) | 회차별 선택 가능(가장 유연) |
| 새 클래스에서 비회원이 필요한 경우 | 못 받음 → 다시 열려면 값 변경 | 날짜 지나면 계속 닫힘 | 회차별 해결 |
| 구현·검증 비용 | 가장 작음(분기 1+B 4곳, 설정 1) | 작음(날짜 비교 추가) | 큼(모델·마이그레이션·API·UI, dev 마이그레이션 검증) |
| 위험 | 11/11 이후 다른 팀이 비회원 입장을 원하면 별도 결정 필요 | 날짜 경계(KST/UTC) 실수 위험 | 마이그레이션 오류·헤드 충돌, 11/10 밤 마감에 부담 |

**추천: 안 1(전역 스위치)**. 근거: (1) 운영 활성 클래스가 1개·예정 회차가 모두 그 클래스라 안 2/3과 효과가 같고 비용만 다르다, (2) 마이그레이션이 없어 11/10 마감·롤백 요건에 맞는다, (3) 과거 회차는 어떤 안이든 입장 경로가 이미 닫혀 있다. 11/11 이후에 클래스별로 다르게 다뤄야 하면 그때 안 3으로 올린다(스위치 위에 얹는 형태라 되돌릴 일 없음).

## 4. 과거 회차·읽기 경로 회귀 영향

| 대상 | 가드 위치와 무관한가 | 근거 |
|---|---|---|
| 과거 비회원 회차 상세·리포트·업로드 현황 | **무관** | 가드는 `_enter_resolved` 비회원 분기와 B 진입부에만 둔다. 상세·리포트는 호스트/회원 인증 경로이고 `completed` 회차는 코드 입장 자체가 닫혀 있다(`find_enterable_session`이 `completed/cancelled` 제외, `class_code_service.py:28,113`) |
| 이미 입장한 비회원의 `entry-state`·`features/batch`·원시 업로드·WS (`resolve_upload_participant`) | **`entry` 모드에서는 무관**(그대로 동작) | 차단은 "새 입장"만. 입장 자격으로 이어지는 C1~C4는 건드리지 않는다. 진행 중 비회원이 있는 상태에서 스위치를 켜면 그들은 자격 만료(24h)까지 측정·업로드를 계속한다(= 11/10 밤 켜면 11/11 시점 비회원 자격은 이미 만료) |
| 비회원 재입장(복귀) | **차단됨**(A1 입장 요청 자체가 거부) | `entry_credential`이 있어도 `_enter_resolved`가 먼저 거부 → 정원 51행 문제(SDD-282 F4) 재발 경로도 함께 닫힘 |
| 비회원 PII 보관·삭제 스위프 | 무관 | `retention_sweep_service`는 별도 |
| 비회원 리포트 이메일 | 무관 | `report_participant` 토큰 경로 |

## 5. 우회 경로 점검

| 시도 | 결과(설계 후) | 비고 |
|---|---|---|
| 직접 API 호출 `POST /sessions/enter` (코드+이름) | 403 `GUEST_ENTRY_CLOSED` | 서버 검사라 클라이언트 우회 불가 |
| `/classes/{id}/guest-memberships` 직접 호출 | 403 | B1 가드 필요(없으면 이게 **열린 우회로**) |
| 만료되지 않은 기존 입장 자격으로 `/enter` 재호출 | 403(`_enter_resolved`가 자격 이전에 거부) | |
| 만료되지 않은 입장 자격으로 `entry-state`/업로드/WS | **통과**(`entry` 모드) | 11/4 발급분은 TTL 24h로 11/5에 전부 만료 → **11/11엔 해당 없음**. 11/11 중 비상 차단이 필요하면 `hard` 모드(`resolve_participant_actor` 상단에 거부 추가) — 11/11 당일 배포 금지이므로 `hard`는 **미리 코드에 넣어 두고 값으로만 전환**하는 안을 plan에 둔다 |
| 장기 비회원 자격(B) 보유자 `refresh` | 자격 존재 시 통과 | 운영 자격 0건 → 실영향 0. 코드는 `hard`일 때만 거부하도록 둔다 |
| 초대 메일의 `/join` 안내 | 메일은 4자리 코드를 싣지만 입장은 막힘 | 메일 본문 안내문구 수정 필요(§1-4) |
| 구버전 앱(vc46/TF39) | 서버가 막으므로 입장 불가. 화면은 일반 오류(§6) | |
| 호스트 계정으로 코드 입장 | 호스트는 참여자로 입장 불가(`_enter_resolved` 기존 규칙) | 무관 |
| 로그인 회원이지만 role≠client | `use_observation_endpoint` 403(기존) | 무관 |
| `require_invite` 경로 `/sessions/{id}/enter` | 로그인 필수 | 무관 |

## 6. 클라이언트 영향(웹 vs 앱)

- 새 안내는 **웹 번들**에 들어간다. 웹(PC/모바일 브라우저)과 **앞으로 빌드될 앱**에서는 보인다.
- 설치된 앱(vc46 사이트 APK, TestFlight 39)은 번들이 앱 안에 있어 새 화면을 받지 못한다(**확정**: `capacitor.config.ts`에 `server.url` 없음; 과거 조사 `docs/class-session-restructure/조사/R3-프론트영향.md:142` "구 앱은 구 JS로 동작"). 이 앱들은:
  - `verify` 성공 → 개인정보 입력 화면 → `enterByCode` 403 → `CodeEntryPage.submitProfile`이 `classifyCodeError`에서 `error`로 분류 → "**잠시 문제가 생겼어요. 다시 시도해 주세요**"(`CodeEntryPage.tsx` 해당 catch). 멈추지 않고 뒤로 갈 수 있다(**코드 근거**; 실제 앱에서의 확인은 **미확인**).
  - 안내가 부정확하게 보이므로 **운영 공지(행사 전 가입)가 필수**이고, "앱 업데이트 시 안내가 보임"을 정직하게 보고한다. vc47(스토어)·TestFlight 최신이 이 변경 이후 번들을 갖는지는 빌드 시점 의존이라 **미확인**.
- 대안 비교(구버전에도 안내가 보이게 하는 방법은 없다): 서버가 404를 내면 구앱이 "코드를 확인해 주세요"로 오인시킴 → 채택하지 않는다.

## 7. 클라이언트 안내 화면(요약, 상세는 plan)

- 위치: `CodeEntryPage`의 새 step `signup-required`(`MemberFlowFrame`+`FlowCard` 재사용).
- 진입 조건: (1) `verify` 응답 `guest_entry_closed===true` && 비로그인 → 프로필 입력 전 곧바로, (2) `enterByCode`가 403 `GUEST_ENTRY_CLOSED`를 받은 경우(구형 서버/경합 대비).
- 문구 초안: 제목 "회원가입이 필요해요" / 본문 "이 클래스는 회원으로 가입한 뒤 입장할 수 있어요. 가입한 다음 같은 코드로 다시 들어와 주세요" / 버튼 "회원가입"(`/register/client`) · "로그인"(`/login?role=client`) / 보조 "코드 다시 입력". 금지 표현(점수·종합점수·좋음·나쁨·완료·보증·100%)은 쓰지 않으며 테스트로 검사한다.
- 로그인·가입 후 `/join`으로 돌아오는 `next` 처리 지원 여부는 **미확인**(plan T6에서 확인; 미지원이면 "가입 후 같은 코드로 다시 입력" 안내 문구로 충분).

## 8. 11/10 밤 이전 배포 가능성

가능. 근거: DB 마이그레이션 없음, 기본값 false라 배포 자체는 무영향, 스위치 값만 따로 켠다. 남은 위험은 (1) 운영 배포 전 RDS 스냅샷, (2) SSM 파라미터 쓰기와 서비스 재시작 절차(대표 승인 필요), (3) 11/11 당일 배포 금지. 권장 순서는 plan.md.

## 9. 확인하지 못한 것

1. 구버전 앱 실제 화면(코드 근거만; 기기·시뮬레이터 확인 없음).
2. 운영 `/etc/mindbreeze/prod.env` 값 갱신 절차(SSM 파라미터 → `render_env.py` → 재시작)의 정확한 명령·소요(`deploy/server-config.sh:57`까지만 확인, 실행·검증 안 함).
3. 로그인 후 `/join`으로 되돌아오는 `next` 지원 여부.
4. 만료 토큰으로 `/enter`를 호출한 회원이 비회원 분기에 빠지는지의 실측.
5. vc47·TestFlight 최신 빌드가 내장한 번들 시점.
6. B 계열(`guest-memberships` 등)이 앞으로도 쓰이지 않을지(운영 0행이지만 제품 의도는 대표 확인).


## 10. 앱 흐름 전수 확인 — 로그인 화면 버튼 외에 비회원 코드 입장으로 가는 길이 있는가 (11/4 코드 확인)

- 질문: 회원가입 → 로그인 전후로 앱 안에서 **로그인 없이** 코드 입장(`/join`, 비회원 `enterByCode`)으로 갈 수 있는 경로가 버튼 외에 실제로 있는가.
- 방법: `frontend/src` 전체에서 `/join`·`navigate('/…')`·`<Navigate>`·`window.location`·`Link to` grep + `App.tsx` 라우트 표 + 네이티브 설정(`AndroidManifest.xml`, `Info.plist`, `App.entitlements`) 확인.
- **결론: 버튼 외 경로 없음 (네이티브 앱 기준).** 대표 가정을 깨는 경로는 발견되지 않았다.

### 10-1. 화면 흐름별 확인표

| # | 화면/흐름 | 비회원 코드 입장 경로 | 위치(파일:줄) | 근거 |
|---|-----------|----------------------|----------------|------|
| 1 | **설치 직후·앱 첫 화면** | **없음** | `App.tsx:136~139` `EntryRoute` → 네이티브면 `RoleRouter`; `App.tsx:120~122` 비로그인 → `/login` | 네이티브는 랜딩 페이지를 건너뛰고 로그인으로 직행(웹만 `LandingPage`) |
| 2 | **로그인 화면(회원 탭)** | **있음 = 대상 버튼** | `LoginPage.tsx:286~298` `data-testid="login-code-entry"` → `/join`; 표시 조건 `:205` `isClient`(회원 탭, 입력 중 `!typing`) | 이번에 숨길 유일한 입구. 코치/관리자 탭에는 없음(`isClient` 조건) |
| 3 | 회원가입 화면 | 없음 | `register/RegisterClientPage.tsx:568` 로그인 링크만; `RegisterPage.tsx:61,105` `/`·`/login` | `/join` 링크 0건 |
| 4 | 가입 직후 | 없음 | `RegisterClientPage.tsx:259` → `/onboarding/client`(RoleGuard client, `App.tsx:216`); `SignupConfirmPage.tsx:61,63,83,95` → 온보딩/홈/`/login?role=client` | 가입 직후는 로그인 상태 또는 `/login` |
| 5 | 로그아웃 후 | 없음 | `hooks/useAuth.ts:51` `navigate('/')` → 네이티브는 #1과 같이 `/login`; 계정 삭제 `account-deletion.tsx:90` → `/login?role=client` | 웹은 `/`가 랜딩이지만 앱은 로그인 |
| 6 | 세션 만료(401) | 없음 | `lib/api/client.ts:103~115` 역할별 로그인 경로로 `location.href` | `/login` 이동뿐 |
| 7 | 딥링크 | **없음** | `AndroidManifest.xml:22~25` 런처 `MAIN`만(`autoVerify`·`android:scheme` 0건); `Info.plist:53` 스킴은 Google 로그인 용 1개; `App.entitlements` `associated-domains` 0건; 코드에 `appUrlOpen` 0건 | 외부 링크로 `/join`을 여는 설정 없음 |
| 8 | 푸시 알림 탭 | 없음(회원 전용) | `lib/api/notifications.ts:164` → `/class/{sid}/enter`(로그인 회원, `class_invited`) | 비회원은 알림을 받지 않음 |
| 9 | 입장 대기·입장 화면 | 로그인 회원만 | `pages/class/EntryPage.tsx:351` "코드 입력하기"→`/join`, 이 분기는 `isAuthenticated`(초대받은 로그인 회원)일 때만(`:126`, `:333~354`) | 비로그인은 `entry` 없이 도달 못함 |
| 10 | 오류·만료 화면 | 비회원이 **이미 코드 입장한 뒤**에만 | `EntryPage.tsx:294`(대기 취소), `:361`(입장 자격 만료) → `/join`; `lib/class/entry-back.ts:16` 뒤로가기 | 입장 자격(`sessionStorage`, `class-flow.ts:307~331`)이 있어야 도달. 신규 입구가 아님 |
| 11 | 뒤로가기 | 없음 | `EntryPage.tsx:600~606` `resolveEntryBack`: 로그인 회원은 history/`/app`, **비로그인·게스트만 `/join`**(= 이미 `/join`으로 들어온 사람) | 로그인 화면에서 뒤로가기로 `/join`에 가지 않음 |
| 12 | 404·역할 불일치 화면 | 없음 | `NotFoundPage.tsx:16`, `RoleGuard.tsx:49` → `/` → 앱은 `/login`(#1) | 웹에서만 랜딩 |
| 13 | 회원 홈(로그인 후) | 로그인 회원의 코드 입장(**유지**) | `components/client/code-entry-button.tsx:10` (`ClientHomePage`, `member-structure-home-page`, `member-classes-page`), `ClientSessionDetailPage.tsx:170` | 모두 `RoleGuard client` 안. 회원이 `/join`을 쓰는 것이라 비회원 입구 아님 |
| 14 | 장기 비회원 `/class-members/:classId` | 직접 주소만 | `App.tsx:197` (`RoleGuard` 없음); 이 주소로 가는 링크 코드/서버 URL 생성 **0건** | 앱 안에서 이동 수단 없음(주소창 없는 앱). 웹에서 주소를 아는 사람만 |

### 10-2. 이번 범위 밖 (웹 브라우저, 기록만)

| 위치 | 내용 |
|------|------|
| `landing/Nav.tsx:33`, `landing/v6/LandingV6Chrome.tsx:17`, `landing/Hero.tsx:49`(어디서도 import 안 됨), `OrgPublicPage.tsx:257` | 웹 랜딩·기관 페이지의 "코드로 입장" |
| `App.tsx:177` `/join` | 비로그인 접근은 지금도 열려 있음 |
| 서버 메일 `session_email_invite_service.py:206,220`, `class_effect_service.py:214`, `reminder_service.py:140` | 메일 속 `/join` 안내(앱 사용자가 메일 링크를 누르면 브라우저/기본 동작) |
| 직접 API | `POST /sessions/enter` 등 (한계 L1) |

### 10-3. 확인 못 한 것

1. 앱 안에서 외부 링크(메일 속 `/join` 주소)를 누르면 OS가 앱을 여는지: 딥링크 설정이 없어(#7) 브라우저로 열릴 가능성이 높으나 **기기 실측은 안 함**.
2. `/class-members/:classId`를 만드는 서버 쪽 문자열(공유 링크·QR)은 `backend/app` grep 0건. 다른 저장소·운영 콘텐츠에 있는지는 미확인.
3. 이 확인은 코드 정적 분석이다. 앱 실행 화면 캡처는 하지 않았다.

### 10-4. 운영 읽기 조회로 비회원 입장 건수 확인 (L1 모니터링)

- 가능(분석 단계에서 SSM 읽기 전용 SQL 사용, 건수만). 이번 개정에서는 실행하지 않았다.
  - 비회원 입장 건수: `SELECT count(*) FROM session_participants WHERE user_id IS NULL AND joined_at >= '2026-11-05 00:00+09'`
  - 특정 회차는 `session_id` 한정, 장기 비회원은 `class_members(kind='guest')`·`class_guest_credentials` 신규 건수.
