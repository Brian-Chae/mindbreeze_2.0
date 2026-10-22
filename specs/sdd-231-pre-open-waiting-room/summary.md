# SDD-231 summary

## 구현
- 서버: 시작 예정 3시간 전~3시간 후(설정 2개)에 `ready`/`scheduled` 반복 회차도 초대·코드 입장 허용. 출석(`mark_entered`)·LiveKit 토큰은 열린 뒤.
  - `config.py` lead/grace, `class_code_service.pre_open_entry_allowed`·`find_enterable_session`, `session_service._enter_resolved`·`participant_livekit_token`·`_session_not_open_detail`
- 화면: 10분 초과 남으면 `시작까지 N분 남았어요`(1초 갱신), 이하면 일반 문구. 열리기 전 presence 전송. 409 detail.scheduled_at로 '아직 열리지 않았어요' 카드에도 표시.
- 마이그레이션 없음.

## 테스트
- pytest PG(`tests/pg` 전체) 457 통과(신규 8), SQLite 입장·즉석·코드 관련 61 통과
- vitest 입장·즉석 관련 768 통과(신규 8), `npx tsc --noEmit` 통과

## 한계
- 실서버 LiveKit·WS·dev E2E 미실시(금지 범위). 사전 입장자의 상담사 로비 표시는 기존 presence 훅 재사용분만 확인(훅 mock).
