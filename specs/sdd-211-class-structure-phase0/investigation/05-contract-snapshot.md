# 조사 05 — 구 계약(`/sessions/*`) 회귀 스냅샷 테스트 (Phase 0 항목 5)

> 범위: 읽기 전용. `app.openapi()` 를 **프로세스 안에서만** 생성했다(앱은 외부 서비스 없이 import 됨 — `DATABASE_URL=sqlite://`, Redis 미연결 시 `[WS] Redis 연결 불가…인메모리` 로그만 출력). 파일은 `/tmp` 에만 썼고 저장소 변경 없음.
> 표기: `파일:줄` 근거, 확인 불가는 `미확인`.

## 0. 핵심 발견

| # | 발견 | 근거 |
|---|---|---|
| **C1** | R7/R2 의 "61" 은 **재현된다.** 단 그 61 은 `/sessions` **프리픽스 라우터 58개 + 경로에 `session_id` 가 들어간 타 라우터 3개(admin 2 · reports 1)** 의 합이다. "`/sessions/*` 라우트" 로 좁히면 **58** (경로 52개 × 메서드). | 아래 §1 |
| C2 | 58개 중 **50개는 `response_model` 지정, 8개는 미지정**. 미지정 8개 중 응답 본문이 JSON dict 인 것이 입장 핵심(`join`, `livekit-token`, `markers`)과 `video/url` 이라 OpenAPI 만으로는 고정되지 않는다. | §2 |
| C3 | 지정된 50개 안에도 **불투명(`type: object`, properties 없음) 필드**가 있다(`record.ai_summary/markers/edit_history/subjective_state`, `eeg-rollup.metrics`, `checkin.subjective_state`, `invite/*.summary`). 필드 내부 키 삭제는 OpenAPI 로 안 잡힌다. | §2 |
| C4 | FastAPI OpenAPI 의 `required` 는 **기본값이 있는 응답 필드를 필수로 표시하지 않는다** — `SessionResponse` 는 32 속성 중 `required` 10개뿐. 따라서 "필수 여부 변화" 규칙만으로는 `waitlist_count`·`chat_enabled` 같은 필드 삭제가 안 잡히고, **속성 존재(properties) 규칙이 1차 방어**다. | `/tmp` 생성본 측정; `app/schemas/session.py:154-196` |
| C5 | 현재 응답 형태를 고정하는 기존 테스트는 사실상 없다(OpenAPI·골든·스냅샷 테스트 0건). 키 집합을 단정하는 곳은 산발 3~4곳. | §3 |
| C6 | OpenAPI 생성은 **결정적**이다(같은 프로세스 2회 + 별 프로세스 2회 동일 해시), 소요 0.35초(import 1.5초 별도). `/sessions` 서브셋(58 op, 참조 스키마 76개) 정렬·들여쓰기 JSON 은 약 **7.5천 줄 / 142KB**. | 측정 |

## 1. 라우트 집계 — 방법과 61 대조

**방법 (재현 가능)**: `backend` 에서 `from app.main import app` → `app.routes` 중 `APIRoute` 이고 `path` 가 `/api/v1` 로 시작하는 것을 순회. (R2 §1 명령 ① 과 동일 방식 — `조사/R2-API서비스.md:24-30`, 데코레이터 grep 은 for 루프 등록·멀티라인을 놓친다고 R2 가 이미 지적.)

| 집계 | 결과 |
|---|---|
| v1 전체 라우트 | **239** (R2 `:11` 과 동일; `dev_auth` 는 환경 조건부 include 라 제외 — `app/api/v1/__init__.py:44-48`) |
| 경로에 `session_id` 또는 `/sessions` 포함 (R2 명령 ②) | **61** = session 44 · video 5 · records 5 · audio 3 · admin 2 · reports 1 · data_exports 1 → R2 `:29-30` 과 정확히 일치 |
| 그중 `/api/v1/sessions` 로 시작 | **58** (OpenAPI 상 경로 52개, 메서드 합 58) |
| 프리픽스 밖 3개 | `POST /api/v1/reports/generate/{session_id}`, `GET /api/v1/admin/sessions/{session_id}/research-consents`, `POST /api/v1/admin/sessions/{session_id}/originals/delete` |

**데코레이터 grep 대조 (정적)**: `app/api/v1/session.py` 의 `@router.<method>` 40개 + `router.add_api_route` for-루프 1곳이 `open·start·end·cancel` 4개를 만든다(`:252-269`) = 44; `video.py` 5, `records.py` 5, `audio.py` 3, `data_exports.py` 1(`:15`, 경로가 `/sessions/{session_id}/participants/{participant_id}/data-exports`) → 44+5+5+3+1 = **58**. 일치.

모듈별 `/sessions` 프리픽스 라우터: `session.py:69`(prefix `/sessions`), `records.py:20`, `audio.py:16`, `video.py:23` 모두 `APIRouter(prefix="/sessions")`. `data_exports.py` 는 프리픽스 없이 전체 경로로 선언.

**권고(범위 정의)**: 계약 고정 대상은 R7 과 같은 **61개**로 한다 — 선택 규칙 "경로에 `/sessions` 또는 `{session_id}` 포함" 을 코드로 고정하고, 라우트 목록 자체(메서드+경로+성공 상태코드)를 골든으로 삼아 **삭제·이름변경이 즉시 실패**하게 한다. 단 admin 2·reports 1 은 구 모바일 앱이 아니라 웹 관리/호스트 화면이 호출한다(호출자 확인은 `미확인`) → 구 앱 번들 호환 관점의 핵심은 58개, 3개는 "동결 대상 포함, 완화 시 사유 기록"으로 둔다.

## 2. 응답 모델 현황

### 2.1 `response_model` 미지정 8개 (모두 `/sessions` 프리픽스)
| 엔드포인트 | 위치 | 응답 | 고정 방법 |
|---|---|---|---|
| `POST /sessions/entry/revoke` | `session.py:165` (204) | 본문 없음 | 상태코드만 |
| `DELETE /sessions/{id}` | session.py (204) | 본문 없음 | 상태코드만 |
| `POST /sessions/{id}/join` | `session.py:714-726` → `session_service.py:1700-1719` | **dict** = `_serialize(s)` + `livekit_token` (SessionResponse 와 유사하나 모델 아님) | **골든 응답(b) 필수** — 입장 핵심 |
| `POST /sessions/{id}/livekit-token` | `session.py:690-711` | dict `{livekit_token, webrtc_room_id}` | 골든 응답(b) |
| `POST /sessions/{id}/markers` | `session.py:581-` → `session_service.add_marker` | dict `{markers: [...]}` (`session_service.py:1619`) | 골든 응답(b) |
| `GET /sessions/{id}/video/url` | `video.py:64-86` | dict `{url: ...}` | 골든 응답(b) |
| `GET /sessions/{id}/video/stream` | `video.py:95-115` | `FileResponse` (바이너리) | 상태코드·content-type 만 |
| `GET /sessions/{id}/report-email/view` | `session.py:743-` | `HTMLResponse` | 상태코드·content-type 만 |

### 2.2 지정되었으나 불투명 필드가 있는 응답
`checkin`(`subjective_state`), `eeg-rollup`(`buckets[].metrics`, `overall.metrics`), `invite/email`(GET·POST)·`invite/remind`(`summary`), `record`(GET·PUT: `ai_summary`, `edit_history`, `markers`, `subjective_state`). → 골든 응답(b) 에서 **대표 데이터로 내부 키까지** 기록한다.

### 2.3 나머지 42개 이상은 Pydantic 모델이 응답을 명시
핵심 모델 `SessionResponse` 32 속성(`app/schemas/session.py:154-196`) — 대부분 transition(`open/start/end/cancel`)·`duplicate`·`new-run`·`save-as-template`·`invite`·`participants` 삭제 응답에 재사용. `model_config = {"from_attributes": True}` 이며 `extra` 설정 없음(응답 필터링은 response_model 이 담당 → **모델에 필드가 추가되면 응답에 자동으로 나간다** = "가산" 시나리오가 곧 이 경로). `response_model_exclude_*` 사용 0건(`session.py`·`records.py`·`audio.py`·`video.py` grep 무) → None 필드도 `null` 로 나가 키 집합이 데이터와 무관하게 결정적이다.

## 3. 기존 테스트 현황
- `/sessions` 를 호출하는 테스트 파일 77개(`grep -rlE "/sessions" tests`), 160개 중. 하지만 **응답 전체 형태를 고정하지 않고** 필요한 필드만 단정한다.
- OpenAPI·골든·스냅샷·`contract` 디렉터리/파일: **없음**(`grep -rnE "openapi|golden|snapshot" tests/*.py` 중 `/sessions` 응답과 관련된 것 0건; `snapshot` 은 WS join 스냅샷 이야기).
- 키 집합 단정 사례(산발): `tests/test_sdd209_b5a_entry.py:58` (`enter/verify` 응답 키 = `{title, scheduled_at, host_name}` — **비노출 목적**, 이 키 집합이 늘면 오히려 **실패**한다는 점 주의: 아래 §5.3), `tests/test_mb2_low_fixes_4th.py:643`, `tests/test_org_public.py:210`.
- 테스트 DB 는 SQLite `create_all` 이라 API 테스트는 빠르다(예: `tests/test_sdd209_b5a_entry.py` 15개 = 2.53초, 측정).

> §5.3 의 함의: **`enter/verify` 는 "추가 금지"가 요구사항**(개인정보 비노출)이라, 계약 스냅샷의 "가산 허용" 규칙에서 **예외(봉인 응답)** 로 분류해야 한다. 그렇지 않으면 스냅샷은 통과시키고 기존 테스트는 막는 상충이 생긴다.

## 4. 접근 비교

| 항목 | (a) OpenAPI 서브셋 골든 | (b) TestClient 골든 응답(형태) | (c) 둘 다 |
|---|---|---|---|
| 잡는 것 | 라우트 삭제·이름변경, 모델 필드 삭제/타입/nullable 변화, 요청 파라미터·본문 필수화 | **실제 응답 키/타입**: 미지정 8개 dict, 불투명 필드 내부, 기본값 필드 존재 | 둘의 합집합 |
| 못 잡는 것 | 미지정 8개, 불투명 필드 내부, 서비스가 모델 밖으로 새로 넣는/빼는 값(예: `join` dict) | 호출하지 않은 엔드포인트, 엣지 분기(에러 응답) | — |
| 결정성 | 높음(측정 C6) | 값이 아니라 **형태(키+타입 태그)** 만 저장하면 UUID·시각·토큰 비결정성 제거 | |
| 생성 비용 | 낮음(`app.openapi()` 0.35초, 코드 몇십 줄) | 중간(시나리오 14~18개 작성·유지, 기존 헬퍼 재사용 가능) | |
| 유지 비용 | 낮음(자동 재생성) | 중간(시나리오가 도메인 변경에 영향) | |
| 오탐 | 스키마 이름 변경(`SessionResponse-Output` 등)에 민감 → `$ref` 를 인라인 해소해 비교 | 시나리오 데이터에 따라 `null`/값 존재 변동 → 형태 합집합·null 허용 규칙 | |

**권고: (c) 둘 다, 단 (a) 를 주 방어선·(b) 를 보강선으로 역할 분리.** 이유: (a) 만으로는 입장 핵심 `join`/`livekit-token`(구 앱이 반드시 호출)과 불투명 필드가 뚫리고(C2·C3), (b) 만으로는 호출하지 않은 54여 개 변이를 못 본다. 총 비용은 작다(테스트 약 30개, 실행 수 초).

## 5. 구체 설계

### 5.1 파일 배치
```
backend/tests/contract/
  __init__.py
  conftest.py                      # (선택) 계약 전용 픽스처
  compat.py                        # 순수 함수: OpenAPI 서브셋 추출·ref 인라인·가산 호환 비교
  shape.py                         # 순수 함수: JSON → 형태 트리, 형태 호환 비교
  golden/
    sessions_openapi.json          # 61 op 서브셋 + 참조 스키마 76개(정렬·indent=1, ~7.5천 줄)
    sessions_shapes.json           # 시나리오별 형태 트리
    breaking_exemptions.json       # 의도적 파괴 허용 목록(기본 비어 있음)
  test_sessions_openapi_contract.py
  test_sessions_response_shapes.py
  test_contract_compat_rules.py    # 비교기 자체 단위 테스트(합성 스펙 입력)
  README.md 는 만들지 않는다(규칙은 이 파일들의 docstring + spec/plan 에 기재)
```
`pytest` 는 기존 `ci-feature.yml:88-94` 가 `backend/` 에서 `pytest -q` 로 전체를 돌리므로 **CI 변경 없이** 자동 실행된다(`--ignore` 대상 아님).

### 5.2 (a) OpenAPI 서브셋 골든
- **추출**: `app.openapi()` 중 (경로에 `/sessions` 포함 또는 `{session_id}` 포함) 라우트 61개 → 참조 스키마만 모아 서브셋 구성 → `json.dumps(sort_keys=True, indent=1, ensure_ascii=False)`. 앱 생성은 `conftest.py` 의 SQLite·fakeredis 오버라이드 이용(실서비스 불필요, 측정으로 확인). `ENVIRONMENT` 기본 `production` 이라 `dev_auth` 가 빠지는 것도 골든에 영향 없음(`/sessions` 밖).
- **비교 단위**: `$ref` 를 인라인 해소한 뒤 (메서드, 경로) 키로 응답/요청 스키마를 재귀 비교(스키마 이름 변경 무시).
- **가산 전용 호환 규칙** (골든 = 구 계약, 현재 = 신):

| 대상 | 실패(파괴) | 통과(가산) |
|---|---|---|
| 라우트 | 메서드+경로 삭제·이름변경, 성공 상태코드 변경 | 새 라우트 추가 |
| 응답 속성 | 속성 삭제/이름변경, `type`/`format` 변경, 배열 `items` 타입 변경, `nullable`(anyOf null) 비널→널 허용으로 확대, 골든의 `required` 였던 속성이 비필수로 | **새 속성 추가**(필수든 선택이든 응답에서는 안전), 널허용→비널 축소 |
| 응답 enum | 값 삭제; **값 추가도 기본 실패**(구 앱이 `switch(status)` 하는 경우 — 예: `SessionStatus`·`SessionType`) → `breaking_exemptions.json` 에 사유 기록 시 통과 | — |
| 요청 파라미터/본문 | 속성 삭제, 타입 변경, 선택→필수, **새 필수 속성/파라미터**, enum 값 삭제 | 새 **선택** 속성/파라미터, enum 값 추가 |
| 불투명 객체 | (b)로 위임 | — |

- **`breaking_exemptions.json`**: `{ "id", "op": "POST /sessions/{session_id}/join", "path": "responses.200.properties.x", "change": "removed", "sdd": "SDD-2xx", "reason": "…", "expires_phase": 8 }` — 파일을 수정해야만 파괴 변경이 통과하고, 그 diff 는 리뷰 대상이 된다(§5.5). 기본은 빈 배열.
- **골든 최신성**: 통과 시 "골든에 없는 신규 속성" 개수를 `warnings` 로 출력만 한다(실패 아님). 신규 속성은 **구 앱이 모르는 필드**이므로 고정할 의무가 없다. 다만 Phase 종료 시점(verify 게이트)에 골든을 재생성해 새 필드까지 고정하는 것을 완료 기준에 넣는다.

### 5.3 (b) 응답 형태 골든
- **저장 대상은 값이 아니라 형태**: JSON → 트리 `{"id": "uuid", "created_at": "datetime", "waitlist_count": "int", "participants": [{"…"}], "invite_result": "null|object{…}"}`. 문자열은 정규식으로 `uuid`/`datetime`/`url`/`str` 태그. → UUID·시각·토큰의 비결정성이 원천 제거되어 `freezegun`·고정 시드가 불필요.
- **배열**: 원소 형태의 합집합(키 합집합, 일부에만 있으면 `optional`). **null**: 시나리오에서 null 이면 `null` 로 기록하고 비교 시 "골든이 null 이면 타입 검사는 건너뛰고 키 존재만 검사".
- **호환 규칙**: 골든의 모든 키가 현재 응답에 존재해야 하고 타입 태그가 같아야 한다(골든이 null 인 키 예외). 추가 키는 통과. **봉인 응답 예외**: `POST /sessions/enter/verify` 는 `strict_keys: true` 로 두어 키 집합이 정확히 `{title, scheduled_at, host_name}` 일 것을 요구한다(개인정보 비노출, `tests/test_sdd209_b5a_entry.py:58` 와 같은 요구).
- **시나리오 목록(안, 약 16개)** — 기존 헬퍼 재사용: `tests/test_sdd015_class_code.py` 의 `_register`·`_create_class`·`_open_class`(이미 여러 테스트가 import: `tests/test_sdd209_b5a_entry.py:13`), `tests/entry_helpers.py` 의 `enter_guest`/`enter_member`, `tests/conftest.py` 의 `EntryAwareClient`(자격 자동 첨부).
  1. `POST /sessions`(201) 2. `GET /sessions` 3. `GET /sessions/{id}` 4. `PUT /sessions/{id}` 5. `POST …/open` 6. `POST …/start` 7. `POST …/end`(전이 응답 `SessionResponse`) 8. `POST /sessions/enter/verify`(봉인) 9. `POST /sessions/enter`(비회원) 10. `GET …/entry-state` 11. **`POST …/join`(미지정 dict)** 12. **`POST …/livekit-token`(미지정 dict)** — 토큰 생성이 LiveKit 키 없이 동작하는지 `미확인`(없으면 `generate_livekit_token` 몽키패치) 13. **`POST …/markers`** 14. `GET/PUT …/record`(불투명 내부 키) 15. `GET …/report-status` + `GET …/report-choice/summary` 16. `GET …/eeg-rollup`·`POST …/checkin`·`POST …/invite/email`(불투명 `summary`) 17. `GET …/video/url`.
  - 에러 응답(401/403/404/409/422) 본문 형태(`{"detail": …}`)는 시나리오 2~3개만(구 앱이 `detail` 문자열을 UI 에 노출할 수 있음 — 표시 여부는 프론트/앱 코드 확인 `미확인`).
- **재현성**: 시나리오는 테스트 함수마다 `client` 픽스처(인메모리 SQLite, 함수 스코프)로 독립 실행. 순서 의존 없음.

### 5.4 골든 생성 방법
- `UPDATE_CONTRACT_GOLDEN=1 pytest backend/tests/contract` 로만 `golden/*.json` 을 쓴다. `CI=true` 이면 쓰기를 거부(CI 가 골든을 조용히 덮어쓰는 사고 방지). 쓰기 후 사람이 `git diff` 를 보고 커밋한다.
- **최초 골든은 Phase 0 구현 시점의 현행 동작**을 그대로 박제한다(수정·정리 금지 — 버그도 계약).

### 5.5 의도적 갱신(리뷰) 규칙
1. **가산 변경**: 테스트는 통과. 골든 재생성은 Phase 종료 시점에만(선택, 완료 기준). PR 에 골든 diff 가 있다면 **추가 줄만** 있어야 한다.
2. **파괴 변경**: 테스트 실패 → ① 변경을 되돌리거나 ② `breaking_exemptions.json` 에 항목 추가(SDD 번호·사유·expires_phase) + 골든 갱신. 두 파일 diff 가 PR 에 함께 있어야 하며 리뷰어는 `legacy 호출 0 수렴(D-61, M5)` 확인 전에는 승인하지 않는다(`기획.md:582`).
3. **계약 파일 변경 알림**: 가능하면 CODEOWNERS 로 `backend/tests/contract/golden/**` 를 Brian/백엔드 리드 리뷰 필수로 지정(저장소 CODEOWNERS 존재 여부 `미확인`).
4. 골든을 재생성하는 모든 PR 은 verify.md 의 "구 계약 스냅샷" 항목(기획 §13 `:631`)에 체크.

### 5.6 이 설계가 막는 구체 사고 (기획 위험과의 연결)
- X7/X1: Phase 3~6 에서 `SessionResponse` 에 클래스 필드를 **추가**하는 것은 통과, 기존 필드(`type`, `host_id`, `access_code` 등) 제거·널허용 확대·타입 변경은 실패.
- M6 contract(Phase 8): 레거시 정리는 `breaking_exemptions.json` 항목으로만 가능 → 계약 파기가 코드 리뷰에서 반드시 보인다.

## 6. 테스트 개수 및 비용 추정
| 파일 | 테스트 수(추정) | 내용 |
|---|---|---|
| `test_sessions_openapi_contract.py` | 5 | ① 61 op 집합 일치(삭제·이름변경 실패) ② 골든 대비 가산 전용 호환 ③ 모든 응답 enum 비교 ④ 요청 필수화 금지 ⑤ 예외 파일 형식·만료 검증 |
| `test_contract_compat_rules.py` | 12 | 합성 스펙으로 규칙표 각 행(삭제/이름변경/타입/널/필수/enum/요청 필수화/새 선택 통과) 검증 + 비교기 오탐 방지 |
| `test_sessions_response_shapes.py` | 17 | 위 시나리오 17개 (1 시나리오 = 1 테스트) + 형태 비교기 |
| **합계** | **약 34** | |
- 실행 시간: OpenAPI 생성 0.35초 + 앱 import 1.5초(측정), API 테스트는 측정치 0.17초/개(`test_sdd209_b5a_entry.py` 15개 2.53초) → 신규 17개 약 3초, 전체 **약 5~8초 추정**(CI 러너 값 `미확인`).
- 코드량 추정: `compat.py` ~150줄, `shape.py` ~80줄, 테스트 ~400줄. 규모 **M** (S 아님: 시나리오 17개 작성이 대부분).

## 7. 위험·한계
1. **골든이 곧 현행 버그를 박제**한다 — 의도된 설계(구 앱이 의존할 수 있음).
2. Pydantic/FastAPI 버전 올림 시 OpenAPI 출력 형식 변동 가능 → `requirements.txt` 가 모든 핵심 버전을 고정(`fastapi==0.136.1`, `pydantic==2.13.4`)하므로 업그레이드 PR 에서만 골든 diff 발생. 업그레이드 시 비교는 `$ref` 인라인 후 의미 비교라 이름 변동에는 강하다.
3. 미지정 dict 응답(`join` 등)은 (b) 시나리오가 있어야만 보호된다 — 신규 구 계약 엔드포인트가 추가되면 시나리오 누락 위험 → (a) 의 "라우트 집합 61" 테스트가 신규 라우트를 가산으로 통과시키므로, **모델 미지정 라우트가 생기면 경고**하는 규칙(미지정 목록을 골든화: 현재 8개)을 추가 권고.
4. 에러 경로·WS 이벤트 페이로드(`session_live_namespace.py`)는 이 스냅샷 범위 밖 — 별도(WS 룸 이름 불변은 기획 `:420`).
5. 구 앱 번들 자체의 호출 목록은 이번에 조사하지 않았다(프론트/모바일 코드 대조 `미확인`) — 61 중 실제 호출되는 것의 부분집합을 알면 시나리오 우선순위를 정할 수 있다.

## 8. Task 후보 (plan 이 확정)
| 후보 | 내용 | 규모 |
|---|---|---|
| T-a | `compat.py`/`shape.py` + 비교기 단위 테스트 12개 | S |
| T-b | OpenAPI 골든 생성 + 계약 테스트 5개 + 갱신 스위치(`UPDATE_CONTRACT_GOLDEN`, CI 거부) | S |
| T-c | 응답 형태 시나리오 17개 + 골든 | M |
| T-d | 예외 파일 규칙·리뷰 규칙 문서화(spec/plan 본문), (가능하면) CODEOWNERS | S |

## 9. 확인하지 못한 것 (`미확인` 요약)
1. 구 모바일 앱 번들이 실제 호출하는 `/sessions/*` 부분집합.
2. admin 2·reports 1 의 호출자.
3. `POST /sessions/{id}/livekit-token` 테스트 환경 동작(LiveKit 키 없이 토큰 생성 가능 여부).
4. CODEOWNERS·브랜치 보호 설정 존재 여부.
5. CI 러너에서의 실제 실행 시간.
6. 에러 응답 본문을 앱이 표시하는지.
