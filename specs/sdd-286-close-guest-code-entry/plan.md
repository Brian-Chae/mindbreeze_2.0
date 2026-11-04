# SDD-286 Plan — 비회원 코드 입장 차단 (스위치형)

- 상태: Stage ② Plan (초안, 대표 승인 전 구현 금지)
- 근거: `analysis.md` (경로 지도·비교·추천). 이 문서는 추천안(전역 스위치, 새 입장만 차단)을 기준으로 한다.
- 기한: 11/10(화) 밤까지 운영 배포 가능 상태. 11/11 당일 배포 금지.
- 워커 규칙: 구현=Claude sonnet-5-5, 검증·리뷰=Gemini(antigravity) 별도 워커. 푸시·배포·메일·운영 쓰기 금지, 감독이 diff·테스트로 재검증.

## 1. 결정 사항(대표 확인 필요)

| # | 결정 | 추천 | 기본(미응답 시) |
|---|---|---|---|
| D1 | 차단 범위 | 전역 스위치(env). 11/11 이후 클래스별 구분이 필요해지면 회차 속성으로 확장 | 추천안 |
| D2 | B 계열(장기 비회원 자격 `/classes/{id}/guest-*`)도 닫을지 | 닫는다(운영 사용 0건, 열려 있으면 우회로) | 추천안 |
| D3 | `hard` 모드(이미 받은 입장 자격도 거부)를 코드에 미리 넣을지 | 넣는다(기본 `entry`). 행사 당일 배포 금지이므로 비상 대응을 값 전환으로만 가능하게 | 추천안 |
| D4 | 비회원 입장 재개 시점·조건 | 대표 별도 결정(스위치 off) | — |
| D5 | 초대 메일 본문의 "이름·성별·생년월일 입력하면 입장" 문구 수정 | 수정(발송은 별도 승인) | 추천안 |

## 2. 작업 분할(T1~T8)

각 작업은 **담당 경로가 겹치지 않는다**. T1~T3은 백엔드, T4~T6은 프론트, 둘은 병렬 가능(계약: 403 `detail.code=="GUEST_ENTRY_CLOSED"`, verify 응답 `guest_entry_closed: boolean`).

### 백엔드 (담당 경로: `backend/app/**`, `backend/tests/**`)

**T1. 설정·가드 헬퍼** — `backend/app/config.py`, `backend/app/services/guest_entry_guard.py`(신규)
- `guest_entry_closed: bool = False`, `guest_entry_closed_mode: Literal["entry","hard"] = "entry"`. `.env.example`/`deploy/env-manifest.tsv`에 `GUEST_ENTRY_CLOSED`(ssm, required 0)·`GUEST_ENTRY_CLOSED_MODE`(필요 시) 추가.
- `assert_guest_entry_open()`: 닫혀 있으면 `signup_policy_service.api_error(403, "GUEST_ENTRY_CLOSED", "회원가입 후 입장할 수 있어요")`. `is_guest_entry_closed()`는 verify 응답용.
- 완료 기준: 단위 테스트(켜짐/꺼짐/모드).

**T2. A1·A2 적용** — `backend/app/services/session_service.py`, `backend/app/schemas/session.py`
- `_enter_resolved`: 호스트 분기·회원 분기를 지난 뒤 비회원 분기 첫 줄(`session_service.py:2240` 부근, "비회원: 개인정보 필수" 앞)에서 `assert_guest_entry_open()`. **녹음 동의 사전 검사(`_precheck_recording_consent`, 호스트 제외 일반 경로)보다 먼저** 나오도록 `member_uid is None and not 호스트` 조건으로 함수 초반에 둔다(순서 때문에 `RECORDING_CONSENT_REQUIRED`가 안내를 가리면 안 됨).
- 반드시 유지: 회원(`member_uid` 있음) 경로·호스트 경로·`enter_session_as_invited` 불변.
- `verify_entry_code` 응답에 `guest_entry_closed: bool` 추가(`EnterVerifyResponse`에 선택 필드, additive).
- 계약 골든 `tests/contract/golden/sessions_openapi.json` 갱신 필요 여부 확인(필드 추가이므로 갱신 가능성 큼).

**T3. B 계열 적용** — `backend/app/services/class_guest_service.py`
- `join_guest`, `guest_entry`, `rejoin_guest`, `exchange_recovery` 진입부에 가드(`guest_entry`는 입장 자격을 재발급하므로 필수). `refresh_guest`·`logout_guest`·읽기용 인증은 `hard` 모드에서만 거부.
- 이미 쓰는 오류 형식(`_error(code,status)`→`detail={'code':...}`)과 맞춘다.
- 선택(D3): `hard` 모드에서 `session_service.resolve_participant_actor`의 비회원 자격 경로(`entry_credential` 분기)를 거부. 회원 경로 불변. WS(`resolve_live_join`, `resolve_live_actor`)는 모두 이 함수를 지나므로 한 곳에서 처리됨을 테스트로 확인.

### 프론트 (담당 경로: `frontend/src/**`, `frontend/tests/**`)

**T4. API 타입** — `frontend/src/lib/api/class-flow.ts`, `frontend/src/lib/class/flow/member-entry.ts`
- `EntryVerifyResult.guest_entry_closed?: boolean`. `isGuestEntryClosed(error)`(status 403 + `apiErrorCode==='GUEST_ENTRY_CLOSED'`, `recording-consent.ts`의 `isRecordingConsentRequired`와 같은 형태). `classifyCodeError`는 그대로.

**T5. 안내 화면** — `frontend/src/components/class/flow/member/SignupRequiredView.tsx`(신규), `frontend/src/pages/class/CodeEntryPage.tsx`
- 새 step `signup-required`. 진입 조건: (1) `verifyEntryCode` 결과 `guest_entry_closed===true` && 비로그인(`!isAuthenticated`), (2) `enterByCode` catch에서 `isGuestEntryClosed(error)`.
- 로그인한 `role≠client` 사용자나 로그인 클라이언트는 이 화면에 오지 않는다(기존 흐름 유지).
- 화면: 제목 "회원가입이 필요해요", 본문 안내, 버튼 "회원가입"(→`/register/client`), "로그인"(→`/login?role=client`), 텍스트 버튼 "코드 다시 입력"(→ step `code`로 복귀·상태 초기화). 접근성: `role="alert"` 아님(정보), 첫 버튼에 포커스, `data-testid="signup-required"`.
- 금지 표현 검사 테스트 포함.
- 복귀 흐름(`next`): `/register/client`, `/login`의 `next` 파라미터 지원 여부를 먼저 확인한다. 지원하면 `next=/join`을 붙이고, 아니면 문구("가입한 다음 같은 코드로 다시 들어와 주세요")만 둔다.

**T6. 기타 문구** — `frontend/src/pages/class/EntryPage.tsx`(변경 최소), `frontend/src/pages/client/guest-class-membership-page.tsx`, 백엔드 `session_email_invite_service.py:build_invite_mail`
- 비회원 가입 화면(B 계열): 403 `GUEST_ENTRY_CLOSED` 시 `/register/client` 안내.
- 초대 메일 본문: 비회원 입력 안내 문구를 "회원 가입 후 입장 코드를 입력해요"로 수정(D5; 발송은 하지 않음, 메일 템플릿 테스트만).
- `GuestSignupPrompt`("건너뛰고 계속 참여하기")는 스위치 on에서는 비회원이 입장하지 못하므로 도달하지 않는다. 삭제하지 않는다(스위치 off 롤백 시 필요).

### 검증·릴리스

**T7. 테스트 작성(구현자와 다른 워커)** — verify.md 시나리오를 pytest·vitest로 옮긴다. 기존 `tests/test_sdd209_b5a_entry.py` 등 `enter_guest` 헬퍼를 쓰는 테스트는 **스위치 off(기본)로 그대로 통과**해야 한다. 스위치 on 전용 테스트는 `monkeypatch.setattr(settings, "guest_entry_closed", True)`. 테스트 날짜는 `_future_monday_iso()` 패턴으로 과거가 되지 않게 한다.

**T8. dev 배포 검증** — 승인 후 dev(develop 병합)에서 verify.md 시나리오를 브라우저·API로 실측.

## 3. 배포·롤백 계획 (대표 승인 후 단계별)

| 단계 | 내용 | 시점 | 롤백 |
|---|---|---|---|
| 0 | RDS 스냅샷(운영) | 배포 직전 | — |
| 1 | PR 병합→dev 배포 → verify.md 전 항목 | 11/5~11/8 | 이전 릴리스로 복귀 |
| 2 | 운영 배포(코드만, 스위치 off). 동작 불변 확인: 회원 입장·업로드 | 11/9~11/10 | 이전 릴리스 symlink 복귀 |
| 3 | 스위치 on: `GUEST_ENTRY_CLOSED=true` (SSM 파라미터 → prod.env 렌더 → 백엔드 재시작; 절차는 `deploy/server-config.sh` 기준, **정확한 명령은 구현 때 확인**) | 11/10 밤 | 값을 false로 되돌리고 재시작 |
| 4 | 11/11 행사: 코드 변경 없음. 필요 시 값 전환만 | 11/11 | 동일 |

- 스위치 on 시점 권장: 11/10 밤(11/4 입장 자격은 24h TTL로 이미 만료, 진행 중 비회원 0).
- **11/11 당일 배포 금지 준수.** `hard` 모드와 롤백 값 전환은 배포가 아니라 설정 변경이다(수 초, 대표 승인 하에).
- 운영 사전 공지(앱 구버전 사용자 대응): 앱 안내 화면은 신규 번들에서만 보인다 → 행사 전 "회원가입 후 입장" 안내를 별도로 낸다(본 SDD 범위 밖, 대표 결정).

## 4. 위험과 대응

| 위험 | 대응 |
|---|---|
| 로그인 회원이 만료 토큰 때문에 비회원 분기로 떨어져 차단됨 | 클라이언트 `apiClient`가 갱신 후 재시도하는지 확인(verify V-회원-3). 실패 시 가드를 "토큰 헤더가 아예 있으면 401로 재로그인 유도"로 보정 |
| `verify` 가 로그인 여부를 모름 → 로그인 회원에게 안내가 먼저 뜸 | 프론트 조건에 `!isAuthenticated` 포함. 서버는 verify를 막지 않음 |
| 구버전 앱에서 일반 오류만 보임 | 설계 한계(analysis §6). 공지로 대응, 앱 재빌드는 대표 결정 |
| B 계열 비의도 폐쇄 | 운영 사용 0건 확인됨(§2). 스위치 off로 즉시 복구 |
| OpenAPI 골든 불일치 | T2에서 골든 갱신 + 계약 테스트 실행 |
| 기본 off 로 배포해 놓고 스위치 on을 잊음 | 11/10 체크리스트에 "스위치 on 후 비회원 입장 403 실측"을 둔다(verify V-운영) |

## 5. 산출 확인

- 문서 4종: spec.md(있음), analysis.md, plan.md, verify.md. 구현 후 summary.md.
- 커밋 태그: `feat(sdd-286):`.
