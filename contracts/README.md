# contracts/ — SDD-246 T01 계약·골든 기준

> 소유: T01. 다른 Task는 읽기 전용 소비만 한다. 변경이 필요하면 T01(감독)에 요청한다.
> **G1(실측 골든)은 미충족**이다. 아래 모든 통과는 합성·독립 산술 기준이며 G1/G3 통과가 아니다 (`biosignal-golden/v1/manifest.json` → `status`).

## 구성

| 경로 | 내용 |
|---|---|
| `session-live-v2/schema/*.schema.json` | Socket.IO v2 command / event / ack / snapshot / metric / 기타 wire 의 JSON Schema(draft-07) |
| `session-live-v2/fixtures/{valid,invalid}/` | valid 57건, invalid 66건(미지원 major·알 수 없는 kind·개인정보/토큰/서명URL 누출·타인 지표·종합점수·0 대체·u64 초과 등) |
| `session-live-v2/validate.mjs` | 스키마 + 의미 규칙(누출, audience 범위, u64 범위, window 순서) 검증기 |
| `session-live-v2/wire-compat.json` | Socket.IO/Engine.IO 버전 행렬, ACK 2초·백오프·heartbeat 상수 (lockfile 과 시험으로 동기) |
| `biosignal-golden/v1/packets, expected/` | GF01/GF02 바이트 정본 binary + expected JSON (독립 산술) |
| `biosignal-golden/v1/synth/` | 결정적 시드 합성 EEG/PPG/ACC 스트림(150초, 4500패킷, 352,500B) — **실측 아님** |
| `biosignal-golden/v1/oracle/` | 기존 `frontend/src/lib/eeg/` 를 **수정 없이** 구동하는 runner + 단계별 expected hash |
| `biosignal-golden/v1/expected/scoring/` | GF05 점수 경계 (backend 독립 Python 스코어링) |
| `biosignal-golden/v1/consumers/` | 소비자 공통 decode 계약 시험 |
| `biosignal-golden/v1/manifest.json` | 파일/소스 해시, 규칙, G1 상태, 실측 fixture 추가 절차 |
| `measurement-bridge/schema/` | Capacitor facade(bridge.schema.json), 코어 C ABI JSON 경계(core-abi.schema.json) |
| `check-contracts.sh` | 위 전부를 한 번에 실행하는 진입점 (T12 `scripts/sdd246/check-contracts` 가 호출) |

## 실행

```bash
bash contracts/check-contracts.sh          # 6단계 전체 (약 10초)
SKIP_ORACLE=1 bash contracts/check-contracts.sh   # vitest oracle 생략(빠른 확인용, 인수 증거 아님)
```

의존성: node(frontend/node_modules 의 ajv 6, vitest 5 재사용), python3(생성기·검증기는 표준 라이브러리만). 점수 생성기만 backend venv를 읽기 전용으로 import. dev `.env`·DB·네트워크는 읽지 않는다.

## 소비 방법 (Task별)

공통 규칙: **expected 를 자기 구현으로 재생성하지 않는다.** 소비자는 `packets/`·`synth/` 입력을 자기 언어로 처리해 `expected/` 와 비교한다. 정수·분기·status·null 은 정확 일치, 실수는 Spec N07 허용오차.

### T02 — Rust 코어 (`packages/measurement-core/`)
1. `tests/packet_clock.rs`: `biosignal-golden/v1/packets/**.bin` 을 `push_packet` 에 넣고 `expected/gf0*.json` 의 `strict_status`, `status`, `event`, `segment`, `extended_ticks`, `samples` 와 비교. 규칙 정의는 `manifest.json → packet_rules, clock_rules`.
   - `gf01_*`: EEG signed24/leadoff bit0·bit2, PPG 헤더 LE(1초=32768tick), ACC LE int16. `ch*_uv_sdk_float` 는 SDK 연산 순서(`signed*4.033/12/(2^23-1)*1e6`)와 비트 단위 동일해야 한다.
   - `gf02_*`: 센서별 독립 원점, 32bit wrap, reset → 새 segment, duplicate/conflict/out_of_order(원문 보존·분석 제외), 잘린 패킷 invalid(`raw_preserved:true`).
2. `tests/dsp_parity.rs`: `synth/stream.bin` + `synth/schedule.json`(`[arrival_us, sensor, offset, len]`) 입력 → `expected/oracle/{decoded,clock,eeg_psd_bandpower,eeg_raw_indices,ppg_peaks_rr,hrv_sdnn_respiration,display}.json`. 단계 hash 는 `manifest.json → oracle.stage_hashes`. 같은 입력을 batch 크기를 바꿔도 동일해야 한다.
3. ABI JSON 경계는 `measurement-bridge/schema/core-abi.schema.json`(`CoreConfig, PushPacketCall, CoreOutput, MetricFrame, FinalManifest`).
4. **알려진 oracle 차이**(`manifest.json → oracle_divergences`): 기존 TS 파서는 나머지 바이트가 있는 패킷을 일부 샘플로 받아들인다(3건). v1 계약은 `invalid_remainder` 이다 — T02 는 strict 를 따른다. 이 차이를 숨기려고 oracle 을 고치지 않는다.
5. 앵커: v1 profile 은 현 웹의 "헤더 = 마지막 샘플"(D09). `expected/gf01_*.json → anchor_offsets_us` 에 SDK(첫 샘플)와 현 웹(마지막 샘플) 두 의미의 µs offset 을 모두 기록해 두었다. ACC 는 33333µs 반올림 profile.

### T03 — backend 명령/원장
- `session-live-v2/schema/command.schema.json` 의 `kind` 별 payload 를 pydantic 모델의 정본 대조 대상으로 삼는다(unknown 필드·kind 거절, 인가 `x-authorization` self/host).
- `ack.schema.json` 의 `status/committed/code/retry_after_ms` 조합 규칙, `metric.schema.json` 의 `MetricAck`(accepted 는 `durable:true`) 를 계약 시험에 포함.
- `fixtures/{valid,invalid}` 를 그대로 `jsonschema` 로 검증하는 backend 시험을 두면 계약 드리프트를 잡는다(`pip install jsonschema` 는 T03/T12 결정; 현 backend venv 에는 없음).
- backend 스코어링 패리티: `expected/scoring/gf05_scoring.json` (`legacy_cohort` 71점, `active_sigmoid` 112점+half 경계 5점). 같은 mode·model 끼리만 비교.

### T06 — 웹 reducer / WASM / bridge facade
- reducer 입력은 `event.schema.json`·`snapshot.schema.json`. `fixtures/valid/event-*`, `snapshot-*` 를 reducer 단위 시험 입력으로 사용(도메인 소유권, `(domain,entity_id)` 버전 비교, null 이 숫자를 덮지 않음).
- bridge 타입은 `measurement-bridge/schema/bridge.schema.json` 에서 생성(수동 복제 금지). 이벤트 순서/세대 판정은 `measurement-bridge/validate.mjs → classifyEvent` 의 규칙(`discard_stale_generation / resnapshot_new_generation / discard_duplicate / gap_resnapshot / apply`)을 그대로 구현.
- WASM worker: `consumers/decode-conformance.test.mjs` 의 Buffer 디코더가 최소 기준이며 `expected/` 와 동일 결과가 나와야 한다.

### T07 (iOS) / T08 (Android)
- Swift/Kotlin 은 `bridge.schema.json` 의 8개 메서드·4개 이벤트와 `Capabilities / MeasurementSnapshot` 을 Codable/data class 로 생성한다. 필드 추가는 선택 필드만, 의미·단위·필수 변경은 major.
- `MeasurementSnapshot.collection.counters.js_heartbeat_independent` 는 항상 `true`(native counter 가 JS heartbeat 와 무관함을 G1 증거로 남김). `archive.queue.disk_limit_bytes` 는 512MiB 고정(D07).
- native Socket.IO 클라이언트 라이브러리는 선택 후 `session-live-v2/wire-compat.json → native_clients` 에 버전을 추가하고 합성 서버 handshake/ack/reconnect 결과를 evidence 에 남긴다.
- 합성 스트림(`synth/`)을 BLE notification 대신 주입하는 spike 입력으로 쓸 수 있다. 단, 실기기 G1 은 대체하지 않는다.

## 변경 규칙
- `manifest.json` 의 `files` 해시가 현재와 다르면 `check` 가 실패한다. expected 변경은 감독 승인 후 `ORACLE_WRITE=1`(oracle) → `python3 -I biosignal-golden/v1/tools/build_manifest.py build <repo>` 순서로만 한다.
- 구현자가 expected fixture 를 수정하면 T11 재검토 전에 인수하지 않는다.
- `frontend/src/lib/eeg/`, `backend/app/services/eeg_metrics.py` 변경은 manifest 의 oracle/backend 소스 해시를 깨뜨려 즉시 드러난다(의도된 동작).

## 실측 골든 추가 (G1 충족 절차)
`manifest.json → add_real_fixture_procedure` 8단계 참고. 요약: 동의된 비식별 raw 를 원 바이트+도착 monotonic µs 로 저장 → `runOracle(streamDir)` 로 단계 hash 생성 → 독립 산술로 decoded 교차 확인 → 불일치는 단계별 resolve → 감독 승인 후 manifest 갱신 → T11 의 3 플랫폼 실행 기록 후에만 G1 충족 표시.
