# SDD-336 — 수업 측정 미시작 원인 표시와 재진입 알림

- 상태: 대표 승인 완료(11/26) — Stage ③~⑥ 연속 진행
- 브랜치: `sdd/336-coach-measure-cause`
- 근거: 11/25 운영 몸돌봄 4회차(`b315616b…`)·마음돌봄 3회차(`e433f9ea…`) 측정 실패 사후 조사
- 대표 결정: "1 반영, 2 리포트 발송은 지금처럼, 4 이건 다음 단계(대체 측정 이관은 수동)"

## Goal
코치가 라이브 화면에서 "왜 측정이 안 되는지"를 보고 바로 안내할 수 있게 하고, 앱을 열지 않은 회원에게 서버가 재진입을 알린다. 12/2 수업 전 운영 반영.

## In-scope
1. `live-metrics` 회원 행에 `measure_issue_reason`(1필드, 마이그레이션 0) 추가. 코치 카드에 원인 라벨 + 행동 안내 1줄(점수·등급 없음).
   - 판정 우선순위: `app_update_required` > `consent_declined` > `app_not_in_class` > `not_started`.
2. 수업 시작 후 측정 미시작 150초 초과 회원에게 앱 푸시 최대 2회(회차당 회원당), 측정 시작 시 중단. 기존 푸시 outbox·`device_tokens` 사용, 앱 수정 없음.
3. 수업 시작 순간 소켓 오류 3종 무해화(KeyError None / Session not found / TimeoutError).
4. 코치 리포트 `partial` 원인 확인·수정.

## Out-of-scope
- 리포트 발송 시점(현행 유지), 대체 측정 이관(다음 단계), 앱 코드(`frontend/android`, `frontend/ios`, `frontend/src/lib/ble`, `use-native-measurement*`, 입장/동의 화면), 앱 최소 버전 게이트 API.

## 조사 결과(근거)
- `partial` 원인: 몸돌봄 4회차 참가 47명 중 17명이 리포트 제외(`report_included=false`). 제외자가 1명이라도 있으면 `strip_counselor_shared_sources`가 `ai_record`를 `{not_available, excluded}`로 덮어, 원래 `stt_disabled`(운영 STT 미제공 = 정상 → ready)였을 것이 `generation_status_for_content`에서 partial로 판정됨. 오류 메시지가 없는 것도 이 때문(실패가 아님). 결함이 아니라 판정 오분류.
- KeyError None / 'Session not found': `on_join` 처리 중 소켓이 끊겨 `sio.get_session` 이 KeyError. 핸들러 예외가 `Task exception was never retrieved` 로 남음.
- TimeoutError: 수업 시작 직후 입장 폭주로 이벤트 루프가 바빠 `emit_sync_factory._run` 의 5초 대기가 초과. 방송 실패는 heartbeat self-heal 이 복구(무해)하나 트레이스가 로그를 오염.

## Acceptance Criteria
- [ ] `measure_issue_reason` 우선순위·경계 단위 시험, 앱 버전 비교(1.0.1 미만·기록 없음)
- [ ] 코치 카드 라벨/안내 렌더, 점수·등급 없음, 밴드 미사용(거절)은 이상 집계 제외·라벨만 표시
- [ ] 푸시: 150초 경계, 회차·회원당 최대 2회, 데이터 들어오면 중단, 토큰 없으면 skipped
- [ ] 소켓 3종: 끊긴 sid 에서 예외 미전파, 타임아웃 한 줄 경고
- [ ] `excluded` 공통 기록 생략은 partial 이 아니다(ready)
- [ ] backend pytest(신규+관련), frontend vitest·tsc·eslint 통과

## Risks
- "앱 버전 기록 없음 = 업데이트 필요" 규칙은 웹 입장 회원도 해당될 수 있다 → 라벨 문구를 "앱 업데이트 확인"으로 완화하지 않고 대표 지시대로 두되, 웹 플랫폼 토큰 행은 판정에서 제외(웹은 밴드 앱 측정 대상 아님).
- 푸시 문구는 기존 outbox 발송기 페이로드(title/body/deeplink)를 그대로 따른다.
