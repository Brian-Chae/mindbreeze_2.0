# SDD-231 — 예약 클래스 시작 전 대기실 입장과 남은 시간 안내

- 상태: Stage ① Spec 완료
- 브랜치: `sdd/231-pre-open-waiting-room`
- 작성일: 2026-10-22
- 기준 커밋: PR #33(`fix/instant-class-member-wait`, EntryPage notyet 깜빡임 수정) 위에서 작업

## 1. 문제

예약(반복·고정형) 클래스는 회차 status가 `open`/`in_progress`가 아니면 초대 입장·코드 입장 모두 409 `session_not_open`
(`session_service._enter_resolved`, `join_session`)이고 코드 입장은 `find_enterable_session`이 404로 막는다.
그래서 회원은 시작 시각 전에 대기실에 미리 들어가 있을 수 없고, 얼마나 남았는지도 알 수 없다.

## 2. 확정 요구 (Brian)

1. 예약 클래스도 회차가 열리기 전에 초대받은 회원(로그인 초대 입장·코드 입장)이 대기실에 들어갈 수 있다. 상담사가 회차를 열고 시작하면 자동으로 이어서 진행한다.
2. 시작 예정까지 **10분 초과** 남았으면 대기실/입장 화면에 남은 시간과 시작 시각을 표시한다(`시작까지 32분 남았어요`). **10분 이하**면 일반 대기 문구. 실시간 갱신.
3. 너무 이른 입장은 허용 구간 밖이면 지금의 `아직 열리지 않았어요`(남은 시간 표시) 화면.

## 3. 입장 허용 구간 (결정 항목 — 기존 정책 없음)

저장소에 사전 입장 정책이 없다(조사: docs/specs/backend 전수 검색, 15분 전 규칙은 강사 교체 타임아웃뿐). 기본값을 둔다.

- **시작 예정 시각 3시간 전 ~ 3시간 후** (`class_pre_open_entry_lead_minutes=180`, `class_pre_open_entry_grace_minutes=180`, `config.py`).
- 뒤쪽 3시간은 상담사가 늦게 여는 경우. 그보다 지난 미개설 회차(며칠 전 놓친 회차)는 계속 막는다.
- 구간 안이면 `ready`/`scheduled` 반복 클래스 회차에서 대기실 입장 허용. 구간 밖은 409 `session_not_open` 유지, 응답 detail에 `scheduled_at`을 실어 화면이 남은 시간을 보여 준다.

## 4. 서버 규칙

| 항목 | 규칙 |
|---|---|
| 입장(`enter`, `enter/{id}`) | 허용 구간이면 `ready`/`scheduled` 반복 회차도 참여자 생성·입장 자격 발급. 정원·대기열(`is_waitlisted`) 로직은 그대로 |
| 출석 | 사전 입장은 `mark_entered`(출석·`entered_at`)를 **하지 않는다**. 실제 라이브 입장(LiveKit 토큰 발급 시점)에 최초 1회 기록 |
| LiveKit 토큰 | 회차가 `ready`/`scheduled`이면 `participant_livekit_token` 409 `session_not_open`. 호스트가 시작해 방이 열린 뒤에만 발급 |
| 코드 입장 조회 | 반복 클래스 코드: open/in_progress 회차가 없으면 허용 구간 내 `ready`/`scheduled` 회차가 **정확히 1개**일 때 그 회차 반환(2개 이상·0개면 기존과 같이 404) |
| `join_session`(레거시 로그인 join) | 토큰 발급 경로이므로 유지(409). detail에 `scheduled_at`만 추가 |
| 즉석(instant)·비반복 클래스 | 동작 변경 없음 |
| 마이그레이션 | 없음 |

## 5. 화면 규칙

- `session_not_open` 오류의 `scheduled_at`으로 `아직 열리지 않았어요` 카드에 시작 시각·남은 시간 표시.
- 입장 확인(`EntryConfirmView`, wait 모드): 10분 초과면 `시작까지 N분 남았어요 · 오후 3:00 시작`, 이하면 기존 `열리면 자동으로 입장해요 · 이 화면을 열어 두세요`. 1초 단위 갱신.
- 열리기 전에도 상담사 로비 presence(`useWaitingRoomPresence`)를 보낸다(`confirm`+`unopened`).
- 열리면 기존 상태 머신(`unopened → open → wizard`)이 자동 진행. 머신 변경 없음.
- 남은 시간 문구: 60분 미만 `N분`, 이상 `H시간 M분`(M=0이면 `H시간`), 며칠 전이면 `D일 H시간`은 쓰지 않고 허용 구간 밖 카드에서 날짜 표기(`formatWhen`).

## 6. QA 리스트 (수락 기준)

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | 반복 클래스, 시작 30분 전, 초대 회원 로그인 입장 | 200, 입장 자격 발급, 참여자 `entered_at` 없음, 출석 `expected` 유지 |
| 2 | 같은 조건, 코드 입장 | 200 |
| 3 | 허용 구간 밖(5시간 전) | 409 `session_not_open` + `scheduled_at` |
| 4 | 사전 입장 후 LiveKit 토큰 요청 | 409 `session_not_open`, 토큰 없음 |
| 5 | 상담사가 열고 시작 후 토큰 요청 | 토큰 발급 + 출석 `attended`, `entered_at` 기록 |
| 6 | 정원 가득 찬 회차 사전 입장 | 대기열(`is_waitlisted`) 규칙 유지 |
| 7 | 즉석 클래스 입장 | 기존과 동일 |
| 8 | 32분 남음 | `시작까지 32분 남았어요` + 시작 시각, 시간 경과 시 갱신 |
| 9 | 10분 이하 | 일반 대기 문구 |
| 10 | 대기 중 서버 status가 open/in_progress | 자동으로 준비 단계/진행 |
