# SDD-286 Plan — 로그인 화면 비회원 코드 입장 버튼 숨김 (개정 3판)

- 상태: Stage ② Plan (대표 승인 전 구현 금지). 근거: `spec.md`, `analysis.md` §10.
- 워커 규칙: 구현=Claude sonnet-5-5, 검증=Gemini(antigravity) 별도 워커. 푸시·배포·메일·운영 쓰기·앱 빌드 금지, 감독이 diff·테스트로 재검증.

## 1. 결정 사항

| # | 결정 | 내용 |
|---|------|------|
| D1 | 방식 | 서버 변경 없이 프론트 화면 플래그 1개 |
| D2 | 플래그 이름 | `VITE_GUEST_ENTRY_ENABLED` / `isGuestEntryEnabled()` (기본 false=숨김) |
| D3 | 범위 | 로그인 화면 버튼 1곳(`LoginPage.tsx:286~298`)만. 다른 입구는 §4 확장 여지 |

## 2. 플래그 주입 방식 (기존 관례 확인 결과)

| 환경 | 관례(코드 확인) | 이번 적용 |
|------|----------------|-----------|
| 플래그 함수 | `lib/feature-flags.ts`: `import.meta.env.VITE_X === 'true'` (`isCounselingEnabled`, `isAiEnabled`, `isArchiveV3Enabled`) | `isGuestEntryEnabled()` 추가, 기본 false |
| 타입 | `src/vite-env.d.ts` `ImportMetaEnv`에 `VITE_LIVE_PROTOCOL_V2?` 선언 | `VITE_GUEST_ENTRY_ENABLED?: string` 추가 |
| dev 빌드 | `deploy-dev.yml:42~45`가 `.env`에 `echo "VITE_…" >> .env` 후 `vite build --mode dev` | `echo "VITE_GUEST_ENTRY_ENABLED=true" >> .env` 추가. `ci-feature.yml:96~97`도 같은 방식이면 동일 추가(테스트 빌드) |
| 로컬 개발 | `npm run dev`는 `frontend/.env`(gitignore, `.env.example`에 안내) | `.env.example`에 `VITE_GUEST_ENTRY_ENABLED=true` 예시 주석 |
| dev 앱 빌드 | `package.json:19,21,23` `cap:ios:dev`·`cap:android:dev`·`android:build:dev`는 `vite build --mode dev` | `.env`가 없으면 꺼지므로 해당 스크립트 앞에 `VITE_GUEST_ENTRY_ENABLED=true` 접두(또는 `.env.dev` 파일 도입). 구현 때 `.env.dev` 방식이 `vite --mode dev`에 자동 적용되므로 **`frontend/.env.dev`(커밋 가능, 공개 값만)** 를 권장 |
| 운영 빌드 | `vite.config.ts:25~36` 운영 분기 `define`이 `VITE_API_BASE_URL`·`VITE_LIVE_PROTOCOL_V2`를 **고정** 주입. `release-build.yml:131~151`, `build:prod`(`package.json:26`)는 이 분기를 탐 | `define`에 `'import.meta.env.VITE_GUEST_ENTRY_ENABLED': JSON.stringify('false')` 추가 → 환경변수로 켤 수 없음 |
| 운영 번들 검사 | `scripts/check-release-bundle.mjs`가 번들 문자열로 dev 흔적·`VITE_LIVE_PROTOCOL_V2:true` 검사 | `VITE_GUEST_ENTRY_ENABLED:"true"`가 번들에 있으면 실패하도록 검사 1줄 추가 |

## 3. 작업 분할 (담당 경로 겹침 없음, 전부 `frontend/`와 워크플로)

**T1. 플래그 함수·타입** — `src/lib/feature-flags.ts`, `src/vite-env.d.ts`
- `isGuestEntryEnabled()` 추가. 단위 테스트(`'true'`만 true).

**T2. 로그인 화면 적용** — `src/pages/LoginPage.tsx`
- `LoginPage.tsx:286~298` 카드 블록을 `isClient && !typing && isGuestEntryEnabled()`로 감싼다(블록 삭제 금지).
- `:253`의 하단 여백 `pb-[calc(8.5rem+env(safe-area-inset-bottom))]`도 `isGuestEntryEnabled()`일 때만 적용(꺼지면 카드가 없으므로 빈 공간 방지).
- 회원 로그인 폼·가입 링크 등은 변경 없음.

**T3. 환경 주입** — `vite.config.ts`, `.github/workflows/deploy-dev.yml`(필요 시 `ci-feature.yml`), `frontend/.env.dev` 또는 `package.json` dev 스크립트, `scripts/check-release-bundle.mjs`, `.env.example`
- §2 표대로. **`release-build.yml`·`deploy-prod.yml`은 건드리지 않는다**(vite 운영 분기 고정이 단일 방어선).

**T4. 테스트(구현자와 다른 워커)** — verify.md 시나리오를 vitest로. 기존 `LoginPage` 관련 테스트가 `login-code-entry`를 기대하면 플래그 on 환경(`vi.stubEnv('VITE_GUEST_ENTRY_ENABLED','true')`)으로 옮기고, off 기본 시 부재를 검사하는 테스트를 추가.

**T5. dev 실측** — 승인 후 dev 배포에서 로그인 화면 카드 표시(플래그 on)를 확인. 운영 번들 숨김은 로컬 `build:prod` 산출물 문자열 검사로 확인(배포 아님).

## 4. 확장 여지 (이번 구현 안 함)

- 같은 플래그로 웹 입구도 숨길 수 있다: `Nav.tsx:33`, `LandingV6Chrome.tsx:17`, `Hero.tsx:49`, `OrgPublicPage.tsx:257`, `/join` 비로그인 접근(`App.tsx:177`). 위치는 `analysis.md` §10-2.
- 서버 스위치(L2)는 아래 폐기 절의 설계 그대로 나중에 추가 가능.

## 5. 위험과 대응

| 위험 | 대응 |
|------|------|
| 운영 빌드에 플래그가 켜진 채 나감 | `vite.config.ts` 운영 분기 `define` 고정 + 번들 검사 스크립트 실패 처리 |
| dev 빌드에서 플래그가 빠져 개발 중인 비회원 기능을 못 봄 | `.env.dev` 또는 워크플로 주입 + dev 실측(T5) |
| 카드 제거 후 하단 빈 공간 | T2에서 여백도 함께 조건화, verify로 390px 화면 확인 |
| 서버 API는 열려 있음 | 한계 L1로 문서화, 읽기 조회로 감시 |

## 6. 후속 SDD-287 스코프 메모 (번호·워크스페이스 발급 안 함)

- 목적: 같은 이름+생년월일+성별+이메일의 기존 참여자가 있으면 새 행을 만들지 않고 **기존 참여자의 연장**으로 처리(dev 개발).
- 재입장 로직 위치: `session_service.py:2229~2262` 부근(`_enter_resolved` 비회원 분기, 입장 자격 헤더 있을 때만 같은 행 복귀 → 자격이 없으면 새 행).
- 동일인 판정은 4개 필드를 정규화(이름 공백·대소문자, 이메일 소문자, 생년월일 형식 통일)해 비교. 이메일은 PII라 해시 비교 또는 기존 컬럼 재사용 검토.
- 정원 계산: 현재 행 수 기준이라 연장이 되면 정원 점유가 사람 수와 일치(SDD-282 F4 해소). 대기열 순번·`left` 상태 복귀 처리 확인 필요.
- 후속 테스트: 기존 `test_sdd209_b5a_entry.py`·`test_sdd062_guest_gender_birth.py` 회귀.

---

# (폐기됨) 서버 스위치안 Plan — 대표 지시 11/4로 채택하지 않음

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
