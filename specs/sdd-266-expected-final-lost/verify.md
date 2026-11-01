# SDD-266 — Verify (구현 전 QA 체크리스트)

| ID | 시나리오 | 기대 |
|---|---|---|
| V-F01 | prev{87,8/8/7,false} + next{87,1/1/1,true} 병합 | final=true, raw 8/8/7 유지(낮추지 않음) |
| V-F02 | 뒤처진 next 가 final=false | final 은 prev.final 유지(되돌림 없음) |
| V-F03 | prev.final=true 이후 어떤 next(final=false, 낮은 값 포함) | final=true 유지 |
| V-F04 | 병합 후 전송 본문 = max 총량 + final=true (서버 규칙 ① 에 걸리지 않는 값) | PUT body raw 8/8/7, final=true |
| V-F05 | 종료 이벤트 미수신 + 스윕 complete(raw 1/1/1, complete=true) | final=true 보고 1회 도달 |
| V-F06 | stop 응답 SEALING → 합성 이벤트 → hub.markEnding → 즉시 final=true | 간격 제한 무시하고 전송 |
| V-F07 | stop 합성 이벤트 payload = 네이티브 payload 와 같은 키(sessionId,state) | iOS·Android 동일 |
| V-F08 | 네이티브 SEALING 이벤트가 나중에 또 와도 중복 보고 없음(멱등) | PUT 추가 없음 |
| V-F09 | 오프라인에서 종료 → 복귀 시 final=true 1건만 전송 | 레코드 1건, final=true |
| V-F10 | 오프라인 중 앱 재기동(restore) 후 복귀 | IDB 의 final=true 전송 |
| V-F11 | 총량 단조: 이후 더 낮은 raw 가 와도 저장값 불변 | max 유지 |
| V-F12 | 종료 후 총량이 늘면(9/9/8) final=true 유지한 채 증가 보고 | final=true, raw 9/9/8 |
| V-F13 | 같은 최종 값 반복 제출 | 추가 PUT 없음 |
| V-F14 | 서버 계약 불변: 본문 필드·단조·final 규칙 ①②③ 과 모순 없음, 보내는 raw 는 항상 이전 전송값 이상 | 단조 |
| V-F15 | sessionId 없이 stop(startMeasurement 이력 없음) | 합성 이벤트 생략, 예외 없음 |
| V-F16 | 안드로이드 `ArchiveQueue` 재생성 시 verified+payload 삭제 항목도 `signalCounts` 에 포함 | 총량 보존 |
| V-F17 | payload 없는 non-VERIFIED 항목은 기존처럼 건너뜀 | 불변 |
| V-F18 | `gcVerified` 후 같은 alias 재투입 거부(dedupe 유지) | 중복 청크 없음 |
| V-F19 | 기존 SDD-260/264/265 JS 시험·`tsc -b`·eslint 회귀 | 0 |
| V-F20 | iOS 큐는 verified 항목을 저널에 유지(코드 확인) + 컴파일/시험 | 변경 불필요 |
