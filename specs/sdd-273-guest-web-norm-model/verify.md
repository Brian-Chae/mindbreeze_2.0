# SDD-273 — Verify (구현 전 체크리스트)

| ID | 시나리오 | 기대 |
|---|---|---|
| V1 | 모델 미적용 코어(legacy_cohort)에 극단 입력 | 지표가 0/100 경계에 포화(RED 재현) |
| V2 | 같은 입력 + 같은 모델 JSON을 `active_sigmoid` + `set_model` 로 | 포화 해소, focus/relaxation/emotion이 모델 식과 일치 |
| V3 | WASM(웹)과 Rust golden(`golden_oracle.rs` pinned model·stream.bin)의 같은 입력 | focus/relaxation/emotion 표시값 완전 일치(허용오차 0.1 이내 명시) |
| V4 | 활성 모델 있음 | 워커 init에 `modelJson`, config `model_mode=active_sigmoid`, capture.start `modelVersion` = 코어 config `model_version` = envelope 메타 |
| V5 | 모델 없음/유효지표 0/조회 실패 | legacy 유지(`b0-cohort-2`), 세션은 정상 시작 |
| V6 | 조회 일시 실패 후 재시도 성공 | 시작 지연 3초 이내, 모델 적용 |
| V7 | 세션 중 모델이 뒤늦게 도착 | 교체하지 않음(1회 pin) |
| V8 | 잘못된 모델(s≤0, direction 3) | 해당 지표 제외, 전부 무효면 legacy |
| V9 | `set_model` 실패 | `core_unavailable`, 서버 요청 없음 |
| V10 | tsc -b, eslint, 기존 `sdd272*`·`fix-*`·`sdd244*` 시험 | 통과 |
| V11 | 호흡·HRV | 경로 비교 결과와 원인 확정/미확정 기록 |
