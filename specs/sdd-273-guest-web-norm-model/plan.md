# SDD-273 — Plan

| # | 작업 | 파일 | 담당 |
|---|---|---|---|
| T1 | 모델 pin 순수 모듈(`buildWebModelPin`, `resolveWebCore`, `fetchActiveModelForStart`, 버전 규칙) | `frontend/src/lib/measurement-web/model-pin.ts`(신규) | 단독 |
| T2 | 워커 init 메시지에 `modelJson` 추가, 생성 직후 `set_model` 호출(실패 시 init_error) | `core.worker.ts`, `capture-adapter.ts`(StartArgs) | 단독 |
| T3 | `WebMeasurementSession.doStart`: 조회→pin→`resolveWebCore`; capture.start `modelVersion`·adapter meta·configJson 동일 값 | `web-measurement-session.ts` | 단독 |
| T4 | 시험 `tests/sdd273-*.test.ts`: 모델 pin 단위 / 세션 통합(워커 mock) / WASM 직접 구동 RED→GREEN | `frontend/tests/` | 단독 |
| T5 | 호흡·HRV 경로 비교(코드 + 가능하면 dev 원시 재생) | summary.md | 단독 |

순서: verify.md(구현 전) → T4 RED → T1~T3 GREEN → T5 → summary.
WASM 재생성: 불필요(`set_model` 기존 노출). 코어 변경이 필요해지면 `npm run wasm:build` 후 보고.
