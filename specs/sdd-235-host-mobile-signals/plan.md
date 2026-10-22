# SDD-235 구현 계획

## FE — 승인된 A안 (2026-10-22)
Brian의 10/22 확정 및 구현 지시를 승인 근거로 한다. BE 절은 별도 워커가 관리한다.

1. 모바일 도크 위 76px 상시 신호 줄, 데스크톱 상단 진입점, 독립 손들기·익명 신호 시트를 연결한다. 0건도 활성 버튼이며 흐리게 표시한다. 기존 도크 5개 유지, 밴드 미착용 타일에도 손들기·발언권 표시.
2. 손 내리기는 기존 lower-hand API를 사용하고 처리 중 중복 방지·실패 안내를 제공한다. 백엔드는 수정하지 않는다.
3. 순수 이벤트 정책과 호스트 토스트를 구현한다. 핵심 3종만 무음, 종류별 묶음, 한 장, 4~6초, 시트 진입. 초기 스냅샷·중복·만료·동일 주제 시트·세션 전환을 검증한다. 조용한 신호에는 이름을 전달하지 않는다.
4. 신규 vitest RED→GREEN 및 기존 host 회귀, 타입·변경 파일 eslint·build를 실행한다.
5. Chrome 실제 HostLiveView 하니스에서 390/1440 상태별 캡처, 독립 리뷰, summary 작성 및 기능 브랜치 푸시. PR·배포 없음.

### FE 파일 책임
- UI: HostLiveView, HostParticipantGrid, host-player.css, sheets, host-player-case.
- 이벤트: HostLiveContainer, quiet-signal 및 새 호스트 토스트 정책/훅.
- 검증: 기존 host 테스트 하니스 확장, 신규 테스트 및 screens.


---

<!-- 아래는 BE 워커(sdd/235-be-host-lower-hand, ec238af4)가 쓴 BE 절 — 감독이 병합 -->

# SDD-235 — Plan

> FE 절은 프론트 워커가 별도로 추가한다. 이 파일의 BE 절만 백엔드 워커가 작성했다.

## BE — 상담사(진행자)의 회원 손 내리기

### 결정 (Brian 확정 10/22)
- A안 + 핵심 신호 무음 토스트 + **상담사가 회원 손 내리기 포함**.
- 마이그레이션 없음. 기존 엔드포인트 확장.

### API 계약
`POST /api/v1/sessions/{session_id}/participants/{participant_id}/lower-hand` (경로·메서드 불변)

| 호출자 | 결과 |
|---|---|
| 세션 호스트(`s.host_id`)이며 `set_speaking`과 같은 인가(`authorize_session(..., LIVE_METRICS_READ)`) 통과 | 200, 타 참여자 손 내리기. `lowered_by="host"` |
| 대상 참여자 본인(로그인/`X-Entry-Credential`) | 200 (기존 동작). `lowered_by="self"` |
| 다른 회원·비진행 로그인 사용자 | 403 (기존 `_authorize_participant_access`) |
| 자격 없음/위조 | 401/403 (기존) |

- 응답(`SpeakingStateResponse`)에 `lowered_by: "self" | "host" | null` 추가. lower-hand 외 엔드포인트는 null.
- 종료·취소 세션 400, 세션/참여자 없음 404, 멱등(이미 내려가 있으면 통지 없음), `speaking` 유지, 변경 시 `_notify_speaking_changed` 재사용 — 모두 기존과 동일.
- 인가는 `_is_speaking_manager`(호스트 + `authorize_session(LIVE_METRICS_READ)`, set_speaking과 동일 규칙)로 판정한다.
- 호스트 판정 우선: 호스트 로그인이면 호스트 경로, 아니면 기존 본인 경로로 폴백.

### 변경 파일
- `backend/app/services/session_service.py`: `_is_speaking_manager`, `lower_hand` 분기, 반환에 `lowered_by`.
- `backend/app/schemas/session.py`: `SpeakingStateResponse.lowered_by`.
- `backend/app/api/v1/session.py`: lower-hand docstring.
- `backend/tests/test_sdd094_speaking_rights.py`: 호스트 내리기·403·멱등 테스트.
