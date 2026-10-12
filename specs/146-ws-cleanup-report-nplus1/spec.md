# SDD-146 — WS 상태 정리 훅 · 리포트 N+1 (2건)

## 배경

코드 리뷰 잔여 마지막 백엔드 2건. WS 전역 상태 메모리 누수 + client 리포트 생성 N+1.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | WS-01 | session_live_namespace 전역 dict 5개(_active_signals, _last_aggregate_at, _last_group_average_at, _audio_states, _audio_revisions) 세션 종료 시 미정리 → 메모리 누수 |
| 2 | RPT-03 | client 리포트 생성이 참가자별 조회·생성·_serialize 반복(N+1) |

## 변경

1. **WS-01** — 세션별 정리 훅 `clear_session_state(session_id)` 추가, 소켓 레지스트리로 마지막 소켓 이탈/종료 시에만 정리. 단일 워커 배포 제약 docstring 문서화.
2. **RPT-03** — 기존 리포트·SessionRecord 배치 조회 + 서사 상태 공유 캐시로 N+1 제거. 멱등·중복 방지 유지.
