# SDD-273 — Summary

## 결과
| 항목 | 상태 | 근거 |
|---|---|---|
| 모델 미적용(집중·이완·감정균형 0/100 포화) | **원인 확정 + 수정** | 웹 WASM 코어가 `legacy_cohort` 고정, `set_model` 미호출(코드·시험으로 재현) |
| 호흡·HRV 차이 | **원인 미확정** (아래 가설) | 코어 입력 차이(앵커·도착 지터·BLE 묶음)로는 재현되지 않음 |

## 변경
- `frontend/src/lib/measurement-web/model-pin.ts`(신규): 활성 모델 조회(캐시→재시도 400ms/1.2s, 총 3초 한도), `buildNativeModelPayload` 재사용 검증, `sigmoid-<version>`/sha256 hash, `resolveWebCore`.
- `web-measurement-session.ts`: 시작 시 1회 조회·pin. capture.start `modelVersion` = 코어 config = envelope 메타 동일 문자열. 조회·검증 실패는 legacy 로 시작(세션 중 교체 없음).
- `core.worker.ts`·`capture-adapter.ts`: init 에 `modelJson`, 코어 생성 직후 `set_model`(실패 시 `init_error` → `core_unavailable`, 서버 요청 없음).
- 서버 변경 없음(`/normalization/models/active` 는 무인증 공개 라우터). WASM 재생성 불필요(`set_model` 기존 노출, WASM 산출물 = 현재 코어 소스 커밋).
- `packages/measurement-core/examples/replay_model.rs`(신규): 네이티브(FFI 와 같은 api 경로)로 golden 재생 → 표시 지표 JSON.
- 시험: `tests/sdd273-wasm-model.test.ts`, `tests/sdd273-session-model.test.ts`, fixture `tests/fixtures/sdd273/native-{legacy,active}.json`. 기존 `t06c-wiring`/`t06c-hook` 은 조회 mock 만 추가.

## 정책 결정(spec §3)
조회 실패 시 legacy 로 시작하고 **이후 모델이 도착해도 적용하지 않는다** — 네이티브 1회 pin 과 동일, 서버 stream 의 `model_version` 이 capture.start 에 고정되고, 도중 교체는 곡선 불연속을 만든다.

## 시험 실제 결과
- golden 합성 입력(149 프레임), 웹 WASM:
  - focus: 모델 없음 min0/max100 (포화 100프레임) → 모델 적용 min2/max100 (포화 48)
  - relaxation: 모델 없음 값 없음(코호트 폴백 없음) → 모델 72~87
  - emotion: 모델 없음 포화 98 → 모델 71~100 (포화 50)
- **웹(WASM) = 네이티브(Rust)**: 같은 패킷+같은 모델 → focus/relaxation/emotion 표시값 허용오차 0 완전 일치, bpm/resp/sdnn 1e-9 이내, 모델 미적용도 일치.
- vitest `tests/sdd246-web tests/sdd273` 134 passed / 1 skipped; 확장 묶음(sdd272·sdd244·fix-live/native/resp/hrv/ppg) 300 passed 후 훅 시험 1건 수정해 재통과. `tsc -b` 오류 0, eslint 오류 0.

## 호흡·HRV 규명 결과
같은 golden 입력으로 웹 방식 호출을 코어에 재현해 비교:
| 조건 | bpm | resp | sdnn |
|---|---|---|---|
| 네이티브 고정 앵커 vs 웹식 앵커(패킷마다 wallMs=Date.now, anchor=arrival) | 일치 | 일치 | 일치 |
| 도착 지터(지연 최대 140ms) | 평균 70.47 동일 | 15.00 동일 | 48.69→48.71 |
| BLE 묶음(2초·5초 경계 도착) | 70.47→70.48/70.45 | 15.00 동일 | 48.69→48.53/48.62 |

→ 코어는 앵커·도착 시각 차이에 둔감하다. 모델 정규화 변경은 호흡/HRV 에 영향 없음(모델 유무 resp/sdnn 동일 확인).

### 미확정 — 남은 가설(이번에 못 확인)
1. 화면 값 우선순위: `MemberClassContainer` 는 서버 LiveState(웹 코어가 보낸 값)를 우선 쓰고, 없을 때 로컬 `useBand` JS 분석값을 쓴다. 게스트는 두 출처가 번갈아 보일 수 있다(코드 추정, 실측 안 함).
2. `raw-capture.ts` 는 PPG 헤더를 big-endian 으로 읽는다(`getUint32(0, signal !== 'ppg')`). Rust 코어는 PPG 도 little-endian. 라이브 지표는 원문 bytes 를 코어에 넘겨 영향 없으나, 저장 경로(`capture-session`/`raw-clock`)의 PPG tick 에 영향 가능 — 저장 로직 불변 원칙으로 수정하지 않음.
3. 실기 BLE 환경(Web Bluetooth 알림 누락·중복·순서 역전)은 시뮬레이션 밖. dev 에 저장된 같은 회차 원시 재생은 시도하지 않았다(운영 vc40 데이터는 prod 이므로 접근 금지 범위).
- 필요 계측(additive 제안): 웹 경로에서 PPG 패킷 `status`(accepted/duplicate/out_of_order) 카운트를 `live-diag` 로 기록 → 실기 후 비교.

## 확인 못 한 것
실기(앱+JS BLE) 화면 확인, dev 원시 재생, 앱 번들 반영 후 동작.
