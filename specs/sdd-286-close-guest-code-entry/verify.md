# SDD-286 Verify — 구현 전 QA 게이트 (개정 3판: 로그인 화면 버튼 숨김)

- 상태: Stage ③ (구현 전 작성. 변경은 말미 "변경 이력"에 추가)
- 대상 플래그: `VITE_GUEST_ENTRY_ENABLED` (운영 빌드는 `vite.config.ts`에서 `false` 고정, dev는 `true`)
- 통과 기준: 모든 항목 통과 + 기존 테스트 회귀 없음.

## A. 버튼 숨김 (운영 설정)

| ID | 시나리오 | 기대 | 방법 |
|----|----------|------|------|
| V-1 | 플래그 off(기본)로 `LoginPage` 회원 탭 렌더 | `data-testid="login-code-entry"` 없음, "로그인 없이 바로 들어가요" 문구 없음 | vitest |
| V-2 | 같은 상태에서 하단 여백 | 카드용 `pb-[calc(8.5rem…)]` 클래스가 적용되지 않음 | vitest |
| V-3 | 코치/관리자 탭 | 변경 전과 동일(원래 카드 없음) | vitest |
| V-4 | `local build:prod` 산출물 번들 문자열 | `VITE_GUEST_ENTRY_ENABLED:"false"` 포함, `"true"` 없음. `check-release-bundle.mjs`가 `"true"` 주입 시 실패하는지도 확인 | 스크립트 실측 |
| V-5 | 환경변수로 운영 빌드에 `VITE_GUEST_ENTRY_ENABLED=true`를 줘도 | 번들은 여전히 `false`(고정) | 스크립트 실측 |
| V-6 | 390px 모바일 뷰포트 로그인 화면 | 카드가 없고 하단 빈 공간 없음, 로그인 버튼·가입 링크 정상 | 실측(브라우저, 운영 모드 빌드 로컬) |

## B. dev 유지

| ID | 시나리오 | 기대 | 방법 |
|----|----------|------|------|
| V-7 | 플래그 on(`vi.stubEnv`)로 회원 탭 렌더 | 카드 표시, 클릭 시 `/join` 이동 | vitest |
| V-8 | dev 모드 빌드 번들 | `VITE_GUEST_ENTRY_ENABLED:"true"` | 스크립트 실측 |
| V-9 | dev 배포 후 로그인 화면(승인 후) | 카드 표시, `/join` 비회원 입장 기존대로 동작 | 실측(dev) |

## C. 회원 정상 (회귀)

| ID | 시나리오 | 기대 | 방법 |
|----|----------|------|------|
| V-10 | 로그인 client가 홈의 `CodeEntryButton`으로 `/join` → 코드 입장 | 정상 입장(플래그 off 상태에서) | vitest(`member-code-entry-button.test.tsx`) + 실측(dev, 플래그 off 빌드 가능 시) |
| V-11 | 회원 이메일 로그인·구글 로그인·가입 링크 | 변경 없음 | vitest(기존 LoginPage 테스트) |
| V-12 | `/join` 직접 접근(플래그 off) | **기존과 동일하게 열림**(이번 범위에서 처리 안 함 → 변경 없음을 고정) | vitest |

## D. 버튼 외 입구 없음 확인 (정적, 구현 후 재실행)

| ID | 시나리오 | 기대 | 방법 |
|----|----------|------|------|
| V-13 | `grep` 네이티브 설정 | `AndroidManifest.xml`에 `autoVerify`·`android:scheme` 없음, `App.entitlements`에 `associated-domains` 없음, 코드에 `appUrlOpen` 없음 | 명령 실행 |
| V-14 | 앱 라우트: 비로그인 `/`(네이티브 모드 mock) | `/login`으로 이동(랜딩 아님) | vitest(`isNativeApp` mock) |
| V-15 | `/join`을 가리키는 `Link/navigate` 목록 | `analysis.md` §10-1 표와 일치(새 입구가 생기지 않았는지) | grep 비교 |

## E. 빌드·회귀

- `tsc -b` 통과.
- vitest 전체: **기준선 실패 23건과 동일**(신규 실패 0). 기준선 목록은 구현 시작 전에 `develop` 현재 상태로 먼저 저장해 비교.
- 생성 CSS에 `LoginPage`가 쓰는 Tailwind 클래스가 정상 포함(카드 제거로 누락 클래스가 없는지 확인).

## F. 알려진 한계 확인(문서)

| ID | 확인 |
|----|------|
| V-16 | 서버 API는 열려 있음(L1)을 문서화했는가 |
| V-17 | 운영 읽기 조회로 비회원 입장 건수 확인 방법(`analysis.md` §10-4)이 있는가 |
| V-18 | 서버 스위치 확장 여지(L2)와 웹 입구 확장 여지(L3)가 기록되었는가 |

## 변경 이력

- 2026-11-04 개정 3판 작성(구현 전). 이전 서버 스위치안 검증표는 아래에 보존.

---

# (폐기됨, 서버 스위치안 Verify — 대표 지시 11/4) 참고용 보존

- 상태: Stage ③ (구현 전 작성, 사후 수정 금지 — 변경은 "변경 이력"에 추가)
- 대상 스위치: `GUEST_ENTRY_CLOSED`(기본 false), `GUEST_ENTRY_CLOSED_MODE`(`entry`|`hard`)
- 범례: 자동=pytest/vitest, 실측=dev에서 브라우저·API 직접, 운영=승인 후 읽기/설정 전환
- 통과 기준: 모든 항목 통과 + 기존 테스트 회귀 없음. 하나라도 실패하면 운영 배포 보류.

## A. 차단 (스위치 on)

| ID | 시나리오 | 기대 | 방법 |
|---|---|---|---|
| V-차단-1 | 비로그인으로 `POST /sessions/enter`(유효 코드·정상 개인정보·녹음 동의 true) | 403, `detail.code=="GUEST_ENTRY_CLOSED"`, 참여 행 0개 생성, 입장 자격 없음 | 자동 |
| V-차단-2 | 같은 요청에서 녹음 동의 **false** | 여전히 `GUEST_ENTRY_CLOSED`(`RECORDING_CONSENT_REQUIRED`가 아님 — 순서 검증) | 자동 |
| V-차단-3 | 존재하지 않는 코드 | 404(기존 그대로, 정보 비노출 유지). 차단 코드가 코드 존재 여부를 노출하지 않음 | 자동 |
| V-차단-4 | `POST /sessions/enter/verify` 유효 코드 | 200 + `guest_entry_closed:true`. 스위치 off면 `false` | 자동 |
| V-차단-5 | 시도 제한: 차단 응답 반복이 `record_failure`(IP 실패 카운트)를 올리지 않음 | 403이므로 404 전용 카운트 불변 | 자동 |
| V-차단-6 | 응답 문구에 금지 표현(점수·종합점수·좋음·나쁨·완료·보증·100%) 없음 | 없음 | 자동 |
| V-차단-7 | B1 `POST /classes/{id}/guest-memberships` | 403 `GUEST_ENTRY_CLOSED`, `class_members` 행 0 증가 | 자동 |
| V-차단-8 | B2 `guest-entry`, B3 `rejoin`, B4 `exchange` | 403 `GUEST_ENTRY_CLOSED`, 입장 자격 발급 0 | 자동 |

## B. 회원 정상 (스위치 on, 회귀 핵심)

| ID | 시나리오 | 기대 | 방법 |
|---|---|---|---|
| V-회원-1 | 로그인 client가 같은 코드로 `POST /sessions/enter`(`{"code":…}`+Authorization) | 200, `is_guest:false`, 입장 자격 발급, 정상 참여 행(`user_id` 있음) | 자동 |
| V-회원-2 | 로그인 client: 정기형 클래스 코드 → `/classes/resolve-code`→`/classes/{id}/join`→`/class/{sid}/enter` 흐름 | 정상(M1·M3) | 자동+실측 |
| V-회원-3 | 만료 직전/만료 access 토큰으로 `/join` 코드 입장 | 토큰 갱신 후 정상 입장. 갱신 실패 시 로그인 유도(비회원 안내로 오인 금지) — 동작을 문서화 | 실측 |
| V-회원-4 | 초대받은 회원 `POST /sessions/{id}/enter` | 정상 | 자동 |
| V-회원-5 | 호스트 계정 코드 입장 | 기존과 동일(호스트는 참여자 행 없이 응답) | 자동 |
| V-회원-6 | 회원이 입장 후 `features/batch`·`ingest-expected`·`eeg-raw/presign`·`biosignal-*`·WS 접속 | 200/정상(`resolve_upload_participant` 불변) | 자동(기존 테스트 `test_sdd209_b5b_ownership` 등) |
| V-회원-7 | 정원 50 이후 회원 입장 → 대기열 정상 | 기존과 동일 | 자동 |

## C. 안내 화면(클라이언트)

| ID | 시나리오 | 기대 | 방법 |
|---|---|---|---|
| V-UI-1 | 비로그인, 유효 코드 4자리 입력 | 개인정보 입력 화면을 거치지 않고 "회원가입이 필요해요" 화면 | vitest + 실측(dev, Chromium 모바일 뷰포트 390px) |
| V-UI-2 | 버튼 "회원가입" → `/register/client`, "로그인" → `/login?role=client`, "코드 다시 입력" → 코드 입력 초기화 | 이동/초기화 정상, 막다른 화면 없음 | vitest + 실측 |
| V-UI-3 | verify 필드가 없는 응답(스위치 off 서버)과 enter가 403 `GUEST_ENTRY_CLOSED`를 반환하는 경합 | 프로필 입력 후에도 같은 안내 화면으로 이동 | vitest |
| V-UI-4 | 스위치 off | 기존 비회원 흐름 완전 동일(개인정보 입력→입장), 안내 화면 미노출 | vitest + 실측 |
| V-UI-5 | 로그인 client가 `/join` | 안내 화면 미노출, 기존 흐름 | vitest |
| V-UI-6 | 화면 문구에 금지 표현 없음, 점수/등급 환원 표현 없음 | 문자열 검사 테스트 통과 | vitest |
| V-UI-7 | 키보드 조작·포커스·읽기 순서(첫 버튼 포커스, Tab 순서) | 정상 | 실측 |
| V-UI-8 | **구버전 번들(현 develop 기준 빌드)** 에서 서버가 403을 줄 때 | 멈추지 않음: "잠시 문제가 생겼어요. 다시 시도해 주세요" 표시, 뒤로/코드 재입력 가능. 안내 화면은 **안 보임이 정상**(번들 내장) | 실측(구 번들 dev 빌드 또는 현 develop 번들) |
| V-UI-9 | 안드로이드 vc46 / TestFlight 39 실제 기기 | 위 V-UI-8과 동일 동작 확인 → **기기 확인은 필요**. 불가하면 "미확인"으로 보고 | 실측(가능 시) |

## D. 우회

| ID | 시나리오 | 기대 | 방법 |
|---|---|---|---|
| V-우회-1 | `X-Entry-Credential`(유효 자격)을 붙여 `POST /sessions/enter` | 403 `GUEST_ENTRY_CLOSED`(자격이 있어도 재입장 불가) | 자동 |
| V-우회-2 | 이름만 다르게 반복 입장 시도 | 전부 403, 참여 행 증가 0 | 자동 |
| V-우회-3 | 유효 자격으로 `entry-state`·`features/batch`(스위치 on, `entry` 모드) | **허용(진행 중 보호)** — 의도 동작임을 테스트로 고정 | 자동 |
| V-우회-4 | 같은 요청, `hard` 모드 | 401/403으로 거부(REST). WS join도 거부 | 자동 |
| V-우회-5 | 초대 메일 `/join` 안내만으로 입장 시도 | 차단. 메일 본문에 "개인정보 입력 후 입장" 문구가 없음 | 자동 |
| V-우회-6 | 임의 `participant_id`만으로(자격 없이) 업로드/WS | 401(기존) | 자동 |
| V-우회-7 | 다른 클래스의 자격으로 이 클래스 접근 | 403(기존) | 자동 |
| V-우회-8 | 장기 비회원 자격(B)로 `refresh` | `entry`: 유지(운영 0건), `hard`: 거부 | 자동 |

## E. 과거 회차·읽기 경로

| ID | 시나리오 | 기대 | 방법 |
|---|---|---|---|
| V-과거-1 | 비회원 참여 행이 있는 completed 회차: 상세(`GET /sessions/{id}`), 참여자 목록, 리포트, 업로드 현황 | 스위치 on/off 동일한 응답 | 자동(비교 테스트) + 실측(dev 시드) |
| V-과거-2 | 완료된 비회원 회차의 리포트 이메일 열람(`report-email/view`) | 불변 | 자동 |
| V-과거-3 | 완료 회차에서 사후 업로드(`allow_completed=True`) — 입장 자격 보유 비회원, `entry` 모드 | 기존과 동일(허용) | 자동 |
| V-과거-4 | 비회원 PII 보관 스위프 dry-run | 불변 | 자동(기존) |
| V-과거-5 | 운영 읽기 전용 조회: 비회원 52행 소속 회차가 전부 completed임을 재확인 | 확인됨(분석 단계에서 1회 확인, 배포 전 재확인) | 운영(읽기) |

## F. 롤백

| ID | 시나리오 | 기대 | 방법 |
|---|---|---|---|
| V-롤백-1 | 스위치 on→off(설정값만 변경, 프로세스 재시작) | 비회원 입장 즉시 이전 동작으로 복귀, 데이터 변경 없음 | 자동(설정 토글) + dev 실측 |
| V-롤백-2 | 코드 배포 후 스위치 off 상태 | 모든 기존 동작·응답 스키마 불변(`guest_entry_closed:false` 외) | 자동(기존 계약/회귀 테스트 전체) |
| V-롤백-3 | 이전 릴리스로 복귀 | 마이그레이션 없음 → 스키마 호환 | 설계 확인 |

## G. 회귀 테스트 묶음(변경 후 필수 실행)

- 백엔드: `tests/test_sdd209_b5a_entry.py`, `test_sdd209_b5b_ownership.py`, `test_sdd209_b4_class_code.py`, `test_sdd209_b6_waitlist_cancel.py`, `test_sdd220_recording_consent.py`, `test_sdd062_guest_gender_birth.py`, `test_sdd015_class_code.py`, `test_member_livekit_token.py`, `test_sdd024_session_live_ws.py`, `tests/contract/test_sessions_response_shapes.py`, class_guest 관련 테스트 전체. 스위치 기본값(off)으로 전부 통과해야 한다.
- 프론트: `class-flow-member-entry*.test.*`, `member-code-entry-button.test.tsx`, `class-flow-member-live`, `fix-guest-app-web-measurement`, 신규 안내 화면 테스트. `tsc -b` 통과, 생성 CSS에 새 클래스(예: 안내 화면에서 쓰는 Tailwind 클래스)가 실제 포함되는지 확인.
- 테스트 날짜: 과거로 흘러가지 않게 `_future_monday_iso()` 패턴.

## H. 운영 배포 후 확인(승인 후)

| ID | 시나리오 | 기대 |
|---|---|---|
| V-운영-1 | 배포 후 스위치 off 상태에서 회원 코드 입장·업로드 정상 | 정상 |
| V-운영-2 | 스위치 on 후, 비로그인 `POST /sessions/enter`(**읽기 전용 실측: 존재하는 코드로 요청하되 참여 행이 생기지 않음을 확인**) | 403 `GUEST_ENTRY_CLOSED`, DB 행 0 증가 |
| V-운영-3 | 스위치 on 후 회원 로그인 입장 | 정상 |
| V-운영-4 | 11/11 회차(`195e4b`)의 비회원 참여 행이 생성되지 않음(건수만 조회) | 0 |
| V-운영-5 | nginx 로그: `/sessions/enter` 응답 코드 분포(403 증가, 5xx 0) | 정상 |

> V-운영-2는 운영 쓰기가 생길 수 있는 요청(정상이면 참여 행 생성)이라, **스위치 on 이후에만** 수행하고 차단 응답이 나오는 경우에 한한다. 스위치가 꺼진 상태로 실행하지 않는다(대표 승인 필요).

## 변경 이력

- 2026-11-04 최초 작성(구현 전).
