# SDD-211 — 클래스·세션 재설계 Phase 0 (선행 정리: 용어 사전 · 호스트 판정 단일화 · 역할 가드 · PG 마이그레이션 스모크 · 구 계약 스냅샷 · 승인 전 리포트 노출 검증 · M0 사전 조회 설계)

> 2026-10-18 · 작성: Claude (Stage ①②③ 문서 전용) · 코드·DB·서버 변경 없음 · 입력: `brief.md`, `docs/class-session-restructure/{기획,영향도,결정-필요}.md`, 조사 R2·R6·R7·R8·R9·R10, `investigation/01~07`
> 정본: **plan.md**(Task·근거 `파일:줄`) · **verify.md**(구현 전 QA 게이트). 판단 근거는 `investigation/` 에 있다.

## 목적

클래스·세션 구조를 바꾸기 전에(Phase 1~8) **문구 · 권한 · 검증 기반**을 먼저 정리한다. 사용자에게 보이는 변화는 거의 없고(회원이 승인 전 리포트를 더 이상 보지 못함, client 토큰의 세션 생성 차단), 이후 모든 Phase 가 기대는 안전망을 만든다. 기능 추가가 아니다.

| 기반 | 이후 Phase 가 필요로 하는 이유 |
|---|---|
| 용어 사전·키 기반 배지 | Phase 2 가 라벨을 바꿀 때 `label === '클래스'` 비교가 배지를 조용히 깨뜨리는 것 방지(`기획.md` X20) |
| `authorize_session` 단일화 | Phase 3 이 "진행 강사 포함"을 **한 곳**에서 바꾸게 함(복제 9곳 → 1곳) |
| 세션 생성·수정 역할 가드 | 현재 로그인만 확인 — client 가 호스트 세션을 만들 수 있는 틈 |
| PostgreSQL `alembic upgrade head` CI 스모크 | 마이그레이션이 PG 에서 처음 도는 곳이 dev 배포(X1·X9·X16) |
| 구 계약 회귀 스냅샷 | 구 앱(Capacitor 번들, 강제 업데이트 없음)이 `/sessions/*` 로 계속 동작해야 함(X7) |
| 승인 전 리포트 노출 검증(R6-X1) | 클래스 리포트 **일괄 승인 게이트**(Phase 5)의 전제이자 개인정보 위험(X14) |
| M0 사전 조회 설계 | Phase 1 백필 분류 규칙 승인의 근거(분포·기준선 차이·스냅샷) |

## 범위 (기획 §9 Phase 0, 변경 없음)

1. **영역별 용어 사전** `frontend/src/lib/terms.ts` + 서버 골격 `backend/app/services/session_terms.py`. 탭·사이드바 배지를 **키 기반**으로(비교식 10개 / 3개 파일 — 기획의 "3곳"은 파일 수). 용어 가드(`BANNED_COPY`·`class-flow-shell-terms.test.ts`)를 영역별로 분리. **한 글자도 바꾸지 않음**(사전 값 = 현행 리터럴 복사본).
2. **`authorize_session`**: 복제 호스트 판정 헬퍼 9곳(6개 파일, 호출 33곳)을 응답 바이트 동일한 리팩터로 단일 모듈 `services/session_authz.py` 에 통합.
3. **역할 가드**: `POST /sessions`·`PUT /sessions/{id}`·`duplicate`·`save-as-template`·`new-run` 에 `require_roles("counselor","org_admin")`. client 정상 경로 유무를 조사했고(없음 — `investigation/02`) 가드 적용.
4. **PG CI 스모크**: PostgreSQL 16 서비스 컨테이너에서 빈 DB `alembic upgrade head` + 스키마 덤프 복원본 `upgrade head`. **현재 빈 DB 업그레이드가 실패**하므로 리비전 `30c1bfbc724f` 멱등화를 포함(스키마 변경 아님).
5. **구 계약 회귀 스냅샷**: `/sessions/*` 61 라우트의 OpenAPI 서브셋 골든(가산 전용 규칙) + 응답 형태 골든 17 시나리오.
6. **R6-X1**: 회원이 승인 전(`pending_review`)·생성 중·실패 리포트를 목록·상세·홈에서 볼 수 있음을 **확인했다(노출 확정)**. 쿼리 수준 필터 수정 + 테스트 고정.
7. **M0 사전 조회 설계**: 분포 조회 SQL(A1~A11, 집계만, 읽기 전용 3중 강제), 기준선 102건 vs SDD-210 "134건" 판별 질의, 수동 RDS 스냅샷 절차. **실행은 구현 단계**(Brian 승인 후).

## 비범위 (Phase 1 이후 · 이번에 하지 않음)

- 신규 테이블·컬럼·`classes`·`counseling_relationships`·백필·`/classes/*` API·`area` 필드 (Phase 1).
- 라벨 변경(`명상 클래스`·`지도사`·`상담 N회차`·`구성원` 등 D-62 값) — Phase 2. Phase 0 은 영역 차원 **구조**만 만들고 값은 동일.
- 메일 본문·푸시 문구의 사전 이전, 에러 `detail` 문구 매핑 (Phase 2).
- `report-status`·WS `report:progress` 의 상태 문자열을 회원에게 가리는 변경(호스트 UI 와 공유 필드 — 후속).
- 클래스 일괄 승인·강사 확장(`approve_all_reports` 호스트 한정 유지), `_can_access_report` 계열·`set_speaking`·`video.py` platform_admin 우회·`export_service.authorize` 통합(Phase 3).
- 기존 SQLite 단위 테스트 스위트의 PG 전환, 복합 FK·진행자 정확히 1명 PG 테스트(해당 테이블이 생기는 Phase), `alembic check` 차단 승격(모델↔마이그레이션 드리프트 정리 후).
- 운영 DB 조회·prod 작업·SDD-210 인프라 변경, 브랜치 보호 설정 변경.
- 엔진(진행·입장·뇌파·녹음/STT/요약·리포트 생성) 수정.

## 확정 결정 (뒤집지 않음)

| # | 확정 | 출처 |
|---|---|---|
| 1 | 클래스=프로그램 / 세션=회차, 명상 클래스·상담 분리, 기관 단위 on/off 없음 | `기획.md` §3 |
| 2 | 추가형(nullable) 스키마만 · 구 `/sessions/*` 61 경로·세션 id·참여자 id 불변 · 엔진 불변 | `기획.md` §9 공통 원칙 |
| 3 | 롤백은 **코드 revert 뿐**, DB 는 되돌리지 않음. 마이그레이션 다운그레이드는 운영 롤백에 사용하지 않음 | `기획.md` §12 롤백 총칙 |
| 4 | **D-60**: 이전은 무중단. SDD-210 prod 컷오버와의 선후는 일정 확인 후 Phase 0 plan 에서 확정 → **일정 미확정이므로 `미확인`**(plan §9) | `결정-필요.md` 확정 기록 |
| 5 | **D-62**: 호칭 값(지도사·상담 N회차/상담 세션·내담자 메뉴 흡수·구성원)은 Phase 2 에서 적용. Phase 0 은 값을 바꾸지 않음 | `결정-필요.md` 확정 기록 |
| 6 | D-55·D-56·D-57(분류 규칙 기본값)·D-64(상담 메뉴 Phase 2 노출) | `결정-필요.md` 확정 기록 |
| 7 | Phase 0 은 DB 스키마 변경 없음 · 출시 단위 1회(릴리스 1) · 완료 기준: PG 스모크 · 구 계약 스냅샷 · client 토큰 세션 생성 403 · 분포 조회 결과 Brian 보고 | `기획.md` §9 Phase 0 |
| 8 | 7-Stage SDD: **verify 는 구현 전 승인 게이트**, 구현 후 완화 금지 | `CLAUDE.md` |

## 조사로 바로잡은 전제 (결정을 뒤집는 것이 아니라 사실 정정)

| # | 기획·브리프의 전제 | 조사 결과 | 근거 |
|---|---|---|---|
| 1 | 호스트 판정 복제 9곳 / **5개** 서비스 파일 | 9곳 맞음, **파일은 6개**(session·record·audio·video·session_email_invite·report). 9곳은 의미가 다른 **4계열**, 호출 33곳 | `investigation/01` §1 |
| 2 | `label === '클래스'` 3곳 | **3개 파일에 비교식 10개**(`클래스`·`채팅`·`알림`·`리포트`) | `investigation/06` §1.1 |
| 3 | 빈 DB 에서 `alembic upgrade head` 가능(SDD-210 T-15 전제) | **현재 실패.** 14번째 리비전 `30c1bfbc724f` 가 `chat_room_participants` 를 중복 생성(DuplicateTable). SDD-210 의 "85개"는 `__pycache__` 포함 — 실제 **84개**, head 1개 | `investigation/04` §0 |
| 4 | R6-X1 "미확인" | **노출 확정**(목록·상세·홈 카드, 상태 불문). 기존 테스트가 노출을 계약처럼 고정 | `investigation/03` §0·§2 |
| 5 | "SQL 초안만" (R7·R10) | 컬럼은 모두 존재하나 활성 참여자 정의가 서로 다르고(R7 vs R10), `WITH` 로 시작하는 질의는 기존 러너가 거부, `custom_type_name` 은 자유 입력(개인정보 가능) | `investigation/07` §1.2 |

## 완료 기준 (SDD 4종 + Phase 0 게이트)

spec(이 문서) + plan + verify(구현 전 승인) + summary(구현 후). 추가로 `기획.md` §9 Phase 0 완료 기준: **PG 스모크 통과 · 구 계약 스냅샷 통과 · client 토큰 세션 생성 403 테스트 · 분포 조회 결과 Brian 보고**. 자세한 합격 기준은 verify.md.

## 상태

- ① Spec: **작성 완료 — Brian go/no-go 대기** (2026-10-18)
- ② Plan / ③ Verify: 작성 완료. **사용자 결정 7건 + 확인 요청 1건**(plan §11, 모두 기본값 포함) 응답 후 verify 승인. 승인 전 어떤 Task 도 시작하지 않는다.
- ④~⑦: 미착수
